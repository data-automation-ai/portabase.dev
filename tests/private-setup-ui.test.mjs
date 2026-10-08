import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startUiServer } from '../utility/ui/server.mjs';
import { resolvePrivateJob } from '../cloud/runner/private-config.mjs';
import { engineArgvForJob } from '../cloud/runner/worker.mjs';
import { createPrivateSetup } from '../utility/ui/private-setup.mjs';

const runnerId = '11111111-1111-4111-8111-111111111111', projectRef = 'abcdefghijklmnopqrst';
function snapshot() { return { project: { ref: projectRef }, database: { ok: true, data: { tables: [
  { schema: 'public', name: 'orders', bytes: 100, capsule: 'structure + rows' },
  { schema: 'public', name: 'logs', bytes: 200, capsule: 'structure + rows' },
] } }, storage: { ok: true, data: { buckets: [{ id: 'photos', totalBytes: 400, objectCount: 2 }] } } }; }
async function fixture() {
  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const directory = await mkdtemp(join(tmpdir(), 'portabase-setup-ui-test-'));
  const config = { projectRef, provider: { type: 's3', bucket: 'synthetic' }, backupDirectory: 'capsules', statusDirectory: 'status' };
  await writeFile(join(directory, 'engine.json'), JSON.stringify(config));
  const options = { directory, runnerId, projectRef, engineConfigPath: 'engine.json' };
  return { directory, config, options };
}
function call(server, path, { method = 'GET', body, headers = {}, host } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port: server.address.port, path, method,
      headers: { ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}),
        'X-Portabase-Session': server.token, ...(host ? { Host: host } : {}), ...headers } }, response => {
      let data = ''; response.on('data', chunk => { data += chunk; });
      response.on('end', () => { let json; try { json = JSON.parse(data); } catch { /* static asset */ }
        resolve({ status: response.statusCode, headers: response.headers, json, data }); });
    });
    req.on('error', reject); req.end(bytes);
  });
}
const selection = inventory => ({ inventoryRevision: inventory.inventoryRevision, selectedTables: ['public.orders'], selectedBuckets: [], incrementalBinary: false, confirmEmpty: false });
const headersFor = (server, inventory) => ({ Origin: `http://127.0.0.1:${server.address.port}`, 'X-Portabase-CSRF': inventory.csrf });

test('private setup preserves loopback/Host/Origin/session/CSP boundaries and requires CSRF for writes', async () => {
  const f = await fixture(); const server = await startUiServer({ privateSetup: f.options, collect: async () => snapshot() });
  try {
    assert.equal(server.address.address, '127.0.0.1');
    const index = await call(server, '/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-security-policy'], /connect-src 'self'/);
    assert.match(index.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(index.headers['cache-control'], 'no-store');
    assert.equal(index.data.includes(server.token), false);
    assert.equal((await call(server, '/api/setup', { host: 'evil.example' })).status, 421);
    assert.equal((await call(server, '/api/setup', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call(server, '/api/setup', { headers: { 'X-Portabase-Session': '' } })).status, 401);
    const inventory = (await call(server, '/api/setup')).json;
    const body = selection(inventory), headers = headersFor(server, inventory);
    assert.equal((await call(server, '/api/configurations', { method: 'POST', body })).status, 403);
    assert.equal((await call(server, '/api/configurations', { method: 'POST', body, headers: { ...headers, 'X-Portabase-CSRF': 'wrong' } })).status, 403);
    assert.equal((await call(server, '/api/configurations', { method: 'POST', body, headers: { ...headers, Origin: 'null' } })).status, 403);
    assert.equal((await call(server, '/api/configurations', { method: 'POST', body, headers: { ...headers, 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await call(server, '/api/configurations', { method: 'POST', body: ' '.repeat(256 * 1024 + 1), headers })).status, 413);
    assert.deepEqual((await readdir(f.directory)).sort(), ['engine.json', 'runner-state.sqlite', 'runner-state.sqlite-shm', 'runner-state.sqlite-wal'].sort());
  } finally { await server.close(); }
});

test('authenticated private save writes immutable reference and exact exclusions usable by resolver', async () => {
  const f = await fixture(); const server = await startUiServer({ privateSetup: f.options, collect: async () => snapshot() });
  try {
    const inventory = (await call(server, '/api/setup')).json;
    const options = { method: 'POST', body: selection(inventory), headers: headersFor(server, inventory) };
    const results = await Promise.all([call(server, '/api/configurations', options), call(server, '/api/configurations', options)]);
    assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
    const saved = results.find(row => row.status === 201).json;
    assert.doesNotMatch(JSON.stringify(saved), /public.orders|public.logs|photos|engineConfig/);
    const { type, ...payload } = saved.intent;
    const resolved = await resolvePrivateJob({ type, payload }, f.options);
    assert.deepEqual(resolved.job.payload.excludeTables, ['public.logs']);
    assert.deepEqual(resolved.job.payload.excludeBuckets, ['photos']);
    const argv = engineArgvForJob(resolved.job, resolved);
    assert.equal(argv[argv.indexOf('--exclude-table-data') + 1], 'public.logs');
    assert.equal(argv[argv.indexOf('--exclude-buckets') + 1], 'photos');
    assert.equal(argv[argv.indexOf('--config') + 1], resolved.configPath);
    const firstBytes = await readFile(join(f.directory, payload.configRef, '1.json'), 'utf8');
    const refreshed = (await call(server, '/api/setup')).json;
    const second = await call(server, '/api/configurations', { method: 'POST', body: selection(refreshed), headers: headersFor(server, refreshed) });
    assert.equal(second.status, 201);
    assert.notEqual(second.json.intent.configRef, payload.configRef);
    assert.equal(await readFile(join(f.directory, payload.configRef, '1.json'), 'utf8'), firstBytes);
  } finally { await server.close(); }
});

test('failed refresh invalidates prior selection; changed engine settings cannot reuse inspected inventory', async () => {
  const f = await fixture(); let fail = false;
  const setup = await createPrivateSetup({ ...f.options, collect: async () => { if (fail) throw new Error('private-provider-diagnostic'); return snapshot(); } });
  const old = await setup.inspect(); fail = true;
  await assert.rejects(setup.inspect(), { code: 'inventory_unavailable' });
  await assert.rejects(setup.save(selection(old)), { code: 'inventory_changed' });
  fail = false; const fresh = await setup.inspect();
  await writeFile(join(f.directory, 'engine.json'), JSON.stringify({ ...f.config, capture: { database: false } }));
  await assert.rejects(setup.save(selection(fresh)), { code: 'inventory_changed' });
  assert.deepEqual(await readdir(f.directory), ['engine.json']);
});

test('collector receives the exact validated config for each inspection', async () => {
  const f = await fixture(); const seen = [];
  const setup = await createPrivateSetup({ ...f.options, collect: async config => { seen.push(config.capture); return snapshot(); } });
  await setup.inspect();
  await writeFile(join(f.directory, 'engine.json'), JSON.stringify({ ...f.config, capture: { auth: false } }));
  const inventory = await setup.inspect();
  assert.deepEqual(seen, [undefined, { auth: false }]);
  const saved = await setup.save(selection(inventory));
  const config = JSON.parse(await readFile(join(f.directory, saved.intent.configRef, 'engine-1.json'), 'utf8'));
  assert.deepEqual(config.capture, { auth: false });
});

test('incomplete, oversized and malformed inventories cannot authorize saves', async () => {
  const f = await fixture();
  for (const mutate of [s => { s.database.ok = false; }, s => { s.storage.ok = false; },
    s => { s.database.data.tables[0].bytes = -1; }, s => { s.database.data.tables.push(s.database.data.tables[0]); },
    s => { s.storage.data.buckets[0].objectCount = '2'; }, s => { s.database.data.tables = Array(5001).fill(s.database.data.tables[0]); }]) {
    const data = snapshot(); mutate(data);
    const setup = await createPrivateSetup({ ...f.options, collect: async () => data });
    await assert.rejects(setup.inspect(), { code: 'inventory_unavailable' });
  }
  assert.deepEqual(await readdir(f.directory), ['engine.json']);
});

test('unknown selections, private fields and unconfirmed empty selections fail without writes', async () => {
  const f = await fixture(); const setup = await createPrivateSetup({ ...f.options, collect: async () => snapshot() });
  const inventory = await setup.inspect();
  for (const patch of [{ selectedTables: ['public.foreign'] }, { selectedTables: ['public.orders', 'public.orders'] },
    { passphrase: 'synthetic-only' }, { configRef: 'chosen-by-browser' }, { incrementalBinary: 'true' }]) {
    await assert.rejects(setup.save({ ...selection(inventory), ...patch }), { code: 'invalid_selection' });
  }
  await assert.rejects(setup.save({ ...selection(inventory), selectedTables: [] }), { code: 'empty_selection_confirmation_required' });
  const saved = await setup.save({ ...selection(inventory), selectedTables: [], confirmEmpty: true });
  assert.equal(saved.saved, true);
  const record = JSON.parse(await readFile(join(f.directory, saved.intent.configRef, '1.json'), 'utf8'));
  assert.deepEqual(record.excludeTables, ['public.orders', 'public.logs']);
});

test('explicit private mode refuses missing root and F without starting a server', async () => {
  for (const directory of [undefined, 'F:/forbidden', 'F:\\forbidden']) {
    await assert.rejects(startUiServer({ privateSetup: { directory, runnerId, projectRef, engineConfigPath: 'engine.json' }, collect: async () => snapshot() }));
  }
});
