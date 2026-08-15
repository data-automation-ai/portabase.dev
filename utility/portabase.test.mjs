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
  generateFunctionRedeployScripts,
  mapPool,
  PINNED_SUPABASE_CLI,
  PLATFORM_SCHEMA_EXCLUDES,
  resolveStorageConcurrency,
  SCHEMA_EXCLUDE_VERSION,
  schemaExcludePattern,
  storageCacheKey,
  trialProtectionLedger,
  isCapsuleName,
  providerCommand,
  providerRemote,
  providerVerifyCommand,
  projectBaseUrl,
  recoveryEvidenceStatus,
  safeObjectPath,
  shouldSkipStorageDownload,
  storageObjectIdentity,
  supabaseHeaders,
  validateBlankRestoreInventory,
  validateDrillCapsule,
  validateRestoreTarget,
  assertLocalStarterSize,
  LOCAL_STARTER_MAX_BYTES,
  directoryByteSize,
  isLocalProvider,
  FIRST_PER_BUCKET_STORAGE,
  TRIAL_LIMITS,
  fingerprintSortedKeys,
  storageObjectKeysFromBuckets,
  fingerprintsMatch,
  DEFAULT_RESTORE_PLAN_MAX_BYTES,
  measureDataSqlTables,
  filterDataSqlByTables,
  buildRestorePlan,
  restorePlanSelectedBytes,
  validateRestorePlan,
  restorePlanSelectedTableKeys,
  filterStorageManifestByPlan,
  restorePlanSelectedFunctionNames,
  classifyFunctionDirs,
  enableCliFlag,
} from './portabase-core.mjs';

test('enableCliFlag mutates the argv slice hasFlag-style readers use', () => {
  const slice = ['replay', '--confirm-target', 'abc'];
  assert.equal(slice.includes('--execute'), false);
  enableCliFlag(slice, 'execute');
  assert.equal(slice.includes('--execute'), true);
  enableCliFlag(slice, 'execute');
  assert.equal(slice.filter(a => a === '--execute').length, 1);
});

test('first-per-bucket storage sample is not a schema-only trial', () => {
  assert.equal(FIRST_PER_BUCKET_STORAGE.databaseSchemaOnly, false);
  assert.equal(FIRST_PER_BUCKET_STORAGE.firstObjectPerBucket, true);
  assert.equal(FIRST_PER_BUCKET_STORAGE.maxFunctions, null);
  assert.equal(TRIAL_LIMITS.databaseSchemaOnly, true);
});

test('storage name+size fingerprint is order-independent and size-sensitive', () => {
  const a = fingerprintSortedKeys(['b/z\t10', 'a/x\t1', 'a/y\t2'], 'md5');
  const b = fingerprintSortedKeys(['a/y\t2', 'b/z\t10', 'a/x\t1'], 'md5');
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.count, 3);
  assert.equal(a.method, 'sorted-name-size-concat');
  assert.equal(fingerprintsMatch(a, b), true);
  // same names, different reported size → different fingerprint
  const c = fingerprintSortedKeys(['b/z\t11', 'a/x\t1', 'a/y\t2'], 'md5');
  assert.equal(fingerprintsMatch(a, c), false);
  const keys = storageObjectKeysFromBuckets([
    { id: 'images', objects: [{ name: 'a.png', size: 9 }, { fullName: 'b/c.png', size: 3 }] },
  ]);
  assert.deepEqual(keys.sort(), ['images/a.png\t9', 'images/b/c.png\t3'].sort());
});

test('sample-expected fingerprint differs from full source inventory', () => {
  const full = fingerprintSortedKeys(['b/a\t1', 'b/z\t2', 'c/x\t3'], 'md5');
  const sample = fingerprintSortedKeys(['b/a\t1', 'c/x\t3'], 'md5');
  assert.equal(fingerprintsMatch(full, sample), false);
  assert.equal(sample.count, 2);
  assert.equal(full.count, 3);
});
import { cleanSchemaLine } from './portabase.mjs';

test('demo trial is opt-in; default is full community capture', () => {
  assert.equal(editionFor({ trialFlag: true, environment: '' }), 'trial');
  assert.equal(editionFor({ trialFlag: false, environment: 'trial' }), 'trial');
  assert.equal(editionFor({ trialFlag: false, environment: 'essentials' }), 'community');
  assert.equal(editionFor({ trialFlag: false, environment: '' }), 'community');
});

test('safeObjectPath accepts nested object names', () => {
  assert.match(safeObjectPath('avatars/user/photo.jpg'), /avatars.+user.+photo\.jpg/);
});

test('safeObjectPath blocks traversal', () => {
  assert.throws(() => safeObjectPath('../secret.txt'), /Unsafe object path/);
});

test('storageObjectIdentity reads size etag and content type', () => {
  const id = storageObjectIdentity({
    updated_at: '2026-08-01T00:00:00.000Z',
    metadata: { size: 42, etag: '"abc"', mimetype: 'image/png' },
  });
  assert.equal(id.size, 42);
  assert.equal(id.etag, '"abc"');
  assert.equal(id.contentType, 'image/png');
  assert.equal(id.updatedAt, '2026-08-01T00:00:00.000Z');
});

test('shouldSkipStorageDownload resumes when size and etag match prior record', () => {
  const listing = { size: 100, etag: 'e1', updatedAt: 't1' };
  assert.equal(shouldSkipStorageDownload({ size: 100 }, listing, { size: 100, etag: 'e1', sha256: 'x' }), true);
  assert.equal(shouldSkipStorageDownload({ size: 99 }, listing, { size: 100, etag: 'e1', sha256: 'x' }), false);
  assert.equal(shouldSkipStorageDownload({ size: 100 }, listing, null), false);
});

test('generateFunctionRedeployScripts emits ps1 bash and verify_jwt flags', () => {
  const out = generateFunctionRedeployScripts(
    [{ name: 'health', verifyJwt: true }, { name: 'public-hook', verifyJwt: false }],
    { projectRef: 'abcd' },
  );
  assert.match(out.ps1, /functions deploy health/);
  assert.match(out.ps1, /functions deploy public-hook --project-ref \$ProjectRef --no-verify-jwt/);
  assert.match(out.bash, /public-hook.*--no-verify-jwt/);
  assert.match(out.ps1, new RegExp(`supabase@${PINNED_SUPABASE_CLI}`));
  assert.doesNotMatch(out.ps1, /supabase@latest/);
  assert.equal(out.manifest.totalFunctions, 2);
  assert.equal(out.manifest.functions[1].verifyJwt, false);
});

test('schema exclude list is versioned and non-empty (W10)', () => {
  assert.ok(SCHEMA_EXCLUDE_VERSION >= 2);
  assert.ok(PLATFORM_SCHEMA_EXCLUDES.includes('auth'));
  assert.ok(PLATFORM_SCHEMA_EXCLUDES.includes('storage'));
  assert.match(schemaExcludePattern(), /supabase_functions/);
});

test('storageCacheKey prefers sha256 then identity hash (W1)', () => {
  const sha = 'a'.repeat(64);
  assert.equal(storageCacheKey({}, sha), sha);
  const key = storageCacheKey({ size: 10, updatedAt: 't', etag: 'e' });
  assert.equal(key.length, 64);
  assert.equal(storageCacheKey({}), null);
});

test('mapPool runs with concurrency and preserves order', async () => {
  const started = [];
  const results = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
    started.push(n);
    await new Promise(r => setTimeout(r, 5));
    return n * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.equal(started.length, 5);
});

test('resolveStorageConcurrency reads config and env', () => {
  const prev = process.env.PORTABASE_STORAGE_CONCURRENCY;
  try {
    delete process.env.PORTABASE_STORAGE_CONCURRENCY;
    assert.equal(resolveStorageConcurrency({}), 8);
    assert.equal(resolveStorageConcurrency({ capture: { storageConcurrency: 12 } }), 12);
    process.env.PORTABASE_STORAGE_CONCURRENCY = '24';
    assert.equal(resolveStorageConcurrency({ capture: { storageConcurrency: 8 } }), 24);
  } finally {
    if (prev === undefined) delete process.env.PORTABASE_STORAGE_CONCURRENCY;
    else process.env.PORTABASE_STORAGE_CONCURRENCY = prev;
  }
});

test('aws provider prefers s3 sync for destination efficiency (W1)', () => {
  const cmd = providerCommand({ provider: { type: 'aws', bucket: 'b', prefix: 'p' } }, 'C:/caps/c1');
  assert.equal(cmd[0], 'aws');
  assert.equal(cmd[1][1], 'sync');
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
  assert.ok(verifyArgs.includes('--size-only'));
  assert.ok(!verifyArgs.includes('--checksum-mode'), 'checksum-mode is download-only in the AWS CLI and breaks upload verification');
});

test('Dropbox upload uses customer rclone remote', () => {
  const [command, args] = providerCommand({ provider: { type: 'dropbox', remote: 'mydropbox', path: '/Portabase' } }, '/tmp/capsule');
  assert.equal(command, 'rclone');
  assert.ok(args.some(value => String(value).startsWith('mydropbox:')));
  assert.ok(args.includes('--immutable'));
});

test('Local Starter size gate allows under 100 MB and refuses over without override', async () => {
  assert.equal(isLocalProvider({ provider: { type: 'local' } }), true);
  assert.equal(assertLocalStarterSize(50 * 1024 * 1024).ok, true);
  assert.equal(assertLocalStarterSize(LOCAL_STARTER_MAX_BYTES).ok, true);
  assert.throws(
    () => assertLocalStarterSize(LOCAL_STARTER_MAX_BYTES + 1),
    /Local Starter vault refuses/,
  );
  assert.equal(assertLocalStarterSize(LOCAL_STARTER_MAX_BYTES + 1, { allowLargeLocal: true }).allowedByOverride, true);
  const root = await mkdtemp(join(tmpdir(), 'pb-local-'));
  try {
    await writeFile(join(root, 'a.bin'), Buffer.alloc(1024));
    assert.equal(await directoryByteSize(root), 1024);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  assert.deepEqual(
    validateBlankRestoreInventory({ applicationTables: 2, authUsers: 1, storageBuckets: 0, edgeFunctions: 0 }, { allowOccupied: true }),
    { applicationTables: 2, authUsers: 1, storageBuckets: 0, edgeFunctions: 0 },
  );
});

test('restore can allow source==target only with explicit opt-in', () => {
  assert.throws(() => validateRestoreTarget('same', 'same', 'same'), /source project/);
  assert.equal(validateRestoreTarget('same', 'same', 'same', '', { allowSourceTarget: true }), true);
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

test('open-source capsule-crypto module is the AES-GCM source of truth', async () => {
  const crypto = await import('./capsule-crypto.mjs');
  assert.equal(crypto.CAPSULE_CRYPTO_FORMAT, 'portabase-aes256gcm-v1');
  assert.equal(crypto.CAPSULE_CIPHER, 'aes-256-gcm');
  assert.equal(crypto.CAPSULE_PASSPHRASE_MIN_LENGTH, 16);
  assert.match(crypto.capsuleCryptoPublicDescription(), /capsule-crypto\.mjs/);
  assert.equal(typeof crypto.encryptFile, 'function');
  assert.equal(typeof crypto.decryptFile, 'function');
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

const SYNTHETIC_DATA_SQL = [
  '--',
  '-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres',
  '--',
  '',
  'COPY "public"."orders" ("id", "customer", "note") FROM stdin;',
  '1\tAlice\thas a tab\\tescaped in this field',
  '2\tBob\t\\N',
  '\\.',
  '',
  '--',
  '-- Data for Name: empty_table; Type: TABLE DATA; Schema: public; Owner: postgres',
  '--',
  '',
  'COPY "public"."empty_table" ("id") FROM stdin;',
  '\\.',
  '',
  '--',
  '-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin',
  '--',
  '',
  'COPY "auth"."users" ("id", "email") FROM stdin;',
  '11111111-1111-1111-1111-111111111111\ta@example.com',
  '22222222-2222-2222-2222-222222222222\tb@example.com',
  '\\.',
  '',
  'SELECT pg_catalog.setval(\'public.orders_id_seq\', 2, true);',
  '',
].join('\n');

test('measureDataSqlTables measures each COPY block including its header and terminator', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portabase-plan-test-'));
  try {
    const dataSqlPath = join(root, 'data.sql');
    await writeFile(dataSqlPath, SYNTHETIC_DATA_SQL);
    const sizes = await measureDataSqlTables(dataSqlPath);
    const byKey = Object.fromEntries(sizes.map(t => [`${t.schema}.${t.table}`, t.bytes]));
    assert.equal(Object.keys(byKey).length, 3);
    assert.ok(byKey['public.orders'] > 0);
    assert.ok(byKey['public.empty_table'] > 0, 'empty table still has a measurable header+terminator block');
    assert.ok(byKey['auth.users'] > byKey['public.empty_table']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filterDataSqlByTables keeps only selected COPY blocks and preserves other lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portabase-plan-test-'));
  try {
    const sourcePath = join(root, 'data.sql');
    const targetPath = join(root, 'filtered.sql');
    await writeFile(sourcePath, SYNTHETIC_DATA_SQL);
    await filterDataSqlByTables(sourcePath, targetPath, new Set(['public.orders']));
    const filtered = await readFile(targetPath, 'utf8');
    assert.match(filtered, /COPY "public"\."orders"/);
    assert.doesNotMatch(filtered, /COPY "public"\."empty_table"/);
    assert.doesNotMatch(filtered, /COPY "auth"\."users"/);
    assert.doesNotMatch(filtered, /b@example\.com/);
    assert.match(filtered, /Alice/);
    // non-COPY lines (comments, setval) pass through untouched
    assert.match(filtered, /setval\('public\.orders_id_seq', 2, true\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filterDataSqlByTables can select zero tables, producing a dump with no data rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portabase-plan-test-'));
  try {
    const sourcePath = join(root, 'data.sql');
    const targetPath = join(root, 'filtered.sql');
    await writeFile(sourcePath, SYNTHETIC_DATA_SQL);
    await filterDataSqlByTables(sourcePath, targetPath, new Set());
    const filtered = await readFile(targetPath, 'utf8');
    assert.doesNotMatch(filtered, /^COPY /m);
    assert.match(filtered, /setval/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildRestorePlan selects everything by default and binds to the capsule id', () => {
  const manifest = { projectRef: 'abcxyz', contents: { functions: { names: ['fn-a', 'fn-b'] } } };
  const storageManifest = { buckets: [{ id: 'avatars', objects: [{ name: 'a.png', size: 1000 }, { name: 'b.png', size: 2000 }] }] };
  const tableSizes = [{ schema: 'public', table: 'orders', bytes: 500 }];
  const plan = buildRestorePlan({ manifest, capsuleId: 'abcxyz-2026-01-01T00-00-00Z', tableSizes, storageManifest });
  assert.equal(plan.capsuleId, 'abcxyz-2026-01-01T00-00-00Z');
  assert.equal(plan.tables.length, 1);
  assert.equal(plan.buckets.length, 1);
  assert.equal(plan.buckets[0].bytes, 3000);
  assert.equal(plan.functions.length, 2);
  assert.ok(plan.tables.every(t => t.selected));
  assert.equal(restorePlanSelectedBytes(plan), 3500);
  assert.equal(plan.maxBytes, DEFAULT_RESTORE_PLAN_MAX_BYTES);
});

test('validateRestorePlan refuses a plan generated for a different capsule', () => {
  const plan = buildRestorePlan({ manifest: { projectRef: 'abc' }, capsuleId: 'abc-2026-01-01T00-00-00Z', tableSizes: [] });
  assert.throws(
    () => validateRestorePlan(plan, { capsuleId: 'abc-2026-02-02T00-00-00Z' }),
    /different capsule|abc-2026-02-02T00-00-00Z/,
  );
});

test('validateRestorePlan hard-stops when selected bytes exceed the budget', () => {
  const plan = buildRestorePlan({
    manifest: { projectRef: 'abc' },
    capsuleId: 'abc-2026-01-01T00-00-00Z',
    tableSizes: [{ schema: 'public', table: 'big_table', bytes: 600 * 1024 * 1024 }],
    maxBytes: 500 * 1024 * 1024,
  });
  assert.throws(() => validateRestorePlan(plan, { capsuleId: 'abc-2026-01-01T00-00-00Z' }), /over the .* budget/);
});

test('validateRestorePlan passes once over-budget tables are deselected', () => {
  const plan = buildRestorePlan({
    manifest: { projectRef: 'abc' },
    capsuleId: 'abc-2026-01-01T00-00-00Z',
    tableSizes: [{ schema: 'public', table: 'big_table', bytes: 600 * 1024 * 1024 }],
    maxBytes: 500 * 1024 * 1024,
  });
  plan.tables[0].selected = false;
  const { selectedBytes } = validateRestorePlan(plan, { capsuleId: 'abc-2026-01-01T00-00-00Z' });
  assert.equal(selectedBytes, 0);
});

test('restorePlanSelectedTableKeys reflects only selected: true entries', () => {
  const plan = buildRestorePlan({
    manifest: { projectRef: 'abc' },
    capsuleId: 'abc-2026-01-01T00-00-00Z',
    tableSizes: [{ schema: 'public', table: 'a', bytes: 1 }, { schema: 'public', table: 'b', bytes: 1 }],
  });
  plan.tables.find(t => t.table === 'b').selected = false;
  const keys = restorePlanSelectedTableKeys(plan);
  assert.deepEqual([...keys], ['public.a']);
});

test('filterStorageManifestByPlan keeps only selected buckets and recomputes objectCount', () => {
  const storageManifest = {
    buckets: [
      { id: 'avatars', objects: [{ name: 'a.png', size: 100 }] },
      { id: 'invoices', objects: [{ name: 'x.pdf', size: 200 }, { name: 'y.pdf', size: 300 }] },
    ],
  };
  const plan = buildRestorePlan({ manifest: { projectRef: 'abc' }, capsuleId: 'id', tableSizes: [], storageManifest });
  plan.buckets.find(b => b.id === 'invoices').selected = false;
  const filtered = filterStorageManifestByPlan(storageManifest, plan);
  assert.deepEqual(filtered.buckets.map(b => b.id), ['avatars']);
  assert.equal(filtered.objectCount, 1);
});

test('classifyFunctionDirs treats a captured function with its directory as present', () => {
  const entries = [{ name: 'fn-a', captureVia: 'cli' }, { name: 'fn-b', captureVia: 'management-api' }];
  const result = classifyFunctionDirs(entries, () => true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.present, 2);
});

test('classifyFunctionDirs excuses a ghost function that capture skipped as 404', () => {
  const entries = [
    { name: 'fn-a', captureVia: 'cli' },
    { name: 'generate-image', captureVia: 'skipped-missing' },
  ];
  const result = classifyFunctionDirs(entries, name => name !== 'generate-image');
  assert.deepEqual(result.missing, [], 'a deliberately skipped ghost is not a lost source');
  assert.deepEqual(result.skipped, ['generate-image']);
  assert.equal(result.present, 1);
});

test('classifyFunctionDirs still fails a function that was captured but lost its directory', () => {
  // The adversarial case: the ghost-function excuse must NOT mask a genuine gap.
  const entries = [
    { name: 'fn-a', captureVia: 'cli' },
    { name: 'fn-lost', captureVia: 'cli' },
    { name: 'generate-image', captureVia: 'skipped-missing' },
  ];
  const result = classifyFunctionDirs(entries, name => name === 'fn-a');
  assert.deepEqual(result.missing, ['fn-lost'], 'a captured function with no directory is still missing');
  assert.deepEqual(result.skipped, ['generate-image']);
  assert.equal(result.present, 1);
});

test('restorePlanSelectedFunctionNames reflects only selected: true entries', () => {
  const plan = buildRestorePlan({ manifest: { projectRef: 'abc', contents: { functions: { names: ['fn-a', 'fn-b'] } } }, capsuleId: 'id', tableSizes: [] });
  plan.functions.find(f => f.name === 'fn-b').selected = false;
  assert.deepEqual([...restorePlanSelectedFunctionNames(plan)], ['fn-a']);
});
