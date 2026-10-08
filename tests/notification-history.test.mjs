import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationHistoryHandler } from '../netlify/functions/cloud-notification-history.mjs';
import { ownerKey } from '../netlify/shared/agent-store.mjs';
const user = { id: 'alice', cloudVersion: 'supabase' }, owner = ownerKey(user), eventId = 'a'.repeat(64);
const path = `owners/${owner}/outbox/${eventId}/email`;
const record = { owner, eventId, channel: 'email', eventType: 'backup.failed', state: 'accepted', deliveryStatus: 'delivered', createdAt: '2026-10-04T12:00:00Z', address: 'private-email', payload: { secret: 'private-data' } };
function handler(store) { return createNotificationHistoryHandler({ authenticate: async () => user, storeFactory: () => store }); }
test('history is owner-scoped and exposes safe statuses without private records', async () => {
  const response = await handler({ async *list({ prefix }) { assert.equal(prefix, `owners/${owner}/outbox/`); yield { blobs: [{ key: path }] }; }, get: async () => record })({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.ok(!response.body.includes('private-'));
  const body = JSON.parse(response.body);
  assert.equal(body.deliveries[0].state, 'accepted');
  assert.equal(body.deliveries[0].deliveryStatus, 'delivered');
  assert.equal(body.truncated, false);
});
test('foreign keys, corrupt owner records and storage outages never become empty success', async () => {
  for (const store of [
    { async *list() { yield { blobs: [{ key: 'owners/foreign/outbox/x/email' }] }; } },
    { async *list() { yield { blobs: [{ key: path }] }; }, get: async () => ({ ...record, owner: 'foreign' }) },
    { async *list() { throw new Error('private-store-error'); } },
  ]) {
    const response = await handler(store)({ httpMethod: 'GET' });
    assert.equal(response.statusCode, 503);
    assert.ok(!response.body.includes('private'));
  }
});
test('a capped history explicitly reports incomplete results', async () => {
  const rows = new Map(Array.from({ length: 501 }, (_, i) => { const id = i.toString(16).padStart(64, '0'); return [`owners/${owner}/outbox/${id}/email`, { ...record, eventId: id }]; }));
  let reads = 0;
  const response = await handler({ async *list() { yield { blobs: [...rows.keys()].map(key => ({ key })) }; }, get: async key => { reads++; return rows.get(key); } })({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).truncated, true);
  assert.equal(JSON.parse(response.body).deliveries.length, 100);
  assert.equal(reads, 500);
});
test('permanent provider rejection remains readable without claiming a delivery receipt', async () => {
  const rejected = { ...record, state: 'rejected', deliveryStatus: null, reason: 'provider_rejected' };
  const response = await handler({ async *list() { yield { blobs: [{ key: path }] }; }, get: async () => rejected })({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.deliveries[0].state, 'rejected');
  assert.equal(body.deliveries[0].deliveryStatus, null);
  assert.equal(body.deliveries[0].reason, undefined);
  assert.ok(!response.body.includes('private-'));
});
