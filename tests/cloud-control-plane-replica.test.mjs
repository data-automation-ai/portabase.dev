import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControlPlaneStore } from '../cloud/control-plane/store.mjs';
import { createInjectedPrimary, createSupabasePrimary, LIVE_BUSINESS_SOURCE_REF } from '../cloud/control-plane/supabase-primary.mjs';
import {
  assertPersistentSqlitePath,
  isMemorySqlitePath,
  openPersistentSqlite,
} from '../cloud/control-plane/sqlite-file.mjs';
import { assertAllowedRow, findForbiddenField, isCapsuleHash } from '../cloud/control-plane/forbidden.mjs';

const HASH = 'a'.repeat(64);

function scratch() {
  return mkdtempSync(join(tmpdir(), 'portabase-cp-replica-'));
}

function dbPath(dir) {
  return join(dir, 'control-plane.db');
}

function storeFor(dir, primary, now) {
  return createControlPlaneStore({ filePath: dbPath(dir), primary, now });
}

function subscriber(overrides = {}) {
  return {
    id: 'sub_1',
    email: 'ops@example.com',
    user_id: 'user_1',
    status: 'active',
    plan_id: 'cloud-17',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

test('opens and creates one persistent sqlite file with essential tables', () => {
  const dir = scratch();
  const primary = createInjectedPrimary();
  const store = storeFor(dir, primary);
  assert.equal(statSync(store.filePath).isFile(), true);
  const names = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(names, [
    'billing_metadata',
    'capsule_hashes',
    'jobs',
    'promo_codes',
    'replica_meta',
    'subscribers',
    'sync_outbox',
  ]);
  const files = readdirSync(dir).filter((name) => name.endsWith('.db'));
  assert.deepEqual(files, ['control-plane.db']);
  assert.equal(store.meta('schema_version'), '1');
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('refuses :memory:, memory URIs, empty path, and F:', () => {
  assert.equal(isMemorySqlitePath(':memory:'), true);
  assert.equal(isMemorySqlitePath('file::memory:?cache=shared'), true);
  assert.equal(isMemorySqlitePath('file:foo.db?mode=memory'), true);
  assert.throws(() => openPersistentSqlite(':memory:'), { code: 'sqlite_memory_refused' });
  assert.throws(() => openPersistentSqlite('file::memory:'), { code: 'sqlite_memory_refused' });
  assert.throws(() => assertPersistentSqlitePath(''), { code: 'sqlite_path_required' });
  assert.throws(() => assertPersistentSqlitePath('F:/portabase/control-plane.db'), { code: 'f_drive_refused' });
  assert.throws(() => assertPersistentSqlitePath('F:\\portabase\\control-plane.db'), { code: 'f_drive_refused' });
});

test('happy-path replicate copies primary essentials onto the sqlite file', async () => {
  const dir = scratch();
  const primary = createInjectedPrimary({
    subscribers: [subscriber()],
    promo_codes: [{
      id: 'promo_1',
      code: 'LAUNCH',
      plan_id: 'cloud-17',
      percent_off: 10,
      expires_at: '2026-12-31T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    }],
    billing_metadata: [{
      id: 'bill_1',
      subscriber_id: 'sub_1',
      square_customer_id: 'sq_c_1',
      square_subscription_id: 'sq_s_1',
      trial_ends_at: '2026-09-08T00:00:00.000Z',
      current_period_end: null,
      price_monthly_cents: 1700,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    }],
    jobs: [{
      id: 'job_1',
      type: 'dry-run',
      status: 'queued',
      project_ref: 'abcdefghijklmnopqr',
      capsule_hash: HASH,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    }],
    capsule_hashes: [{
      id: 'cap_1',
      hash: HASH,
      algorithm: 'sha256',
      created_at: '2026-09-01T00:00:00.000Z',
    }],
  });
  const store = storeFor(dir, primary);
  const replicated = await store.replicate();
  assert.equal(replicated.counts.subscribers, 1);
  assert.equal(replicated.counts.promo_codes, 1);
  assert.equal(replicated.counts.jobs, 1);
  assert.equal(replicated.counts.capsule_hashes, 1);

  primary.setDown(true);
  const subs = await store.list('subscribers');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].email, 'ops@example.com');
  assert.equal((await store.get('capsule_hashes', 'cap_1')).hash, HASH);
  assert.equal(store.meta('last_replicate_at') != null, true);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('operates while supabase is down: read and write land on sqlite and queue', async () => {
  const dir = scratch();
  const primary = createInjectedPrimary({ subscribers: [subscriber()] });
  const store = storeFor(dir, primary);
  await store.replicate();
  primary.setDown(true);

  const listed = await store.list('subscribers');
  assert.equal(listed[0].id, 'sub_1');

  const written = await store.write('subscribers', {
    email: 'night@example.com',
    plan_id: 'cloud-7',
    status: 'trialing',
  });
  assert.equal(written.source, 'sqlite');
  assert.equal(written.queued, true);
  assert.equal((await store.list('subscribers')).length, 2);

  const job = await store.write('jobs', { type: 'verify', project_ref: 'abcdefghijklmnopqr' });
  assert.equal(job.queued, true);
  assert.equal((await store.list('jobs'))[0].type, 'verify');

  const pending = store.outbox();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].collection, 'subscribers');
  assert.equal(primary.snapshot().subscribers.length, 1);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('sync-back replays the outbox when the primary returns', async () => {
  const dir = scratch();
  const primary = createInjectedPrimary();
  primary.setDown(true);
  const store = storeFor(dir, primary);

  const written = await store.write('promo_codes', { code: 'night', plan_id: 'cloud-17', percent_off: 15 });
  assert.equal(written.queued, true);
  assert.equal(primary.snapshot().promo_codes.length, 0);

  primary.setDown(false);
  const sync = await store.syncBack();
  assert.equal(sync.applied, 1);
  assert.equal(sync.remaining, 0);
  assert.equal(primary.snapshot().promo_codes.length, 1);
  assert.equal(primary.snapshot().promo_codes[0].code, 'NIGHT');
  assert.equal(store.outbox().length, 0);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('backup copies the sqlite file and schedule writes a second copy', async () => {
  const dir = scratch();
  const primary = createInjectedPrimary({ subscribers: [subscriber()] });
  const store = storeFor(dir, primary);
  await store.replicate();

  const dest = join(dir, 'backups', 'control-plane.db');
  const copied = store.backup(dest);
  assert.equal(copied.destPath, dest);
  assert.ok(copied.bytes > 0);
  assert.equal(statSync(dest).isFile(), true);
  assert.notEqual(dest, store.filePath);

  const destDir = join(dir, 'scheduled');
  const scheduled = store.scheduleBackup({ destDir, intervalMs: 50 });
  assert.equal(statSync(scheduled.first.destPath).isFile(), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  scheduled.stop();
  const snaps = readdirSync(destDir).filter((name) => name.endsWith('.db'));
  assert.ok(snaps.length >= 1);
  assert.ok(snaps[0].startsWith('control-plane-'));

  store.close();
  const reopened = openPersistentSqlite(dest);
  const rows = reopened.db.prepare('SELECT email FROM subscribers').all();
  assert.equal(rows[0].email, 'ops@example.com');
  reopened.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('refuses keys, capsule bytes, and secret-shaped bodies on write', async () => {
  const dir = scratch();
  const store = storeFor(dir, createInjectedPrimary());

  await assert.rejects(
    () => store.write('subscribers', { email: 'ops@example.com', plan_id: 'cloud-17', service_role: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa' }),
    { code: 'forbidden_secret_shape' },
  );
  await assert.rejects(
    () => store.write('jobs', { type: 'dry-run', db_url: 'postgres://postgres:hunter2@db.supabase.co:5432/postgres' }),
    { code: 'forbidden_secret_shape' },
  );
  await assert.rejects(
    () => store.write('capsule_hashes', { hash: HASH, bytes: `PBASE${'A'.repeat(200)}` }),
    { code: 'forbidden_secret_shape' },
  );
  await assert.rejects(
    () => store.write('jobs', { type: 'dry-run', passphrase: 'please-do-not-store-this' }),
    { code: 'forbidden_secret_shape' },
  );
  await assert.rejects(
    () => store.write('capsule_hashes', { hash: `PBASE${'A'.repeat(200)}` }),
    { code: 'forbidden_secret_shape' },
  );
  await assert.rejects(
    () => store.write('capsule_hashes', { hash: 'not-a-hash' }),
    { code: 'capsule_hash_only' },
  );
  await assert.rejects(
    () => store.write('billing_metadata', { subscriber_id: 'sub_1', card_number: '4111111111111111' }),
    { code: 'forbidden_secret_shape' },
  );

  assert.ok(findForbiddenSecretLike());
  assert.equal(isCapsuleHash(HASH), true);
  assert.equal((await store.list('subscribers')).length, 0);
  assert.equal(store.outbox().length, 0);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function findForbiddenSecretLike() {
  assert.ok(findForbiddenField({ service_role: 'x' }));
  assert.ok(findForbiddenField({ key: 'sb_secret_abc' }));
  assert.ok(findForbiddenField('postgres://x:y@host/db'));
  assert.throws(() => assertAllowedRow('jobs', { type: 'dry-run', secret: 'nope' }), { code: 'forbidden_secret_shape' });
  return true;
}

test('primary adapter refuses the live business source as a write dest', () => {
  assert.throws(
    () => createSupabasePrimary({
      url: `https://${LIVE_BUSINESS_SOURCE_REF}.supabase.co`,
      serviceKey: 'not-used',
    }),
    { code: 'live_business_source_refused' },
  );
});

test('sql schemas do not define key or capsule-byte columns', () => {
  const sqlite = readFileSync(new URL('../cloud/control-plane/schema.sql', import.meta.url), 'utf8');
  const pg = readFileSync(new URL('../supabase/cloud/0003_essentials.sql', import.meta.url), 'utf8');
  for (const text of [sqlite, pg]) {
    assert.doesNotMatch(text, /passphrase/i);
    assert.doesNotMatch(text, /service_role/i);
    assert.doesNotMatch(text, /sb_secret/i);
    assert.doesNotMatch(text, /capsule_bytes/i);
    assert.doesNotMatch(text, /CREATE TABLE[\s\S]*:memory:/i);
    assert.match(text, /capsule_hash/);
  }
  assert.match(pg, /Do NOT apply to ekklokrukxmqlahtonnc/);
});
