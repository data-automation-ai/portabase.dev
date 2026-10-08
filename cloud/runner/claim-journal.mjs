import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePrivateDirectory } from './private-config.mjs';
import { acquireSupervisorLease } from './supervisor-lease.mjs';
import { configReference, PRIVATE_OPERATIONS, RUNNER_ID_RE } from './config-reference.mjs';

const fail = (code = 'invalid_claim_journal') => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(value).digest('hex');
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function syncDirectory(path) {
  let file;
  try { file = await open(path, 'r'); await file.sync(); }
  catch (error) { if (!(process.platform === 'win32' && ['EPERM', 'EISDIR', 'EINVAL', 'EBADF'].includes(error.code))) throw error; }
  finally { await file?.close(); }
}

/** One bounded state record; no polling history or private configuration.
 * A short exclusive lease serializes updates. Crashed writes/leases require
 * private review; no PID/time based lock stealing or automatic deletion.
 */
export async function createClaimJournal({ directory, owner, runnerId, origin }) {
  if (!/^[a-f0-9]{64}$/.test(owner || '') || !RUNNER_ID_RE.test(runnerId || '')
    || !origin?.startsWith('https://') || new URL(origin).origin !== origin) fail();
  const root = await validatePrivateDirectory(directory);
  let base = root;
  for (const part of ['.claim-journal', owner, runnerId, hash(origin)]) {
    await validatePrivateDirectory(base);
    const next = join(base, part);
    try { await mkdir(next, { mode: 0o700 }); await syncDirectory(base); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await validatePrivateDirectory(next); base = next;
  }
  const path = join(base, 'state.json'), staging = join(base, 'next.json');
  function jobBinding(job) {
    let reference;
    try { reference = configReference(job?.payload); } catch { fail('claim_response_mismatch'); }
    if (job.version !== 2 || job.runnerId !== runnerId || reference.runnerId !== runnerId
      || !PRIVATE_OPERATIONS.includes(job.type) || typeof job.id !== 'string' || !/^job_[A-Za-z0-9_-]{1,76}$/.test(job.id)
      || Object.keys(job.payload).some(key => !Object.hasOwn(reference, key))) fail('claim_response_mismatch');
    return { id: job.id, version: 2, runnerId, type: job.type, payload: reference };
  }
  function validate(state) {
    if (!exact(state, ['version', 'owner', 'runnerId', 'origin', 'sequence', 'requestId', 'state', 'job'])
      || state.version !== 1 || state.owner !== owner || state.runnerId !== runnerId || state.origin !== origin
      || !Number.isSafeInteger(state.sequence) || state.sequence < 1 || typeof state.requestId !== 'string' || !RUNNER_ID_RE.test(state.requestId)
      || !['pending', 'received', 'settled'].includes(state.state) || state.state === 'pending' && state.job !== null) fail();
    if (state.job !== null) {
      try { if (!equal(jobBinding(state.job), state.job)) fail(); } catch { fail(); }
    }
    return state;
  }
  async function read() {
    if (!await exists(path)) return null;
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 4096) fail();
    const file = await open(path, 'r');
    try {
      const opened = await file.stat();
      if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) fail();
      const bytes = Buffer.alloc(4097); let length = 0;
      while (length < bytes.length) { const { bytesRead } = await file.read(bytes, length, bytes.length - length, length); if (!bytesRead) break; length += bytesRead; }
      const after = await file.stat(), current = await lstat(path);
      if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
        || current.ino !== opened.ino || current.dev !== opened.dev || current.isSymbolicLink() || current.nlink !== 1) fail();
      return validate(JSON.parse(bytes.subarray(0, length).toString('utf8')));
    } finally { await file.close(); }
  }
  async function transaction(operation) {
    const lease = await acquireSupervisorLease({ directory: base, owner, runnerId, origin });
    try {
      if (await exists(staging)) fail();
      const current = await read();
      const { next, value } = await operation(current);
      if (next) {
        validate(next); const bytes = Buffer.from(JSON.stringify(next)); if (bytes.length > 4096) fail();
        const file = await open(staging, 'wx', 0o600);
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        await lease.assertOwned();
        await rename(staging, path); await syncDirectory(base);
      }
      return value;
    } catch (error) {
      if (['invalid_claim_journal', 'claim_response_mismatch', 'claim_assignment_conflict', 'claim_sequence_exhausted'].includes(error?.code)) throw error;
      fail();
    } finally { await lease.release(); }
  }
  function requestFor(state) {
    return { type: 'claim', version: 2, runnerId, claimProtocol: 1, claimSequence: state.sequence, claimRequestId: state.requestId };
  }
  function matchRequest(state, request) {
    if (!state || !equal(requestFor(state), request)) fail('claim_assignment_conflict');
  }
  return {
    async request() {
      return transaction(current => {
        if (current && current.state !== 'settled') return { value: requestFor(current) };
        if (current?.sequence === Number.MAX_SAFE_INTEGER) fail('claim_sequence_exhausted');
        const next = { version: 1, owner, runnerId, origin, sequence: (current?.sequence || 0) + 1,
          requestId: randomUUID(), state: 'pending', job: null };
        return { next, value: requestFor(next) };
      });
    },
    async accept(request, response) {
      return transaction(current => {
        matchRequest(current, request);
        const claim = response?.claim;
        if (response?.ok !== true || !exact(claim, ['protocol', 'sequence', 'requestId', 'runnerId'])
          || claim.protocol !== 1 || claim.sequence !== current.sequence || claim.requestId !== current.requestId || claim.runnerId !== runnerId
          || !Object.hasOwn(response, 'job') || current.state === 'settled') fail('claim_response_mismatch');
        let job = null;
        if (response.job !== null) {
          if (!['running', 'succeeded', 'failed'].includes(response.job?.status)) fail('claim_response_mismatch');
          job = jobBinding(response.job);
        }
        if (current.state === 'received' && !equal(current.job, job)) fail('claim_assignment_conflict');
        return { next: current.state === 'pending' ? { ...current, state: 'received', job } : undefined, value: job };
      });
    },
    async settle(request, job) {
      return transaction(current => {
        matchRequest(current, request);
        if (current.state !== 'received' || !equal(current.job, job === null ? null : jobBinding(job))) fail('claim_assignment_conflict');
        return { next: { ...current, state: 'settled' }, value: undefined };
      });
    },
  };
}
