import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AWS_CAPSULE_FORMAT_VERSION,
  AWS_CAPSULE_KIND,
  AWS_CAPSULE_MANIFEST_SCHEMA,
  AWS_INVENTORY_SCHEMA_VERSION,
  AWS_PACKAGE_FILES,
  buildCapsulePackageShape,
  buildDoctorReport,
  buildInventory,
  emptySecretsPolicy,
  unprovenCoverage,
  validateAwsCapsuleManifest,
} from '../utility/aws/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(root, 'utility/aws/fixtures/sample-account.json');

async function loadFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

test('AWS capsule versions are independent of Supabase formatVersion 1', () => {
  assert.equal(AWS_CAPSULE_KIND, 'portabase-aws-capsule');
  assert.equal(AWS_CAPSULE_FORMAT_VERSION, '2.0.0');
  assert.equal(AWS_INVENTORY_SCHEMA_VERSION, '1.0.0');
  assert.equal(AWS_CAPSULE_MANIFEST_SCHEMA.properties.kind.const, AWS_CAPSULE_KIND);
  assert.notEqual(AWS_CAPSULE_FORMAT_VERSION, '1');
});

test('escape-package shape matches Supabase files and does not seal keys', () => {
  const shape = buildCapsulePackageShape({
    kind: AWS_CAPSULE_KIND,
    capsuleFormatVersion: AWS_CAPSULE_FORMAT_VERSION,
    profile: 'exclude-binaries',
  });
  assert.equal(shape.family, 'portabase-escape-package');
  assert.equal(shape.formatVersion, 2);
  assert.equal(shape.files.manifest, AWS_PACKAGE_FILES.manifest);
  assert.equal(shape.files.ciphertext, 'capsule.pbase');
  assert.equal(shape.files.checksums, 'checksums.sha256');
  assert.equal(shape.files.recover, 'RECOVER.txt');
  assert.equal(shape.sealed, false);
  assert.equal(shape.holdsKeys, false);
  assert.equal(shape.owner, 'customer');
  assert.match(shape.recoverHint, /never holds/i);
  assert.match(shape.recoverHint, /MATCH/i);
  assert.match(shape.recoverHint, /most recent completed backups/i);
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
  assert.equal(report.packageShape.sealed, false);
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
