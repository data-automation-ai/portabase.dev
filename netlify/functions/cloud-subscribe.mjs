import { rememberCheckout } from '../shared/checkout-attempts.mjs';
import { withBlobs } from '../shared/subscription-store.mjs';
import { publicAuthConfigBoth, jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import {
  buildAddonPaymentLinkRequest,
  buildSubscriptionPaymentLinkRequest,
  ensureCloudPlanVariationId,
  ensureExtraTransfersAddonVariationId,
  PRICE_MONTHLY_CENTS,
  STORAGE_POLICY,
  squareCredentials,
  squareFetch,
  TRIAL_DAYS,
} from '../shared/square-cloud.mjs';
import {
  BASE_TRANSFERS_PER_24H,
  CLOUD_DEFAULT_PLAN_ID,
  CLOUD_PAYMENT_GATEWAY,
  CLOUD_PLANS,
  EXTRA_TRANSFERS_ADDON_ID,
  extraTransfersAddonPublic,
  getCloudPlan,
} from '../shared/product.mjs';
import { deriveAccess, getSubscriptionForUser, saveSubscription } from '../shared/subscription-store.mjs';
import { resolveSquareCheckoutReady, squareBlockedPayload } from '../shared/square-ready.mjs';
import { applyPromoCode, lookupPromo, normalizePromoCode } from '../shared/promo-codes.mjs';
import { testPromoEndsAt } from '../shared/test-promo.mjs';

export function createSubscribeHandler({ authenticate = verifyCloudUser, get = getSubscriptionForUser,
  save = saveSubscription, credentials = squareCredentials, ensurePlan = ensureCloudPlanVariationId,
  request = squareFetch, authConfig = publicAuthConfigBoth, readiness = resolveSquareCheckoutReady } = {}) {
return async function lambdaHandler(event) {
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
    user = await authenticate(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized', message: 'Sign in (Supabase or AWS version) before starting a trial.' });
  }

  const storeKey = `${user.cloudVersion}:${user.id}`;
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }
  const addonRequested = body.addon === EXTRA_TRANSFERS_ADDON_ID || body.addon === 'extra-transfers';
  const planId = CLOUD_PLANS[body.planId] ? body.planId : CLOUD_DEFAULT_PLAN_ID;
  const plan = getCloudPlan(planId);

  try {
    const existing = (await get(user));
    const access = deriveAccess(existing);

    // Handle Promo Code if supplied
    const rawPromo = body.promoCode || body.code || '';
    if (rawPromo && !addonRequested) {
      const applied = applyPromoCode({
        planId: plan.id,
        baseCents: plan.priceMonthlyCents,
        code: rawPromo,
      });
      if (applied.ok && applied.priceMonthlyCents === 0) {
        const nowIso = new Date().toISOString();
        const endsAt = testPromoEndsAt(new Date(), 30);
        const record = await save({
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
          promoCode: applied.promo.code,
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
        const promoAccess = deriveAccess(record);
        return jsonResponse(200, {
          ok: true,
          promoActivated: true,
          planId: plan.id,
          promoCode: applied.promo.code,
          url: `/app?checkout=complete&mode=promo&plan=${plan.id}&promo=${encodeURIComponent(applied.promo.code)}`,
          subscription: record,
          access: promoAccess,
        });
      }
    }

    if (!addonRequested && access.hasAccess && existing?.status !== 'checkout_pending'
      && getCloudPlan(existing.planId || existing.plan).id === plan.id) {
      return jsonResponse(200, {
        ok: true,
        alreadySubscribed: true,
        access,
        subscription: existing,
      });
    }

    if (addonRequested) {
      if (!existing || !access.hasAccess) {
        return jsonResponse(409, {
          error: 'plan_required',
          message: 'Start a Square Cloud plan first, then add Extra transfers.',
        });
      }
      if (existing.extraTransfersAddon) {
        return jsonResponse(200, {
          ok: true,
          alreadySubscribed: true,
          addon: EXTRA_TRANSFERS_ADDON_ID,
          access,
          subscription: existing,
        });
      }
      const subscribedPlan = getCloudPlan(existing.plan || plan.id);
      const addonVariationId = await ensureExtraTransfersAddonVariationId(subscribedPlan.id);
      const { locationId } = await credentials();
      const siteUrl = (process.env.PORTABASE_SITE_URL || process.env.URL || 'https://portabase.dev').replace(/\/$/, '');
      const attempt = crypto.randomUUID();
      const linkBody = buildAddonPaymentLinkRequest({
        locationId,
        planVariationId: addonVariationId,
        attempt,
        siteUrl,
        buyerEmail: user.email,
        cognitoSub: storeKey,
        planId: subscribedPlan.id,
      });
      const result = await request('/v2/online-checkout/payment-links', {
        method: 'POST',
        body: linkBody,
      });
      const url = result.payment_link?.url;
      const orderId = result.payment_link?.order_id;
      if (!url) throw new Error('missing_payment_link');
      const now = new Date().toISOString();
      const record = await save(rememberCheckout(existing, {
        ...existing,
        userId: storeKey,
        squarePaymentLinkId: result.payment_link?.id || null,
        checkoutKind: EXTRA_TRANSFERS_ADDON_ID,
        pendingAddon: EXTRA_TRANSFERS_ADDON_ID,
        squareAddonPlanVariationId: addonVariationId,
        squareAddonOrderId: orderId || null,
        checkoutAttempt: attempt,
        checkoutUrl: url,
        updatedAt: now,
      }));
      const addon = extraTransfersAddonPublic(subscribedPlan.id);
      return jsonResponse(200, {
        ok: true,
        url,
        orderId: orderId || null,
        attempt,
        addon: EXTRA_TRANSFERS_ADDON_ID,
        extraTransfersAddon: addon,
        message: `Square checkout: Extra transfers add-on · up to 3 / 24h · ${addon.priceLabel} on ${subscribedPlan.shortLabel}.`,
        subscription: record,
      });
    }

    const planVariationId = await ensurePlan(plan.id);
    const { locationId } = await credentials();
    const siteUrl = (process.env.PORTABASE_SITE_URL || process.env.URL || 'https://portabase.dev').replace(/\/$/, '');
    const attempt = crypto.randomUUID();

    const linkBody = buildSubscriptionPaymentLinkRequest({
      locationId,
      planVariationId,
      attempt,
      siteUrl,
      buyerEmail: user.email,
      cognitoSub: storeKey,
      planId: plan.id,
    });
    linkBody.payment_note = `portabase-cloud trial plan=${plan.id} version=${user.cloudVersion} user=${user.id} attempt=${attempt}`;
    linkBody.checkout_options.redirect_url = `${siteUrl}/app?checkout=complete&version=${user.cloudVersion}&plan=${plan.id}&attempt=${encodeURIComponent(attempt)}`;

    const result = await request('/v2/online-checkout/payment-links', {
      method: 'POST',
      body: linkBody,
    });

    const url = result.payment_link?.url;
    const orderId = result.payment_link?.order_id;
    if (!url) throw new Error('missing_payment_link');

    const now = new Date().toISOString();
    const candidate = rememberCheckout(existing, {
      userId: storeKey,
      squarePaymentLinkId: result.payment_link?.id || null,
      revision: existing?.revision || 0,
      supabaseUserId: user.cloudVersion === 'supabase' ? user.id : null,
      cognitoSub: user.cloudVersion === 'aws' ? user.id : null,
      authProvider: user.authProvider,
      cloudVersion: user.cloudVersion,
      email: user.email,
      name: user.name || '',
      status: 'checkout_pending',
      plan: plan.id,
      cyclesPerDay: BASE_TRANSFERS_PER_24H,
      transfersPer24h: BASE_TRANSFERS_PER_24H,
      extraTransfersAddon: Boolean(existing?.extraTransfersAddon),
      paymentGateway: CLOUD_PAYMENT_GATEWAY,
      trialDays: TRIAL_DAYS,
      priceMonthlyCents: plan.priceMonthlyCents,
      listPriceMonthlyCents: CLOUD_PLANS['cloud-37'].priceMonthlyCents,
      storageCapGb: plan.storageCapGb,
      storagePolicy: 'customer_byo',
      squarePlanVariationId: planVariationId,
      squareOrderId: orderId || null,
      checkoutAttempt: attempt,
      checkoutUrl: url,
      startedAt: existing?.startedAt || null,
      trialEndsAt: existing?.trialEndsAt || null,
      createdAt: existing?.createdAt || now,
    });

    // An unfinished upgrade must not revoke the customer's current entitlement.
    const record = await save(access.hasAccess
      ? { ...existing, checkoutAttempts: candidate.checkoutAttempts }
      : candidate);
    const product = await authConfig();
    return jsonResponse(200, {
      ok: true,
      url,
      orderId: orderId || null,
      attempt,
      planId: plan.id,
      cyclesPerDay: BASE_TRANSFERS_PER_24H,
      extraTransfersAddon: extraTransfersAddonPublic(plan.id),
      cloudVersion: user.cloudVersion,
      trialDays: TRIAL_DAYS,
      priceMonthlyCents: plan.priceMonthlyCents,
      paymentGateway: CLOUD_PAYMENT_GATEWAY,
      storage: STORAGE_POLICY,
      message: `Square checkout: card required. Then $${plan.priceMonthlyUsd}/mo · ${plan.cadenceLabel}. You provide capsule storage — Portabase never hosts capsules.`,
      subscription: record,
      product: {
        provider: 'dual',
        cloudVersion: user.cloudVersion,
        trialDays: product.trialDays,
        priceMonthlyCents: plan.priceMonthlyCents,
        plans: product.plans || CLOUD_PLANS,
        paymentGateway: CLOUD_PAYMENT_GATEWAY,
        storage: STORAGE_POLICY,
      },
    });
  } catch (error) {
    const inspect = await readiness();
    const msg = String(error.message || 'error');
    const missingFromError = (msg.match(/missing ([A-Z][A-Z0-9_]+)/) || [])[1];
    if (!inspect.ready || /missing /i.test(msg) || /not configured/i.test(msg)) {
      const payload = squareBlockedPayload(inspect);
      if (missingFromError && !payload.missing.includes(missingFromError)) payload.missing.push(missingFromError);
      console.error(`cloud_subscribe_blocked mode=${inspect.mode} missing=${payload.missing.join(',')}`);
      return jsonResponse(503, payload);
    }
    console.error(`cloud_subscribe_error=${msg.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    return jsonResponse(503, {
      error: 'checkout_unavailable',
      mode: inspect.mode,
      unsetCatalogPins: inspect.unsetCatalogPins,
      message: `Square ${inspect.mode} checkout failed. If catalog pins are unset, Louis must set: ${inspect.unsetCatalogPins.join(', ') || 'none'}. Email escape@portabase.dev.`,
    });
  }
}

}
export const handler = withBlobs(createSubscribeHandler());
