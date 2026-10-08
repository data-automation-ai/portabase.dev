import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { createPrivateCapsuleReview } from '../utility/ui/private-capsule-review.mjs';
import { runPrivateReplayChild } from '../utility/private-replay.mjs';
import { pullOnce } from '../cloud/runner/worker.mjs';

const configRef = '33333333-3333-4333-8333-333333333333';
const targetRef = 'bcdefghijklmnopqrst0';
const sha = value => createHash('sha256').update(value).digest('hex');
const entry = fileURLToPath(new URL('../utility/private-replay.mjs', import.meta.url));
async function fixture(t) {
  const f = await privateCapsuleFixture();
  t.after(async () => {
    const root = resolve(f.directory), base = resolve(tmpdir());
    assert.ok(root.startsWith(`${base}${sep}`) && basename(root).startsWith('portabase-capsule-review-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const service = await createPrivateCapsuleReview(f.options), review = await service.inspect({});
  const saved = await service.save({ revision: review.revision, selectedTables: ['public.orders'],
    selectedBuckets: [], selectedFunctions: [], maxBytes: 1000000, confirmEmpty: false });
  const reference = { version: 2, runnerId: f.options.runnerId, configRef, configRevision: 1 };
  await mkdir(join(f.directory, configRef));
  const engine = JSON.stringify({ projectRef: f.options.projectRef, backupDirectory: 'backups', statusDirectory: 'status' });
  await writeFile(join(f.directory, 'engine.json'), engine);
  const record = { ...reference, operation: 'replay', projectRef: f.options.projectRef, targetRef,
    engineConfigPath: 'engine.json', engineConfigSha256: sha(engine), capsulePath: 'capsule',
    restorePlanRef: saved.planRef, restorePlanBindingSha256: saved.bindingSha256 };
  const recordPath = join(f.directory, configRef, '1.json'), bytes = JSON.stringify(record);
  await writeFile(recordPath, bytes);
  const job = { id: 'job_child', version: 2, runnerId: reference.runnerId, type: 'replay', payload: reference, admission: { maxBytes: 1000 } };
  const env = { PORTABASE_RUNNER_CONFIG_DIR: f.directory, PORTABASE_RUNNER_ID: reference.runnerId,
    PORTABASE_PROJECT_REF: f.options.projectRef, PORTABASE_TARGET_PROJECT_REF: targetRef,
    PORTABASE_ENCRYPTION_PASSPHRASE: f.options.passphrase, PORTABASE_REVIEW_MAX_CIPHER_BYTES: String(f.options.maxCipherBytes),
    PORTABASE_REVIEW_MAX_EXPANDED_BYTES: String(f.options.maxExpandedBytes), PORTABASE_JOB_MAX_CAPSULE_BYTES: '1000',
    PORTABASE_PRIVATE_CONFIG_REVISION_SHA256: sha(bytes), PORTABASE_AGENT_TOKEN: `pb_agent_${'a'.repeat(64)}_0_${'b'.repeat(64)}` };
  return { ...f, env, job, saved, record, recordPath, args: [configRef, '1'] };
}

test('fixed child consumes revalidated prepared plan and keeps evidence outside cleaned snapshot', async t => {
  const f = await fixture(t); let calls = 0, scratch, evidence;
  const result = await runPrivateReplayChild(f.args, { env: f.env, executePrepared: async (prepared, options) => {
    calls++; scratch = prepared.temp; evidence = options.evidenceDirectory;
    assert.equal(prepared.bindingSha256, f.saved.bindingSha256);
    assert.equal(prepared.selectedBytes, f.saved.selectedBytes);
    assert.equal(prepared.maxBytes, 1000);
    assert.deepEqual(prepared.plan.tables.map(row => row.selected), [true, false]);
    assert.equal(options.targetRef, targetRef); assert.equal(options.confirmTarget, targetRef);
    assert.ok(evidence.startsWith(join(f.directory, '.replay-evidence') + sep));
    assert.ok(!evidence.startsWith(scratch));
    assert.match(await readFile(join(prepared.extracted, 'database', 'data.sql'), 'utf8'), /private-row-value/);
    await writeFile(join(evidence, 'result.json'), '{"synthetic":true}');
    return { status: 'SELECTIVE_RESTORE_VERIFIED', evidence: { jsonPath: join(evidence, 'result.json') } };
  } });
  assert.equal(calls, 1); assert.equal(result.status, 'SELECTIVE_RESTORE_VERIFIED');
  await assert.rejects(readdir(scratch), { code: 'ENOENT' });
  assert.equal(await readFile(join(evidence, 'result.json'), 'utf8'), '{"synthetic":true}');
  assert.deepEqual(await readdir(join(f.directory, '.replay-runs')), []);
});

test('child setup rejects arbitrary flags, coercion, missing pins/limits, changed target and no-plan fallback', async t => {
  const f = await fixture(t); let calls = 0;
  const executePrepared = () => { calls++; };
  for (const args of [[], [...f.args, '--overwrite'], [configRef, '01'], [configRef, '1e0'], [configRef, '1.0'], ['../escape', '1']]) {
    await assert.rejects(runPrivateReplayChild(args, { env: f.env, executePrepared }));
  }
  for (const patch of [
    { PORTABASE_PRIVATE_CONFIG_REVISION_SHA256: undefined }, { PORTABASE_PRIVATE_CONFIG_REVISION_SHA256: 'F'.repeat(64) },
    { PORTABASE_JOB_MAX_CAPSULE_BYTES: '0' }, { PORTABASE_JOB_MAX_CAPSULE_BYTES: '01' }, { PORTABASE_JOB_MAX_CAPSULE_BYTES: '9007199254740992' },
    { PORTABASE_REVIEW_MAX_CIPHER_BYTES: undefined }, { PORTABASE_REVIEW_MAX_CIPHER_BYTES: '1.5' },
    { PORTABASE_REVIEW_MAX_EXPANDED_BYTES: undefined }, { PORTABASE_REVIEW_MAX_EXPANDED_BYTES: 'NaN' },
    { PORTABASE_ENCRYPTION_PASSPHRASE: undefined }, { PORTABASE_RUNTIME_CONFIG: '{}' },
    { PORTABASE_TARGET_PROJECT_REF: f.options.projectRef },
  ]) await assert.rejects(runPrivateReplayChild(f.args, { env: { ...f.env, ...patch }, executePrepared }));
  const record = { ...f.record }; delete record.restorePlanRef; delete record.restorePlanBindingSha256;
  const bytes = JSON.stringify(record); await writeFile(f.recordPath, bytes);
  await assert.rejects(runPrivateReplayChild(f.args, { env: { ...f.env, PORTABASE_PRIVATE_CONFIG_REVISION_SHA256: sha(bytes) }, executePrepared }), { code: 'private_replay_config_changed' });
  assert.equal(calls, 0);
});

test('child refuses revision and engine configuration changes after parent inspection', async t => {
  const f = await fixture(t); let calls = 0;
  const executePrepared = () => { calls++; };
  await writeFile(f.recordPath, `${JSON.stringify(f.record)}\n`);
  await assert.rejects(runPrivateReplayChild(f.args, { env: f.env, executePrepared }), { code: 'private_replay_config_changed' });
  await writeFile(f.recordPath, JSON.stringify(f.record));
  await writeFile(join(f.directory, 'engine.json'), '{}');
  await assert.rejects(runPrivateReplayChild(f.args, { env: f.env, executePrepared }), { code: 'engine_config_changed' });
  assert.equal(calls, 0);
});

test('engine failure or linked evidence directory cleans prepared plaintext without executing fallback', async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(runPrivateReplayChild(f.args, { env: f.env, executePrepared: async prepared => {
    calls++; assert.ok((await readdir(prepared.extracted)).length);
    throw Object.assign(new Error('synthetic engine failure'), { code: 'synthetic_failure' });
  } }), { code: 'synthetic_failure' });
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(join(f.directory, '.replay-runs')), []);
  const other = await fixture(t), linked = await fixture(t);
  await symlink(other.directory, join(linked.directory, '.replay-evidence'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(runPrivateReplayChild(linked.args, { env: linked.env, executePrepared: () => { calls++; } }), { code: 'private_config_path_refused' });
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(join(linked.directory, '.replay-runs')), []);
});

test('worker launches fixed private child, overrides ambient pins/caps and publishes no private selection/output', async t => {
  const f = await fixture(t), requests = []; let launches = 0;
  const result = await pullOnce({ baseUrl: 'https://cloud.example.test', token: 'synthetic',
    env: { ...f.env, PORTABASE_JOB_MAX_CAPSULE_BYTES: '99999999', PORTABASE_PRIVATE_CONFIG_REVISION_SHA256: '0'.repeat(64) },
    fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return { ok: true, json: async () => body.type === 'claim' ? { ok: true, job: { ...f.job, status: 'running' },
        claim: { protocol: 1, sequence: body.claimSequence, requestId: body.claimRequestId, runnerId: body.runnerId } }
        : { ok: true, job: { ...f.job, status: body.status, safeError: body.safeError } } };
    },
    spawnImpl: async (argv, options) => {
      launches++;
      assert.deepEqual(argv, [process.execPath, entry, ...f.args]);
      assert.equal(options.env.PORTABASE_JOB_MAX_CAPSULE_BYTES, '1000');
      assert.equal(options.env.PORTABASE_PRIVATE_CONFIG_REVISION_SHA256, f.env.PORTABASE_PRIVATE_CONFIG_REVISION_SHA256);
      await runPrivateReplayChild(argv.slice(2), { env: options.env, executePrepared: async prepared => {
        assert.equal(prepared.maxBytes, 1000);
        return { status: 'SELECTIVE_RESTORE_VERIFIED', privateLog: 'private customer table details' };
      } });
      return { code: 0, stdout: 'private customer table details' };
    },
  });
  assert.equal(launches, 1); assert.equal(result.status, 'succeeded');
  assert.doesNotMatch(JSON.stringify({ result, requests }), /private customer|restorePlan|bindingSha256|plan\.json|passphrase|public\.orders/);
  assert.deepEqual(await readdir(join(f.directory, '.replay-runs')), []);
});

test('actual child process refuses malformed invocation without provider or private output', async t => {
  const f = await fixture(t);
  await assert.rejects(promisify(execFile)(process.execPath, [entry, ...f.args, '--overwrite'], {
    env: { ...process.env, ...f.env }, cwd: f.directory, timeout: 10000,
  }), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /^Private replay failed\. No success was recorded\./);
    assert.doesNotMatch(error.stderr, /private-row|passphrase|portabase-capsule-review-test-/);
    return true;
  });
});

test('actual child process with missing or wrong private keys/limits never calls a target', async t => {
  const f = await fixture(t), guard = join(f.directory, 'deny-provider.mjs'), attempted = join(f.directory, 'provider-attempted');
  await writeFile(guard, `import fs from 'node:fs';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { fs.writeFileSync(process.env.TEST_ATTEMPT_FILE, 'blocked'); throw new Error('provider-forbidden'); };
globalThis.fetch = deny;
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = deny;
net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny;
http.request = deny; http.get = deny; https.request = deny; https.get = deny;
syncBuiltinESMExports();
`);
  for (const patch of [
    { PORTABASE_ENCRYPTION_PASSPHRASE: '' },
    { PORTABASE_ENCRYPTION_PASSPHRASE: 'incorrect-private-passphrase' },
    { PORTABASE_REVIEW_MAX_CIPHER_BYTES: '01' },
    { PORTABASE_REVIEW_MAX_EXPANDED_BYTES: '' },
  ]) {
    await assert.rejects(promisify(execFile)(process.execPath, ['--import', pathToFileURL(guard).href, entry, ...f.args], {
      env: { SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(), ...f.env, ...patch, TEST_ATTEMPT_FILE: attempted },
      cwd: f.directory, timeout: 10000,
    }), error => {
      assert.equal(error.code, 1); assert.equal(error.stdout, '');
      assert.match(error.stderr, /^Private replay failed\. No success was recorded\./);
      assert.doesNotMatch(error.stderr, /private-row|passphrase|provider-forbidden|portabase-capsule-review-test-/);
      return true;
    });
    await assert.rejects(readFile(attempted), { code: 'ENOENT' });
  }
});

test('preflight/unknown engine outcome cannot report restore success and still cleans scratch', async t => {
  const f = await fixture(t);
  for (const status of ['PREFLIGHT_PASSED', 'FAILED', undefined]) {
    await assert.rejects(runPrivateReplayChild(f.args, { env: f.env, executePrepared: async () => ({ status }) }), { code: 'private_replay_not_verified' });
    assert.deepEqual(await readdir(join(f.directory, '.replay-runs')), []);
  }
});
