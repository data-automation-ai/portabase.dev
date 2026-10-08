import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { captureOptions, inventoryObject, payloadStorage, targetDatabaseUrl, databaseIdentity, assertDatabaseTarget,
  assertDeltaBaseline, verifiedCachePath, assembleDeltaPayload, containedPath, validateRecoveryArgs } from '../utility/recovery-options.mjs';
import { captureStorage, restoreDatabase, captureDatabaseNative } from '../utility/portabase.mjs';
import { parseStorageDestination, preflightStorageS3, restoreStorageS3 } from '../utility/storage-s3-restore.mjs';
import { validateOverwrite, overwriteSql, rolesForOverwrite } from '../utility/overwrite-target.mjs';
import { recoveryEvidenceStatus, baselineObjectUnchanged } from '../utility/portabase-core.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'portabase-options-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, path, data) {
  const full = containedPath(root, path);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, typeof data === 'object' ? JSON.stringify(data) : data);
}

test('capture modes have explicit conflicts and omitted objects never become payload', () => {
  assert.deepEqual(captureOptions({}, ['--ddl-only', '--storage-inventory-only']), { ddlOnly: true, storageInventoryOnly: true });
  assert.throws(() => captureOptions({}, ['--ddl-only', '--include-table-data']), /cannot/);
  assert.throws(() => captureOptions({}, ['--storage-inventory-only', '--trial']), /unsampled/);
  const object = inventoryObject('photo.jpg', { size: 17 });
  assert.equal(object.includedInCapsule, false);
  assert.equal(object.presentAtSource, true);
  assert.equal(payloadStorage({ buckets: [{ objects: [object] }] }).objectCount, 0);
});

test('capture and restore reject misspelled options and missing values before side effects', () => {
  assert.throws(() => validateRecoveryArgs('backup', ['backup', '--storage-inventry-only']), /Unknown/);
  assert.throws(() => validateRecoveryArgs('restore', ['restore', '--storage-to-s3', '--execute']), /requires a value/);
  assert.throws(() => validateRecoveryArgs('restore', ['restore', '--fill-missing']), /unsupported/);
  validateRecoveryArgs('restore', ['restore', '--capsule', '/runner/full', '--preflight', '--storage-to-s3', 's3://vault/prefix', '--s3-expected-owner', '123456789012']);
});

test('DDL-only runs schema and role dumps, never a data dump; normal capture includes data', async t => {
  const root = await fixture(t);
  for (const ddlOnly of [true, false]) {
    const directory = join(root, ddlOnly ? 'ddl' : 'full');
    await mkdir(directory);
    const calls = [];
    const result = await captureDatabaseNative('postgresql://postgres:test@source.invalid/postgres', directory,
      ddlOnly ? { databaseSchemaOnly: true } : null, [], {
        resolveExecutable: name => name,
        dumpToFile: async (tool, args, path) => { calls.push(args); await writeFile(path, 'SELECT 1;\n'); },
        inventoryFor: async () => ({ tables: [], authUsers: 0 }),
      });
    assert.equal(calls.some(args => args.includes('--data-only')), !ddlOnly);
    assert.equal(result.files.includes('data.sql'), !ddlOnly);
    assert.equal(result.limited, ddlOnly);
    assert.ok((await readFile(join(directory, 'schema.sql'), 'utf8')).includes('SELECT 1'));
  }
});

test('inventory-only capture lists names and sizes without downloading any bytes', async t => {
  const root = await fixture(t);
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/storage/v1/bucket')) return Response.json([{ id: 'photos', name: 'photos' }]);
    if (url.endsWith('/storage/v1/object/list/photos')) return Response.json([{ id: '1', name: 'x.jpg', metadata: { size: 123, mimetype: 'image/jpeg' } }]);
    assert.fail('Inventory-only capture attempted to fetch object bytes');
  });
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://source.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });
  const result = await captureStorage(root, null, { capture: { storageInventoryOnly: true }, backupDirectory: join(root, 'capsules'), statusDirectory: join(root, 'status') });
  assert.equal(result.objectCount, 0);
  assert.equal(result.omittedObjectCount, 1);
  assert.equal(result.omittedBytes, 123);
  const manifest = JSON.parse(await readFile(join(root, 'storage/storage-manifest.json')));
  assert.equal(manifest.buckets[0].objects[0].name, 'x.jpg');
  assert.equal(manifest.buckets[0].objects[0].includedInCapsule, false);
});

test('database names differ independently; wrong host/project and same-source targets fail', () => {
  const target = targetDatabaseUrl('postgresql://postgres:secret@db.target.supabase.co/postgres', 'recovered_app');
  assert.equal(new URL(target).pathname, '/recovered_app');
  assert.equal(databaseIdentity(target), 'db.target.supabase.co:5432/recovered_app');
  assertDatabaseTarget({ targetUrl: target, targetRef: 'target' });
  assert.throws(() => assertDatabaseTarget({ targetUrl: target, targetRef: 'wrong' }), /does not match/);
  assert.throws(() => assertDatabaseTarget({ sourceUrl: target, targetUrl: target, targetRef: 'target' }), /source/);
  assert.throws(() => targetDatabaseUrl(target, 'x/other'), /simple database/);
  assert.throws(() => assertDatabaseTarget({ targetUrl: target, targetRef: 'target', overwrite: true }), /confirm-target-db/);
});

test('incremental capture downloads new files, reuses verified bytes, refreshes newer files, and emits delta deletions', async t => {
  const root = await fixture(t);
  const priorEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://source.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  t.after(() => {
    if (priorEnv.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = priorEnv.url;
    if (priorEnv.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = priorEnv.key;
  });
  let timestamp = '2026-01-01T00:00:00Z';
  let body = 'old';
  let downloads = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/storage/v1/bucket')) return Response.json([{ id: 'photos', name: 'photos' }]);
    if (url.endsWith('/storage/v1/object/list/photos')) return Response.json([{ id: 'x', name: 'x.jpg', updated_at: timestamp, metadata: { size: 3, eTag: 'stable', mimetype: 'image/jpeg' } }]);
    assert.ok(url.endsWith('/storage/v1/object/authenticated/photos/x.jpg'));
    downloads++;
    return new Response(body);
  });
  const config = { projectRef: 'source', capture: { incrementalBinary: true }, backupDirectory: join(root, 'capsules'), statusDirectory: join(root, 'status') };
  async function capture(n, baseline = null) {
    const directory = join(root, `run-${n}`);
    const result = await captureStorage(directory, null, config, [], [], baseline);
    const manifest = await readFile(join(directory, 'storage/storage-manifest.json'), 'utf8');
    await put(root, 'status/last-storage-manifest.json', manifest);
    return { result, manifest: JSON.parse(manifest), directory };
  }
  await capture(1);
  const second = await capture(2);
  assert.equal(downloads, 1);
  assert.equal(second.result.cacheHits, 1);
  assert.equal(await readFile(join(second.directory, 'storage/photos/x.jpg'), 'utf8'), 'old');
  timestamp = '2026-02-01T00:00:00Z';
  body = 'new';
  const third = await capture(3);
  assert.equal(downloads, 2);
  assert.equal(await readFile(join(third.directory, 'storage/photos/x.jpg'), 'utf8'), 'new');
  const baseline = new Map([['photos/x.jpg', third.manifest.buckets[0].objects[0]], ['photos/deleted.jpg', { sha256: sha('gone'), size: 4 }]]);
  const fourth = await capture(4, baseline);
  assert.equal(downloads, 2);
  assert.equal(fourth.result.deltaReused, 1);
  assert.deepEqual(fourth.result.tombstones, ['photos/deleted.jpg']);
  assert.equal(fourth.manifest.buckets[0].objects[0].payloadLocation, 'baseline');
});

test('verified cache rejects corruption and changed metadata, accepts exact prior bytes', async t => {
  const root = await fixture(t);
  const prior = { sha256: sha('old'), size: 3, updatedAt: '2026-01-01', etag: 'old' };
  await put(root, `${prior.sha256.slice(0, 2)}/${prior.sha256}`, 'old');
  assert.ok(await verifiedCachePath(root, prior, prior));
  assert.equal(await verifiedCachePath(root, prior, { ...prior, updatedAt: '2026-02-01' }), null);
  assert.equal(baselineObjectUnchanged(prior, { ...prior, updatedAt: '2026-02-01' }), false);
  await put(root, `${prior.sha256.slice(0, 2)}/${prior.sha256}`, 'bad');
  assert.equal(await verifiedCachePath(root, prior, prior), null);
});

test('delta reconstruction preserves unchanged bytes, replaces changes, and removes deletions', async t => {
  const root = await fixture(t);
  const baseRoot = join(root, 'base');
  const deltaRoot = join(root, 'delta');
  const baseline = { projectRef: 'source', status: 'COMPLETE' };
  const delta = { projectRef: 'source', baseline: { capsuleId: 'full-1', manifestSha256: sha(JSON.stringify(baseline)) },
    deltaHashes: { database: { 'schema.sql': sha('schema'), 'data.sql': sha('new rows') } },
    delta: { database: { reused: [{ path: 'schema.sql', sha256: sha('schema') }], missing: [] },
      functions: { reused: [], missing: ['old/index.ts'] }, storage: { tombstones: ['photos/gone.jpg'] } } };
  await put(baseRoot, 'database/schema.sql', 'schema');
  await put(baseRoot, 'database/data.sql', 'old rows');
  await put(baseRoot, 'storage/photos/keep.jpg', 'keep');
  await put(baseRoot, 'storage/photos/gone.jpg', 'gone');
  await put(baseRoot, 'functions/old/index.ts', 'old');
  await put(deltaRoot, 'database/data.sql', 'new rows');
  await put(deltaRoot, 'storage/photos/new.jpg', 'new');
  await put(deltaRoot, 'storage/storage-manifest.json', { buckets: [{ id: 'photos', public: false, objects: [
    { name: 'keep.jpg', size: 4, sha256: sha('keep'), includedInCapsule: false, payloadLocation: 'baseline' },
    { name: 'new.jpg', size: 3, sha256: sha('new') },
  ] }] });
  await put(deltaRoot, 'functions/functions-manifest.json', { functions: [] });
  const dest = await assembleDeltaPayload({ baselineRoot: baseRoot, deltaRoot, destination: join(root, 'merged'), baseline, delta, baselineId: 'full-1' });
  assert.equal(await readFile(join(dest, 'database/data.sql'), 'utf8'), 'new rows');
  assert.equal(await readFile(join(dest, 'storage/photos/keep.jpg'), 'utf8'), 'keep');
  await assert.rejects(readFile(join(dest, 'storage/photos/gone.jpg')), /ENOENT/);
  await assert.rejects(readFile(join(dest, 'functions/old/index.ts')), /ENOENT/);
  assert.equal(await readFile(join(baseRoot, 'storage/photos/gone.jpg'), 'utf8'), 'gone');
  assert.throws(() => assertDeltaBaseline(delta, baseline, 'wrong'), /ID/);
  assert.throws(() => assertDeltaBaseline(delta, { ...baseline, status: 'PARTIAL' }, 'full-1'), /checksum/);
  await put(baseRoot, 'database/schema.sql', 'corrupt');
  await assert.rejects(assembleDeltaPayload({ baselineRoot: baseRoot, deltaRoot, destination: join(root, 'bad'), baseline, delta, baselineId: 'full-1' }), /checksum/);
});

test('S3 diversion checks owner, transfers bytes, verifies read-back, and records omitted objects', async t => {
  const root = await fixture(t);
  await put(root, 'storage/photos/x.jpg', 'abc');
  const storage = { buckets: [{ id: 'photos', objects: [{ name: 'x.jpg', size: 3, sha256: sha('abc') }, inventoryObject('absent.jpg', { size: 22 })] }] };
  const destination = parseStorageDestination('s3://customer-vault/restore', '123456789012');
  const objects = new Map();
  const calls = [];
  const command = async (args, options) => {
    calls.push(args);
    if (args[0] === 'sts') return JSON.stringify({ Account: '123456789012' });
    if (args[0] === 's3api') return '';
    if (options?.hashOutput) { const bytes = objects.get(args[2]); return { sha256: sha(bytes), bytes: bytes.length }; }
    objects.set(args[3], await readFile(args[2]));
    return '';
  };
  await preflightStorageS3(destination, command);
  const result = await restoreStorageS3({ extracted: root, storage, destination, capsuleId: 'capsule-1', command, runId: 'test' });
  assert.equal(result.hashesVerified, 1);
  assert.equal(result.omittedObjectCount, 1);
  assert.equal(result.storageServingRestored, false);
  assert.ok(objects.has(result.mappingUri));
  assert.ok(calls.some(args => args.includes('--expected-bucket-owner')));
  assert.equal(result.mapping.objects[0].s3Uri, 's3://customer-vault/restore/capsule-1/test/objects/photos/x.jpg');
  await assert.rejects(restoreStorageS3({ extracted: root, storage, destination, capsuleId: 'capsule-1', runId: 'bad',
    command: async (args, options) => options?.hashOutput ? { sha256: sha('bad'), bytes: 3 } : '' }), /mismatch/);
  assert.throws(() => parseStorageDestination('s3://customer-vault', ''), /expected-owner/);
});

test('overwrite requires bound, verified rollback and refuses changed targets and filtered capture', () => {
  const inventory = { tables: [], authUsers: 0 };
  const contents = Object.fromEntries(['database', 'auth', 'storage', 'functions'].map(name => [name, { complete: true }]));
  const options = { sourceRef: 'source', targetRef: 'target', confirmation: 'target', scope: 'app-and-auth',
    capture: { status: 'COMPLETE', contents }, rollback: { projectRef: 'target', status: 'COMPLETE', sourceDatabaseIdentity: 'target:5432/postgres', contents },
    rollbackId: 'rollback-1', rollbackHash: sha('capsule'), identity: 'target:5432/postgres', currentInventory: inventory, rollbackInventory: inventory,
    proof: { status: 'RECOVERY_DATA_PATH_VERIFIED', capsuleId: 'rollback-1', capsuleSha256: sha('capsule'), sourceProjectRef: 'target', targetProjectRef: 'drill',
      database: { verified: true }, storage: { verified: true }, functions: { verified: true } } };
  assert.equal(validateOverwrite(options), true);
  assert.throws(() => validateOverwrite({ ...options, confirmation: 'wrong' }), /confirm-overwrite/);
  assert.throws(() => validateOverwrite({ ...options, sourceRef: 'target' }), /source/);
  assert.throws(() => validateOverwrite({ ...options, proof: { ...options.proof, capsuleSha256: 'wrong' } }), /evidence/);
  assert.throws(() => validateOverwrite({ ...options, currentInventory: { ...inventory, authUsers: 1 } }), /changed/);
  assert.throws(() => validateOverwrite({ ...options, restorePlan: {} }), /unfiltered/);
  assert.throws(() => overwriteSql({ schemas: ['auth'], authTables: [] }), /platform/);
  assert.throws(() => overwriteSql({ schemas: ['public'], authTables: [], extensionSchemas: ['public'] }), /extensions/);
  assert.match(overwriteSql({ schemas: ['public'], authTables: ['users', 'identities'] }), /TRUNCATE TABLE "auth"\."users", "auth"\."identities" RESTART IDENTITY/);
  assert.equal(rolesForOverwrite('CREATE ROLE "existing";\nCREATE ROLE "new";', ['existing']), 'CREATE ROLE "new";');
});

test('database restore submits reset and all SQL in one transaction, fails closed, and keeps URL out of argv', async t => {
  const root = await fixture(t);
  for (const file of ['roles.sql', 'schema.sql', 'data.sql']) await put(root, `database/${file}`, '-- fixture\n');
  const prior = process.env.PORTABASE_TARGET_DB_URL;
  process.env.PORTABASE_TARGET_DB_URL = 'postgresql://postgres:test-secret@target.invalid/recovered';
  t.after(() => { if (prior === undefined) delete process.env.PORTABASE_TARGET_DB_URL; else process.env.PORTABASE_TARGET_DB_URL = prior; });
  const calls = [];
  const adapter = { resolveExecutable: () => 'mock-psql', runCommand: async (...args) => calls.push(args) };
  await restoreDatabase(root, null, { sql: '-- reset', existingRoles: [] }, adapter);
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes('--single-transaction'));
  assert.ok(calls[0][1].includes('ON_ERROR_STOP=1'));
  assert.equal(calls[0][1].filter(arg => arg === '--file').length, 4);
  assert.equal(calls[0][2].env.PGDATABASE, 'recovered');
  assert.ok(!JSON.stringify(calls[0][1]).includes('test-secret'));
  await assert.rejects(restoreDatabase(root, null, null, { ...adapter, runCommand: async () => { throw new Error('SQL failure'); } }), /SQL failure/);
  await put(root, 'database/data.sql', "INSERT INTO public.omitted VALUES ('must not execute');\n");
  calls.length = 0;
  await assert.rejects(restoreDatabase(root, { tables: [] }, null, adapter), { code: 'unsupported_capsule_sql' });
  assert.equal(calls.length, 0, 'unsupported selective SQL must fail before any database command');
  await put(root, 'database/data.sql', 'COPY public.kept (id) FROM stdin;\n1\n\\.\n');
  const scratchRoot = join(root, 'private-scratch');
  await mkdir(scratchRoot);
  let filteredPath;
  await restoreDatabase(root, { tables: [{ schema: 'public', table: 'kept', selected: true }] }, null, {
    ...adapter, scratchRoot, runCommand: async (_command, args) => {
      filteredPath = args.find(value => typeof value === 'string' && value.includes('portabase-plan-'));
      const rel = relative(scratchRoot, filteredPath);
      assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
      assert.match(await readFile(filteredPath, 'utf8'), /COPY public.kept/);
    },
  });
  await assert.rejects(readFile(filteredPath), { code: 'ENOENT' });
  await assert.rejects(restoreDatabase(root, null, null, { ...adapter, scratchRoot: 'F:/refused' }), { code: 'private_config_path_refused' });
});

test('separate S3 and selective evidence cannot claim complete recovery', () => {
  const layers = { mode: 'execute', database: { verified: true }, functions: { verified: true }, storage: { verified: true, destination: 's3' } };
  assert.equal(recoveryEvidenceStatus({ ...layers, captureStatus: 'COMPLETE' }), 'DATABASE_RESTORED_OBJECTS_IN_S3');
  assert.equal(recoveryEvidenceStatus({ ...layers, captureStatus: 'SELECTIVE' }), 'SELECTIVE_RESTORE_OBJECTS_IN_S3');
  assert.equal(recoveryEvidenceStatus({ ...layers, captureStatus: 'PARTIAL' }), 'FAILED');
});
