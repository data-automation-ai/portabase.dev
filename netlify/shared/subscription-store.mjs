import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getStore } from '@netlify/blobs';

const STORE = 'portabase-cloud-subscriptions';

// Local disk-backed fallback store when Netlify Blobs environment is absent
const localStoreFile = path.join(os.tmpdir(), '.portabase-local-cloud-store.json');
const memoryStorage = new Map();
let memoryRevision = 0;

function loadLocalStoreFromDisk() {
  try {
    if (fs.existsSync(localStoreFile)) {
      const raw = fs.readFileSync(localStoreFile, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          memoryStorage.set(k, v);
        }
      }
    }
  } catch {
    // ignore
  }
}

function persistLocalStoreToDisk() {
  try {
    const obj = Object.fromEntries(memoryStorage.entries());
    fs.writeFileSync(localStoreFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

loadLocalStoreFromDisk();

export function createLocalFallbackStore(name = STORE) {
  return {
    async get(key, options = {}) {
      loadLocalStoreFromDisk();
      const scopedKey = `${name}:${key}`;
      const entry = memoryStorage.get(scopedKey) ?? memoryStorage.get(key);
      if (!entry) return null;
      return options?.type === 'json' ? structuredClone(entry.data) : entry.data;
    },
    async getWithMetadata(key, options = {}) {
      loadLocalStoreFromDisk();
      const scopedKey = `${name}:${key}`;
      const entry = memoryStorage.get(scopedKey) ?? memoryStorage.get(key);
      if (!entry) return null;
      return {
        data: options?.type === 'json' ? structuredClone(entry.data) : entry.data,
        etag: entry.etag,
        metadata: entry.metadata || {},
      };
    },
    async setJSON(key, data, options = {}) {
      loadLocalStoreFromDisk();
      const scopedKey = `${name}:${key}`;
      const old = memoryStorage.get(scopedKey) ?? memoryStorage.get(key);
      if (options?.onlyIfNew && old) return { modified: false };
      if (options?.onlyIfMatch && old?.etag !== options.onlyIfMatch) return { modified: false };
      const nextEtag = String(++memoryRevision);
      const entry = { data: structuredClone(data), etag: nextEtag, updatedAt: new Date().toISOString() };
      memoryStorage.set(scopedKey, entry);
      persistLocalStoreToDisk();
      return { modified: true, etag: nextEtag };
    },
    async set(key, data, options = {}) {
      loadLocalStoreFromDisk();
      const scopedKey = `${name}:${key}`;
      const old = memoryStorage.get(scopedKey) ?? memoryStorage.get(key);
      if (options?.onlyIfNew && old) return { modified: false };
      if (options?.onlyIfMatch && old?.etag !== options.onlyIfMatch) return { modified: false };
      const nextEtag = String(++memoryRevision);
      const entry = { data, etag: nextEtag, updatedAt: new Date().toISOString() };
      memoryStorage.set(scopedKey, entry);
      persistLocalStoreToDisk();
      return { modified: true, etag: nextEtag };
    },
    async delete(key) {
      loadLocalStoreFromDisk();
      const scopedKey = `${name}:${key}`;
      memoryStorage.delete(scopedKey);
      memoryStorage.delete(key);
      persistLocalStoreToDisk();
      return true;
    },
  };
}

export function store(name = STORE) {
  const hasBlobsEnv = Boolean(
    process.env.NETLIFY_BLOBS_CONTEXT
    || (process.env.NETLIFY_BLOBS_TOKEN && process.env.NETLIFY_BLOBS_SITE_ID)
  );
  if (!hasBlobsEnv) {
    return createLocalFallbackStore(name);
  }
  try {
    const realStore = getStore({ name, consistency: 'strong' });
    const fallback = createLocalFallbackStore(name);
    return new Proxy(realStore, {
      get(target, prop) {
        const orig = target[prop];
        if (typeof orig === 'function') {
          return async (...args) => {
            try {
              return await orig.apply(target, args);
            } catch (err) {
              if (err.name === 'MissingBlobsEnvironmentError' || /environment has not been configured/i.test(err.message)) {
                return fallback[prop](...args);
              }
              throw err;
            }
          };
        }
        return orig;
      },
    });
  } catch {
    return createLocalFallbackStore(name);
  }
}

/** Primary key is Supabase auth user id (uuid). */
export async function getSubscriptionByUserId(userId, database = store()) {
  if (!userId) return null;
  return database.get(`user:${userId}`, { type: 'json' });
}

export async function getSubscriptionByUserIdStrict(userId, database = store()) {
  const record = await getSubscriptionByUserId(userId, database);
  if (!record) {
    const err = new Error('subscription_not_found');
    err.status = 404;
    throw err;
  }
  return record;
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

export async function putSubscriptionForUser(user, patch, database = store()) {
  if (!['supabase', 'aws'].includes(user?.cloudVersion) || typeof user.id !== 'string' || !user.id) {
    throw new Error('invalid_subscription_identity');
  }
  const key = `${user.cloudVersion}:${user.id}`;
  const existing = await getSubscriptionByUserId(key, database);
  const record = {
    ...(existing || {}),
    ...patch,
    userId: key,
    supabaseUserId: user.cloudVersion === 'supabase' ? user.id : (patch?.supabaseUserId || null),
    cognitoSub: user.cloudVersion === 'aws' ? user.id : (patch?.cognitoSub || null),
    authProvider: user.authProvider || 'supabase',
    cloudVersion: user.cloudVersion || 'supabase',
  };
  return saveSubscription(record, database);
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

export function moneyBackEligible(record, now = new Date(), windowDays = 8) {
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
  const paidMs = new Date(paidAt).getTime();
  const nowMs = now.getTime();
  const deadline = paidMs + windowDays * 24 * 60 * 60 * 1000;
  const fullCents = Number(record.lastPaymentAmountCents || record.priceMonthlyCents) || 0;
  if (nowMs <= deadline) {
    return {
      ok: true,
      reason: 'paid_window',
      refundExpectedCents: Number(record.lastPaymentAmountCents) || 0,
      deadline: new Date(deadline).toISOString(),
    };
  }
  const periodEndMs = record.currentPeriodEnd ? Date.parse(record.currentPeriodEnd) : NaN;
  if (Number.isFinite(periodEndMs) && periodEndMs > nowMs && fullCents > 0) {
    const cycleMs = Math.max(24 * 60 * 60 * 1000, periodEndMs - paidMs);
    const remainingFraction = Math.min(1, Math.max(0, (periodEndMs - nowMs) / cycleMs));
    const proratedCents = Math.max(1, Math.floor(fullCents * remainingFraction));
    return {
      ok: true,
      reason: 'prorated_window',
      refundExpectedCents: proratedCents,
      deadline: new Date(periodEndMs).toISOString(),
    };
  }
  return { ok: false, reason: 'window_closed' };
}

export function deriveAccess(record, now = new Date()) {
  if (!record) return { status: 'none', hasAccess: false, label: 'No subscription' };
  const status = String(record.status || 'none');
  const nowMs = Number(now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now));

  const promoVerified = (record.verifiedBy === 'promo_code' || record.paymentGateway === 'promo_code' || record.paymentGateway === 'test_promo' || record.status === 'testing')
    && Boolean(record.promoCode || record.testPromoRedeemedAt);
  const until = record.testAccessEndsAt || record.currentPeriodEnd || record.trialEndsAt;

  if (promoVerified && until && Date.parse(until) > nowMs) {
    const planId = record.planId || record.plan || 'cloud-7';
    return {
      status,
      hasAccess: true,
      trialActive: status === 'trialing',
      planId,
      until,
      label: record.promoCode ? `Promo tier (${record.promoCode})` : 'Free usage tier',
      trialEndsAt: record.trialEndsAt || null,
      currentPeriodEnd: record.currentPeriodEnd || until,
      priceMonthlyCents: record.priceMonthlyCents ?? 0,
      moneyBackEligible: false,
      moneyBack: { ok: false, reason: 'promo_free_usage' },
    };
  }

  const verified = record.verifiedBy === 'square_api' && Boolean(record.squareSubscriptionId)
    && Number.isFinite(Date.parse(record.squareVerifiedAt)) && Date.parse(record.squareVerifiedAt) <= nowMs;
  const regularUntil = status === 'trialing' ? record.trialEndsAt : record.currentPeriodEnd;
  const active = verified && ['trialing', 'active'].includes(status) && Date.parse(regularUntil) > nowMs;
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
    moneyBack: moneyBackEligible(record, now instanceof Date ? now : new Date(now)),
  };
}
