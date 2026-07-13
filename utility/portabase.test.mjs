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
  formatBytes,
  trialProtectionLedger,
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
import { cleanSchemaLine } from './portabase.mjs';

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

test('schema cleanup preserves PL/pgSQL function definitions and bodies', () => {
  assert.equal(cleanSchemaLine('    LANGUAGE "plpgsql"'), '    LANGUAGE "plpgsql"');
  assert.equal(cleanSchemaLine('  select * from storage.objects;'), '  select * from storage.objects;');
  assert.equal(cleanSchemaLine('CREATE FUNCTION "public"."touch"() RETURNS trigger'), 'CREATE OR REPLACE FUNCTION "public"."touch"() RETURNS trigger');
});

test('schema cleanup filters grants only when they reference an excluded schema', () => {
  assert.match(cleanSchemaLine('GRANT SELECT ON TABLE "auth"."users" TO "reader";'), /^-- /);
  assert.match(cleanSchemaLine('GRANT USAGE ON SCHEMA "storage" TO "reader";'), /^-- /);
  assert.equal(cleanSchemaLine('GRANT SELECT ON TABLE "public"."orders" TO "reader";'), 'GRANT SELECT ON TABLE "public"."orders" TO "reader";');
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

test('trial protection ledger exposes the gap between found and protected', () => {
  const ledger = trialProtectionLedger({
    database: { complete: true, limited: true, files: ['roles.sql', 'schema.sql'], summary: { tables: 23, rows: 48112, approximateRows: true, authUsers: 1204, policies: 6, databaseFunctions: 2, triggers: 3 } },
    storage: { objectCount: 5, totalBytes: 51200, inventory: { bucketCount: 4, objectCount: 890, totalBytes: 3435973836 } },
    functions: { count: 2, names: ['a', 'b'], availableCount: 7, available: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], secretNames: ['STRIPE_KEY', 'RESEND_KEY'] },
  });
  const byLayer = Object.fromEntries(ledger.rows.map(row => [row.layer, row]));
  assert.equal(byLayer['Database rows'].found, 48112);
  assert.equal(byLayer['Database rows'].protected, 0);
  assert.equal(byLayer['Database rows'].approximate, true);
  assert.equal(byLayer['Auth users'].protected, 0);
  assert.equal(byLayer['Storage files'].found, 890);
  assert.equal(byLayer['Storage files'].protected, 5);
  assert.equal(byLayer['Edge Functions'].found, 7);
  assert.equal(byLayer['Edge Functions'].protected, 2);
  assert.equal(byLayer['Secret values'].byDesign, true);
  assert.deepEqual(ledger.unprotectedLayers, ['Database rows', 'Auth users', 'Storage files', 'Edge Functions']);
});

test('trial protection ledger treats secrets as by-design, never as a failure', () => {
  const ledger = trialProtectionLedger({
    database: { complete: true, limited: false, summary: { tables: 2, rows: 10, approximateRows: false, authUsers: 3, policies: 0, databaseFunctions: 0, triggers: 0 } },
    storage: { objectCount: 4, totalBytes: 100, inventory: { bucketCount: 1, objectCount: 4, totalBytes: 100 } },
    functions: { count: 1, names: ['a'], availableCount: 1, available: ['a'], secretNames: ['ONLY_SECRET'] },
  });
  assert.deepEqual(ledger.unprotectedLayers, []);
  const secrets = ledger.rows.find(row => row.layer === 'Secret values');
  assert.equal(secrets.found, 1);
  assert.equal(secrets.protected, 0);
});

test('ledger degrades gracefully when a layer was skipped or unknown', () => {
  const ledger = trialProtectionLedger({
    database: { complete: false, limited: true },
    storage: { objectCount: 0 },
    functions: { complete: false, skipped: true, reason: 'SUPABASE_ACCESS_TOKEN not provided' },
  });
  const byLayer = Object.fromEntries(ledger.rows.map(row => [row.layer, row]));
  assert.equal(byLayer['Database rows'].found, null);
  assert.equal(byLayer['Edge Functions'].found, null);
  assert.equal(byLayer['Secret values'].found, null);
  assert.deepEqual(ledger.unprotectedLayers, []);
});

test('byte formatting stays human readable across magnitudes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(51200), '50.0 KB');
  assert.equal(formatBytes(3435973836), '3.2 GB');
});

test('trial report renders the full inventory ledger and never claims completeness', async () => {
  const { writeTrialReport } = await import('./portabase.mjs');
  const root = await mkdtemp(join(tmpdir(), 'portabase-report-'));
  try {
    await writeTrialReport(root, {
      projectRef: 'abcdefghijklmnopqrst',
      contents: {
        database: { complete: true, limited: true, files: ['roles.sql', 'schema.sql'], summary: { tables: 23, rows: 48112, approximateRows: true, authUsers: 1204, policies: 6, databaseFunctions: 2, triggers: 3 } },
        storage: { objectCount: 5, totalBytes: 51200, inventory: { bucketCount: 4, objectCount: 890, totalBytes: 3435973836 } },
        functions: { count: 2, names: ['a', 'b'], availableCount: 7, available: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], secretNames: ['STRIPE_KEY', '<script>alert(1)</script>'] },
      },
    });
    const html = await readFile(join(root, 'TRIAL-REPORT.html'), 'utf8');
    assert.match(html, /~48,112/);
    assert.match(html, /890/);
    assert.match(html, /3\.2 GB/);
    assert.match(html, /5 of 890 Storage files/);
    assert.match(html, /0 of ~48,112/);
    assert.match(html, /Computed locally\. Transmitted nowhere\./);
    assert.match(html, /STRIPE_KEY/);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'secret names must be HTML-escaped');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
