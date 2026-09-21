import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  RESOURCE_CLASS,
  SIZE_POLICY,
  applySizePolicy,
  assertReadOnlyAwsCli,
  decideBinaryPath,
} from '../utility/aws/index.mjs';

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
  assert.equal(decision.recommendedPath, 'reference-latest-completed-snapshot');
});

test('unmeasured EBS volume will-fail', () => {
  const decision = decideBinaryPath({
    resourceClass: RESOURCE_CLASS.VOLUME,
    id: 'vol-unknown',
    encryption: { encrypted: true },
  });
  assert.equal(decision.finding, 'will-fail');
  assert.ok(decision.restoreBlockers.includes('unmeasured-volume'));
});

test('binary dump request will-fail even when a snapshot exists', () => {
  const decision = decideBinaryPath({
    resourceClass: RESOURCE_CLASS.VOLUME,
    id: 'vol-dump',
    sizeGiB: 8,
    recommendedSnapshotId: 'snap-x',
    dumpBytes: true,
  });
  assert.equal(decision.finding, 'will-fail');
  assert.ok(decision.restoreBlockers.includes('binary-dump-refused'));
});

test('oversized scripted payload will-fail; large payload will-warn', () => {
  const huge = { resourceClass: RESOURCE_CLASS.IAM_POLICY, id: 'huge', scriptedPayload: { body: 'x'.repeat(SIZE_POLICY.scriptedWarnMaxBytes + 10) } };
  const large = { resourceClass: RESOURCE_CLASS.IAM_POLICY, id: 'large', scriptedPayload: { body: 'y'.repeat(SIZE_POLICY.scriptedCopyMaxBytes + 10) } };
  assert.equal(decideBinaryPath(huge).finding, 'will-fail');
  assert.ok(decideBinaryPath(huge).restoreBlockers.includes('scripted-payload-too-large'));
  assert.equal(decideBinaryPath(large).finding, 'will-warn');
  assert.ok(decideBinaryPath(large).restoreBlockers.includes('scripted-payload-large'));
});

test('applySizePolicy is exported and keeps will-copy for small JSON', () => {
  const base = {
    action: ACTIONS.PACK_SCRIPTED,
    finding: 'will-copy',
    reason: 'ok',
    coverage: 'scripted',
    inCapsule: true,
    recommendedPath: null,
    restoreBlockers: [],
  };
  const next = applySizePolicy(base, { resourceClass: RESOURCE_CLASS.VPC, scriptedPayload: { VpcId: 'vpc-1' } });
  assert.equal(next.finding, 'will-copy');
  assert.equal(next.measured.scriptedBytes > 0, true);
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

test('IAM, VPC, DynamoDB, and KMS descriptions will-copy', () => {
  assert.equal(decideBinaryPath({ resourceClass: RESOURCE_CLASS.IAM_ROLE, id: 'app-ec2' }).finding, 'will-copy');
  assert.equal(decideBinaryPath({ resourceClass: RESOURCE_CLASS.VPC, id: 'vpc-aaa' }).finding, 'will-copy');
  assert.equal(decideBinaryPath({ resourceClass: RESOURCE_CLASS.INSTANCE, id: 'i-abc' }).finding, 'will-copy');
  assert.equal(decideBinaryPath({ resourceClass: RESOURCE_CLASS.DYNAMODB_TABLE, id: 'sessions' }).finding, 'will-copy');
  assert.equal(decideBinaryPath({ resourceClass: RESOURCE_CLASS.KMS_KEY, id: 'alias/app' }).finding, 'will-copy');
});

test('read-only AWS CLI allowlist refuses CreateSnapshot and GetSecretValue', () => {
  assert.equal(assertReadOnlyAwsCli('ec2', 'describe-volumes'), true);
  assert.throws(() => assertReadOnlyAwsCli('ec2', 'create-snapshot'), /create-snapshot/);
  assert.throws(() => assertReadOnlyAwsCli('secretsmanager', 'get-secret-value'), /get-secret-value/);
  assert.throws(() => assertReadOnlyAwsCli('s3api', 'put-object'), /put-object/);
  assert.throws(() => assertReadOnlyAwsCli('ec2', 'run-instances'), /run-instances/);
});
