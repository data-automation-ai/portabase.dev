import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const NOTIFICATION_BUDGET_STORE = 'portabase-notification-budgets';
export function validateNotificationLimits(limits) {
  if (!Number.isSafeInteger(limits?.attempts) || limits.attempts < 1 || limits.attempts > 1000
    || !Number.isSafeInteger(limits?.sends) || limits.sends < 1 || limits.sends > limits.attempts) throw new Error('invalid_notification_limits');
  return limits;
}
function key(owner, channel, day) {
  if (!/^[a-f0-9]{64}$/.test(owner || '') || !['email', 'sms'].includes(channel) || !/^\d{4}-\d\d-\d\d$/.test(day || '')) throw new Error('invalid_notification_budget');
  return `owners/${owner}/daily/${day}/${channel}`;
}
function validate(row, owner, channel, day) {
  if (row && (row.owner !== owner || row.channel !== channel || row.day !== day || !Array.isArray(row.reservations)
    || row.reservations.length > 1000 || row.reservations.some(item => !/^[a-f0-9-]{36}$/.test(item.id || '') || !['reserved', 'accepted', 'rejected', 'unknown'].includes(item.state)))) throw new Error('invalid_notification_budget_record');
}

/** Reserve before dispatch. Crashes and ambiguous outcomes keep send capacity consumed. */
export function createNotificationBudget({ store = () => getStore({ name: NOTIFICATION_BUDGET_STORE, consistency: 'strong' }), clock = Date.now } = {}) {
  const db = () => typeof store === 'function' ? store() : store;
  return {
    async reserve(owner, channel, limits) {
      validateNotificationLimits(limits);
      const day = new Date(clock()).toISOString().slice(0, 10);
      const path = key(owner, channel, day);
      for (let attempt = 0; attempt < 12; attempt++) {
        const current = await db().getWithMetadata(path, { type: 'json' });
        validate(current?.data, owner, channel, day);
        const reservations = current?.data?.reservations || [];
        if (reservations.length >= limits.attempts || reservations.filter(row => row.state !== 'rejected').length >= limits.sends) return null;
        const id = randomUUID();
        const record = { owner, channel, day, reservations: [...reservations, { id, state: 'reserved' }] };
        const result = await db().setJSON(path, record, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
        if (result.modified) return { owner, channel, day, id };
      }
      throw new Error('notification_budget_contention');
    },
    async settle(reservation, outcome) {
      const { owner, channel, day, id } = reservation;
      if (!['accepted', 'rejected', 'unknown'].includes(outcome)) throw new Error('invalid_notification_budget_outcome');
      const path = key(owner, channel, day);
      for (let attempt = 0; attempt < 12; attempt++) {
        const current = await db().getWithMetadata(path, { type: 'json' });
        validate(current?.data, owner, channel, day);
        const entry = current?.data?.reservations.find(row => row.id === id);
        if (!entry) throw new Error('notification_budget_reservation_missing');
        if (entry.state !== 'reserved') return; // settled/ambiguous reservations cannot be refunded later
        const record = { ...current.data, reservations: current.data.reservations.map(row => row.id === id ? { id, state: outcome } : row) };
        const result = await db().setJSON(path, record, { onlyIfMatch: current.etag });
        if (result.modified) return;
      }
      throw new Error('notification_budget_contention');
    },
  };
}
