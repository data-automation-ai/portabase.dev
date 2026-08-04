import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { PRICE_MONTHLY_CENTS, TRIAL_DAYS } from '../shared/square-cloud.mjs';
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

  const now = new Date().toISOString();
  const startedAt = now;
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
    trialEndsAt: trialEndsAtFrom(startedAt, TRIAL_DAYS),
    confirmedAt: now,
    createdAt: existing.createdAt || now,
  });

  return jsonResponse(200, {
    ok: true,
    access: deriveAccess(record),
    subscription: record,
    cloudVersion: user.cloudVersion,
    message: 'Trial started. Card is on file. Converts to paid subscription after 7 days unless canceled.',
  });
}
