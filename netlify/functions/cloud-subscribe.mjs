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
import { inspectSquareCheckoutReady, squareBlockedPayload } from '../shared/square-ready.mjs';

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
    const existing = (await getSubscriptionForUser(user));
    const access = deriveAccess(existing);
    if (!addonRequested && access.hasAccess && existing?.status !== 'checkout_pending') {
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
      const { locationId } = await squareCredentials();
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
      const result = await squareFetch('/v2/online-checkout/payment-links', {
        method: 'POST',
        body: linkBody,
      });
      const url = result.payment_link?.url;
      const orderId = result.payment_link?.order_id;
      if (!url) throw new Error('missing_payment_link');
      const now = new Date().toISOString();
      const record = await saveSubscription({
        ...existing,
        userId: storeKey,
        checkoutKind: EXTRA_TRANSFERS_ADDON_ID,
        pendingAddon: EXTRA_TRANSFERS_ADDON_ID,
        squareAddonPlanVariationId: addonVariationId,
        squareAddonOrderId: orderId || null,
        checkoutAttempt: attempt,
        checkoutUrl: url,
        updatedAt: now,
      });
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

    const planVariationId = await ensureCloudPlanVariationId(plan.id);
    const { locationId } = await squareCredentials();
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

    const result = await squareFetch('/v2/online-checkout/payment-links', {
      method: 'POST',
      body: linkBody,
    });

    const url = result.payment_link?.url;
    const orderId = result.payment_link?.order_id;
    if (!url) throw new Error('missing_payment_link');

    const now = new Date().toISOString();
    const record = await saveSubscription({
      userId: storeKey,
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

    const product = await publicAuthConfigBoth();
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
    const inspect = inspectSquareCheckoutReady();
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
