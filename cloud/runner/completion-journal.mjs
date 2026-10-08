import { createHash } from 'node:crypto';
import { lstat, mkdir, open, opendir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configReference, PRIVATE_OPERATIONS, RUNNER_ID_RE } from './config-reference.mjs';
import { validatePrivateDirectory } from './private-config.mjs';
import { jobResultFromRecord, publicJobError, publicJobResult } from './job-result.mjs';

export const MAX_PENDING_COMPLETIONS = 100;
const MAX_RECORD_BYTES = 8192;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const time = value => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function syncDirectory(path) {
  let file;
  try { file = await open(path, 'r'); await file.sync(); }
  catch (error) { if (!(process.platform === 'win32' && ['EPERM', 'EISDIR', 'EINVAL', 'EBADF'].includes(error.code))) throw error; }
  finally { await file?.close(); }
}
async function makeDirectory(path) {
  await validatePrivateDirectory(dirname(path));
  try { await mkdir(path, { mode: 0o700 }); await syncDirectory(dirname(path)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await validatePrivateDirectory(path);
}
async function writeNew(path, value) {
  await validatePrivateDirectory(dirname(path));
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES) fail('invalid_completion_journal');
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await syncDirectory(dirname(path));
}
async function readRecord(path) {
  await validatePrivateDirectory(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_RECORD_BYTES) fail('invalid_completion_journal');
  const file = await open(path, 'r');
  try {
    const opened = await file.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) fail('invalid_completion_journal');
    const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const after = await file.stat();
    if (bytesRead > MAX_RECORD_BYTES || bytesRead !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) fail('invalid_completion_journal');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally { await file.close(); }
}

export function runnerJournalOwner(agentToken) {
  const owner = typeof agentToken === 'string' && /^pb_agent_([a-f0-9]{64})_\d{1,2}_[a-f0-9]{64}$/.exec(agentToken)?.[1];
  if (!owner) fail('private_runner_setup_required');
  return owner; // token bytes are never persisted
}

export async function createCompletionJournal({ directory, owner, runnerId, origin, clock = Date.now }) {
  if (!/^[a-f0-9]{64}$/.test(owner || '') || !RUNNER_ID_RE.test(runnerId || '') || new URL(origin).origin !== origin || !origin.startsWith('https://')) fail('invalid_completion_journal');
  const root = await validatePrivateDirectory(directory);
  let base = root;
  for (const part of ['.job-journal', owner, runnerId]) { base = join(base, part); await makeDirectory(base); }
  const pending = join(base, 'pending'), done = join(base, 'done');
  await makeDirectory(pending); await makeDirectory(done);
  function bindingFor(job) {
    const reference = configReference(job?.payload);
    if (job.version !== 2 || job.runnerId !== runnerId || reference.runnerId !== runnerId
      || !PRIVATE_OPERATIONS.includes(job.type) || typeof job.id !== 'string' || !/^job_[A-Za-z0-9_-]{1,76}$/.test(job.id)
      || Object.keys(job.payload).some(key => !Object.hasOwn(reference, key))) fail('invalid_completion_journal');
    return { owner, runnerId, origin, jobId: job.id, operation: job.type, reference };
  }
  function validateBinding(binding, key) {
    if (!exactKeys(binding, ['owner', 'runnerId', 'origin', 'jobId', 'operation', 'reference'])
      || binding.owner !== owner || binding.runnerId !== runnerId || binding.origin !== origin || hash(binding.jobId) !== key) fail('invalid_completion_journal');
    const normalized = bindingFor({ id: binding.jobId, type: binding.operation, version: 2, runnerId, payload: binding.reference });
    if (JSON.stringify(normalized) !== JSON.stringify(binding)) fail('invalid_completion_journal');
  }
  function validateReport(report, binding) {
    const keys = Object.keys(report || {}), required = ['type', 'version', 'runnerId', 'jobId', 'status', 'safeError'];
    if (!report || typeof report !== 'object' || Array.isArray(report)
      || required.some(key => !Object.hasOwn(report, key)) || keys.some(key => ![...required, 'result'].includes(key))
      || report.type !== 'finish'
      || report.version !== 2 || report.runnerId !== runnerId || report.jobId !== binding.jobId
      || !['succeeded', 'failed'].includes(report.status)
      || (report.status === 'succeeded' ? report.safeError !== null : report.safeError !== publicJobError(report.safeError))) fail('invalid_completion_journal');
    let result = null;
    try { result = publicJobResult(report.result); } catch { fail('invalid_completion_journal'); }
    if (result && (binding.operation !== 'backup' || report.status !== 'succeeded')) fail('invalid_completion_journal');
  }
  async function entry(path, key) {
    await validatePrivateDirectory(path);
    if (await exists(join(path, 'rejected.json'))) {
      if (await exists(join(path, 'started.json')) || await exists(join(path, 'finished.json'))) fail('invalid_completion_journal');
      const rejected = await readRecord(join(path, 'rejected.json'));
      if (!exactKeys(rejected, ['version', 'state', 'binding', 'report', 'at']) || rejected.version !== 1
        || rejected.state !== 'execution_rejected' || !time(rejected.at)) fail('invalid_completion_journal');
      validateBinding(rejected.binding, key); validateReport(rejected.report, rejected.binding);
      if (rejected.report.status !== 'failed') fail('invalid_completion_journal');
      return { state: 'execution_rejected', binding: rejected.binding, report: rejected.report };
    }
    const started = await readRecord(join(path, 'started.json'));
    if (!exactKeys(started, ['version', 'state', 'binding', 'at']) || started.version !== 1 || started.state !== 'execution_started' || !time(started.at)) fail('invalid_completion_journal');
    validateBinding(started.binding, key);
    if (!await exists(join(path, 'finished.json'))) return { state: 'execution_unknown', binding: started.binding };
    const finished = await readRecord(join(path, 'finished.json'));
    if (!exactKeys(finished, ['version', 'state', 'binding', 'report', 'at']) || finished.version !== 1 || finished.state !== 'execution_finished'
      || !time(finished.at) || JSON.stringify(finished.binding) !== JSON.stringify(started.binding)) fail('invalid_completion_journal');
    validateReport(finished.report, finished.binding);
    return { state: 'execution_finished', binding: finished.binding, report: finished.report };
  }
  function sameJob(left, right) { if (JSON.stringify(left) !== JSON.stringify(right)) fail('completion_binding_conflict'); }
  return {
    async completed(job) {
      const binding = bindingFor(job), key = hash(binding.jobId), path = join(done, key);
      if (!await exists(path)) return null;
      const old = await entry(path, key); sameJob(old.binding, binding);
      if (!old.report) fail('invalid_completion_journal');
      return old;
    },
    async pending() {
      await validatePrivateDirectory(pending);
      const result = [];
      for await (const child of await opendir(pending)) {
        if (result.length >= MAX_PENDING_COMPLETIONS) fail('completion_journal_full');
        if (!/^[a-f0-9]{64}$/.test(child.name) || !child.isDirectory() || child.isSymbolicLink()) fail('invalid_completion_journal');
        result.push(await entry(join(pending, child.name), child.name));
      }
      return result;
    },
    async start(job) {
      const binding = bindingFor(job), key = hash(binding.jobId), path = join(pending, key);
      if (await exists(join(done, key))) { const old = await entry(join(done, key), key); sameJob(old.binding, binding); fail('job_already_executed'); }
      await validatePrivateDirectory(pending);
      try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') fail('job_execution_unknown'); throw error; }
      await syncDirectory(pending);
      await writeNew(join(path, 'started.json'), { version: 1, state: 'execution_started', binding, at: new Date(clock()).toISOString() });
      return binding;
    },
    async finish(binding, report) {
      const key = hash(binding.jobId), path = join(pending, key);
      validateBinding(binding, key); validateReport(report, binding);
      const old = await entry(path, key); sameJob(old.binding, binding);
      if (old.report) { sameJob(old.report, report); return old; }
      await writeNew(join(path, 'finished.json'), { version: 1, state: 'execution_finished', binding, report, at: new Date(clock()).toISOString() });
      return { state: 'execution_finished', binding, report };
    },
    async reject(job, report) {
      // This reserves the same job slot as start(), but records no execution.
      // A crash during reservation leaves a blocked entry, never permission to run.
      const binding = bindingFor(job), key = hash(binding.jobId), path = join(pending, key);
      validateReport(report, binding);
      if (report.status !== 'failed') fail('invalid_completion_journal');
      if (await exists(join(done, key))) { const old = await entry(join(done, key), key); sameJob(old.binding, binding); fail('job_already_executed'); }
      await validatePrivateDirectory(pending);
      try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') fail('job_execution_unknown'); throw error; }
      await syncDirectory(pending);
      await writeNew(join(path, 'rejected.json'), { version: 1, state: 'execution_rejected', binding, report, at: new Date(clock()).toISOString() });
      return { state: 'execution_rejected', binding, report };
    },
    async acknowledge(completion, response) {
      const { binding, report } = completion, job = response?.job, key = hash(binding.jobId);
      validateBinding(binding, key); validateReport(report, binding);
      if (response?.ok !== true || !job || job.id !== binding.jobId || job.version !== 2 || job.runnerId !== runnerId
        || job.type !== binding.operation || job.status !== report.status || job.safeError !== report.safeError) fail('completion_acknowledgement_mismatch');
      let acknowledgedResult;
      try { acknowledgedResult = jobResultFromRecord(job); } catch { fail('completion_acknowledgement_mismatch'); }
      let reportedResult;
      try { reportedResult = publicJobResult(report.result); } catch { fail('completion_acknowledgement_mismatch'); }
      if (JSON.stringify(acknowledgedResult) !== JSON.stringify(reportedResult)) fail('completion_acknowledgement_mismatch');
      sameJob(bindingFor(job), binding);
      const target = join(done, key), source = join(pending, key);
      if (await exists(target)) { const old = await entry(target, key); sameJob(old.binding, binding); sameJob(old.report, report); return; }
      const old = await entry(source, key); sameJob(old.binding, binding); sameJob(old.report, report);
      await validatePrivateDirectory(done); await validatePrivateDirectory(pending);
      try { await rename(source, target); }
      catch (error) {
        if (!await exists(target)) throw error;
        const archived = await entry(target, key); sameJob(archived.binding, binding); sameJob(archived.report, report);
      }
      await syncDirectory(pending); await syncDirectory(done);
    },
  };
}
