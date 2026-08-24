import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { PRICE_MONTHLY_CENTS, retrieveCheckoutEvidence, squareCheckoutIsFulfilled, TRIAL_DAYS } from '../shared/square-cloud.mjs';
import {
  deriveAccess,
  getSubscriptionByUserId,
  saveSubscription,
  trialEndsAtFrom,
} from '../shared/subscription-store.mjs';

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
    return jsonResponse(401, { error: 'unauthorized' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const attempt = String(body.attempt || '').slice(0, 80);
  const storeKey = `${user.cloudVersion}:${user.id}`;
  const existing = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id));

  if (!existing) {
    return jsonResponse(404, { error: 'no_checkout', message: 'No checkout found for this account. Start the trial again.' });
  }

  if (attempt && existing.checkoutAttempt && attempt !== existing.checkoutAttempt) {
    return jsonResponse(409, { error: 'attempt_mismatch', message: 'Checkout attempt does not match this account.' });
  }

  const access = deriveAccess(existing);
  if (access.hasAccess && existing.status !== 'checkout_pending') {
    return jsonResponse(200, { ok: true, alreadyActive: true, access, subscription: existing });
  }

  if (!existing.squareOrderId) {
    return jsonResponse(409, {
      error: 'checkout_incomplete',
      message: 'Square checkout is not complete. Pay with Square, then return here.',
    });
  }

  let evidence;
  try {
    evidence = await retrieveCheckoutEvidence(existing.squareOrderId);
  } catch (error) {
    console.error(`cloud_confirm_square_error=${String(error.message || 'error').replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    return jsonResponse(503, {
      error: 'checkout_unavailable',
      message: 'Could not verify Square checkout. Try again in a moment.',
    });
  }

  const fulfilled = squareCheckoutIsFulfilled(evidence);
  if (!fulfilled.ok) {
    return jsonResponse(409, {
      error: 'checkout_incomplete',
      message: 'Square checkout is not complete. Card was not captured. Pay with Square, then return here.',
    });
  }

  const payment = fulfilled.payment || evidence.payments?.[0] || null;
  const subscription = evidence.subscription || null;
  const now = new Date().toISOString();
  const startedAt = existing.startedAt && existing.status !== 'checkout_pending' ? existing.startedAt : now;
  const amountCents = Number(payment?.amount_money?.amount) || fulfilled.amountCents || 0;
  const record = await saveSubscription({
    ...existing,
    userId: storeKey,
    authProvider: user.authProvider,
    cloudVersion: user.cloudVersion,
    email: user.email,
    status: 'trialing',
    trialDays: TRIAL_DAYS,
    priceMonthlyCents: existing.priceMonthlyCents || PRICE_MONTHLY_CENTS,
    startedAt,
    trialEndsAt: existing.trialEndsAt || trialEndsAtFrom(startedAt, TRIAL_DAYS),
    confirmedAt: now,
    createdAt: existing.createdAt || now,
    squareOrderId: existing.squareOrderId,
    squareSubscriptionId: subscription?.id || existing.squareSubscriptionId || null,
    squareCustomerId: subscription?.customer_id || payment?.customer_id || existing.squareCustomerId || null,
    lastPaymentId: payment?.id || existing.lastPaymentId || null,
    lastPaymentAmountCents: amountCents || existing.lastPaymentAmountCents || 0,
    firstPaidAt: amountCents > 0 ? (existing.firstPaidAt || now) : existing.firstPaidAt || null,
    fulfillmentVia: fulfilled.via,
  });

  return jsonResponse(200, {
    ok: true,
    access: deriveAccess(record),
    subscription: record,
    cloudVersion: user.cloudVersion,
    message: 'Trial started. Card is on file. Converts to paid subscription after 7 days unless canceled.',
  });
}
