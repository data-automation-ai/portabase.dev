import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationPreferencesHandler } from '../netlify/functions/cloud-notification-preferences.mjs';

function setup() {
  const records = new Map();
  const store = {
    async getWithMetadata(key) { return records.get(key) || null; },
    async setJSON(key, data, options) {
      const old = records.get(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && old?.etag !== options.onlyIfMatch)) return { modified: false };
      records.set(key, { data: structuredClone(data), etag: String(data.revision) });
      return { modified: true };
    },
  };
  const handler = createNotificationPreferencesHandler({ authenticate: async e => {
    if (!e.user) throw new Error();
    return { id: e.user, cloudVersion: 'supabase' };
  }, storeFactory: () => store });
  return { handler, records };
}
const preferences = { email: { onFailure: true, onSuccess: false }, sms: { onFailure: false, onSuccess: false } };
const put = (user, revision = 0, extra = {}) => ({ user, httpMethod: 'PUT', body: JSON.stringify({ revision, preferences, ...extra }) });

test('preferences default off and remain isolated by verified customer', async () => {
  const { handler } = setup();
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 401);
  assert.equal((await handler(put('alice'))).statusCode, 200);
  const alice = JSON.parse((await handler({ user: 'alice', httpMethod: 'GET' })).body);
  const bob = JSON.parse((await handler({ user: 'bob', httpMethod: 'GET' })).body);
  assert.equal(alice.preferences.email.onFailure, true);
  assert.equal(bob.preferences.email.onFailure, false);
  assert.equal(alice.deliveryConfigured, false);
  assert.equal((await handler(put('bob', 0, { owner: 'alice' }))).statusCode, 400);
});
test('concurrent updates cannot silently overwrite consent changes', async () => {
  const { handler } = setup();
  const responses = await Promise.all([handler(put('alice')), handler(put('alice'))]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal((await handler(put('alice'))).statusCode, 409);
});
test('unexpected private content and coerced booleans are rejected', async () => {
  const { handler, records } = setup();
  for (const value of [{ ...preferences, manifest: 'secret' }, { ...preferences, sms: { onFailure: 'true', onSuccess: false } }]) {
    assert.equal((await handler(put('alice', 0, { preferences: value }))).statusCode, 400);
  }
  assert.equal(records.size, 0);
});
test('storage failure does not report an empty or saved configuration', async () => {
  const handler = createNotificationPreferencesHandler({ authenticate: async () => ({ id: 'alice', cloudVersion: 'supabase' }), storeFactory: () => { throw new Error('sensitive provider error'); } });
  for (const event of [{ httpMethod: 'GET' }, put('alice')]) {
    const response = await handler(event);
    assert.equal(response.statusCode, 503);
    assert.ok(!response.body.includes('sensitive'));
  }
});
