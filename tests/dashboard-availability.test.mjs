import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardHandler } from '../netlify/functions/cloud-dashboard.mjs';
const user = { id: 'alice', cloudVersion: 'supabase' };
const setup = overrides => createDashboardHandler({ authenticate: async () => user, jobsDatabase: () => ({ get: async () => [] }), subscription: async () => null, squareStatus: () => ({ ready: false }), ...overrides });

test('dashboard outages and corrupt records do not become empty success', async () => {
  for (const overrides of [
    { jobsDatabase: () => ({ get: async () => { throw new Error('private details'); } }) },
    { jobsDatabase: () => ({ get: async () => ({ invalid: true }) }) },
    { subscription: async () => { throw new Error('private billing details'); } },
  ]) {
    const response = await setup(overrides)({ httpMethod: 'GET' });
    assert.equal(response.statusCode, 503);
    assert.ok(!response.body.includes('private'));
  }
});
test('dashboard reads only the signed-in account and rejects status-only add-on claims', async () => {
  const keys = [];
  const response = await setup({ jobsDatabase: () => ({ get: async key => { keys.push(key); return []; } }),
    subscription: async () => ({ userId: 'supabase:alice', status: 'active', plan: 'cloud-17', extraTransfersAddon: true }),
  })({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.access.hasAccess, false);
  assert.equal(data.subscription.extraTransfersAddon, false);
  assert.deepEqual(keys, ['jobs:supabase:alice']);
});
