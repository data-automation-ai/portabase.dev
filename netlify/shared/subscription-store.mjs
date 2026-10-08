import { getStore } from '@netlify/blobs';

const STORE = 'portabase-cloud-subscriptions';

function store() {
  return getStore({ name: STORE, consistency: 'strong' });
}

/** Primary key is Supabase auth user id (uuid). */
export async function getSubscriptionByUserId(userId, database = store()) {
  if (!userId) return null;
  return database.get(`user:${userId}`, { type: 'json' });
}

/** @deprecated use getSubscriptionByUserId */
export async function getSubscriptionBySub(userId) {
  return getSubscriptionByUserId(userId);
}

export async function saveSubscription(record, database = store()) {
  const userId = record.userId || record.supabaseUserId || record.cognitoSub;
  if (!userId) throw new Error('missing_user_id');
  const previous = await database.getWithMetadata(`user:${userId}`, { type: 'json' });
  if ((record.revision || 0) !== (previous?.data?.revision || 0)) throw Object.assign(new Error('subscription_changed'), { status: 409 });
  const next = {
    ...record,
    userId,
    supabaseUserId: record.supabaseUserId || userId,
    authProvider: record.authProvider || 'supabase',
    updatedAt: new Date().toISOString(),
    revision: (previous?.data?.revision || 0) + 1,
  };
  // A provider identity belongs to exactly one application account. Reserve it
  // before updating the account so a concurrent claimant can never gain access.
  for (const [prefix, id] of [
    ['square-sub', record.squareSubscriptionId], ['square-sub', record.squareAddonSubscriptionId],
    ['square-order', record.squareOrderId], ['square-order', record.squareAddonOrderId],
    ['attempt', record.checkoutAttempt],
  ]) {
    if (!id) continue;
    const key = `${prefix}:${id}`;
    const result = await database.setJSON(key, { userId }, { onlyIfNew: true });
    if (!result.modified) {
      const owner = await database.get(key, { type: 'json' });
      if (owner?.userId !== userId) throw Object.assign(new Error('billing_identity_conflict'), { status: 409 });
    }
  }
  const write = await database.setJSON(`user:${userId}`, next, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!write.modified) throw Object.assign(new Error('subscription_changed'), { status: 409 });
  return next;
}

/** Authenticated endpoints must never fall back to legacy, provider-ambiguous IDs. */
export async function getSubscriptionForUser(user, lookup = getSubscriptionByUserId) {
  if (!['supabase', 'aws'].includes(user?.cloudVersion) || typeof user.id !== 'string' || !user.id) throw new Error('invalid_subscription_identity');
  const key = `${user.cloudVersion}:${user.id}`;
  const record = await lookup(key);
  if (record && record.userId !== key) throw new Error('subscription_identity_mismatch');
  return record;
}

// Provider cancellation/refund may race a background reconciliation. Persist
// closure against the latest revision, but never close a replacement checkout.
export async function closeSubscription(record, patch, database = store()) {
  if (!['closed', 'refunded', 'canceled'].includes(patch.status)) throw new Error('invalid_closure');
  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await getSubscriptionByUserId(record.userId, database);
    if (!latest || latest.checkoutAttempt !== record.checkoutAttempt || latest.squareOrderId !== record.squareOrderId) {
      throw Object.assign(new Error('checkout_changed'), { status: 409 });
    }
    try { return await saveSubscription({ ...latest, ...patch }, database); }
    catch (error) { if (error.message !== 'subscription_changed') throw error; }
  }
  throw Object.assign(new Error('subscription_changed'), { status: 409 });
}

export async function getUserIdBySquareOrder(orderId, database = store()) {
  if (!orderId) return null;
  const row = await database.get(`square-order:${orderId}`, { type: 'json' });
  return row?.userId || row?.cognitoSub || null;
}

export async function getUserIdBySquareSubscription(subscriptionId, database = store()) {
  if (!subscriptionId) return null;
  const row = await database.get(`square-sub:${subscriptionId}`, { type: 'json' });
  return row?.userId || row?.cognitoSub || null;
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

export function deriveAccess(record, now = new Date()) {
  if (!record) return { status: 'none', hasAccess: false, label: 'No subscription' };
  const status = String(record.status || 'none');
  const verified = record.verifiedBy === 'square_api' && Boolean(record.squareSubscriptionId)
    && Number.isFinite(Date.parse(record.squareVerifiedAt)) && Date.parse(record.squareVerifiedAt) <= Number(now);
  const until = status === 'trialing' ? record.trialEndsAt : record.currentPeriodEnd;
  const active = verified && ['trialing', 'active'].includes(status) && Date.parse(until) > Number(now);
  return {
    status,
    hasAccess: active,
    label:
      status === 'trialing' ? '7-day trial'
        : status === 'active' ? 'Active subscription'
          : status === 'past_due' ? 'Past due'
            : status === 'payment_refunded' ? 'Current invoice refunded'
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
