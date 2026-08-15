import { getStore } from '@netlify/blobs';

const STORE = 'portabase-cloud-subscriptions';

function store() {
  return getStore({ name: STORE, consistency: 'strong' });
}

/** Primary key is Supabase auth user id (uuid). */
export async function getSubscriptionByUserId(userId) {
  if (!userId) return null;
  try {
    return await store().get(`user:${userId}`, { type: 'json' });
  } catch {
    return null;
  }
}

/** @deprecated use getSubscriptionByUserId */
export async function getSubscriptionBySub(userId) {
  return getSubscriptionByUserId(userId);
}

export async function saveSubscription(record) {
  const userId = record.userId || record.supabaseUserId || record.cognitoSub;
  if (!userId) throw new Error('missing_user_id');
  const next = {
    ...record,
    userId,
    supabaseUserId: record.supabaseUserId || userId,
    authProvider: record.authProvider || 'supabase',
    updatedAt: new Date().toISOString(),
  };
  await store().setJSON(`user:${userId}`, next);
  if (record.squareSubscriptionId) {
    await store().setJSON(`square-sub:${record.squareSubscriptionId}`, { userId });
  }
  if (record.squareOrderId) {
    await store().setJSON(`square-order:${record.squareOrderId}`, { userId });
  }
  if (record.checkoutAttempt) {
    await store().setJSON(`attempt:${record.checkoutAttempt}`, { userId });
  }
  return next;
}

export async function getUserIdBySquareOrder(orderId) {
  if (!orderId) return null;
  try {
    const row = await store().get(`square-order:${orderId}`, { type: 'json' });
    return row?.userId || row?.cognitoSub || null;
  } catch {
    return null;
  }
}

export async function getUserIdBySquareSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  try {
    const row = await store().get(`square-sub:${subscriptionId}`, { type: 'json' });
    return row?.userId || row?.cognitoSub || null;
  } catch {
    return null;
  }
}

/** @deprecated */
export async function getCognitoSubBySquareOrder(orderId) {
  return getUserIdBySquareOrder(orderId);
}

/** @deprecated */
export async function getCognitoSubBySquareSubscription(subscriptionId) {
  return getUserIdBySquareSubscription(subscriptionId);
}

export function trialEndsAtFrom(startIso, days = 7) {
  const start = startIso ? new Date(startIso) : new Date();
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function moneyBackEligible(record, now = new Date(), windowDays = 7) {
  if (!record) return { ok: false, reason: 'no_subscription' };
  const status = String(record.status || 'none');
  if (['refunded', 'closed', 'canceled'].includes(status)) {
    return { ok: false, reason: 'already_closed' };
  }
  if (!['trialing', 'active', 'past_due'].includes(status)) {
    return { ok: false, reason: 'not_active' };
  }
  if (status === 'trialing') {
    return { ok: true, reason: 'trial', refundExpectedCents: 0 };
  }
  const paidAt = record.firstPaidAt || record.startedAt;
  if (!paidAt) return { ok: false, reason: 'no_paid_timestamp' };
  const deadline = new Date(paidAt).getTime() + windowDays * 24 * 60 * 60 * 1000;
  if (now.getTime() > deadline) return { ok: false, reason: 'window_closed' };
  return {
    ok: true,
    reason: 'paid_window',
    refundExpectedCents: Number(record.lastPaymentAmountCents) || 0,
    deadline: new Date(deadline).toISOString(),
  };
}

export function deriveAccess(record) {
  if (!record) return { status: 'none', hasAccess: false, label: 'No subscription' };
  const status = String(record.status || 'none');
  const active = ['trialing', 'active', 'past_due'].includes(status);
  return {
    status,
    hasAccess: active,
    label:
      status === 'trialing' ? '7-day trial'
        : status === 'active' ? 'Active subscription'
          : status === 'past_due' ? 'Past due'
            : status === 'canceled' ? 'Canceled'
              : status === 'refunded' ? 'Refunded · closed'
                : status === 'closed' ? 'Closed'
              : status === 'checkout_pending' ? 'Checkout pending'
                : 'No subscription',
    trialEndsAt: record.trialEndsAt || null,
    currentPeriodEnd: record.currentPeriodEnd || null,
    priceMonthlyCents: record.priceMonthlyCents || 1700,
    moneyBack: moneyBackEligible(record),
  };
}
