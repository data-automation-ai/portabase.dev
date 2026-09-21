import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IAM_TIER,
  RUNNER_AWS_AUTH_ERROR,
  RUNNER_AWS_AUTH_MODES,
  RunnerAwsAuthError,
  assertLeastPrivilegeSketch,
  assertRunnerAwsAuth,
  buildAwsRunPlan,
  buildInventory,
  detectRunnerAwsAuth,
  flattenActions,
  loadMapPolicy,
  loadShipPolicy,
  redactRunnerAwsAuth,
  runAwsCli,
} from '../utility/aws/index.mjs';
import { buildAwsEngineArgv } from '../cloud/runner/engine-job.mjs';
import { assertAllowedRow } from '../cloud/control-plane/forbidden.mjs';
import { assertControlPlaneRunnerBody } from '../netlify/shared/runner-plane.mjs';
import { acceptBrowserSeal, createSleepingRunner } from '../cloud/runner/agent.mjs';
import { assertNoPlaintextAwsKeys, buildAwsSealedEnvelope } from '../src/lib/runner-seal.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(root, 'utility/aws/fixtures/sample-account.json');

async function loadFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

test('missing runner AWS credentials fail closed', () => {
  const empty = detectRunnerAwsAuth({}, { checkSharedFiles: false });
  assert.equal(empty.mode, RUNNER_AWS_AUTH_MODES.NONE);
  assert.equal(empty.ok, false);
  assert.throws(
    () => assertRunnerAwsAuth({}, { checkSharedFiles: false }),
    (err) => err instanceof RunnerAwsAuthError && err.code === RUNNER_AWS_AUTH_ERROR,
  );
});

test('prefers instance role, then env, then profile', () => {
  const role = detectRunnerAwsAuth(
    { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/x' },
    { checkSharedFiles: false },
  );
  assert.equal(role.mode, RUNNER_AWS_AUTH_MODES.INSTANCE_ROLE);
  assert.equal(role.preferred, true);

  const envKeys = detectRunnerAwsAuth(
    { AWS_ACCESS_KEY_ID: 'AKIATESTEXAMPLE', AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    { checkSharedFiles: false },
  );
  assert.equal(envKeys.mode, RUNNER_AWS_AUTH_MODES.ENV);
  assert.equal(envKeys.hasAccessKeyId, true);
  assert.equal(envKeys.hasSecretKey, true);
  const redacted = redactRunnerAwsAuth(envKeys);
  assert.equal(JSON.stringify(redacted).includes('wJalrXUtnFEMI'), false);
  assert.equal(JSON.stringify(redacted).includes('AKIATESTEXAMPLE'), false);

  const profile = detectRunnerAwsAuth({ AWS_PROFILE: 'portabase-export-map' }, { checkSharedFiles: false });
  assert.equal(profile.mode, RUNNER_AWS_AUTH_MODES.PROFILE);
  assert.equal(profile.profile, 'portabase-export-map');
});

test('CLI without --fixture fails closed when the runner has no AWS creds', async () => {
  const logs = [];
  const io = { log: (line) => logs.push(String(line)), error: () => {} };
  await assert.rejects(
    () => runAwsCli(['inventory'], io, {}),
    (err) => err.code === RUNNER_AWS_AUTH_ERROR || /No AWS credentials on this runner/i.test(err.message),
  );
  await assert.rejects(
    () => runAwsCli(['plan'], io, {}),
    /No AWS credentials on this runner/i,
  );
});

test('CLI with runner creds but no fixture still refuses live describe / --live', async () => {
  const logs = [];
  const io = { log: (line) => logs.push(String(line)), error: () => {} };
  const env = { AWS_PROFILE: 'portabase-export-map', AWS_REGION: 'us-east-1' };
  await assert.rejects(
    () => runAwsCli(['inventory'], io, env),
    /credentials resolved[\s\S]*--live mutate remains refused/i,
  );
  await assert.rejects(
    () => runAwsCli(['inventory', '--live'], io, env),
    /read-only|will not mutate/i,
  );
});

test('--require-aws with fixture fails closed without creds and passes with a profile', async () => {
  const logs = [];
  const io = { log: (line) => logs.push(String(line)), error: () => {} };
  await assert.rejects(
    () => runAwsCli(['plan', '--fixture', fixturePath, '--require-aws', '--json'], io, {}),
    /No AWS credentials on this runner/i,
  );
  const plan = await runAwsCli(
    ['plan', '--fixture', fixturePath, '--require-aws', '--json'],
    io,
    { AWS_PROFILE: 'portabase-export-map' },
  );
  assert.equal(plan.runnerLocalAws, true);
  assert.equal(plan.neverHoldsAwsKeys, true);
  assert.equal(plan.runnerAuth.mode, RUNNER_AWS_AUTH_MODES.PROFILE);
  assert.equal(plan.dryRun, true);
});

test('run plan assumes runner-local AWS access', async () => {
  const inventory = buildInventory(await loadFixture());
  const plan = buildAwsRunPlan(inventory, {
    fixturePath: 'utility/aws/fixtures/sample-account.json',
    runnerAuth: { mode: RUNNER_AWS_AUTH_MODES.INSTANCE_ROLE, ok: true, preferred: true },
  });
  assert.equal(plan.runnerLocalAws, true);
  assert.equal(plan.runnerAuth.mode, RUNNER_AWS_AUTH_MODES.INSTANCE_ROLE);
  const inventoryStep = plan.steps.find((step) => step.id === 'inventory');
  assert.ok(inventoryStep.runnerCommands.some((cmd) => /--require-aws/.test(cmd)));
});

test('MAP vs SHIP IAM sketches are least privilege and contain no admin keys', () => {
  const map = loadMapPolicy();
  const ship = loadShipPolicy();
  assertLeastPrivilegeSketch(map, IAM_TIER.MAP);
  assertLeastPrivilegeSketch(ship, IAM_TIER.SHIP);
  assert.ok(flattenActions(map).includes('sts:GetCallerIdentity'));
  assert.ok(!flattenActions(map).includes('secretsmanager:GetSecretValue'));
  assert.ok(flattenActions(ship).includes('ec2:CreateStoreImageTask'));
  assert.match(JSON.stringify(ship), /YOUR-BACKUP-BUCKET|ACCOUNT_ID/);
  assert.doesNotMatch(JSON.stringify(map), /AKIA[0-9A-Z]{16}/);
  assert.doesNotMatch(JSON.stringify(ship), /AKIA[0-9A-Z]{16}/);
  assert.doesNotMatch(JSON.stringify(ship), /AdministratorAccess/);
});

test('control plane rejects AWS key-shaped bodies; runner accepts only ciphertext AWS seal', () => {
  assert.throws(
    () => assertControlPlaneRunnerBody({ action: 'provision', AWS_SECRET_ACCESS_KEY: 'wJalr' }),
    (err) => err.code === 'forbidden_secret_shape' || err.code === 'keys_must_seal_to_runner',
  );
  assert.throws(
    () => assertControlPlaneRunnerBody({ action: 'provision', awsAccessKeyId: 'AKIATEST' }),
    (err) => err.code === 'forbidden_secret_shape' || err.code === 'keys_must_seal_to_runner',
  );
  assert.throws(
    () => assertAllowedRow('jobs', {
      id: 'j1',
      type: 'aws-plan',
      status: 'running',
      aws_secret_access_key: 'nope',
    }),
    { code: 'forbidden_secret_shape' },
  );

  let runner = createSleepingRunner({ subscriberId: 'user_1' });
  assert.throws(
    () => acceptBrowserSeal(runner, { sealedEnvelope: { ciphertext: 'x', alg: 'AES-256-GCM', AWS_SECRET_ACCESS_KEY: 'wJalr' } }),
    { code: 'plaintext_seal_refused' },
  );
  const envelope = buildAwsSealedEnvelope({ ciphertext: 'sealed-aws', runnerId: runner.runnerId });
  assert.equal(envelope.purpose, 'aws-runner-credentials');
  assertNoPlaintextAwsKeys(envelope);
  runner = acceptBrowserSeal(runner, { sealedEnvelope: envelope });
  assert.equal(runner.sealedKeysPresent, true);
});

test('AWS engine argv stays on the free CLI and requires runner AWS', () => {
  assert.deepEqual(buildAwsEngineArgv({ subcommand: 'plan' }), [
    'node',
    'utility/portabase.mjs',
    'aws',
    'plan',
    '--require-aws',
  ]);
  assert.throws(() => buildAwsEngineArgv({ subcommand: 'snapshot' }), { code: 'unknown_aws_engine_command' });
});
