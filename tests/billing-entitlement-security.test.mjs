import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { closeSubscription, deriveAccess, getSubscriptionByUserId, saveSubscription, getUserIdBySquareOrder, getUserIdBySquareSubscription } from '../netlify/shared/subscription-store.mjs';
import { resolvePortabaseSquareSecret } from '../netlify/shared/square-cloud.mjs';
import { verifySquareSubscription } from '../netlify/shared/square-subscription-proof.mjs';
import { reconcileSubscription } from '../netlify/shared/billing-entitlement.mjs';
import { createConfirmationHandler } from '../netlify/functions/cloud-confirm-checkout.mjs';
import { createWebhookHandler } from '../netlify/functions/square-webhook.mjs';

const now = Date.parse('2026-10-04T12:00:00Z');
function database() {
  const rows = new Map(); let etag = 0;
  return {
    rows,
    async get(key) { return structuredClone(rows.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
    async setJSON(key, data, options = {}) {
      const old = rows.get(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && options.onlyIfMatch !== old?.etag)) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++etag) });
      return { modified: true, etag: String(etag) };
    },
  };
}
const pending = (id = 'a') => ({ userId: `supabase:${id}`, status: 'checkout_pending', squareOrderId: `order-${id}`, squarePlanVariationId: 'plan', checkoutAttempt: `attempt-${id}`, trialDays: 7 });
const activePatch = {
  status: 'active', squareSubscriptionId: 'subscription', verifiedBy: 'square_api',
  squareVerifiedAt: new Date(now).toISOString(), currentPeriodEnd: '2026-11-01T00:00:00Z',
};
function provider({ subscription = {}, order = {}, invoice = {}, candidates } = {}) {
  const sub = { id: 'subscription', customer_id: 'customer', location_id: 'location', plan_variation_id: 'plan',
    created_at: '2026-09-01T00:01:00Z', status: 'ACTIVE', version: 1, start_date: '2026-09-01',
    card_id: 'card', timezone: 'UTC', charged_through_date: '2026-10-31', invoice_ids: ['invoice'], ...subscription };
  const read = async path => {
    if (path.startsWith('/v2/orders/')) return { order: { id: 'order-a', location_id: 'location', state: 'OPEN',
      created_at: '2026-09-01T00:00:00Z', fulfillments: [{ state: 'COMPLETED', pickup_details: { recipient: { customer_id: 'customer' } } }], ...order } };
    if (path === '/v2/subscriptions/search') return { subscriptions: candidates || [sub] };
    if (path.startsWith('/v2/subscriptions/')) return { subscription: sub };
    if (path === '/v2/invoices/invoice') return { invoice: { id: 'invoice', subscription_id: 'subscription', location_id: 'location',
      primary_recipient: { customer_id: 'customer' }, status: 'PAID', version: 1, ...invoice } };
    throw new Error(`Unexpected test request ${path}`);
  };
  return { request: read, credentials: async () => ({ locationId: 'location' }), now };
}

test('status strings cannot grant access without fresh identity and an unexpired paid/trial period', () => {
  for (const status of ['trialing', 'active', 'past_due']) assert.equal(deriveAccess({ status }, now).hasAccess, false);
  assert.equal(deriveAccess(activePatch, now).hasAccess, true);
  assert.equal(deriveAccess({ ...activePatch, currentPeriodEnd: new Date(now).toISOString() }, now).hasAccess, false);
  assert.equal(deriveAccess({ ...activePatch, status: 'past_due' }, now).hasAccess, false);
  assert.equal(deriveAccess({ ...activePatch, status: 'trialing', trialEndsAt: '2026-10-05T00:00:00Z' }, now).hasAccess, true);
  assert.equal(deriveAccess({ ...activePatch, verifiedBy: undefined }, now).hasAccess, false);
});

test('proof accepts an OPEN checkout order with fulfilled customer identity and paid latest invoice', async () => {
  const result = await verifySquareSubscription(pending(), provider());
  assert.equal(result.verified, true);
  assert.equal(result.patch.status, 'active');
  assert.equal(result.patch.currentPeriodEnd, '2026-11-01T00:00:00.000Z');
});

test('scheduled cancellation caps paid and trial access in the provider timezone', async () => {
  const subscription = { canceled_date: '2026-10-06', timezone: 'America/New_York' };
  const paid = await verifySquareSubscription(pending(), provider({ subscription }));
  assert.equal(paid.patch.currentPeriodEnd, '2026-10-06T04:00:00.000Z');
  assert.equal(paid.patch.cancellationEffectiveAt, paid.patch.currentPeriodEnd);
  assert.equal(deriveAccess(paid.patch, now).hasAccess, true);
  assert.equal(deriveAccess(paid.patch, Date.parse(paid.patch.currentPeriodEnd)).hasAccess, false);
  const trial = await verifySquareSubscription(pending(), provider({ subscription: { ...subscription, start_date: '2026-10-01' } }));
  assert.equal(trial.patch.trialEndsAt, paid.patch.currentPeriodEnd);
  const ended = await verifySquareSubscription(pending(), { ...provider({ subscription }), now: Date.parse(paid.patch.currentPeriodEnd) });
  assert.equal(ended.patch.status, 'canceled');
  assert.equal(deriveAccess(ended.patch, now).hasAccess, false);
});

test('malformed cancellation date cannot grant access and cleared cancellation removes stale metadata', async () => {
  for (const canceled_date of ['2026-02-30', 'invalid', '']) {
    assert.equal((await verifySquareSubscription(pending(), provider({ subscription: { canceled_date } }))).verified, false);
  }
  const result = await verifySquareSubscription({ ...pending(), cancellationEffectiveAt: '2026-10-06T00:00:00Z' }, provider());
  assert.equal(result.patch.cancellationEffectiveAt, null);
});

test('proof denies abandoned checkout, another customer/location/plan, and ambiguous subscriptions', async () => {
  for (const options of [
    { order: { fulfillments: [] } }, { order: { location_id: 'foreign' } },
    { subscription: { customer_id: 'foreign' } }, { subscription: { plan_variation_id: 'foreign' } },
    { subscription: { location_id: 'foreign' } }, { subscription: { created_at: '2020-01-01T00:00:00Z' } },
    { invoice: { subscription_id: 'foreign' } }, { invoice: { primary_recipient: { customer_id: 'foreign' } } },
  ]) assert.equal((await verifySquareSubscription(pending(), provider(options))).verified, false);
  const request = provider().request;
  const sub = (await request('/v2/subscriptions/subscription')).subscription;
  assert.equal((await verifySquareSubscription(pending(), provider({ candidates: [sub, { ...sub, id: 'other' }] }))).reason, 'subscription_ambiguous');
});

test('invoiced-through date and ACTIVE status are insufficient; refund and cancellation remove access', async () => {
  for (const status of ['UNPAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']) {
    const result = await verifySquareSubscription(pending(), provider({ invoice: { status } }));
    assert.equal(deriveAccess(result.patch, now).hasAccess, false);
  }
  const result = await verifySquareSubscription(pending(), provider({ subscription: { status: 'CANCELED' } }));
  assert.equal(result.patch.status, 'canceled');
});

test('card-backed trial is bounded to seven days in the subscription timezone', async () => {
  const subscription = { start_date: '2026-10-01', timezone: 'America/New_York', invoice_ids: [] };
  const result = await verifySquareSubscription(pending(), provider({ subscription }));
  assert.equal(result.patch.trialEndsAt, '2026-10-08T04:00:00.000Z');
  assert.equal(deriveAccess(result.patch, now).hasAccess, true);
  const missingCard = await verifySquareSubscription(pending(), provider({ subscription: { ...subscription, card_id: null } }));
  assert.equal(deriveAccess(missingCard.patch, now).hasAccess, false);
});

test('concurrent account claims cannot attach the same provider subscription twice', async () => {
  const db = database();
  const a = await saveSubscription(pending('a'), db);
  const b = await saveSubscription(pending('b'), db);
  const results = await Promise.allSettled([a, b].map(row => saveSubscription({ ...row, ...activePatch }, db)));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected' && row.reason.message === 'billing_identity_conflict').length, 1);
});

test('stale Square proof cannot overwrite a refund or a replacement checkout', async () => {
  const db = database();
  let row = await saveSubscription(pending(), db);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const proof = new Promise(resolve => { release = resolve; });
  const inflight = reconcileSubscription(row, { verify: async () => { entered(); return proof; }, save: value => saveSubscription(value, db) });
  await started;
  row = await saveSubscription({ ...row, status: 'refunded' }, db);
  release({ verified: true, patch: activePatch });
  await assert.rejects(inflight, error => error.status === 409);
  assert.equal((await getSubscriptionByUserId(row.userId, db)).status, 'refunded');
  let called = false;
  await reconcileSubscription(row, { verify: async () => { called = true; } });
  assert.equal(called, false);
  const replacement = await saveSubscription({ ...pending(), revision: row.revision, squareOrderId: 'replacement', checkoutAttempt: 'replacement-attempt' }, db);
  const restored = await reconcileSubscription(replacement, {
    verify: async () => ({ verified: true, patch: { ...activePatch, squareSubscriptionId: 'new-subscription' } }),
    save: value => saveSubscription(value, db),
  });
  assert.equal(deriveAccess(restored.record, now).hasAccess, true);
});

test('confirmation cannot unlock from a redirect, supplied subscription ID, or an add-on flag', async () => {
  const db = database(); await saveSubscription(pending(), db);
  let checkedKind;
  const handler = createConfirmationHandler({ authenticate: async () => ({ id: 'a', cloudVersion: 'supabase' }),
    get: key => getSubscriptionByUserId(key, db), reconcile: async (_, options) => { checkedKind = options.kind; return { verified: false }; } });
  const call = body => handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  assert.equal((await call({})).statusCode, 409);
  assert.equal((await call({ attempt: 'foreign' })).statusCode, 409);
  assert.equal((await call({ attempt: 'attempt-a', subscriptionId: 'foreign', addon: 'extra-transfers' })).statusCode, 202);
  assert.equal(checkedKind, 'base');
  assert.equal((await getSubscriptionByUserId('supabase:a', db)).status, 'checkout_pending');
});

test('signed duplicate and out-of-order webhook events reconcile current provider state', async () => {
  const db = database(); let row = await saveSubscription({ ...pending(), ...activePatch }, db);
  let providerStatus = 'canceled'; let calls = 0;
  const notificationUrl = 'https://portabase.dev/api/square/webhook';
  const handler = createWebhookHandler({ secret: async () => 'test-key', notificationUrl,
    get: id => getSubscriptionByUserId(id, db), findOrder: id => getUserIdBySquareOrder(id, db), findSubscription: id => getUserIdBySquareSubscription(id, db),
    reconcile: (record, opts) => reconcileSubscription(record, { ...opts, save: value => saveSubscription(value, db), verify: async () => { calls++; return { verified: true, patch: { ...activePatch, status: providerStatus } }; } }),
  });
  const event = { type: 'subscription.updated', data: { object: { subscription: { id: 'subscription', status: 'ACTIVE' } } } };
  const body = JSON.stringify(event);
  const signed = { httpMethod: 'POST', body, headers: { 'x-square-hmacsha256-signature': createHmac('sha256', 'test-key').update(notificationUrl + body).digest('base64') } };
  assert.equal((await handler({ ...signed, body: body + ' ' })).statusCode, 403);
  assert.equal((await handler(signed)).statusCode, 200);
  providerStatus = 'active';
  assert.equal((await handler(signed)).statusCode, 200);
  row = await getSubscriptionByUserId(row.userId, db);
  assert.equal(row.status, 'canceled');
  assert.equal(calls, 1);
});

test('storage outages surface instead of masquerading as missing subscriptions', async () => {
  await assert.rejects(getSubscriptionByUserId('supabase:a', { get: async () => { throw new Error('unavailable'); } }), /unavailable/);
  const handler = createConfirmationHandler({ authenticate: async () => ({ id: 'a', cloudVersion: 'supabase' }), get: async () => { throw new Error('secret provider details'); } });
  const result = await handler({ httpMethod: 'POST', body: '{}' });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.includes('secret'), false);
});

test('completed refund closes a concurrently refreshed record but leaves a new checkout untouched', async () => {
  const db = database();
  const original = await saveSubscription({ ...pending(), ...activePatch }, db);
  await saveSubscription({ ...original, squareVersion: 2 }, db);
  const closed = await closeSubscription(original, { status: 'refunded' }, db);
  assert.equal(closed.status, 'refunded');
  await saveSubscription({ ...pending(), revision: closed.revision, squareOrderId: 'new-order', checkoutAttempt: 'new-attempt' }, db);
  await assert.rejects(closeSubscription(original, { status: 'refunded' }, db), /checkout_changed/);
  assert.equal((await getSubscriptionByUserId(original.userId, db)).status, 'checkout_pending');
});

test('lower provider versions cannot replace newer paused state', async () => {
  const row = { ...pending(), ...activePatch, status: 'paused', squareVersion: 7 };
  const result = await reconcileSubscription(row, {
    verify: async () => ({ verified: true, patch: { ...activePatch, squareVersion: 6 } }),
    save: async () => { throw new Error('must not write stale proof'); },
  });
  assert.equal(result.record.status, 'paused');
});

test('Square lookup is product-scoped with only a product deployment environment fallback', async () => {
  let lookup;
  const result = await resolvePortabaseSquareSecret('SQUARE_ACCESS_TOKEN', 'access_token', {
    resolve: async (name, selector) => { lookup = { name, selector }; throw new Error('missing'); },
    env: { SQUARE_ACCESS_TOKEN: 'test-site-token' },
  });
  assert.deepEqual(lookup, { name: 'PORTABASE_SQUARE_ACCESS_TOKEN', selector: { service: 'portabase-square', key: 'access_token' } });
  assert.equal(result, 'test-site-token');
  await assert.rejects(resolvePortabaseSquareSecret('SQUARE_ACCESS_TOKEN', 'access_token', { resolve: async () => { throw new Error('missing'); }, env: {} }), /PORTABASE_SQUARE_ACCESS_TOKEN/);
});

test('refunded invoice denies that period without blocking a later genuinely paid renewal', async () => {
  const db = database();
  const row = await saveSubscription({ ...pending(), ...activePatch }, db);
  const refunded = await reconcileSubscription(row, {
    verify: record => verifySquareSubscription(record, provider({ invoice: { status: 'REFUNDED', version: 2 } })),
    save: record => saveSubscription(record, db),
  });
  assert.equal(refunded.record.status, 'payment_refunded');
  assert.equal(deriveAccess(refunded.record, now).hasAccess, false);
  const renewal = await reconcileSubscription(refunded.record, {
    verify: async () => ({ verified: true, patch: { ...activePatch, lastInvoiceId: 'next-month-invoice', squareInvoiceVersion: 1 } }),
    save: record => saveSubscription(record, db),
  });
  assert.equal(deriveAccess(renewal.record, now).hasAccess, true);
});
