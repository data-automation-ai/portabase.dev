import { publicAuthConfigBoth, jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import {
  buildSubscriptionPaymentLinkRequest,
  ensureCloudPlanVariationId,
  PRICE_MONTHLY_CENTS,
  STORAGE_POLICY,
  squareCredentials,
  squareFetch,
  TRIAL_DAYS,
} from '../shared/square-cloud.mjs';
import { CLOUD_PAYMENT_GATEWAY, CLOUD_PLAN_ID } from '../shared/product.mjs';
import { deriveAccess, getSubscriptionByUserId, saveSubscription } from '../shared/subscription-store.mjs';

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

  try {
    const existing = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id));
    const access = deriveAccess(existing);
    if (access.hasAccess && existing?.status !== 'checkout_pending') {
      return jsonResponse(200, {
        ok: true,
        alreadySubscribed: true,
        access,
        subscription: existing,
      });
    }

    const planVariationId = await ensureCloudPlanVariationId();
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
    });
    linkBody.payment_note = `portabase-cloud trial version=${user.cloudVersion} user=${user.id} attempt=${attempt}`;
    linkBody.checkout_options.redirect_url = `${siteUrl}/app?checkout=complete&version=${user.cloudVersion}&attempt=${encodeURIComponent(attempt)}`;

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
      supabaseUserId: user.cloudVersion === 'supabase' ? user.id : null,
      cognitoSub: user.cloudVersion === 'aws' ? user.id : null,
      authProvider: user.authProvider,
      cloudVersion: user.cloudVersion,
      email: user.email,
      name: user.name || '',
      status: 'checkout_pending',
      plan: CLOUD_PLAN_ID,
      paymentGateway: CLOUD_PAYMENT_GATEWAY,
      trialDays: TRIAL_DAYS,
      priceMonthlyCents: PRICE_MONTHLY_CENTS,
      listPriceMonthlyCents: 3400,
      storagePolicy: 'customer_byo',
      promoUntil: '2026-08-31',
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
      cloudVersion: user.cloudVersion,
      trialDays: TRIAL_DAYS,
      priceMonthlyCents: PRICE_MONTHLY_CENTS,
      paymentGateway: CLOUD_PAYMENT_GATEWAY,
      storage: STORAGE_POLICY,
      message: 'Square checkout: card required. $17/mo after trial. You provide binary storage — Portabase never hosts capsules.',
      subscription: record,
      product: {
        provider: 'dual',
        cloudVersion: user.cloudVersion,
        trialDays: product.trialDays,
        priceMonthlyCents: product.priceMonthlyCents,
        paymentGateway: CLOUD_PAYMENT_GATEWAY,
        storage: STORAGE_POLICY,
      },
    });
  } catch (error) {
    console.error(`cloud_subscribe_error=${String(error.message || 'error').replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    return jsonResponse(503, {
      error: 'checkout_unavailable',
      message: 'Secure trial checkout is temporarily unavailable. Email escape@portabase.dev.',
    });
  }
}
