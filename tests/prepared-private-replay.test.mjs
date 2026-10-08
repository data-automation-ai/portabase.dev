import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { createPrivateCapsuleReview } from '../utility/ui/private-capsule-review.mjs';
import { preparePrivateReplay } from '../utility/private-replay-prepare.mjs';
import { encryptFile } from '../utility/capsule-crypto.mjs';
import { packDirectoryTarGz } from '../utility/portabase-core.mjs';
import { restoreDatabase, runPreparedPrivateReplay } from '../utility/portabase.mjs';

const targetRef = 'bbbbbbbbbbbbbbbbbbbb';
function environment(t, patch = {}) {
  const env = { PORTABASE_PROJECT_REF: 'abcdefghijklmnopqrst', PORTABASE_TARGET_PROJECT_REF: targetRef,
    PORTABASE_TARGET_SUPABASE_URL: `https://${targetRef}.supabase.co`, PORTABASE_TARGET_SERVICE_ROLE_KEY: 'synthetic-target-key',
    PORTABASE_TARGET_SECRET_KEY: '', PORTABASE_TARGET_DB_URL: `postgresql://postgres:synthetic-password@db.${targetRef}.supabase.co/postgres`,
    SUPABASE_DB_URL: 'postgresql://postgres:synthetic-password@db.abcdefghijklmnopqrst.supabase.co/postgres',
    SUPABASE_ACCESS_TOKEN: 'synthetic-management', PORTABASE_RUNTIME_CONFIG: '', ...patch };
  const prior = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}
async function fixture(t, { admissionMaxBytes = 1000, selectedBuckets = [], selectedFunctions = [], inventoryOnly = false, omitted = false, incompleteFunctions = false, invalidFunctionSource = false } = {}) {
  const f = await privateCapsuleFixture();
  if (invalidFunctionSource) {
    await mkdir(join(f.raw, 'functions', 'send-receipt'), { recursive: true });
    await writeFile(join(f.raw, 'functions', 'send-receipt', 'README.txt'), 'No executable entrypoint.');
  }
  const object = Buffer.alloc(100, 65), sha = createHash('sha256').update(object).digest('hex');
  await mkdir(join(f.raw, 'storage', 'images'));
  await writeFile(join(f.raw, 'storage', 'images', 'private-object.jpg'), object);
  await writeFile(join(f.raw, 'storage', 'storage-manifest.json'), JSON.stringify({ inventoryOnly, buckets: [{ id: 'images', objects: [{ name: 'private-object.jpg', size: 100, sha256: sha, includedInCapsule: !omitted }] }] }));
  if (incompleteFunctions) { f.manifest.contents.functions.complete = false; await writeFile(join(f.raw, 'manifest.json'), JSON.stringify(f.manifest)); }
  await writeFile(join(f.raw, 'database', 'roles.sql'), '-- synthetic role definitions\n');
  await writeFile(join(f.raw, 'database', 'schema.sql'), '-- synthetic schema definitions\n');
  await packDirectoryTarGz(f.raw, f.archive);
  await rm(join(f.capsule, 'capsule.pbase'));
  f.metadata.encryption = await encryptFile(f.archive, join(f.capsule, 'capsule.pbase'), f.options.passphrase, f.metadata.id);
  await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify(f.metadata));
  const service = await createPrivateCapsuleReview(f.options), review = await service.inspect({});
  const saved = await service.save({ revision: review.revision, selectedTables: ['public.orders'], selectedBuckets, selectedFunctions, maxBytes: 1000000, confirmEmpty: false });
  const prepared = await preparePrivateReplay({ ...f.options, planRef: saved.planRef, expectedBindingSha256: saved.bindingSha256, admissionMaxBytes });
  t.after(() => prepared.cleanup());
  const evidenceDirectory = join(f.directory, 'durable-evidence'); await mkdir(evidenceDirectory);
  const options = { directory: f.directory, targetRef, confirmTarget: targetRef, evidenceDirectory };
  const calls = [], writes = [], sql = [];
  const adapters = {
    readDatabaseName: async () => { calls.push('database-name'); return 'postgres'; },
    querySelectedTableCount: async sql => { calls.push('selected-row-count'); assert.equal(sql, 'SELECT count(*)::text FROM "public"."orders";'); return '1'; },
    targetFetch: async () => { calls.push('target-health'); return { ok: true }; },
    readTargetInventory: async () => { calls.push('inventory'); return { applicationTables: 0, authUsers: 0, storageBuckets: 0, edgeFunctions: 0 }; },
    restoreDatabase: async (extracted, plan, overwrite, runnerOptions) => {
      writes.push('database'); assert.equal(extracted, prepared.extracted); assert.equal(plan, prepared.plan); assert.equal(overwrite, null);
      assert.equal(runnerOptions.scratchRoot, prepared.scratchRoot);
      return restoreDatabase(extracted, plan, overwrite, { ...runnerOptions, resolveExecutable: () => 'synthetic-psql', runCommand: async (_name, args, opts) => {
        assert.ok(args.includes('--single-transaction')); assert.ok(args.includes('ON_ERROR_STOP=1'));
        assert.doesNotMatch(JSON.stringify(args), /synthetic-password/); assert.equal(opts.env.PGDATABASE, 'postgres');
        for (let index = 0; index < args.length; index++) if (args[index] === '--file') {
          const path = args[++index]; sql.push(await readFile(path, 'utf8'));
          if (path.includes('portabase-plan-')) assert.equal(relative(prepared.scratchRoot, path).startsWith('..'), false);
        }
      } });
    },
    restoreStorage: async (extracted, plan) => { writes.push('storage'); assert.equal(extracted, prepared.extracted); assert.equal(plan, prepared.plan); return { verified: true, hashesVerified: 0 }; },
    restoreFunctions: async (_extracted, manifest, ref, plan) => { writes.push('functions'); assert.equal(manifest, prepared.manifest); assert.equal(ref, targetRef); assert.equal(plan, prepared.plan); return { verified: true, active: [] }; },
    verifyRestoredDatabase: async (_extracted, _limited, plan) => { calls.push('database-readback'); assert.equal(plan, prepared.plan); return { verified: true, actualTableCount: 2, actualRows: 1 }; },
  };
  return { ...f, prepared, saved, options, adapters, calls, writes, sql };
}

test('prepared replay consumes immutable selection with lower admission, real SQL filtering and durable private evidence', async t => {
  environment(t); const f = await fixture(t);
  // Original source files no longer participate in execution.
  await writeFile(join(f.capsule, 'capsule.json'), '{}'); await writeFile(join(f.capsule, 'capsule.pbase'), 'changed');
  await writeFile(join(f.directory, f.saved.planPath), '{}');
  const result = await runPreparedPrivateReplay(f.prepared, f.options, f.adapters);
  assert.equal(result.status, 'SELECTIVE_RESTORE_VERIFIED'); assert.equal(result.report.restorePlan.maxBytes, 1000);
  assert.deepEqual(f.writes, ['database']);
  assert.deepEqual(f.calls, ['database-name', 'target-health', 'inventory', 'database-readback', 'selected-row-count']);
  const sql = f.sql.join('\n'); assert.match(sql, /synthetic role definitions/); assert.match(sql, /synthetic schema definitions/);
  assert.match(sql, /COPY public.orders/); assert.doesNotMatch(sql, /COPY "public"\."empty"/);
  assert.match(result.report.scope, /roles-and-schema-apply-in-full/);
  await f.prepared.cleanup();
  const report = JSON.parse(await readFile(result.evidence.jsonPath));
  assert.equal(report.status, 'SELECTIVE_RESTORE_VERIFIED'); assert.equal(report.bindingSha256, f.saved.bindingSha256);
  assert.equal(report.database.selectedRows.comparison, 'row-counts-only'); assert.equal(report.database.selectedRows.tables[0].expectedRows, 1);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-password|synthetic-target-key/);
});

test('forged or cleaned preparation and unsupported options fail before any external operation', async t => {
  environment(t); const f = await fixture(t);
  await assert.rejects(runPreparedPrivateReplay({ ...f.prepared }, f.options, f.adapters), { code: 'restore_plan_preparation_required' });
  for (const patch of [{ allowOccupied: true }, { allowSourceTarget: true }, { overwrite: true }, { capsulePath: f.capsule }, { restorePlan: {} }, { preflight: 'true' }]) {
    await assert.rejects(runPreparedPrivateReplay(f.prepared, { ...f.options, ...patch }, f.adapters), { code: 'private_replay_options_refused' });
  }
  process.env.PORTABASE_RUNTIME_CONFIG = '{}';
  await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, f.adapters), { code: 'private_replay_options_refused' });
  process.env.PORTABASE_RUNTIME_CONFIG = '';
  await f.prepared.cleanup(); await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, f.adapters), { code: 'restore_plan_preparation_required' });
  assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
});

test('foreign source/target, wrong confirmation, wrong endpoint and source database all refuse before target calls', async t => {
  environment(t); const f = await fixture(t);
  for (const patch of [{ targetRef: f.options.projectRef }, { confirmTarget: 'wrong' }]) await assert.rejects(runPreparedPrivateReplay(f.prepared, { ...f.options, ...patch }, f.adapters));
  for (const [key, value] of [
    ['PORTABASE_PROJECT_REF', targetRef], ['PORTABASE_TARGET_PROJECT_REF', 'other'],
    ['PORTABASE_TARGET_SUPABASE_URL', 'https://different.supabase.co'], ['PORTABASE_TARGET_SUPABASE_URL', `http://${targetRef}.supabase.co`],
    ['PORTABASE_TARGET_DB_URL', process.env.SUPABASE_DB_URL], ['PORTABASE_TARGET_SERVICE_ROLE_KEY', ''],
  ]) { const original = process.env[key]; process.env[key] = value; await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, f.adapters)); process.env[key] = original; }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
});

test('evidence cannot escape the private root or be written into the temporary preparation', async t => {
  environment(t); const f = await fixture(t);
  for (const evidenceDirectory of [f.prepared.temp, f.prepared.extracted, 'F:/refused', join(f.directory, '..')]) {
    await assert.rejects(runPreparedPrivateReplay(f.prepared, { ...f.options, evidenceDirectory }, f.adapters));
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
});

test('connected database, credential health and exact blank inventory checks prevent every write', async t => {
  environment(t); const f = await fixture(t);
  const cases = [
    { readDatabaseName: async () => 'wrong_database' }, { targetFetch: async () => ({ ok: false }) },
    { readTargetInventory: async () => ({ applicationTables: 1, authUsers: 0, storageBuckets: 0, edgeFunctions: 0 }) },
    { readTargetInventory: async () => ({ applicationTables: 0, authUsers: 2, storageBuckets: 0, edgeFunctions: 0 }) },
    { readTargetInventory: async () => ({}) }, { readTargetInventory: async () => ({ applicationTables: -1, authUsers: 0, storageBuckets: 0, edgeFunctions: 0 }) },
    { readTargetInventory: async () => ({ applicationTables: 0, authUsers: 0, storageBuckets: '0', edgeFunctions: 0 }) },
  ];
  for (const patch of cases) await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, { ...f.adapters, ...patch }));
  assert.deepEqual(f.writes, []);
  const files = await readdir(f.options.evidenceDirectory); assert.ok(files.some(name => name.endsWith('.json')));
  for (const file of files.filter(name => name.endsWith('.json'))) assert.equal(JSON.parse(await readFile(join(f.options.evidenceDirectory, file))).status, 'FAILED');
});

test('storage payload tamper fails even with successful transport adapters and preflight writes nothing', async t => {
  environment(t); const f = await fixture(t, { selectedBuckets: ['images'] });
  const preflight = await runPreparedPrivateReplay(f.prepared, { ...f.options, preflight: true }, f.adapters);
  assert.equal(preflight.status, 'PREFLIGHT_PASSED'); assert.deepEqual(f.writes, []);
  await writeFile(join(f.prepared.extracted, 'storage', 'images', 'private-object.jpg'), 'tampered');
  await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, f.adapters), /payload/);
  assert.deepEqual(f.writes, []);
});

test('selected inventory-only, omitted Storage and incomplete Function payloads fail before any target operation', async t => {
  environment(t);
  for (const options of [{ selectedBuckets: ['images'], inventoryOnly: true }, { selectedBuckets: ['images'], omitted: true },
    { selectedFunctions: ['send-receipt'], incompleteFunctions: true }, { selectedFunctions: ['send-receipt'] },
    { selectedFunctions: ['send-receipt'], invalidFunctionSource: true }]) {
    const f = await fixture(t, options);
    await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, f.adapters), { code: 'private_replay_selected_data_unavailable' });
    assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
  }
});

test('unselected missing Storage and incomplete Functions do not block selected database recovery', async t => {
  environment(t); const f = await fixture(t, { incompleteFunctions: true });
  await rm(join(f.prepared.extracted, 'storage', 'images', 'private-object.jpg'));
  const result = await runPreparedPrivateReplay(f.prepared, f.options, f.adapters);
  assert.equal(result.status, 'SELECTIVE_RESTORE_VERIFIED'); assert.equal(result.report.storage.skipped, true); assert.equal(result.report.functions.skipped, true);
  assert.deepEqual(f.writes, ['database']);
});

test('failed read-back throws and persists FAILED, never returns a verified result', async t => {
  environment(t); const f = await fixture(t);
  await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, { ...f.adapters, verifyRestoredDatabase: async () => ({ verified: false, reason: 'synthetic mismatch' }) }), { code: 'private_replay_verification_failed' });
  const files = (await readdir(f.options.evidenceDirectory)).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1); const report = JSON.parse(await readFile(join(f.options.evidenceDirectory, files[0])));
  assert.equal(report.status, 'FAILED'); assert.equal(report.database.verified, false);
});

test('cleanup during an awaited preflight observation revokes preparation before subsequent calls', async t => {
  environment(t); const f = await fixture(t); let health = 0;
  await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, { ...f.adapters,
    readDatabaseName: async () => { await f.prepared.cleanup(); return 'postgres'; }, targetFetch: async () => { health++; return { ok: true }; } }), { code: 'restore_plan_preparation_required' });
  assert.equal(health, 0); assert.deepEqual(f.writes, []);
});

test('selected row-count mismatch fails even when the broad database inventory says verified', async t => {
  environment(t); const f = await fixture(t);
  await assert.rejects(runPreparedPrivateReplay(f.prepared, f.options, { ...f.adapters, querySelectedTableCount: async () => '0' }), { code: 'private_replay_verification_failed' });
  const file = (await readdir(f.options.evidenceDirectory)).find(name => name.endsWith('.json'));
  const report = JSON.parse(await readFile(join(f.options.evidenceDirectory, file)));
  assert.equal(report.status, 'FAILED'); assert.equal(report.database.verified, false); assert.equal(report.database.selectedRows.tables[0].reason, 'row_count_mismatch');
});
