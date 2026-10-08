import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeHandler } from '../netlify/functions/cloud-me.mjs';
import { CLOUD_FREE, CLOUD_PLANS } from '../netlify/shared/product.mjs';
import { planTransfersPer24h } from '../src/lib/product.js';

const now = Date.now();
const before = new Date(now - 60_000).toISOString(), after = new Date(now + 86_400_000).toISOString();
const user = { id: 'account-fixture', cloudVersion: 'supabase' };
const config = { trialDays: 7, priceMonthlyCents: 1700, versions: { supabase: { available: true }, aws: { available: false } } };
const verified = { userId: 'supabase:account-fixture', status: 'active', plan: 'cloud-7', verifiedBy: 'square_api', squareSubscriptionId: 'verified-base', squareVerifiedAt: before, currentPeriodEnd: after };
const addon = { extraTransfersAddon: true, addonStatus: 'active', addonVerifiedBy: 'square_api', squareAddonSubscriptionId: 'verified-addon', addonVerifiedAt: before, addonCurrentPeriodEnd: after };
const poisoned = { storageCapGb: 999, cyclesPerDay: 99, transfersPer24h: 99, planId: 'cloud-37' };
async function read(record) {
  const handler = createMeHandler({ authenticate: async () => user, subscription: async actual => { assert.deepEqual(actual, user); return record; },
    authConfig: async () => config, squareStatus: () => ({ ready: false }), clock: () => now });
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body);
}
test('verified paid plans use their own quotas rather than stored overrides or a default plan', async () => {
  for (const id of ['cloud-7', 'cloud-17', 'cloud-37']) {
    const { subscription: sub } = await read({ ...verified, ...poisoned, plan: id });
    const plan = CLOUD_PLANS[id];
    assert.equal(sub.plan, id); assert.equal(sub.planId, id); assert.equal(sub.billingPlan, id);
    assert.equal(sub.storageCapGb, plan.storageCapGb); assert.equal(sub.storageCapBytes, plan.storageCapBytes);
    assert.equal(sub.transfersPer24h, plan.transfersPer24h);
    assert.equal(sub.scheduledTransfersPer24h, plan.transfersPer24h);
    assert.equal(sub.cyclesPerDay, plan.transfersPer24h); assert.equal(sub.scheduled, true);
    assert.equal(sub.priceMonthlyCents, plan.priceMonthlyCents);
  }
});
test('unverified, expired and canceled base subscriptions retain only free manual admission', async () => {
  for (const patch of [{ verifiedBy: 'browser' }, { currentPeriodEnd: before }, { status: 'canceled' }, { plan: 'unknown-plan' }, { squareVerifiedAt: after }]) {
    const record = { ...verified, ...poisoned, ...addon, priceMonthlyCents: 700, ...patch };
    const { subscription: sub } = await read(record);
    assert.equal(sub.plan, CLOUD_FREE.id); assert.equal(sub.planId, CLOUD_FREE.id);
    assert.equal(sub.billingPlan, record.plan); assert.equal(sub.squareSubscriptionId, record.squareSubscriptionId);
    assert.equal(sub.priceMonthlyCents, 700); assert.equal(sub.hasBillingRecord, true);
    assert.equal(sub.storageCapGb, CLOUD_FREE.storageCapGb); assert.equal(sub.extraTransfersAddon, false);
    assert.equal(sub.transfersPer24h, 1); assert.equal(sub.scheduledTransfersPer24h, 0);
    assert.equal(sub.cyclesPerDay, 0); assert.equal(sub.scheduled, false);
  }
});
test('no billing record returns explicit free quotas instead of retaining cached paid settings', async () => {
  const { subscription: sub, access } = await read(null);
  assert.equal(access.hasAccess, false); assert.equal(sub.status, 'none'); assert.equal(sub.billingPlan, null);
  assert.equal(sub.hasBillingRecord, false); assert.equal(sub.plan, 'cloud-free'); assert.equal(sub.planId, 'cloud-free');
  assert.equal(sub.transfersPer24h, 1); assert.equal(sub.scheduledTransfersPer24h, 0); assert.equal(sub.priceMonthlyCents, 0);
});
test('add-on requires current verified ownership and cannot override an expired base subscription', async () => {
  for (const patch of [{ addonVerifiedBy: null }, { addonVerifiedAt: after }, { addonStatus: 'canceled' }, { addonCurrentPeriodEnd: before }, { squareAddonSubscriptionId: null }]) {
    const { subscription: sub } = await read({ ...verified, ...addon, ...patch });
    assert.equal(sub.extraTransfersAddon, false); assert.equal(sub.transfersPer24h, 1); assert.equal(sub.cyclesPerDay, 1);
  }
  const { subscription: active } = await read({ ...verified, ...addon });
  assert.equal(active.extraTransfersAddon, true); assert.equal(active.transfersPer24h, 3); assert.equal(active.cyclesPerDay, 3);
  assert.equal(active.storageCapGb, CLOUD_PLANS['cloud-7'].storageCapGb);
});
test('legacy billed plan identity is preserved separately from normalized admission', async () => {
  const { subscription: sub } = await read({ ...verified, plan: 'cloud-27' });
  assert.equal(sub.billingPlan, 'cloud-27'); assert.equal(sub.plan, 'cloud-17'); assert.equal(sub.transfersPer24h, 3);
});
test('client transfer quotas explicitly preserve free manual access without accepting an add-on', () => {
  assert.equal(planTransfersPer24h('cloud-free'), 1);
  assert.equal(planTransfersPer24h('cloud-free', { extraTransfersAddon: true }), 1);
  assert.equal(planTransfersPer24h('cloud-7'), 1);
  assert.equal(planTransfersPer24h('cloud-17'), 3);
  assert.equal(planTransfersPer24h('cloud-7', { extraTransfersAddon: true }), 3);
});
test('authentication failure and subscription outage do not produce effective quota success', async () => {
  const auth = createMeHandler({ authenticate: async () => { throw new Error('invalid_token'); } });
  assert.equal((await auth({ httpMethod: 'GET' })).statusCode, 401);
  const unavailable = createMeHandler({ authenticate: async () => user, subscription: async () => { throw new Error('store_unavailable'); } });
  assert.equal((await unavailable({ httpMethod: 'GET' })).statusCode, 503);
});
