import { createHash, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { authenticateAgent, listAgents } from './agent-store.mjs';
import { safeCloudEvent, CLOUD_EVENT_MAX_AGE_MS } from './safe-telemetry.mjs';
import { notificationMessage } from './notification-message.mjs';
import { reserveReceiptIndex } from './notification-receipt-store.mjs';
import { resolveNotificationDestination } from './notification-destinations.mjs';

export const NOTIFICATION_OUTBOX_STORE = 'portabase-notification-outbox';
const channels = new Set(['email', 'sms']);
const hash = value => createHash('sha256').update(value).digest('hex');
const ownerValid = owner => typeof owner === 'string' && /^[a-f0-9]{64}$/.test(owner);
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const providerIdValid = value => typeof value === 'string' && /^[A-Za-z0-9._:@<>-]{1,512}$/.test(value);
const conflict = () => Object.assign(new Error('notification_state_changed'), { status: 409 });
const iso = now => new Date(now).toISOString();

export function notificationKey({ owner, eventId, channel }) {
  if (!ownerValid(owner) || !/^[a-f0-9]{64}$/.test(eventId || '') || !channels.has(channel)) throw new Error('invalid_notification_reference');
  return `owners/${owner}/outbox/${eventId}/${channel}`;
}

// Retry identity deliberately excludes error text, payload and recipient. Agents
// must retain the original occurredAt on retries. Equal agent/type/time reports
// coalesce; a future sender event UUID can replace this identity when available.
export function notificationEventId(agent, event) {
  if (!ownerValid(agent?.owner) || !opaque(agent?.id) || event?.agentId !== agent.id
    || event?.projectRef !== agent.projectRef || !Number.isFinite(Date.parse(event?.occurredAt))) throw new Error('invalid_notification_binding');
  return hash(JSON.stringify([agent.owner, agent.id, event.eventType, event.occurredAt]));
}

/**
 * Server-only durable outbox. Destination resolver must return an owner-bound
 * verified record: {owner, channel, id, revision, address, verifiedAt, revokedAt}.
 * Addresses exist only in memory at dispatch. No default transport is provided.
 *
 * Transport receives {channel,to,subject,text,idempotencyKey}; returns
 * {status:'accepted',providerId}, {status:'rejected',retryable}, or {status:'unknown'}.
 * Acceptance is NOT delivery. An idempotency key is advisory until supported by
 * the actual provider. Timeouts/crashes after sending require reconciliation,
 * never blind retry or an exactly-once claim.
 */
export function createNotificationOutbox({
  store = () => getStore({ name: NOTIFICATION_OUTBOX_STORE, consistency: 'strong' }),
  authenticate = authenticateAgent,
  agentActive = async (owner, id) => (await listAgents(owner)).some(row => row.id === id && !row.revokedAt),
  getPreferences = owner => getStore({ name: 'portabase-notification-preferences', consistency: 'strong' }).get(`owners/${owner}`, { type: 'json' }),
  getDestination = resolveNotificationDestination,
  clock = Date.now, leaseMs = 60_000, maxAttempts = 5,
} = {}) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000
    || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('invalid_outbox_options');
  const db = () => typeof store === 'function' ? store() : store;

  async function currentPermission(record) {
    if (clock() - Date.parse(record.occurredAt) > CLOUD_EVENT_MAX_AGE_MS) return null;
    const prefs = await getPreferences(record.owner);
    if (prefs?.owner !== record.owner || !Number.isSafeInteger(prefs.revision) || prefs.revision < 1
      || !notificationMessage({ eventType: record.eventType }, prefs.preferences?.[record.channel])) return null;
    if (!await agentActive(record.owner, record.agentId)) return null;
    const destination = await getDestination(record.owner, record.channel);
    if (destination?.owner !== record.owner || destination.channel !== record.channel
      || !opaque(destination.id) || !Number.isSafeInteger(destination.revision) || destination.revision < 1
      || typeof destination.address !== 'string' || !destination.address || destination.address.length > 320
      || /[\r\n]/.test(destination.address) || destination.revokedAt
      || !Number.isFinite(Date.parse(destination.verifiedAt)) || Date.parse(destination.verifiedAt) > clock()) return null;
    return { destination, consentRevision: prefs.revision };
  }

  async function read(reference) {
    const snapshot = await db().getWithMetadata(notificationKey(reference), { type: 'json' });
    if (!snapshot) return null;
    const row = snapshot.data;
    if (row.owner !== reference.owner || row.eventId !== reference.eventId || row.channel !== reference.channel) throw new Error('notification_binding_mismatch');
    return snapshot;
  }
  async function write(reference, snapshot, patch) {
    const row = { ...snapshot.data, ...patch, updatedAt: iso(clock()) };
    const result = await db().setJSON(notificationKey(reference), row, { onlyIfMatch: snapshot.etag });
    if (!result.modified) throw conflict();
    return row;
  }
  const samePermission = (row, permission) => permission && permission.consentRevision === row.consentRevision
    && permission.destination.id === row.destinationId && permission.destination.revision === row.destinationRevision;

  async function enqueue({ authorization, input, sourceJobId, expectedOwner, expectedAgentId }) {
    const agent = await authenticate(authorization);
    if (!agent || agent.revokedAt || !ownerValid(agent.owner)) throw Object.assign(new Error('unauthorized_agent'), { status: 401 });
    // Only server job completion code supplies this separate argument. The
    // telemetry HTTP handler never accepts it from an event body. Bind it to the
    // same authenticated owner/runner and distinguish simultaneous jobs.
    if (sourceJobId !== undefined && (typeof sourceJobId !== 'string' || !/^job_[A-Za-z0-9_-]{1,76}$/.test(sourceJobId)
      || expectedOwner !== agent.owner || expectedAgentId !== agent.id)) throw new Error('invalid_notification_job_binding');
    const occurred = Date.parse(input?.occurredAt), now = clock();
    const overdueCompletion = sourceJobId !== undefined && Number.isFinite(occurred) && now - occurred > CLOUD_EVENT_MAX_AGE_MS;
    // Only a trusted server completion can reconcile beyond the public event
    // age window. Keep its real timestamp and permanently suppress overdue alerts.
    const event = safeCloudEvent(input, agent, overdueCompletion ? occurred : now);
    if (!notificationMessage(event, { onFailure: true, onSuccess: true })) return [];
    const eventId = sourceJobId === undefined ? notificationEventId(agent, event)
      : hash(JSON.stringify(['owned-job-completion', agent.owner, agent.id, sourceJobId]));
    const references = [];
    for (const channel of channels) {
      const reference = { owner: agent.owner, eventId, channel };
      const existing = await read(reference);
      if (existing) { references.push({ ...reference, state: existing.data.state, created: false }); continue; }
      const base = { ...reference, agentId: agent.id, eventType: event.eventType, occurredAt: event.occurredAt };
      const permission = overdueCompletion ? null : await currentPermission(base);
      const record = { ...base, state: permission ? 'pending' : 'suppressed', attempts: 0,
        createdAt: iso(clock()), updatedAt: iso(clock()), availableAt: clock(),
        ...(overdueCompletion ? { reason: 'completion_too_old' } : {}),
        consentRevision: permission?.consentRevision ?? null,
        destinationId: permission?.destination.id ?? null, destinationRevision: permission?.destination.revision ?? null };
      const saved = await db().setJSON(notificationKey(reference), record, { onlyIfNew: true });
      const result = saved.modified ? record : (await read(reference)).data;
      references.push({ ...reference, state: result.state, created: saved.modified });
    }
    return references;
  }

  async function claim(reference) {
    const snapshot = await read(reference);
    if (!snapshot) return null;
    const row = snapshot.data;
    if (row.state === 'sending' && row.leaseUntil <= clock()) {
      await write(reference, snapshot, { state: 'unknown', reason: 'lease_expired_during_send', leaseToken: null, leaseUntil: null });
      return null;
    }
    const eligible = row.state === 'pending' || (row.state === 'leased' && row.leaseUntil <= clock());
    if (!eligible || row.availableAt > clock()) return null;
    const permission = await currentPermission(row);
    if (!samePermission(row, permission)) {
      await write(reference, snapshot, { state: 'suppressed', reason: 'consent_or_destination_changed', leaseToken: null, leaseUntil: null });
      return null;
    }
    const leaseToken = randomUUID();
    await write(reference, snapshot, { state: 'leased', leaseToken, leaseUntil: clock() + leaseMs });
    return { ...reference, leaseToken };
  }

  async function deliver(lease, transport) {
    if (typeof transport !== 'function') throw new Error('notification_transport_required');
    let snapshot = await read(lease);
    if (!snapshot || snapshot.data.state !== 'leased' || snapshot.data.leaseToken !== lease.leaseToken || snapshot.data.leaseUntil <= clock()) throw conflict();
    const row = snapshot.data;
    const permission = await currentPermission(row);
    if (!samePermission(row, permission)) return write(lease, snapshot, { state: 'suppressed', reason: 'consent_or_destination_changed', leaseToken: null, leaseUntil: null });
    const message = notificationMessage({ eventType: row.eventType }, { onFailure: true, onSuccess: true });
    if (!message) throw new Error('invalid_notification_message');
    // Persist before any provider call. If the process disappears from here on,
    // lease expiry records UNKNOWN rather than automatically submitting again.
    await write(lease, snapshot, { state: 'sending', attempts: row.attempts + 1, sendingAt: iso(clock()) });
    // Recheck after the durable transition as well: an opt-out or recipient
    // change while the write was in flight must stop this dispatch.
    const dispatchPermission = await currentPermission(row);
    if (!samePermission(row, dispatchPermission)) {
      snapshot = await read(lease);
      if (!snapshot || snapshot.data.state !== 'sending' || snapshot.data.leaseToken !== lease.leaseToken) throw conflict();
      return write(lease, snapshot, { state: 'suppressed', reason: 'consent_or_destination_changed', leaseToken: null, leaseUntil: null });
    }
    snapshot = await read(lease);
    if (!snapshot || snapshot.data.state !== 'sending' || snapshot.data.leaseToken !== lease.leaseToken) throw conflict();
    if (snapshot.data.leaseUntil <= clock()) {
      // This process knows it has not invoked the provider. Other workers only
      // see 'sending' and conservatively record unknown after lease expiry.
      return write(lease, snapshot, { state: 'pending', reason: 'lease_expired_before_dispatch', availableAt: clock(), leaseToken: null, leaseUntil: null });
    }
    let result;
    try {
      result = await transport({ channel: row.channel, to: dispatchPermission.destination.address,
        subject: message.subject, text: message.text, idempotencyKey: `${row.eventId}:${row.channel}` });
    } catch { result = { status: 'unknown' }; }
    snapshot = await read(lease);
    if (!snapshot || snapshot.data.state !== 'sending' || snapshot.data.leaseToken !== lease.leaseToken) throw conflict();
    const patch = { leaseToken: null, leaseUntil: null };
    if (result?.status === 'accepted' && providerIdValid(result.providerId)) {
      await reserveReceiptIndex(db(), row, result.providerId);
      Object.assign(patch, { state: 'accepted', providerId: result.providerId, acceptedAt: iso(clock()) });
    } else if (result?.status === 'rejected' && typeof result.retryable === 'boolean') {
      const retry = result.retryable && snapshot.data.attempts < maxAttempts;
      Object.assign(patch, { state: retry ? 'pending' : 'rejected', reason: retry ? 'provider_rejected_retryable' : 'provider_rejected',
        availableAt: clock() + Math.min(3600_000, 30_000 * 2 ** (snapshot.data.attempts - 1)) });
    } else Object.assign(patch, { state: 'unknown', reason: 'provider_outcome_unknown' });
    // Receipt callbacks may race this write after the index is reserved. Merge
    // their facts rather than overwriting a verified delivery with acceptance.
    for (let attempt = 0; attempt < 4; attempt++) {
      snapshot = await read(lease);
      if (!snapshot || snapshot.data.state !== 'sending' || snapshot.data.leaseToken !== lease.leaseToken) throw conflict();
      try { return await write(lease, snapshot, patch); }
      catch (error) { if (error.status !== 409) throw error; }
    }
    throw conflict();
  }

  return { enqueue, claim, deliver, get: async reference => (await read(reference))?.data || null };
}
