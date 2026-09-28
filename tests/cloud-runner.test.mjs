import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreeEngineArgv, describeEngineJob } from '../cloud/runner/engine-job.mjs';
import {
  acceptBrowserSeal,
  createSleepingRunner,
  rejectControlPlaneAction,
  sleepRunner,
  startTransfer,
} from '../cloud/runner/agent.mjs';
import { assertControlPlaneRunnerBody, provisionSleepingRunner } from '../netlify/shared/runner-plane.mjs';
import { assertRunnerSealUrl, buildAwsSealedEnvelope, buildSealedEnvelope, isControlPlaneUrl } from '../src/lib/runner-seal.js';

test('sleeping runner is empty until a sealed transfer starts', () => {
  const runner = createSleepingRunner({ subscriberId: 'user_1', region: 'us-east-1' });
  assert.equal(runner.status, 'sleeping');
  assert.equal(runner.sealedKeysPresent, false);
  assert.equal(runner.engine, 'free-open-source-cli');
  assert.match(runner.runnerId, /^run_/);
});

test('jobs call the free engine path with existing flags only', () => {
  const argv = buildFreeEngineArgv({
    command: 'backup',
    excludeBinaries: true,
    excludeTableList: 'public.noise',
  });
  assert.deepEqual(argv, [
    'node', 'utility/portabase.mjs', 'backup',
    '--exclude-binaries',
    '--exclude-table-list', 'public.noise',
  ]);
  const job = describeEngineJob({ command: 'restore' });
  assert.ok(job.layers.includes('pg_dump'));
  assert.ok(job.layers.includes('encrypted-capsule'));
  assert.throws(() => buildFreeEngineArgv({ command: 'invent-capture' }), { code: 'unknown_engine_command' });
});

test('control plane refuses get-key, SSH, and secret-shaped bodies', () => {
  assert.throws(() => rejectControlPlaneAction('get-key'), { code: 'control_plane_key_access_refused' });
  assert.throws(() => rejectControlPlaneAction('ssh'), { code: 'control_plane_key_access_refused' });
  assert.throws(
    () => assertControlPlaneRunnerBody({ action: 'provision', passphrase: 'hunter2-hunter2' }),
    { code: 'forbidden_secret_shape' },
  );
  assert.throws(
    () => assertControlPlaneRunnerBody({ action: 'provision', sealedEnvelope: { ciphertext: 'abc' } }),
    (err) => err.code === 'forbidden_secret_shape' || err.code === 'keys_must_seal_to_runner',
  );
  assert.throws(
    () => assertControlPlaneRunnerBody({ action: 'provision', keys: { dest: 's3' } }),
    { code: 'keys_must_seal_to_runner' },
  );
  assert.throws(
    () => assertControlPlaneRunnerBody({ action: 'provision', AWS_ACCESS_KEY_ID: 'AKIATEST' }),
    (err) => err.code === 'forbidden_secret_shape' || err.code === 'keys_must_seal_to_runner',
  );
  const publicRunner = provisionSleepingRunner({ subscriberId: 'user_1' });
  assert.equal(publicRunner.sealedKeysPresent, false);
  assert.equal(publicRunner.status, 'sleeping');
});

test('browser seal targets the runner, never /api/cloud', () => {
  assert.equal(isControlPlaneUrl('https://portabase.dev/api/cloud/runners'), true);
  assert.throws(() => assertRunnerSealUrl('https://portabase.dev/api/cloud/runners'), { code: 'seal_to_runner_only' });
  const url = assertRunnerSealUrl('https://runner-user1.internal/seal');
  assert.equal(url.includes('/api/cloud'), false);
  const envelope = buildSealedEnvelope({ ciphertext: 'sealed', runnerId: 'run_1' });
  assert.equal(envelope.alg, 'AES-256-GCM');
  const awsEnvelope = buildAwsSealedEnvelope({ ciphertext: 'sealed-aws', runnerId: 'run_1' });
  assert.equal(awsEnvelope.purpose, 'aws-runner-credentials');
});

test('transfer starts only after seal; sleep discards keys', () => {
  let runner = createSleepingRunner({ subscriberId: 'user_1' });
  assert.throws(() => startTransfer(runner, { command: 'backup' }), { code: 'runner_unsealed' });
  runner = acceptBrowserSeal(runner, { sealedEnvelope: { ciphertext: 'abc', alg: 'AES-256-GCM' } });
  assert.equal(runner.status, 'ready');
  const started = startTransfer(runner, { command: 'backup', destinationKind: 's3' });
  assert.equal(started.runner.status, 'running');
  assert.equal(started.job.phase, 'capture');
  assert.equal(started.engine.command, 'backup');
  const slept = sleepRunner(started.runner);
  assert.equal(slept.status, 'sleeping');
  assert.equal(slept.sealedKeysPresent, false);
});
