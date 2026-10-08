import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJobRequest, claimNextJob, finishJob } from '../cloud/runner/job-intent.mjs';
import { jobResultRecord } from '../cloud/runner/job-result.mjs';
import { resolvePrivateJob } from '../cloud/runner/private-config.mjs';
import { engineArgvForJob, pullOnce } from '../cloud/runner/worker.mjs';

const runnerId = '11111111-1111-4111-8111-111111111111';
const otherRunner = '22222222-2222-4222-8222-222222222222';
const configRef = '33333333-3333-4333-8333-333333333333';
const projectRef = 'abcdefghijklmnopqrst';
const targetRef = 'bcdefghijklmnopqrstu0';
const reference = { version: 2, runnerId, configRef, configRevision: 3 };
const digest = text => createHash('sha256').update(text).digest('hex');
const claimedResponse = (body, job) => ({ ok: true, job: { ...job, status: 'running' },
  claim: { protocol: 1, sequence: body.claimSequence, requestId: body.claimRequestId, runnerId: body.runnerId } });
async function fixture(operation = 'backup') {
  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const directory = await mkdtemp(join(tmpdir(), 'portabase-private-config-test-'));
  await mkdir(join(directory, configRef));
  const engine = { projectRef, provider: { type: 's3', bucket: 'synthetic' }, backupDirectory: 'capsules', statusDirectory: 'status' };
  const engineBytes = JSON.stringify(engine);
  await writeFile(join(directory, 'engine.json'), engineBytes);
  const record = { ...reference, operation, projectRef, engineConfigPath: 'engine.json', engineConfigSha256: digest(engineBytes) };
  if (operation === 'backup') Object.assign(record, { excludeTables: ['public.private_table'], excludeBuckets: ['private-bucket'], incrementalBinary: true });
  else {
    record.capsulePath = 'capsules/exact-capsule';
    await mkdir(join(directory, record.capsulePath), { recursive: true });
    const bytes = JSON.stringify({ formatVersion: 1, projectRef, id: 'synthetic-only' });
    await writeFile(join(directory, record.capsulePath, 'capsule.json'), bytes);
    await writeFile(join(directory, record.capsulePath, 'checksums.sha256'), `${digest(bytes)}  capsule.json\n`);
    if (operation === 'replay') record.targetRef = targetRef;
  }
  const save = async value => writeFile(join(directory, configRef, '3.json'), JSON.stringify(value));
  await save(record);
  const parsed = parseJobRequest({ ...reference, type: operation });
  assert.equal(parsed.ok, true);
  const job = { id: 'job_synthetic', type: parsed.type, version: 2, runnerId, payload: parsed.payload, status: 'queued', admission: { maxBytes: 1000 } };
  const env = { PORTABASE_RUNNER_CONFIG_DIR: directory, PORTABASE_RUNNER_ID: runnerId, PORTABASE_PROJECT_REF: projectRef,
    PORTABASE_TARGET_PROJECT_REF: targetRef, PORTABASE_AGENT_TOKEN: `pb_agent_${'a'.repeat(64)}_0_${'b'.repeat(64)}` };
  return { directory, record, save, job, env, options: { directory, runnerId, projectRef, targetRef } };
}

test('private output paths cannot escape through existing junctions or files', async () => {
  for (const name of ['capsules', 'status']) {
    const f = await fixture(); const outside = await fixture();
    await symlink(outside.directory, join(f.directory, name), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'private_config_path_refused' });
    const blocked = await fixture();
    await writeFile(join(blocked.directory, name), 'not a directory');
    await assert.rejects(resolvePrivateJob(blocked.job, blocked.options), { code: 'private_config_path_refused' });
  }
});

test('v2 queue projection contains opaque references only and rejects mixed/downgraded fields', () => {
  const parsed = parseJobRequest({ ...reference, type: 'backup' });
  assert.deepEqual(parsed.payload, reference);
  for (const key of ['projectRef', 'targetRef', 'excludeTables', 'excludeBuckets', 'note', 'passphrase', 'ciphertext', 'configPath', 'incrementalBinary']) {
    assert.equal(parseJobRequest({ ...reference, type: 'backup', [key]: 'private-value' }).ok, false);
  }
  for (const value of [0, -1, 1.5, '3', null]) assert.equal(parseJobRequest({ ...reference, configRevision: value, type: 'backup' }).ok, false);
  assert.equal(parseJobRequest({ ...reference, version: 3, type: 'backup' }).ok, false);
  assert.equal(parseJobRequest({ ...reference, configRef: '../escape', type: 'backup' }).ok, false);
  assert.throws(() => engineArgvForJob({ type: 'backup', payload: reference }), { code: 'private_config_unresolved' });
});

test('queue helpers cannot claim/finish another runner or downgrade private jobs to legacy', () => {
  const job = { id: 'job_test', type: 'backup', status: 'queued', version: 2, runnerId, payload: reference };
  assert.equal(claimNextJob([job]).job, null);
  assert.equal(claimNextJob([job], { runnerId: otherRunner }).job, null);
  const claimed = claimNextJob([job], { runnerId, workerId: runnerId });
  assert.equal(claimed.job.workerId, runnerId);
  assert.equal(finishJob(claimed.jobs, { jobId: job.id, status: 'succeeded' }).ok, false);
  assert.equal(finishJob(claimed.jobs, { jobId: job.id, status: 'succeeded', runnerId: otherRunner }).ok, false);
  assert.equal(finishJob(claimed.jobs, { jobId: job.id, status: 'succeeded', runnerId }).ok, true);
});

test('agent-only private worker keeps user tokens and private names out of cloud requests and child env', async () => {
  const f = await fixture(); const requests = []; let execution;
  const result = await pullOnce({ baseUrl: 'https://cloud.example.test', env: { ...f.env,
    PORTABASE_CLOUD_TOKEN: 'synthetic-customer-canary', portabase_cloud_token: 'synthetic-customer-canary' },
    fetchImpl: async (url, options) => { const body = JSON.parse(options.body); requests.push({ url, options, body });
      return { ok: true, json: async () => body.type === 'claim' ? claimedResponse(body, f.job) : { ok: true, job: { ...f.job, status: body.status, safeError: body.safeError } } }; },
    spawnImpl: async (argv, options) => { execution = { argv, options }; return { code: 0 }; },
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(execution.options.cwd, f.directory);
  assert.deepEqual(execution.options.env, { ...f.env, PORTABASE_JOB_MAX_CAPSULE_BYTES: '1000', PORTABASE_JOB_COMPLETION_REPORTER: 'server' });
  assert.equal(isAbsolute(execution.argv[1]), true);
  assert.equal((await stat(execution.argv[1])).isFile(), true);
  assert.equal(execution.argv[execution.argv.indexOf('--config') + 1], join(f.directory, 'engine.json'));
  assert.equal(execution.argv[execution.argv.indexOf('--exclude-table-data') + 1], 'public.private_table');
  assert.equal(execution.argv.includes('--incremental-binary'), true);
  for (const request of requests) {
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.url, 'https://cloud.example.test/api/cloud/runner-jobs');
    assert.equal(request.options.headers.Authorization, `Bearer ${f.env.PORTABASE_AGENT_TOKEN}`);
    assert.equal(request.options.headers['X-Portabase-Agent-Authorization'], undefined);
    assert.equal(request.body.version, 2);
    assert.equal(request.body.runnerId, runnerId);
  }
  assert.doesNotMatch(JSON.stringify(requests), /synthetic-customer|private_table|private-bucket|engine\.json|engineConfig|excludeTables/);
  assert.doesNotMatch(JSON.stringify(result), /private_table|private-bucket|engineConfig/);
});

test('private runner reports a completed capsule through the fixed safe projection', async () => {
  const f = await fixture(); const requests = [];
  const result = { schemaVersion: 1, capsuleId: 'abcdefghijklmnopqrst-20261005T120000Z', status: 'COMPLETE',
    capsuleHash: 'a'.repeat(64), manifestHash: 'b'.repeat(64), sizeBytes: 4096, objectCount: 12,
    durationMs: 2500, destinationKind: 's3', destinationVerified: true, completedAt: new Date().toISOString() };
  const response = await pullOnce({ baseUrl: 'https://cloud.example.test', env: f.env,
    fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return { ok: true, json: async () => body.type === 'claim' ? claimedResponse(body, f.job)
        : { ok: true, job: { ...f.job, status: body.status, safeError: body.safeError, ...jobResultRecord(body.result), projectRef } } };
    },
    spawnImpl: async () => {
      const statusDirectory = join(f.directory, 'status'); await mkdir(statusDirectory, { recursive: true });
      result.completedAt = new Date().toISOString();
      await writeFile(join(statusDirectory, 'latest.json'), JSON.stringify({ state: result.status, capsule: result.capsuleId,
        projectRef, capsuleHash: result.capsuleHash, manifestHash: result.manifestHash, sizeBytes: result.sizeBytes,
        objectCount: result.objectCount, durationMs: result.durationMs, destinationVerified: true,
        completedAt: result.completedAt, destination: 's3://private-bucket/private-prefix', passphrase: 'must-stay-private' }));
      return { code: 0 };
    },
  });
  assert.equal(response.status, 'succeeded');
  assert.deepEqual(requests.at(-1).result, result);
  assert.doesNotMatch(JSON.stringify(requests), /private-bucket|private-prefix|passphrase|must-stay-private/);
});

test('wrong runner, missing revision, operation, source and target never resolve', async () => {
  const f = await fixture();
  for (const [patch, options, code] of [
    [{}, { runnerId: otherRunner }, 'runner_binding_mismatch'],
    [{ configRevision: 4 }, {}, 'config_binding_mismatch'],
    [{ runnerId: otherRunner }, {}, 'config_binding_mismatch'],
    [{ projectRef: targetRef }, {}, 'project_ref_mismatch'],
    [{ operation: 'replay' }, {}, 'config_operation_mismatch'],
    [{ excludeTables: undefined }, {}, 'invalid_private_selection'],
    [{ excludeBuckets: undefined }, {}, 'invalid_private_selection'],
    [{ incrementalBinary: undefined }, {}, 'invalid_private_selection'],
  ]) {
    await f.save({ ...f.record, ...patch });
    await assert.rejects(resolvePrivateJob(f.job, { ...f.options, ...options }), { code });
  }
  await f.save(f.record);
  await assert.rejects(resolvePrivateJob({ ...f.job, payload: { ...reference, configRevision: 4 } }, f.options), { code: 'private_config_unavailable' });
  const replay = await fixture('replay');
  await assert.rejects(resolvePrivateJob(replay.job, { ...replay.options, targetRef: projectRef }), { code: 'target_ref_mismatch' });
  await replay.save({ ...replay.record, targetRef: projectRef });
  await assert.rejects(resolvePrivateJob(replay.job, { ...replay.options, targetRef: projectRef }), { code: 'target_ref_mismatch' });
});

test('private resolver rejects F drive, traversal, changed engine bytes and oversized records', async () => {
  const f = await fixture();
  for (const directory of ['F:\\forbidden', 'F:/forbidden', '\\\\?\\F:\\forbidden', 'relative']) {
    await assert.rejects(resolvePrivateJob(f.job, { ...f.options, directory }));
  }
  for (const engineConfigPath of ['../engine.json', 'F:/config.json', '\\\\server\\share\\config.json']) {
    await f.save({ ...f.record, engineConfigPath });
    await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'private_config_path_refused' });
  }
  await f.save(f.record);
  await writeFile(join(f.directory, 'engine.json'), '{}');
  await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'engine_config_changed' });
  await writeFile(join(f.directory, configRef, '3.json'), ' '.repeat(256 * 1024 + 1));
  await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'private_config_too_large' });
});

test('directory junctions and symlinks cannot redirect configuration reads', async () => {
  const f = await fixture();
  const other = await fixture();
  const linked = join(f.directory, 'linked');
  await symlink(other.directory, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await f.save({ ...f.record, engineConfigPath: 'linked/engine.json' });
  await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'private_config_path_refused' });
  await assert.rejects(resolvePrivateJob(f.job, { ...f.options, directory: linked }), { code: 'private_config_path_refused' });
});

test('verify uses the exact capsule; actual CLI runs from private cwd with installed absolute entry', async () => {
  const f = await fixture('verify');
  const resolved = await resolvePrivateJob(f.job, f.options);
  const argv = engineArgvForJob(resolved.job, resolved);
  assert.equal(argv[argv.indexOf('--capsule') + 1], join(f.directory, f.record.capsulePath));
  const { stdout } = await promisify(execFile)(process.execPath, argv.slice(1), { cwd: resolved.cwd, env: { ...process.env, PORTABASE_RUNTIME_CONFIG: '' }, timeout: 15000 });
  assert.match(stdout, /VERIFIED: 1\/1 files/);
  await f.save({ ...f.record, capsulePath: undefined });
  await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'private_config_path_refused' });
  await f.save(f.record);
  await writeFile(join(f.directory, f.record.capsulePath, 'capsule.json'), JSON.stringify({ projectRef: targetRef }));
  await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'capsule_project_mismatch' });
});

test('missing credentials, runtime overrides and unsafe cloud URLs fail before network or engine', async () => {
  const f = await fixture(); let requests = 0;
  const fetchImpl = async () => { requests++; throw new Error('must not request'); };
  for (const patch of [{ PORTABASE_AGENT_TOKEN: '' }, { PORTABASE_RUNNER_ID: '' }, { PORTABASE_RUNTIME_CONFIG: '{}' }]) {
    await assert.rejects(pullOnce({ baseUrl: 'https://cloud.example.test', token: 'synthetic', env: { ...f.env, ...patch }, fetchImpl }));
  }
  for (const baseUrl of ['http://cloud.example.test', 'https://name:password@cloud.example.test', 'https://cloud.example.test/?a=1', 'https://cloud.example.test/#part', 'https://cloud.example.test/prefix']) {
    await assert.rejects(pullOnce({ baseUrl, token: 'synthetic', env: f.env, fetchImpl }), { code: 'invalid_cloud_url' });
  }
  assert.equal(requests, 0);
});

test('private mode refuses legacy replies and local resolver failures emit only a fixed error', async () => {
  for (const legacy of [true, false]) {
    const f = await fixture();
    const job = legacy ? { id: 'job_legacy', type: 'backup', payload: { projectRef } }
      : { ...f.job, payload: { ...reference, configRevision: 99 } };
    const bodies = []; let spawned = false;
    await assert.rejects(pullOnce({ baseUrl: 'https://cloud.example.test', token: 'synthetic', env: f.env,
      fetchImpl: async (_, options) => { const body = JSON.parse(options.body); bodies.push(body); return { ok: true, json: async () => body.type === 'claim' ? claimedResponse(body, job) : { ok: true, job: { ...job, status: body.status, safeError: body.safeError } } }; },
      spawnImpl: async () => { spawned = true; return { code: 0 }; },
    }), { code: legacy ? 'claim_response_mismatch' : 'private_config_unavailable' });
    assert.equal(spawned, false);
    if (job.version !== 2) assert.deepEqual(bodies.map(body => body.type), ['claim']);
    else {
      assert.equal(bodies.at(-1).safeError, 'worker_failed');
      assert.equal(bodies.at(-1).version, 2);
    }
    assert.doesNotMatch(JSON.stringify(bodies), /engine\.json|private_table|ENOENT/);
  }
});
