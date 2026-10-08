import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { cloudBackupCliCommand, describeCloudApiError } from '../src/lib/table-sizer.js';

test('cloudBackupCliCommand omits flags with empty lists', () => {
  assert.equal(cloudBackupCliCommand({}), 'npx portabase backup');
  assert.equal(cloudBackupCliCommand({ excludeTables: [], excludeBuckets: [] }), 'npx portabase backup');
});

test('cloudBackupCliCommand adds --exclude-table-data only', () => {
  const cmd = cloudBackupCliCommand({ excludeTables: ['public.big_logs', 'public.events'] });
  assert.equal(cmd, 'npx portabase backup --exclude-table-data public.big_logs,public.events');
});

test('cloudBackupCliCommand adds --exclude-buckets only', () => {
  const cmd = cloudBackupCliCommand({ excludeBuckets: ['videos', 'raw-media'] });
  assert.equal(cmd, 'npx portabase backup --exclude-buckets videos,raw-media');
});

test('cloudBackupCliCommand combines both flags in order', () => {
  const cmd = cloudBackupCliCommand({
    excludeTables: [{ key: 'a.b' }, 'c.d'],
    excludeBuckets: ['x', { key: 'y' }],
  });
  assert.equal(cmd, 'npx portabase backup --exclude-table-data a.b,c.d --exclude-buckets x,y');
});

test('cloudBackupCliCommand drops secret-shaped or empty names', () => {
  const cmd = cloudBackupCliCommand({ excludeTables: ['public.passphrase', '', 'public.ok_table'] });
  assert.equal(cmd, 'npx portabase backup --exclude-table-data public.ok_table');
});

test('describeCloudApiError maps known safe codes to plain language', () => {
  assert.match(describeCloudApiError({ status: 400, data: { error: 'token_rejected' } }), /didn.t work/i);
  assert.match(describeCloudApiError({ status: 429, data: { error: 'rate_limited' } }), /rate-limiting/i);
  assert.match(describeCloudApiError({ status: 404, data: { error: 'project_not_found' } }), /could not be found/i);
  assert.match(describeCloudApiError({ status: 401 }), /sign in again/i);
  assert.match(describeCloudApiError({}), /network error/i);
});

test('describeCloudApiError falls back to the error message for unknown codes', () => {
  const err = new Error('boom');
  err.status = 500;
  err.data = { error: 'weird_code' };
  assert.equal(describeCloudApiError(err), 'boom');
});

// The rendered account flow is covered by check-private-source-boundary.mjs.
// Load the actual browser module with Vite so import.meta.env uses its real transform.
test('retired browser API helpers reject before private serialization or network', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  try {
    const api = await server.ssrLoadModule('/src/lib/cloud-api.js');
    globalThis.fetch = () => assert.fail('retired source setup must not request a session or backend');
    const privateValue = { toJSON() { assert.fail('private input must not be serialized'); } };
    for (const name of ['fetchSupabaseProjects', 'fetchSupabaseInventory', 'fetchCloudSelection', 'saveCloudSelection']) {
      await assert.rejects(api[name](privateValue, privateValue), { status: 410, code: 'private_runner_setup_required' });
    }
  } finally { globalThis.fetch = originalFetch; await server.close(); }
});
