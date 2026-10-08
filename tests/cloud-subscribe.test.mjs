import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAddonPaymentLinkRequest, buildSubscriptionPaymentLinkRequest, PRICE_MONTHLY_CENTS, STORAGE_POLICY, TRIAL_DAYS } from '../netlify/shared/square-cloud.mjs';
import { ADDON_TRANSFERS_PER_24H, BASE_TRANSFERS_PER_24H, CLOUD_MAX_AGENTS, CLOUD_PAYMENT_GATEWAY, CLOUD_PRICE_MONTHLY_CENTS, CLOUD_PLANS, EXTRA_TRANSFERS_ADDON_ID, getCloudPlan } from '../netlify/shared/product.mjs';
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
  assert.match(body.payment_note, /25 GB/);
  assert.match(body.quick_pay.name, /BYO storage|12 agents/i);
  assert.equal(STORAGE_POLICY.includedInCloud, false);
  assert.equal(STORAGE_POLICY.owner, 'customer');
  assert.equal(CLOUD_MAX_AGENTS, 12);
});

test('Scale Escape plan is hidden legacy $37 with 100 GB cap', () => {
  const plan = getCloudPlan('cloud-37');
  assert.equal(plan.priceMonthlyCents, 3700);
  assert.equal(plan.storageCapGb, 100);
  assert.equal(plan.customerFacing, false);
  assert.equal(CLOUD_PLANS['cloud-7'].storageCapGb, 10);
  assert.equal(CLOUD_PLANS['cloud-17'].storageCapGb, 25);
  assert.match(plan.cadenceLabel, /legacy hidden/i);
  const body = buildSubscriptionPaymentLinkRequest({
    locationId: 'LOC',
    planVariationId: 'VAR37',
    attempt: 'attempt-37',
    siteUrl: 'https://portabase.dev',
    buyerEmail: 'ops@example.com',
    cognitoSub: 'sub-abc',
    planId: 'cloud-37',
  });
  assert.match(body.description, /\$37\/mo|37\/mo/i);
  assert.match(body.payment_note, /cloud-37|\$37/);
  assert.doesNotMatch(body.description, /backup/i);
});

test('Extra transfers add-on payment link is a Square checkout stub', () => {
  const body = buildAddonPaymentLinkRequest({
    locationId: 'LOC',
    planVariationId: 'ADDON_VAR',
    attempt: 'attempt-addon',
    siteUrl: 'https://portabase.dev',
    buyerEmail: 'ops@example.com',
    cognitoSub: 'sub-abc',
  });
  assert.equal(body.quick_pay.price_money.amount, 0);
  assert.equal(body.checkout_options.subscription_plan_id, 'ADDON_VAR');
  assert.match(body.checkout_options.redirect_url, new RegExp(`addon=${EXTRA_TRANSFERS_ADDON_ID}`));
  assert.match(body.description, /3 transfers/i);
  assert.match(body.payment_note, /extra-transfers/);
  assert.equal(ADDON_TRANSFERS_PER_24H, 3);
});

test('legacy $27 Triple maps to Daily $17', () => {
  assert.equal(getCloudPlan('cloud-27').id, 'cloud-17');
});

test('trial end is seven days after start', () => {
  const end = trialEndsAtFrom('2026-08-01T00:00:00.000Z', 7);
  assert.equal(end, '2026-08-08T00:00:00.000Z');
});

test('deriveAccess rejects unverified trial and active status strings', () => {
  assert.equal(deriveAccess({ status: 'trialing' }).hasAccess, false);
  assert.equal(deriveAccess({ status: 'active' }).hasAccess, false);
  assert.equal(deriveAccess({ status: 'checkout_pending' }).hasAccess, false);
  assert.equal(deriveAccess(null).status, 'none');
});
