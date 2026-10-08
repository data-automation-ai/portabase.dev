import { createHash } from 'node:crypto';

const hash = text => createHash('sha256').update(text).digest('hex');
const validOwner = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function canonicalProviderId(channel, value) {
  if (typeof value !== 'string') throw new Error('invalid_provider_id');
  const id = channel === 'email' && value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
  if ((channel === 'sms' && !/^SM[0-9a-fA-F]{32}$/.test(id))
    || (channel === 'email' && !/^[A-Za-z0-9._:@-]{1,510}$/.test(id))
    || !['email', 'sms'].includes(channel)) throw new Error('invalid_provider_id');
  return id;
}
export const providerReceiptIndexKey = (channel, providerId) => `provider-index/${channel}/${hash(canonicalProviderId(channel, providerId))}`;
const outboxKey = reference => {
  if (!validOwner(reference?.owner) || !validOwner(reference?.eventId) || !['email', 'sms'].includes(reference.channel)) throw new Error('invalid_receipt_reference');
  return `owners/${reference.owner}/outbox/${reference.eventId}/${reference.channel}`;
};
function verificationReference(reference) {
  if (reference?.purpose !== 'verification' || !validOwner(reference.owner)
    || !['email', 'sms'].includes(reference.channel) || !/^[a-f0-9-]{36}$/.test(reference.challengeId || '')) throw new Error('invalid_verification_reference');
  return { purpose: 'verification', owner: reference.owner, channel: reference.channel, challengeId: reference.challengeId };
}

/** Shared exclusive namespace prevents challenge IDs from shadowing alert IDs.
 * Receipt acknowledgment never verifies a destination or exposes alert history. */
export async function reserveVerificationReceiptIndex(store, reference, providerId) {
  const record = verificationReference({ ...reference, purpose: 'verification' });
  const key = providerReceiptIndexKey(record.channel, providerId);
  const result = await store.setJSON(key, record, { onlyIfNew: true });
  if (!result.modified) {
    const existing = (await store.getWithMetadata(key, { type: 'json' }))?.data;
    if (existing?.purpose !== record.purpose || existing.owner !== record.owner || existing.channel !== record.channel
      || existing.challengeId !== record.challengeId) throw new Error('provider_id_already_bound');
  }
}

/** Called only after a real transport returns its provider message identifier. */
export async function reserveReceiptIndex(store, reference, providerId) {
  outboxKey(reference);
  const key = providerReceiptIndexKey(reference.channel, providerId);
  const record = { owner: reference.owner, eventId: reference.eventId, channel: reference.channel };
  const result = await store.setJSON(key, record, { onlyIfNew: true });
  if (!result.modified) {
    const existing = await store.getWithMetadata(key, { type: 'json' });
    if (existing?.data.owner !== record.owner || existing.data.eventId !== record.eventId || existing.data.channel !== record.channel) throw new Error('provider_id_already_bound');
  }
}

export async function findReceiptTarget(store, channel, providerId) {
  const index = await store.getWithMetadata(providerReceiptIndexKey(channel, providerId), { type: 'json' });
  if (!index) return null;
  if (index.data.purpose === 'verification') verificationReference(index.data);
  else outboxKey(index.data);
  if (index.data.channel !== channel) throw new Error('receipt_index_channel_mismatch');
  return index.data;
}

/** Safe receipt facts only. No recipient, body or provider error is persisted. */
export async function applyDeliveryReceipt(store, { channel, providerId, status, receiptId, occurredAt }, now = Date.now()) {
  if (!['accepted', 'sent', 'delivered', 'failed'].includes(status) || typeof receiptId !== 'string' || receiptId.length > 512
    || !Number.isFinite(Date.parse(occurredAt))) throw new Error('invalid_delivery_receipt');
  const reference = await findReceiptTarget(store, channel, providerId);
  if (!reference) return { applied: false, reason: 'unmapped' };
  if (reference.purpose === 'verification') return { applied: false, reason: 'verification_message' };
  const key = outboxKey(reference), receiptHash = hash(receiptId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await store.getWithMetadata(key, { type: 'json' });
    const row = snapshot?.data;
    if (!row || row.owner !== reference.owner || row.eventId !== reference.eventId || row.channel !== channel) throw new Error('receipt_owner_mismatch');
    if (!['sending', 'accepted', 'unknown'].includes(row.state)) return { applied: false, reason: 'not_dispatched' };
    if (row.providerId && canonicalProviderId(channel, row.providerId) !== canonicalProviderId(channel, providerId)) throw new Error('receipt_provider_mismatch');
    if (row.receiptHashes?.includes(receiptHash)) return { applied: false, reason: 'duplicate' };
    const prior = row.deliveryStatus || 'accepted';
    const rank = { accepted: 0, sent: 1, delivered: 2, failed: 2, conflicted: 3 };
    const conflict = ['delivered', 'failed'].includes(prior) && ['delivered', 'failed'].includes(status) && prior !== status;
    const nextStatus = conflict ? 'conflicted' : rank[status] > rank[prior] ? status : prior;
    const next = { ...row, deliveryStatus: nextStatus,
      receiptHashes: [...(row.receiptHashes || []), receiptHash].slice(-32),
      lastReceiptAt: new Date(now).toISOString(),
      ...(status === 'delivered' && !row.providerDeliveredAt ? { providerDeliveredAt: occurredAt } : {}),
      ...(status === 'failed' && !row.providerFailedAt ? { providerFailedAt: occurredAt } : {}),
    };
    const result = await store.setJSON(key, next, { onlyIfMatch: snapshot.etag });
    if (result.modified) return { applied: true, status: nextStatus };
  }
  throw new Error('receipt_state_changed');
}
