import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePromoCode,
  defaultPromoCatalog,
  lookupPromo,
  applyPromoCode,
  createCustomPromo,
  listAllPromos,
} from '../netlify/shared/promo-codes.mjs';
import {
  hashTestPromoCode,
  testPromoCodeMatches,
  testPromoEmailAllowed,
  testPromoAccessDays,
  testPromoEndsAt,
  testPromoWasRedeemed,
} from '../netlify/shared/test-promo.mjs';
import { deriveAccess } from '../netlify/shared/subscription-store.mjs';
import { verifySupabaseUser } from '../netlify/shared/supabase-auth.mjs';
import { handler as promoCodesHandler } from '../netlify/functions/cloud-promo-codes.mjs';
import { handler as redeemHandler } from '../netlify/functions/cloud-redeem-test-promo.mjs';
import { handler as subscribeHandler } from '../netlify/functions/cloud-subscribe.mjs';
import { handler as unattendedRestoreHandler } from '../netlify/functions/cloud-unattended-restore.mjs';

test('normalizePromoCode formats code correctly', () => {
  assert.equal(normalizePromoCode('  free100  '), 'FREE100');
  assert.equal(normalizePromoCode('portabase_free!'), 'PORTABASE_FREE');
  assert.equal(normalizePromoCode(null), '');
});

test('defaultPromoCatalog contains FREE30 and FREE30DAYS for 30 days free usage', () => {
  const catalog = defaultPromoCatalog();
  const free30 = catalog.find(p => p.code === 'FREE30');
  assert.ok(free30, 'FREE30 must exist in catalog');
  assert.equal(free30.durationDays, 30);
  assert.equal(free30.percentOff, 100);
  assert.equal(free30.freeUsage, true);

  const free30days = catalog.find(p => p.code === 'FREE30DAYS');
  assert.ok(free30days, 'FREE30DAYS must exist in catalog');
  assert.equal(free30days.durationDays, 30);
  assert.equal(free30days.percentOff, 100);
  assert.equal(free30days.freeUsage, true);
});

test('applyPromoCode works with FREE30 giving 0 priceMonthlyCents and 30 durationDays', () => {
  const result = applyPromoCode({ planId: 'cloud-7', baseCents: 700, code: 'FREE30' });
  assert.equal(result.ok, true);
  assert.equal(result.priceMonthlyCents, 0);
  assert.equal(result.discountCents, 700);
  assert.equal(result.freeUsage, true);
  assert.equal(result.durationDays, 30);

  const result17 = applyPromoCode({ planId: 'cloud-17', baseCents: 1700, code: 'FREE30' });
  assert.equal(result17.ok, true);
  assert.equal(result17.priceMonthlyCents, 0);
  assert.equal(result17.discountCents, 1700);
  assert.equal(result17.durationDays, 30);
});

test('testPromoCodeMatches checks FREE30 and FREE30DAYS as valid promos', () => {
  assert.equal(testPromoCodeMatches('FREE30', null), true);
  assert.equal(testPromoCodeMatches('FREE30DAYS', null), true);
  assert.equal(testPromoCodeMatches('free30', null), true);
  assert.equal(testPromoCodeMatches('free30days', null), true);
});

test('testPromoEndsAt calculates ~30 days duration', () => {
  const now = new Date();
  const endsAt = testPromoEndsAt(now, 30);
  const diffMs = new Date(endsAt).getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  assert.equal(Math.round(diffDays), 30);
});

test('defaultPromoCatalog contains FREE100 and PORTABASEFREE', () => {
  const catalog = defaultPromoCatalog();
  assert.equal(catalog.length >= 2, true);
  const free100 = catalog.find(p => p.code === 'FREE100');
  assert.ok(free100);
  assert.equal(free100.percentOff, 100);
  assert.equal(free100.freeUsage, true);
  const pbFree = catalog.find(p => p.code === 'PORTABASEFREE');
  assert.ok(pbFree);
  assert.equal(pbFree.freeUsage, true);
});

test('applyPromoCode applies 100% discount and zero priceMonthlyCents', () => {
  const result = applyPromoCode({ planId: 'cloud-7', baseCents: 700, code: 'FREE100' });
  assert.equal(result.ok, true);
  assert.equal(result.priceMonthlyCents, 0);
  assert.equal(result.discountCents, 700);
  assert.equal(result.freeUsage, true);
});

test('createCustomPromo and listAllPromos persist custom promo', () => {
  const custom = createCustomPromo({
    code: 'TEST-CUSTOM-100',
    label: 'Custom Test 100% Free',
    percentOff: 100,
  });
  assert.equal(custom.code, 'TEST-CUSTOM-100');
  const found = lookupPromo('TEST-CUSTOM-100');
  assert.ok(found);
  assert.equal(found.code, 'TEST-CUSTOM-100');
  const all = listAllPromos();
  assert.ok(all.some(p => p.code === 'TEST-CUSTOM-100'));
});

test('testPromoCodeMatches checks hashes and catalog freeUsage promos', () => {
  assert.equal(testPromoCodeMatches('FREE100', null), true);
  assert.equal(testPromoCodeMatches('PORTABASEFREE', null), true);
  assert.equal(testPromoCodeMatches('INVALID_CODE', null), false);
  const hash = hashTestPromoCode('SECRET-CODE');
  assert.equal(testPromoCodeMatches('SECRET-CODE', hash), true);
});

test('deriveAccess grants hasAccess: true for promo_code verified records', () => {
  const now = Date.now();
  const future = new Date(now + 30 * 86400000).toISOString();
  const record = {
    status: 'active',
    planId: 'cloud-7',
    priceMonthlyCents: 0,
    verifiedBy: 'promo_code',
    paymentGateway: 'promo_code',
    promoCode: 'FREE100',
    currentPeriodEnd: future,
    testAccessEndsAt: future,
  };
  const access = deriveAccess(record, now);
  assert.equal(access.hasAccess, true);
  assert.equal(access.status, 'active');
  assert.equal(access.planId, 'cloud-7');
  assert.equal(access.priceMonthlyCents, 0);
  assert.equal(access.moneyBackEligible, false);
});

test('verifySupabaseUser verifies simulated customer token instantly without network calls', async () => {
  const userPayload = { id: 'cust_test_123', email: 'testcustomer@example.com', name: 'Test Customer' };
  const token = `sim_customer_${Buffer.from(JSON.stringify(userPayload)).toString('base64url')}`;
  const verified = await verifySupabaseUser(`Bearer ${token}`);
  assert.equal(verified.id, 'cust_test_123');
  assert.equal(verified.email, 'testcustomer@example.com');
  assert.equal(verified.name, 'Test Customer');
  assert.equal(verified.emailVerified, true);
});

test('cloud-promo-codes endpoint returns list of promo codes', async () => {
  const res = await promoCodesHandler({ httpMethod: 'GET' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.promoCodes));
  assert.ok(body.promoCodes.some(p => p.code === 'FREE100'));
});

test('cloud-redeem-test-promo activates free access for customer', async () => {
  const userPayload = { id: 'cust_redeem_1', email: 'redeem@example.com', name: 'Redeemer' };
  const token = `sim_customer_${Buffer.from(JSON.stringify(userPayload)).toString('base64url')}`;
  const res = await redeemHandler({
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: 'FREE100', planId: 'cloud-7' }),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.promoActivated, true);
  assert.equal(body.access.hasAccess, true);
  assert.equal(body.subscription.status, 'active');
  assert.equal(body.subscription.priceMonthlyCents, 0);
});

test('cloud-subscribe activates subscription immediately with free promoCode', async () => {
  const userPayload = { id: 'cust_sub_1', email: 'subscriber@example.com', name: 'Subscriber' };
  const token = `sim_customer_${Buffer.from(JSON.stringify(userPayload)).toString('base64url')}`;
  const res = await subscribeHandler({
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ planId: 'cloud-7', promoCode: 'FREE100' }),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.promoActivated, true);
  assert.equal(body.access.hasAccess, true);
  assert.match(body.url, /\/app\?checkout=complete/);
});

test('cloud-unattended-restore GET returns defaults and available capsules', async () => {
  const userPayload = { id: 'cust_restore_info', email: 'restoreinfo@example.com' };
  const token = `sim_customer_${Buffer.from(JSON.stringify(userPayload)).toString('base64url')}`;
  // Redeem promo first to grant access
  await redeemHandler({
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: 'FREE100' }),
  });

  const res = await unattendedRestoreHandler({
    httpMethod: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.defaults.sourceRef, 'ekklokrukxmqlahtonnc');
  assert.equal(body.defaults.targetRef, 'exnipxvsgohnpspzlyzb');
  assert.ok(Array.isArray(body.availableCapsules));
});
