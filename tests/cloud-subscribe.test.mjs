import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriptionPaymentLinkRequest, PRICE_MONTHLY_CENTS, STORAGE_POLICY, TRIAL_DAYS, VARIATION_NAME, squareCheckoutIsFulfilled, catalogVariationIdFromUpsert, findNamedPlanVariation } from '../netlify/shared/square-cloud.mjs';
import { CLOUD_MAX_AGENTS, CLOUD_PAYMENT_GATEWAY, CLOUD_PRICE_MONTHLY_CENTS, CLOUD_PLANS, getCloudPlan } from '../netlify/shared/product.mjs';
import { deriveAccess, moneyBackEligible, trialEndsAtFrom } from '../netlify/shared/subscription-store.mjs';

test('subscription payment link is $0 trial with plan variation id', () => {
  const body = buildSubscriptionPaymentLinkRequest({
    locationId: 'LOC',
    planVariationId: 'VAR123',
    attempt: 'attempt-1',
    siteUrl: 'https://portabase.dev',
    buyerEmail: 'ops@example.com',
    cognitoSub: 'sub-abc',
  });
  assert.equal(body.quick_pay.price_money.amount, 0);
  assert.equal(body.checkout_options.subscription_plan_id, 'VAR123');
  assert.match(body.checkout_options.redirect_url, /\/app\?checkout=complete/);
  assert.equal(body.pre_populated_data.buyer_email, 'ops@example.com');
  assert.equal(TRIAL_DAYS, 7);
  assert.equal(PRICE_MONTHLY_CENTS, 1700);
  assert.equal(CLOUD_PRICE_MONTHLY_CENTS, 1700);
  assert.equal(CLOUD_PAYMENT_GATEWAY, 'square');
  assert.match(body.description, /\$17\/mo|17\/mo/i);
  assert.match(body.payment_note, /byo_storage=true/);
  assert.match(body.quick_pay.name, /BYO storage|12 agents/i);
  assert.equal(STORAGE_POLICY.includedInCloud, false);
  assert.equal(STORAGE_POLICY.owner, 'customer');
  assert.equal(CLOUD_MAX_AGENTS, 12);
});

test('Triple Escape plan is $27 with up to 3 escapes per day', () => {
  const plan = getCloudPlan('cloud-27');
  assert.equal(plan.priceMonthlyCents, 2700);
  assert.equal(plan.escapesPerDay, 3);
  assert.equal(plan.cyclesPerDay, 3);
  assert.equal(CLOUD_PLANS['cloud-17'].escapesPerDay, 1);
  assert.match(plan.cadenceLabel, /escape/i);
  assert.doesNotMatch(plan.cadenceLabel, /backup/i);
  const body = buildSubscriptionPaymentLinkRequest({
    locationId: 'LOC',
    planVariationId: 'VAR27',
    attempt: 'attempt-27',
    siteUrl: 'https://portabase.dev',
    buyerEmail: 'ops@example.com',
    cognitoSub: 'sub-abc',
    planId: 'cloud-27',
  });
  assert.match(body.description, /\$27\/mo|27\/mo/i);
  assert.match(body.payment_note, /cloud-27|\$27/);
  assert.doesNotMatch(body.description, /backup/i);
});

test('trial end is seven days after start', () => {
  const end = trialEndsAtFrom('2026-08-01T00:00:00.000Z', 7);
  assert.equal(end, '2026-08-08T00:00:00.000Z');
});

test('deriveAccess treats trialing as hasAccess', () => {
  assert.equal(deriveAccess({ status: 'trialing' }).hasAccess, true);
  assert.equal(deriveAccess({ status: 'active' }).hasAccess, true);
  assert.equal(deriveAccess({ status: 'checkout_pending' }).hasAccess, false);
  assert.equal(deriveAccess({ status: 'refunded' }).hasAccess, false);
  assert.equal(deriveAccess(null).status, 'none');
});

test('squareCheckoutIsFulfilled accepts $0 COMPLETED trial payment on an OPEN order', () => {
  const result = squareCheckoutIsFulfilled({
    order: { state: 'OPEN', tenders: [] },
    payments: [{ id: 'pay_trial', status: 'COMPLETED', amount_money: { amount: 0, currency: 'USD' } }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, 'payment');
  assert.equal(result.amountCents, 0);
});

test('squareCheckoutIsFulfilled treats CAPTURED payment as paid even when order is OPEN', () => {
  const result = squareCheckoutIsFulfilled({
    order: { state: 'OPEN' },
    payments: [{ id: 'pay_1', status: 'CAPTURED', amount_money: { amount: 1700, currency: 'USD' } }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, 'payment');
});

test('squareCheckoutIsFulfilled accepts PENDING Square subscription with card on file', () => {
  const result = squareCheckoutIsFulfilled({
    order: { state: 'OPEN' },
    payments: [],
    subscription: { id: 'sub_1', status: 'PENDING' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, 'subscription');
});

test('catalogVariationIdFromUpsert reads id_mappings when objects are omitted', () => {
  const id = catalogVariationIdFromUpsert({
    id_mappings: [
      { client_object_id: '#portabase-cloud-plan', object_id: 'PLAN1' },
      { client_object_id: '#portabase-cloud-daily-trial', object_id: 'VAR1' },
    ],
  }, '#portabase-cloud-daily-trial');
  assert.equal(id, 'VAR1');
});

test('findNamedPlanVariation reads nested subscription plan variations', () => {
  const id = findNamedPlanVariation({
    objects: [{
      type: 'SUBSCRIPTION_PLAN',
      subscription_plan_data: {
        subscription_plan_variations: [{
          id: 'NESTED_VAR',
          subscription_plan_variation_data: { name: VARIATION_NAME },
        }],
      },
    }],
  }, VARIATION_NAME);
  assert.equal(id, 'NESTED_VAR');
});

test('squareCheckoutIsFulfilled rejects checkout_pending with no Square capture', () => {
  const result = squareCheckoutIsFulfilled({
    order: { state: 'DRAFT' },
    payments: [],
  });
  assert.equal(result.ok, false);
});

test('self-serve money-back is open during trial and first 7 paid days', () => {
  assert.equal(moneyBackEligible({ status: 'trialing' }).ok, true);
  assert.equal(moneyBackEligible({ status: 'active', firstPaidAt: '2026-08-14T00:00:00.000Z' }, new Date('2026-08-15T00:00:00.000Z')).ok, true);
  assert.equal(moneyBackEligible({ status: 'active', firstPaidAt: '2026-08-01T00:00:00.000Z' }, new Date('2026-08-15T00:00:00.000Z')).ok, false);
  assert.equal(moneyBackEligible({ status: 'refunded' }).ok, false);
});
