import test from 'node:test';
import assert from 'node:assert/strict';
import { getSubscriptionForUser } from '../netlify/shared/subscription-store.mjs';

test('identical provider subject IDs never share a billing record or use legacy fallback', async () => {
  const keys = [];
  const rows = { 'same-id': { userId: 'same-id', status: 'active' }, 'supabase:same-id': { userId: 'supabase:same-id', status: 'active' } };
  const lookup = async key => { keys.push(key); return rows[key] || null; };
  assert.equal((await getSubscriptionForUser({ cloudVersion: 'supabase', id: 'same-id' }, lookup)).userId, 'supabase:same-id');
  assert.equal(await getSubscriptionForUser({ cloudVersion: 'aws', id: 'same-id' }, lookup), null);
  assert.deepEqual(keys, ['supabase:same-id', 'aws:same-id']);
});
test('invalid identities, corrupt ownership and storage failures fail closed', async () => {
  await assert.rejects(getSubscriptionForUser({ cloudVersion: 'supabase', id: 'alice' }, async () => ({ userId: 'supabase:bob' })), /identity_mismatch/);
  for (const user of [null, { id: 'alice' }, { cloudVersion: 'supabase', id: ['alice'] }]) await assert.rejects(getSubscriptionForUser(user, async () => { throw new Error('must_not_lookup'); }), /invalid_subscription_identity/);
  await assert.rejects(getSubscriptionForUser({ cloudVersion: 'supabase', id: 'alice' }, async () => { throw new Error('store_down'); }), /store_down/);
});
