import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { deriveAccess, getSubscriptionForUser, saveSubscription } from '../shared/subscription-store.mjs';
import { BASE_TRANSFERS_PER_24H, CLOUD_DEFAULT_PLAN_ID, CLOUD_PLANS } from '../shared/product.mjs';
import { normalizePromoCode, lookupPromo } from '../shared/promo-codes.mjs';
import { testPromoCodeMatches, testPromoEndsAt } from '../shared/test-promo.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  let user;
  try {
    user = await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized', message: 'Sign in before redeeming a promo code.' });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const rawCode = body.code || body.promoCode || '';
  const normalizedCode = normalizePromoCode(rawCode);
  if (!normalizedCode) {
    return jsonResponse(400, { error: 'missing_promo_code', message: 'A promo code is required.' });
  }

  const planId = CLOUD_PLANS[body.planId] ? body.planId : CLOUD_DEFAULT_PLAN_ID;
  const plan = CLOUD_PLANS[planId];

  const matches = testPromoCodeMatches(normalizedCode, null);
  const promo = lookupPromo(normalizedCode);
  const isValidPromo = matches || (promo && (promo.freeUsage || promo.percentOff === 100));

  if (!isValidPromo) {
    return jsonResponse(400, {
      error: 'invalid_promo_code',
      message: `Promo code "${normalizedCode}" is not recognized or not eligible for free usage.`,
    });
  }

  const storeKey = `${user.cloudVersion}:${user.id}`;
  const existing = await getSubscriptionForUser(user).catch(() => null);

  const nowIso = new Date().toISOString();
  const endsAt = testPromoEndsAt(new Date(), 30);

  const record = await saveSubscription({
    ...existing,
    userId: storeKey,
    revision: existing?.revision || 0,
    supabaseUserId: user.cloudVersion === 'supabase' ? user.id : null,
    cognitoSub: user.cloudVersion === 'aws' ? user.id : null,
    authProvider: user.authProvider || 'supabase',
    cloudVersion: user.cloudVersion || 'supabase',
    email: user.email,
    name: user.name || '',
    status: 'active',
    plan: plan.id,
    planId: plan.id,
    cyclesPerDay: BASE_TRANSFERS_PER_24H,
    transfersPer24h: BASE_TRANSFERS_PER_24H,
    extraTransfersAddon: Boolean(existing?.extraTransfersAddon),
    paymentGateway: 'promo_code',
    verifiedBy: 'promo_code',
    promoCode: normalizedCode,
    testPromoRedeemedAt: nowIso,
    testAccessEndsAt: endsAt,
    currentPeriodEnd: endsAt,
    trialDays: 0,
    priceMonthlyCents: 0,
    listPriceMonthlyCents: plan.priceMonthlyCents,
    storageCapGb: plan.storageCapGb,
    storagePolicy: 'customer_byo',
    startedAt: existing?.startedAt || nowIso,
    updatedAt: nowIso,
    createdAt: existing?.createdAt || nowIso,
  });

  const access = deriveAccess(record);

  return jsonResponse(200, {
    ok: true,
    promoActivated: true,
    code: normalizedCode,
    planId: plan.id,
    subscription: record,
    access,
  });
}
