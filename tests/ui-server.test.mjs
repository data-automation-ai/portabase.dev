import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { STATIC_FILES, UI_CSP, UI_HOST, startUiServer } from '../utility/ui/server.mjs';
import { buildChecklist, classifyTable, schemaMatches } from '../utility/ui/checklist.mjs';

const STATIC = new URL('../utility/ui/static/', import.meta.url);

function get(port, path, { host = `${UI_HOST}:${port}`, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: UI_HOST, port, path, method, headers: { Host: host, ...headers } }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(collect, fn) {
  const session = await startUiServer({ collect });
  try { await fn(session); } finally { await session.close(); }
}

const fakeSnapshot = async () => ({ ok: true, generatedAt: new Date().toISOString() });

test('ui server listens on the loopback address only', async () => {
  await withServer(fakeSnapshot, async ({ address, url }) => {
    assert.equal(address.address, '127.0.0.1');
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/#t=[0-9a-f]{48}$/);
  });
});

test('every response carries the strict CSP: network calls to self only', async () => {
  assert.match(UI_CSP, /default-src 'none'/);
  assert.match(UI_CSP, /connect-src 'self'(;|$)/);
  assert.doesNotMatch(UI_CSP, /unsafe-inline|unsafe-eval|https?:|\*/);
  await withServer(fakeSnapshot, async ({ address, token }) => {
    for (const path of [...Object.keys(STATIC_FILES), '/api/snapshot', '/nope']) {
      const res = await get(address.port, path, { headers: { 'X-Portabase-Session': token } });
      assert.equal(res.headers['content-security-policy'], UI_CSP, path);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['cache-control'], 'no-store');
    }
  });
});

test('snapshot requires the per-launch session token', async () => {
  await withServer(fakeSnapshot, async ({ address, token }) => {
    assert.equal((await get(address.port, '/api/snapshot')).status, 401);
    assert.equal((await get(address.port, '/api/snapshot', { headers: { 'X-Portabase-Session': 'f'.repeat(48) } })).status, 401);
    const ok = await get(address.port, '/api/snapshot', { headers: { 'X-Portabase-Session': token } });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).ok, true);
  });
});

test('non-loopback Host headers are refused (DNS rebinding)', async () => {
  await withServer(fakeSnapshot, async ({ address, token }) => {
    const res = await get(address.port, '/api/snapshot', { host: `evil.example:${address.port}`, headers: { 'X-Portabase-Session': token } });
    assert.equal(res.status, 421);
    assert.equal((await get(address.port, '/', { host: 'evil.example' })).status, 421);
    assert.equal((await get(address.port, '/', { host: `localhost:${address.port}` })).status, 200);
  });
});

test('cross-origin requests and writes are refused', async () => {
  await withServer(fakeSnapshot, async ({ address, token }) => {
    const cross = await get(address.port, '/api/snapshot', { headers: { Origin: 'https://evil.example', 'X-Portabase-Session': token } });
    assert.equal(cross.status, 403);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      assert.equal((await get(address.port, '/api/snapshot', { method, headers: { 'X-Portabase-Session': token } })).status, 405, method);
    }
  });
});

test('refresh re-collects; plain loads reuse the snapshot', async () => {
  let calls = 0;
  await withServer(async () => ({ calls: ++calls }), async ({ address, token }) => {
    const headers = { 'X-Portabase-Session': token };
    assert.equal(JSON.parse((await get(address.port, '/api/snapshot', { headers })).body).calls, 1);
    assert.equal(JSON.parse((await get(address.port, '/api/snapshot', { headers })).body).calls, 1);
    assert.equal(JSON.parse((await get(address.port, '/api/snapshot?refresh=1', { headers })).body).calls, 2);
  });
});

test('static page references no external origin and runs no inline code', async () => {
  const html = await readFile(new URL('index.html', STATIC), 'utf8');
  const js = await readFile(new URL('app.js', STATIC), 'utf8');
  const css = await readFile(new URL('app.css', STATIC), 'utf8');
  for (const [name, text] of [['index.html', html], ['app.js', js], ['app.css', css]]) {
    assert.doesNotMatch(text, /https?:\/\//, `${name} must not reference an absolute URL`);
    assert.doesNotMatch(text, /\/\/[a-z0-9-]+\.[a-z]{2,}\//i, `${name} must not reference a protocol-relative URL`);
  }
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, 'no inline <script> blocks');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handlers');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'no inline styles');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, 'API data is never parsed as HTML or code');
  const targets = [...js.matchAll(/fetch\(\s*([`'"])([^`'"]*)/g)].map(m => m[2]);
  assert.ok(targets.length > 0);
  for (const target of targets) assert.match(target, /^\/api\//, 'fetch targets are same-origin paths');
  assert.doesNotMatch(js, /XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/);
});

test('snapshot never contains credential values', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_DB_URL: 'postgresql://postgres:SENTINEL_DB_PASSWORD@127.0.0.1:1/postgres',
    SUPABASE_URL: 'http://127.0.0.1:1',
    SUPABASE_SERVICE_ROLE_KEY: 'SENTINEL_SERVICE_ROLE_KEY',
    PORTABASE_ENCRYPTION_PASSPHRASE: 'SENTINEL_PASSPHRASE_1234567890',
  });
  delete process.env.SUPABASE_ACCESS_TOKEN;
  try {
    const { collectUiSnapshot } = await import('../utility/portabase.mjs');
    const snapshot = await collectUiSnapshot({ projectRef: 'abcdefghijklmnopqrst', provider: { type: 'local' } }, false);
    const text = JSON.stringify(snapshot);
    assert.doesNotMatch(text, /SENTINEL/);
    assert.equal(snapshot.readiness.env.SUPABASE_SERVICE_ROLE_KEY, true);
    assert.equal(snapshot.readiness.env.passphrase, true);
    assert.equal(snapshot.functions.ok, false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('schemaMatches follows pg_dump wildcard semantics', () => {
  assert.ok(schemaMatches('pg_catalog', ['pg_*']));
  assert.ok(schemaMatches('auth', ['auth']));
  assert.ok(!schemaMatches('authors', ['auth']));
  assert.ok(!schemaMatches('public', ['pg_*', 'auth']));
  assert.ok(schemaMatches('_timescaledb_internal', ['_timescaledb_*']));
});

test('classifyTable mirrors the backup pg_dump exclusions', () => {
  assert.deepEqual(Object.values(classifyTable('public', 'orders')).map(v => v.keep), [true, true]);
  assert.deepEqual(Object.values(classifyTable('auth', 'users')).map(v => v.keep), [false, true]);
  assert.deepEqual(Object.values(classifyTable('auth', 'schema_migrations')).map(v => v.keep), [false, false]);
  assert.deepEqual(Object.values(classifyTable('storage', 'objects')).map(v => v.keep), [false, false]);
  assert.deepEqual(Object.values(classifyTable('public', 'orders', { trial: true })).map(v => v.keep), [true, false]);
});

test('backup uses the shared data-table exclusion list', async () => {
  const cli = await readFile(new URL('../utility/portabase.mjs', import.meta.url), 'utf8');
  assert.match(cli, /DATA_TABLE_EXCLUDES\.flatMap/);
  assert.doesNotMatch(cli, /'--exclude-table', 'auth\.schema_migrations'/);
});

const READY = {
  env: { SUPABASE_DB_URL: true, SUPABASE_URL: true, SUPABASE_SERVICE_ROLE_KEY: true, SUPABASE_ACCESS_TOKEN: true, passphrase: true },
  tools: { pg_dump: true, pg_dumpall: true, psql: true, supabase: true, tar: true },
};
const DB = { ok: true, data: { tables: [
  { schema: 'public', name: 'orders', bytes: 1000 },
  { schema: 'auth', name: 'users', bytes: 500 },
  { schema: 'storage', name: 'objects', bytes: 9000 },
] } };
const find = (checklist, name) => checklist.items.find(entry => entry.name === name);

test('checklist: fully ready project keeps every layer', () => {
  const checklist = buildChecklist({
    config: { provider: { type: 'aws' } }, readiness: READY, database: DB,
    storage: { ok: true, data: { buckets: [{ id: 'avatars', objectCount: 3, totalBytes: 2048 }] } },
    functions: { ok: true, data: [{ slug: 'hello' }] },
  });
  assert.equal(checklist.counts.BLOCKED, undefined);
  assert.equal(find(checklist, 'Table rows').bytes, 1500);
  assert.equal(find(checklist, 'Bucket avatars').status, 'KEEP');
  assert.equal(find(checklist, 'Function hello').status, 'KEEP');
  assert.equal(find(checklist, 'Auth users').status, 'KEEP');
  assert.ok(checklist.items.some(entry => entry.status === 'NEVER' && /JWT/.test(entry.name)));
});

test('checklist: missing prerequisites are BLOCKED, disabled layers are SKIP', () => {
  const checklist = buildChecklist({
    config: { provider: { type: 'aws' }, capture: { storage: false } },
    readiness: { env: { ...READY.env, SUPABASE_ACCESS_TOKEN: false, passphrase: false }, tools: READY.tools },
    database: DB,
  });
  assert.equal(find(checklist, 'Edge Functions').status, 'BLOCKED');
  assert.equal(find(checklist, 'Storage objects').status, 'SKIP');
  assert.equal(find(checklist, 'Encryption').status, 'BLOCKED');
});

test('checklist: trial limits match TRIAL_LIMITS', () => {
  const checklist = buildChecklist({
    config: { provider: { type: 'aws' } }, trial: true, readiness: READY, database: DB,
    storage: { ok: true, data: { buckets: [
      { id: 'a', objectCount: 10, totalBytes: 1 }, { id: 'b', objectCount: 1, totalBytes: 1 }, { id: 'c', objectCount: 1, totalBytes: 1 },
    ] } },
    functions: { ok: true, data: [{ slug: 'f1' }, { slug: 'f2' }, { slug: 'f3' }] },
  });
  assert.equal(find(checklist, 'Table rows').status, 'SKIP');
  assert.equal(find(checklist, 'Bucket a').status, 'PARTIAL');
  assert.equal(find(checklist, 'Bucket b').status, 'KEEP');
  assert.equal(find(checklist, 'Bucket c').status, 'SKIP');
  assert.equal(find(checklist, 'Function f3').status, 'SKIP');
});

test('checklist: Local Starter over the cap is BLOCKED', () => {
  const checklist = buildChecklist({
    config: { provider: { type: 'local' } }, readiness: READY,
    database: { ok: true, data: { tables: [{ schema: 'public', name: 'big', bytes: 200 * 1024 * 1024 }] } },
  });
  assert.equal(find(checklist, 'Local Starter size cap').status, 'BLOCKED');
});
