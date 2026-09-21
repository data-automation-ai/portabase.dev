import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  ACTIONS,
  AWS_CAPSULE_FORMAT_VERSION,
  AWS_CAPSULE_KIND,
  AWS_CAPSULE_MANIFEST_SCHEMA,
  AWS_INVENTORY_SCHEMA_VERSION,
  COLLECTOR_CONTRACTS,
  COST_SIGNALS,
  FORBIDDEN_MUTATIONS,
  RESOURCE_CLASS,
  buildDoctorReport,
  buildInventory,
  createFixtureClient,
  createLiveClient,
  decideBinaryPath,
  emptySecretsPolicy,
  estimateMonthlyUsd,
  findForbiddenSecrets,
  runAwsCli,
  unprovenCoverage,
  validateAwsCapsuleManifest,
} from '../utility/aws/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(root, 'utility/aws/fixtures/sample-account.json');

async function loadFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

test('version story is explicit and independent of Supabase formatVersion', () => {
  assert.equal(AWS_CAPSULE_KIND, 'portabase-aws-capsule');
  assert.equal(AWS_CAPSULE_FORMAT_VERSION, '2.0.0');
  assert.equal(AWS_INVENTORY_SCHEMA_VERSION, '1.0.0');
  assert.equal(AWS_CAPSULE_MANIFEST_SCHEMA.properties.kind.const, AWS_CAPSULE_KIND);
  assert.notEqual(AWS_CAPSULE_FORMAT_VERSION, '1');
});

test('valid manifest from fixture doctor report passes schema', async () => {
  const inventory = buildInventory(await loadFixture());
  const report = buildDoctorReport(inventory, { createdAt: '2026-09-20T00:00:00.000Z' });
  const manifest = validateAwsCapsuleManifest(report.manifest);
  assert.equal(manifest.coverage.proven, false);
  assert.equal(manifest.coverage.match, false);
  assert.equal(manifest.coverage.binariesInCapsule, false);
  assert.equal(manifest.secretsPolicy.credentialsPacked, false);
  assert.equal(manifest.profile, 'exclude-binaries');
});

test('schema rejects missing versions, proven claims, and packed secrets', () => {
  const base = {
    kind: AWS_CAPSULE_KIND,
    capsuleFormatVersion: AWS_CAPSULE_FORMAT_VERSION,
    inventorySchemaVersion: AWS_INVENTORY_SCHEMA_VERSION,
    profile: 'exclude-binaries',
    createdAt: '2026-09-20T00:00:00.000Z',
    account: { accountId: '123456789012', aliases: [], partition: 'aws' },
    regions: ['us-east-1'],
    scripted: {},
    binaryReferences: {},
    measurement: { scriptedEstimateBytes: 1, binaryFootprintGiB: 0 },
    coverage: unprovenCoverage(),
    secretsPolicy: emptySecretsPolicy(),
  };

  assert.throws(
    () => validateAwsCapsuleManifest({ ...base, capsuleFormatVersion: undefined }),
    /capsuleFormatVersion/,
  );
  assert.throws(
    () => validateAwsCapsuleManifest({ ...base, coverage: { ...unprovenCoverage(), proven: true } }),
    /Never claim MATCH or proven/,
  );
  assert.throws(
    () => validateAwsCapsuleManifest({ ...base, coverage: { ...unprovenCoverage(), match: true } }),
    /match/,
  );
  assert.throws(
    () => validateAwsCapsuleManifest({ ...base, secretsPolicy: { ...emptySecretsPolicy(), credentialsPacked: true } }),
    /credentialsPacked/,
  );
  assert.throws(
    () => validateAwsCapsuleManifest({ ...base, iamUser: { SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG' } }),
    /forbidden secret/,
  );
});

test('EC2 volume without snapshot recommends CreateSnapshot and warns', () => {
  const decision = decideBinaryPath({
    resourceClass: RESOURCE_CLASS.VOLUME,
    id: 'vol-111',
    sizeGiB: 100,
    encryption: { encrypted: true },
  });
  assert.equal(decision.action, ACTIONS.RECOMMEND_SNAPSHOT);
  assert.equal(decision.finding, 'will-warn');
  assert.equal(decision.inCapsule, false);
  assert.equal(decision.recommendedPath, 'ec2-create-snapshot');
  assert.ok(decision.restoreBlockers.includes('no-approved-snapshot'));
});

test('EC2 volume with customer-approved snapshot copies the reference only', () => {
  const decision = decideBinaryPath({
    resourceClass: RESOURCE_CLASS.VOLUME,
    id: 'vol-approved',
    sizeGiB: 20,
    encryption: { encrypted: true },
    recommendedSnapshotId: 'snap-already-approved',
  });
  assert.equal(decision.action, ACTIONS.RECOMMEND_SNAPSHOT);
  assert.equal(decision.finding, 'will-copy');
  assert.equal(decision.coverage, 'binary-reference');
  assert.equal(decision.inCapsule, false);
});

test('instance store is a restore blocker', () => {
  const decision = decideBinaryPath({
    resourceClass: RESOURCE_CLASS.INSTANCE_STORE,
    id: 'i-gpu:instance-store',
    sizeGiB: 150,
  });
  assert.equal(decision.finding, 'will-fail');
  assert.ok(decision.restoreBlockers.includes('instance-store-ephemeral'));
});

test('S3 object bodies are exclude-binaries', () => {
  const decision = decideBinaryPath({
    resourceClass: RESOURCE_CLASS.S3_OBJECT_BODY,
    id: 'app-assets:objects',
    sizeGiB: 50,
  });
  assert.equal(decision.action, ACTIONS.EXCLUDE_BINARIES);
  assert.equal(decision.finding, 'will-warn');
  assert.equal(decision.recommendedPath, 'optional-customer-copy-job');
});

test('ECR images recommend replication or skopeo, not .pbase', () => {
  const decision = decideBinaryPath({
    resourceClass: RESOURCE_CLASS.ECR_IMAGE,
    id: 'app@sha256:deadbeef',
    sizeGiB: 2,
  });
  assert.equal(decision.action, ACTIONS.RECOMMEND_ECR_REPLICATION);
  assert.equal(decision.finding, 'will-warn');
});

test('RDS descriptions stay scripted; row data recommends an AWS snapshot', () => {
  const config = decideBinaryPath({ resourceClass: RESOURCE_CLASS.RDS_INSTANCE, id: 'app-db', sizeGiB: 50 });
  assert.equal(config.action, ACTIONS.RECOMMEND_RDS_SNAPSHOT);
  assert.ok(config.restoreBlockers.includes('rds-rows-not-in-capsule-v1'));
});

test('Lambda config is scripted; opaque package is excluded', () => {
  assert.equal(
    decideBinaryPath({ resourceClass: RESOURCE_CLASS.LAMBDA_FUNCTION, id: 'invoice-worker' }).action,
    ACTIONS.PACK_SCRIPTED,
  );
  assert.equal(
    decideBinaryPath({ resourceClass: RESOURCE_CLASS.LAMBDA_PACKAGE, id: 'invoice-worker:package' }).action,
    ACTIONS.EXCLUDE_BINARIES,
  );
});

test('secret values and SecureString values never pack', () => {
  assert.equal(
    decideBinaryPath({ resourceClass: RESOURCE_CLASS.SECRET_VALUE, id: 'app/db' }).finding,
    'will-fail',
  );
  assert.equal(
    decideBinaryPath({ resourceClass: RESOURCE_CLASS.SSM_SECURE_STRING, id: '/app/token:value' }).finding,
    'will-fail',
  );
});

test('IAM and VPC descriptions will-copy', () => {
  assert.equal(decideBinaryPath({ resourceClass: RESOURCE_CLASS.IAM_ROLE, id: 'app-ec2' }).finding, 'will-copy');
  assert.equal(decideBinaryPath({ resourceClass: RESOURCE_CLASS.VPC, id: 'vpc-aaa' }).finding, 'will-copy');
  assert.equal(decideBinaryPath({ resourceClass: RESOURCE_CLASS.INSTANCE, id: 'i-abc' }).finding, 'will-copy');
});

test('doctor report classifies fixture findings and never claims proven', async () => {
  const inventory = buildInventory(await loadFixture());
  const report = buildDoctorReport(inventory);

  assert.equal(report.proven, false);
  assert.equal(report.match, false);
  assert.ok(report.loudLabels.some((line) => /NOT PROVEN/i.test(line)));
  assert.ok(report.counts['will-copy'] > 0);
  assert.ok(report.counts['will-warn'] > 0);
  assert.ok(report.counts['will-fail'] > 0);
  assert.equal(report.exitCode, 2);

  const volume = report.manifest.findings.find((f) => f.resourceId === 'vol-111');
  assert.equal(volume.severity, 'will-warn');
  assert.equal(volume.recommendedPath, 'ec2-create-snapshot');

  const approved = report.manifest.findings.find((f) => f.resourceId === 'vol-approved');
  assert.equal(approved.severity, 'will-copy');

  const store = report.manifest.findings.find((f) => f.resourceClass === RESOURCE_CLASS.INSTANCE_STORE);
  assert.equal(store.severity, 'will-fail');

  const s3 = report.manifest.findings.find((f) => f.resourceClass === RESOURCE_CLASS.S3_OBJECT_BODY);
  assert.equal(s3.severity, 'will-warn');
  assert.ok(s3.notCovered);

  assert.ok(report.manifest.measurement.binaryFootprintGiB > 50);
  assert.ok(report.manifest.measurement.scriptedEstimateBytes > 0);
  assert.match(report.manifest.measurement.costSignals.disclaimer, /not a quote/i);
  assert.equal(report.manifest.measurement.costSignals.binaryFootprintMonthlyHint.notAQuote, true);
});

test('inventory keeps IAM access key IDs and drops Lambda env values', async () => {
  const inventory = buildInventory(await loadFixture());
  const user = inventory.resources.find((r) => r.resourceClass === RESOURCE_CLASS.IAM_USER);
  assert.deepEqual(user.accessKeyIds, ['AKIATESTEXAMPLE']);
  const lambda = inventory.resources.find((r) => r.resourceClass === RESOURCE_CLASS.LAMBDA_FUNCTION);
  assert.deepEqual(lambda.scriptedPayload.environmentNames, ['DATABASE_URL']);
  assert.equal(findForbiddenSecrets(inventory).length, 0);
  assert.ok(inventory.edges.some((e) => e.rel === 'attached-volume' && e.to.id === 'vol-111'));
});

test('fixture client is read-only and refuses CreateSnapshot', async () => {
  const client = createFixtureClient(await loadFixture());
  const identity = await client.sts.get_caller_identity();
  assert.equal(identity.Account, '123456789012');
  await assert.rejects(() => client.ec2.create_snapshot({ VolumeId: 'vol-111' }), /Refused ec2.create_snapshot/);
  await assert.rejects(() => client.secretsmanager.get_secret_value({ SecretId: 'app/db' }), /Refused/);
  assert.throws(() => createLiveClient(), /Live AWS API collection is not enabled/);
  assert.ok(FORBIDDEN_MUTATIONS.includes('create_snapshot'));
  assert.ok(COLLECTOR_CONTRACTS.ec2.methods.includes('describe_volumes'));
  assert.ok(COLLECTOR_CONTRACTS.s3.never.includes('get_object'));
});

test('cost signals are labeled as hints, not quotes', () => {
  const estimate = estimateMonthlyUsd(100, 'ebsSnapshotGiBMonth');
  assert.equal(estimate.usd, 5);
  assert.equal(estimate.notAQuote, true);
  assert.equal(estimate.hint, true);
  assert.match(COST_SIGNALS.disclaimer, /not a quote/i);
});

test('CLI refuses live and mutate flags', async () => {
  const logs = [];
  const io = { log: (line) => logs.push(String(line)), error: () => {} };
  await assert.rejects(
    () => runAwsCli(['doctor', '--live', '--fixture', fixturePath], io),
    /read-only/,
  );
  await assert.rejects(
    () => runAwsCli(['inventory', '--create-snapshot', '--fixture', fixturePath], io),
    /read-only/,
  );
  await assert.rejects(() => runAwsCli(['snapshot'], io), /not implemented/);
  const help = await runAwsCli(['help'], io);
  assert.equal(help.command, 'aws help');
  assert.match(logs.join('\n'), /aws inventory/);
});

test('wired CLI: portabase aws doctor --fixture exits 0 from process spawn of help', () => {
  const help = spawnSync(process.execPath, [join(root, 'utility/portabase.mjs'), 'help'], {
    encoding: 'utf8',
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /aws inventory/);
  assert.match(help.stdout, /aws doctor/);
  assert.match(help.stdout, /aws plan/);
  assert.match(help.stdout, /Encrypted, customer-owned Supabase recovery capsules/);
});

test('wired CLI: portabase aws doctor --fixture writes a not-proven report', () => {
  const cli = join(root, 'utility/portabase.mjs');
  const result = spawnSync(
    process.execPath,
    [cli, 'aws', 'doctor', '--fixture', fixturePath, '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.proven, false);
  assert.equal(report.counts['will-fail'] > 0, true);
});

test('portabase doctor remains the Supabase command and does not run AWS doctor', () => {
  const result = spawnSync(process.execPath, [join(root, 'utility/portabase.mjs'), 'doctor'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /Config not found|portabase init/);
  assert.doesNotMatch(`${result.stderr}\n${result.stdout}`, /AWS Capsule V2/);
});
