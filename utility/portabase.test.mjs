import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  capsuleName,
  compareDatabaseInventories,
  decryptFile,
  editionFor,
  encryptFile,
  isCapsuleName,
  providerCommand,
  providerRemote,
  providerVerifyCommand,
  projectBaseUrl,
  recoveryEvidenceStatus,
  safeObjectPath,
  supabaseHeaders,
  validateBlankRestoreInventory,
  validateDrillCapsule,
  validateRestoreTarget,
} from './portabase-core.mjs';

test('trial edition cannot be accidentally promoted by a missing flag', () => {
  assert.equal(editionFor({ trialFlag: true, environment: '' }), 'trial');
  assert.equal(editionFor({ trialFlag: false, environment: 'trial' }), 'trial');
  assert.equal(editionFor({ trialFlag: false, environment: 'essentials' }), 'essentials');
});

test('safeObjectPath accepts nested object names', () => {
  assert.match(safeObjectPath('avatars/user/photo.jpg'), /avatars.+user.+photo\.jpg/);
});

test('safeObjectPath blocks traversal', () => {
  assert.throws(() => safeObjectPath('../secret.txt'), /Unsafe object path/);
});

test('AWS upload command targets the customer bucket', () => {
  const [command, args] = providerCommand({ provider: { type: 'aws', bucket: 'customer-vault', prefix: 'prod' } }, 'C:\\capsule');
  assert.equal(command, 'aws');
  assert.ok(args.some(value => String(value).includes('s3://customer-vault/prod/')));
  assert.ok(args.includes('SHA256'));
  assert.match(providerRemote({ provider: { type: 'aws', bucket: 'customer-vault', prefix: 'prod' } }, 'C:\\capsule'), /^s3:\/\/customer-vault\/prod\//);
  const [, verifyArgs] = providerVerifyCommand({ provider: { type: 'aws', bucket: 'customer-vault', prefix: 'prod' } }, 'C:\\capsule');
  assert.ok(verifyArgs.includes('--dryrun'));
  assert.ok(verifyArgs.includes('ENABLED'));
});

test('Dropbox upload uses customer rclone remote', () => {
  const [command, args] = providerCommand({ provider: { type: 'dropbox', remote: 'mydropbox', path: '/Portabase' } }, '/tmp/capsule');
  assert.equal(command, 'rclone');
  assert.ok(args.some(value => String(value).startsWith('mydropbox:')));
  assert.ok(args.includes('--immutable'));
});

test('modern Supabase keys are not incorrectly sent as JWT bearer tokens', () => {
  const modern = supabaseHeaders('sb_secret_example');
  assert.equal(modern.apikey, 'sb_secret_example');
  assert.equal(modern.Authorization, undefined);
  const legacy = supabaseHeaders('legacy.jwt.value');
  assert.equal(legacy.Authorization, 'Bearer legacy.jwt.value');
});

test('project URL normalization accepts stored REST and Storage endpoint URLs', () => {
  assert.equal(projectBaseUrl('https://project.supabase.co/rest/v1/'), 'https://project.supabase.co');
  assert.equal(projectBaseUrl('https://project.supabase.co/storage/v1'), 'https://project.supabase.co');
  assert.equal(projectBaseUrl('https://project.supabase.co'), 'https://project.supabase.co');
});

test('restore target guards refuse source and mismatched confirmation', () => {
  assert.throws(() => validateRestoreTarget('source', 'source', 'source'), /source project/);
  assert.throws(() => validateRestoreTarget('source', 'target', 'wrong'), /exactly match/);
  assert.throws(() => validateRestoreTarget('source', 'target', 'target', 'https://other.supabase.co'), /does not match/);
  assert.equal(validateRestoreTarget('source', 'target', 'target', 'https://target.supabase.co'), true);
});

test('restore refuses any occupied destination inventory', () => {
  assert.deepEqual(validateBlankRestoreInventory({ applicationTables: 0, authUsers: 0, storageBuckets: 0, edgeFunctions: 0 }), { applicationTables: 0, authUsers: 0, storageBuckets: 0, edgeFunctions: 0 });
  assert.throws(() => validateBlankRestoreInventory({ applicationTables: 0, authUsers: 1, storageBuckets: 0, edgeFunctions: 0 }), /target is not blank.*authUsers=1/);
});

test('limited restore drill accepts only a deliberately limited trial capsule', () => {
  assert.equal(validateDrillCapsule('trial'), true);
  assert.throws(() => validateDrillCapsule('essentials'), /requires a current trial capsule/);
});

test('database recovery evidence detects row and structural drift', () => {
  const expected = { tables: [{ schema: 'public', name: 'orders', rows: 4 }], authUsers: 1, policies: 2, databaseFunctions: 1, triggers: 1 };
  assert.equal(compareDatabaseInventories(expected, structuredClone(expected)).verified, true);
  const drifted = structuredClone(expected);
  drifted.tables[0].rows = 3;
  const comparison = compareDatabaseInventories(expected, drifted);
  assert.equal(comparison.verified, false);
  assert.deepEqual(comparison.rowMismatches, [{ table: 'public.orders', expected: 4, actual: 3 }]);
});

test('recovery evidence never calls a partial or unverified restore successful', () => {
  const verified = { verified: true };
  assert.equal(recoveryEvidenceStatus({ mode: 'execute', captureStatus: 'COMPLETE', database: verified, storage: verified, functions: verified }), 'RECOVERY_DATA_PATH_VERIFIED');
  assert.equal(recoveryEvidenceStatus({ mode: 'execute', captureStatus: 'PARTIAL', database: verified, storage: verified, functions: verified }), 'FAILED');
  assert.equal(recoveryEvidenceStatus({ mode: 'execute', captureStatus: 'COMPLETE', database: { verified: false }, storage: verified, functions: verified }), 'FAILED');
  assert.equal(recoveryEvidenceStatus({ mode: 'limited-drill', captureStatus: 'TRIAL', database: verified, storage: verified, functions: verified }), 'LIMITED_DRILL_PASSED');
});

test('capsule names are recognized only for the configured project', () => {
  const name = capsuleName('abcdefghijklmnopqrst', new Date('2026-07-12T12:34:56.000Z'));
  assert.equal(name, 'abcdefghijklmnopqrst-2026-07-12T12-34-56Z');
  assert.equal(isCapsuleName('abcdefghijklmnopqrst', name), true);
  assert.equal(isCapsuleName('different', name), false);
  assert.equal(isCapsuleName('abcdefghijklmnopqrst', '.work-' + name), false);
});

test('encrypted capsules authenticate and reject the wrong passphrase', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portabase-test-'));
  try {
    const source = join(root, 'plain.tar.gz');
    const encrypted = join(root, 'capsule.pbase');
    const restored = join(root, 'restored.tar.gz');
    await writeFile(source, Buffer.from('customer-owned recovery data'));
    const metadata = await encryptFile(source, encrypted, 'correct horse battery staple', 'capsule-id');
    await decryptFile(encrypted, restored, 'correct horse battery staple', metadata);
    assert.deepEqual(await readFile(restored), await readFile(source));
    await assert.rejects(
      decryptFile(encrypted, join(root, 'wrong.tar.gz'), 'this passphrase is definitely wrong', metadata),
      /authenticate|Unsupported state/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
