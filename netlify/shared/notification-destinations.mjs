import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { ownerKey } from './agent-store.mjs';
import { reserveVerificationReceiptIndex } from './notification-receipt-store.mjs';

export const NOTIFICATION_DESTINATION_STORE = 'portabase-notification-destinations';
const channels = new Set(['email', 'sms']);
const TEN_MINUTES = 600_000;
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
const hashCode = (code, salt) => scryptSync(code, salt, 32).toString('hex');
const challengeSalt = (row, challenge) => JSON.stringify([row.owner, row.channel, row.address,
  challenge.id, challenge.destinationRevision, challenge.salt]);
const destinationStore = () => getStore({ name: NOTIFICATION_DESTINATION_STORE, consistency: 'strong' });
const stamp = now => new Date(now).toISOString();

export function notificationDestinationKey(owner, channel) {
  if (!/^[a-f0-9]{64}$/.test(owner || '') || !channels.has(channel)) throw fail('invalid_destination');
  return `owners/${owner}/destinations/${channel}`;
}
function candidateAddress(user, channel, phone) {
  if (channel === 'email') {
    const email = user.email;
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) throw fail('account_contact_missing', 409);
    return email.toLowerCase();
  }
  if (channel !== 'sms' || typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone)) throw fail('invalid_phone');
  return phone;
}
function publicDestination(record) {
  if (!record) return { verified: false, revision: 0, addressHint: null };
  const hint = record.channel === 'sms' ? `••••${record.address?.slice(-4) || ''}`
    : record.address ? `${record.address[0]}•••@${record.address.split('@')[1]}` : null;
  return { channel: record.channel, verified: Boolean(record.verifiedAt && !record.revokedAt),
    verifiedAt: record.verifiedAt || null, revokedAt: record.revokedAt || null,
    revision: record.revision, addressHint: hint };
}

/** Only explicit challenge proof creates a verified destination. Supabase flags
 * and user metadata never do. SMS candidate is intentionally supplied by the
 * customer, bounded per authenticated account/channel before any provider call.
 */
export function createNotificationDestinationService({ store = destinationStore, sendChallenge = null, clock = Date.now,
  receiptStore = () => getStore({ name: 'portabase-notification-outbox', consistency: 'strong' }) } = {}) {
  const db = () => typeof store === 'function' ? store() : store;
  async function read(owner, channel) {
    const snapshot = await db().getWithMetadata(notificationDestinationKey(owner, channel), { type: 'json' });
    if (snapshot && (snapshot.data.owner !== owner || snapshot.data.channel !== channel)) throw fail('destination_binding_mismatch', 503);
    return snapshot;
  }
  async function write(owner, channel, snapshot, record) {
    const result = await db().setJSON(notificationDestinationKey(owner, channel), record,
      snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true });
    if (!result.modified) throw fail('destination_changed', 409);
    return record;
  }
  async function request(user, channel, phone) {
    const owner = ownerKey(user);
    const address = candidateAddress(user, channel, phone);
    if (typeof sendChallenge !== 'function') throw fail('verification_delivery_unconfigured', 503);
    const current = await read(owner, channel);
    const now = clock();
    const history = (current?.data.requests || []).filter(time => Number.isFinite(time) && time > now - 86_400_000);
    if (history.length >= 5 || history.filter(time => time > now - 3600_000).length >= 3
      || history.some(time => time > now - 60_000)) throw fail('verification_rate_limited', 429);
    const id = randomUUID(), salt = randomBytes(16).toString('hex');
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const record = { owner, channel, id: current?.data.id || randomUUID(), address,
      revision: (current?.data.revision || 0) + 1, verifiedAt: null, revokedAt: stamp(now),
      requests: [...history, now], updatedAt: stamp(now),
      challenge: { id, hash: null, salt, attempts: 0, createdAt: stamp(now), expiresAt: now + TEN_MINUTES,
        destinationRevision: (current?.data.revision || 0) + 1, deliveryStatus: 'sending', usedAt: null } };
    record.challenge.hash = hashCode(code, challengeSalt(record, record.challenge));
    // Reserving the request first both enforces rate limits under concurrency
    // and immediately invalidates any previously verified address/revision.
    await write(owner, channel, current, record);
    let result;
    try {
      result = await sendChallenge({ channel, to: address, subject: 'Portabase: verify your notification destination',
        text: `Your Portabase verification code is ${code}. It expires in 10 minutes. Do not share this code.` });
    } catch { result = { status: 'unknown' }; }
    // Persist known provider identity even if the user revoked/replaced the
    // challenge during sending. No code, address or message body enters this index.
    if (result?.status === 'accepted') await reserveVerificationReceiptIndex(
      typeof receiptStore === 'function' ? receiptStore() : receiptStore,
      { owner, channel, challengeId: id }, result.providerId);
    const snapshot = await read(owner, channel);
    if (!snapshot || snapshot.data.challenge?.id !== id) throw fail('destination_changed', 409);
    const deliveryStatus = result?.status === 'accepted' ? 'accepted' : result?.status === 'rejected' ? 'rejected' : 'unknown';
    const next = { ...snapshot.data, challenge: { ...snapshot.data.challenge, deliveryStatus,
      ...(deliveryStatus === 'rejected' ? { hash: null, salt: null } : {}) } };
    await write(owner, channel, snapshot, next);
    return { channel, challengeId: id, expiresAt: stamp(now + TEN_MINUTES), deliveryStatus, destination: publicDestination(next) };
  }

  async function verify(user, channel, challengeId, code) {
    const owner = ownerKey(user);
    if (typeof challengeId !== 'string' || !/^[a-f0-9-]{36}$/.test(challengeId) || typeof code !== 'string' || !/^\d{8}$/.test(code)) throw fail('invalid_verification');
    const current = await read(owner, channel);
    const row = current?.data, challenge = row?.challenge;
    if (!challenge || challenge.id !== challengeId || challenge.usedAt || !challenge.hash
      || challenge.destinationRevision !== row.revision || challenge.expiresAt <= clock()) throw fail('verification_unavailable', 409);
    if (channel === 'email' && candidateAddress(user, channel) !== row.address) throw fail('account_contact_changed', 409);
    if (challenge.attempts >= 5) throw fail('verification_attempts_exhausted', 429);
    // Reserve an attempt before the intentionally expensive hash comparison.
    // Parallel guesses cannot each get five attempts or bypass this counter.
    await write(owner, channel, current, { ...row, challenge: { ...challenge, attempts: challenge.attempts + 1 } });
    const matches = timingSafeEqual(Buffer.from(hashCode(code, challengeSalt(row, challenge)), 'hex'), Buffer.from(challenge.hash, 'hex'));
    if (!matches) throw fail('incorrect_verification_code');
    const latest = await read(owner, channel);
    if (!latest || latest.data.challenge?.id !== challengeId || latest.data.challenge.usedAt
      || latest.data.revision !== row.revision || latest.data.challenge.expiresAt <= clock()) throw fail('verification_unavailable', 409);
    const verified = await write(owner, channel, latest, { ...latest.data, revision: latest.data.revision + 1,
      verifiedAt: stamp(clock()), revokedAt: null, updatedAt: stamp(clock()),
      challenge: { ...latest.data.challenge, hash: null, salt: null, usedAt: stamp(clock()) } });
    return publicDestination(verified);
  }

  async function revoke(user, channel) {
    const owner = ownerKey(user), current = await read(owner, channel);
    if (!current) return publicDestination(null);
    const record = await write(owner, channel, current, { ...current.data, revision: current.data.revision + 1,
      verifiedAt: null, revokedAt: stamp(clock()), challenge: null, updatedAt: stamp(clock()) });
    return publicDestination(record);
  }

  async function resolve(owner, channel) {
    const record = (await read(owner, channel))?.data;
    if (!record?.verifiedAt || record.revokedAt || !record.challenge?.usedAt) return null;
    return { owner, channel, id: record.id, revision: record.revision, address: record.address,
      verifiedAt: record.verifiedAt, revokedAt: null };
  }
  async function list(user) {
    const owner = ownerKey(user);
    return Object.fromEntries(await Promise.all([...channels].map(async channel => [channel, publicDestination((await read(owner, channel))?.data)])));
  }
  return { request, verify, revoke, resolve, list };
}

export const resolveNotificationDestination = (owner, channel) => createNotificationDestinationService().resolve(owner, channel);
