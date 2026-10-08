import test from 'node:test';
import assert from 'node:assert/strict';
import { createCancellationHandler } from '../netlify/functions/cloud-cancel-subscription.mjs';

const now = Date.parse('2026-10-05T12:00:00Z');
const until = '2026-11-01T00:00:00.000Z';
const user = { id: 'owner', cloudVersion: 'supabase' };
function fixture(addon = false) {
  const f = { record: { userId: 'supabase:owner', checkoutAttempt: 'attempt', squareOrderId: 'order',
    squareSubscriptionId: 'base', ...(addon ? { squareAddonSubscriptionId: 'addon' } : {}),
    status: 'active', currentPeriodEnd: until, verifiedBy: 'square_api', squareVerifiedAt: new Date(now).toISOString(), revision: 1 },
    canceled: new Set(), calls: [], writes: [] };
  f.dependencies = { authenticate: async () => user, subscription: async () => structuredClone(f.record), clock: () => now,
    verify: async (record, { kind }) => ({ verified: true, patch: {
      squareSubscriptionId: kind === 'base' ? record.squareSubscriptionId : record.squareAddonSubscriptionId,
      status: 'active', currentPeriodEnd: until, verifiedBy: 'square_api', squareVerifiedAt: new Date(now).toISOString(),
      cancellationEffectiveAt: f.canceled.has(kind) ? until : null,
    } }),
    cancel: async id => { f.calls.push(id); f.canceled.add(id); },
    save: async record => { assert.equal(record.revision, f.record.revision); f.writes.push(record); return record; },
  };
  f.run = async (body = { confirm: true }) => {
    const response = await createCancellationHandler(f.dependencies)({ httpMethod: 'POST', body: JSON.stringify(body) });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  };
  return f;
}

test('cancellation uses owned base and add-on and preserves access until verified end', async () => {
  const f = fixture(true), result = await f.run();
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls, ['base', 'addon']);
  assert.equal(result.body.hasAccess, true);
  assert.equal(result.body.status, 'cancellation_scheduled');
  assert.equal(f.writes[0].addonCancellationEffectiveAt, until);
  assert.equal(result.body.cancellationEffectiveAt, until);
});

test('lost cancellation reply retries with provider readback without repeating mutation', async () => {
  const f = fixture();
  f.dependencies.cancel = async id => { f.calls.push(id); f.canceled.add(id); throw new Error('secret provider body'); };
  const first = await f.run();
  assert.equal(first.status, 503);
  assert.equal(first.body.providerMayHaveChanged, true);
  assert.ok(!JSON.stringify(first).includes('secret'));
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(f.calls, ['base']);
});

test('rejects foreign IDs, absent confirmation, unbound accounts and mismatched proofs', async () => {
  for (const body of [{}, { confirm: false }, { confirm: true, subscriptionId: 'foreign' }]) {
    const f = fixture(); assert.equal((await f.run(body)).status, 400); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.record.userId = 'supabase:foreign';
  assert.equal((await f.run()).status, 409); assert.equal(f.calls.length, 0);
  const g = fixture(); g.dependencies.verify = async () => ({ verified: true, patch: { squareSubscriptionId: 'foreign' } });
  assert.equal((await g.run()).status, 503); assert.equal(g.calls.length, 0);
});

test('provider success without confirmed cancellation cannot become local success', async () => {
  const f = fixture(); f.dependencies.cancel = async id => { f.calls.push(id); };
  assert.equal((await f.run()).status, 503); assert.equal(f.writes.length, 0);
});

test('replacement checkout during provider operation is never overwritten', async () => {
  const f = fixture(); f.dependencies.cancel = async id => {
    f.canceled.add(id); f.record = { ...f.record, checkoutAttempt: 'replacement', squareSubscriptionId: 'new' };
  };
  assert.equal((await f.run()).status, 503); assert.equal(f.writes.length, 0);
});

test('concurrent revision change leaves reconciliation pending and no raw error escapes', async () => {
  const f = fixture(); f.dependencies.save = async () => { throw new Error('secret blob path'); };
  const result = await f.run(); assert.equal(result.status, 503);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('authentication failure never reads billing or calls Square', async () => {
  const f = fixture(); f.dependencies.authenticate = async () => { throw new Error('invalid'); };
  f.dependencies.subscription = async () => assert.fail('read billing');
  assert.equal((await f.run()).status, 401); assert.equal(f.calls.length, 0);
});
