import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriptionPaymentLinkRequest, PRICE_MONTHLY_CENTS, STORAGE_POLICY, TRIAL_DAYS } from '../netlify/shared/square-cloud.mjs';
import { CLOUD_MAX_AGENTS, CLOUD_PAYMENT_GATEWAY, CLOUD_PRICE_MONTHLY_CENTS } from '../netlify/shared/product.mjs';
import { deriveAccess, trialEndsAtFrom } from '../netlify/shared/subscription-store.mjs';

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

test('trial end is seven days after start', () => {
  const end = trialEndsAtFrom('2026-08-01T00:00:00.000Z', 7);
  assert.equal(end, '2026-08-08T00:00:00.000Z');
});

test('deriveAccess treats trialing as hasAccess', () => {
  assert.equal(deriveAccess({ status: 'trialing' }).hasAccess, true);
  assert.equal(deriveAccess({ status: 'active' }).hasAccess, true);
  assert.equal(deriveAccess({ status: 'checkout_pending' }).hasAccess, false);
  assert.equal(deriveAccess(null).status, 'none');
});
