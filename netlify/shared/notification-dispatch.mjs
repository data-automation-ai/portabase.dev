import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { createNotificationOutbox, NOTIFICATION_OUTBOX_STORE } from './notification-outbox.mjs';
import { createNotificationBudget, validateNotificationLimits } from './notification-budget.mjs';
import { resolveNotificationTransport } from './notification-config.mjs';

export const DISPATCH_CURSOR_STORE = 'portabase-notification-dispatch';
const CURSOR_KEY = 'cursor-v1';
const HEX = '0123456789abcdef';
const rootTask = () => ({ type: 'owners', prefix: '' });
const positive = (value, max) => /^\d+$/.test(value || '') && Number(value) >= 1 && Number(value) <= max ? Number(value) : null;
function referenceFor(key) {
  const match = /^owners\/([a-f0-9]{64})\/outbox\/([a-f0-9]{64})\/(email|sms)$/.exec(key || '');
  return match ? { owner: match[1], eventId: match[2], channel: match[3] } : null;
}
function validTask(task) {
  return task && /^[a-f0-9]{0,64}$/.test(task.prefix) && (task.type === 'owners' || task.type === 'events' && /^[a-f0-9]{64}$/.test(task.owner || ''));
}
function validCursor(row) {
  return row?.version === 1 && Array.isArray(row.tasks) && row.tasks.length <= 4096 && row.tasks.every(validTask)
    && Array.isArray(row.pending) && row.pending.length <= 100 && row.pending.every(key => referenceFor(key))
    && Number.isSafeInteger(row.cycles) && row.cycles >= 0;
}

/**
 * Blobs' public SDK hides continuation tokens. A persisted radix worklist splits
 * overflowing owner/event prefixes, reading at most two SDK pages per task.
 * Terminal historical rows never pin traversal to the same first page forever.
 */
async function expandTask(task, store) {
  if (task.type === 'events' && task.prefix.length === 64) return { tasks: [], pending: ['email', 'sms'].map(channel => `owners/${task.owner}/outbox/${task.prefix}/${channel}`) };
  const prefix = task.type === 'owners' ? `owners/${task.prefix}` : `owners/${task.owner}/outbox/${task.prefix}`;
  const iterator = store.list({ prefix, directories: task.type === 'owners', paginate: true })[Symbol.asyncIterator]();
  const first = await iterator.next();
  const second = first.done ? { done: true } : await iterator.next();
  await iterator.return?.();
  const entries = first.done ? [] : task.type === 'owners' ? first.value.directories || [] : first.value.blobs?.map(row => row.key) || [];
  if (!second.done || entries.length > 100) {
    if (task.prefix.length >= 64) throw new Error('invalid_notification_listing');
    return { tasks: [...HEX].reverse().map(char => ({ ...task, prefix: `${task.prefix}${char}` })), pending: [] };
  }
  if (task.type === 'owners') {
    const owners = [...new Set(entries.map(path => /^owners\/([a-f0-9]{64})\/?$/.exec(path)?.[1]).filter(owner => owner?.startsWith(task.prefix)))];
    return { tasks: owners.reverse().map(owner => ({ type: 'events', owner, prefix: '' })), pending: [] };
  }
  return { tasks: [], pending: entries.filter(path => {
    const reference = referenceFor(path);
    return reference?.owner === task.owner && reference.eventId.startsWith(task.prefix);
  }) };
}

export function createNotificationDispatcher({
  env = process.env,
  outbox = createNotificationOutbox(),
  budget = createNotificationBudget(),
  cursorStore = () => getStore({ name: DISPATCH_CURSOR_STORE, consistency: 'strong' }),
  listingStore = () => getStore({ name: NOTIFICATION_OUTBOX_STORE, consistency: 'strong' }),
  resolveTransport = resolveNotificationTransport,
  clock = Date.now,
  maxPages = 16,
  maxCandidates = 100,
  maxDurationMs = 20_000,
} = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 2 || maxPages > 64 || !Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 200
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 12_000 || maxDurationMs > 24_000) throw new Error('invalid_dispatch_options');
  const cursorDb = () => typeof cursorStore === 'function' ? cursorStore() : cursorStore;
  const listingDb = () => typeof listingStore === 'function' ? listingStore() : listingStore;

  return async function dispatch() {
    const started = clock();
    if (env.PORTABASE_NOTIFICATION_SENDING_ENABLED !== 'true') return { state: 'disabled', reason: 'sending_disabled' };
    const maxAttempts = positive(env.PORTABASE_NOTIFICATION_MAX_ATTEMPTS_PER_RUN, 25);
    if (!maxAttempts) return { state: 'disabled', reason: 'run_limit_not_configured' };
    const configured = {};
    for (const channel of ['email', 'sms']) {
      const prefix = `PORTABASE_NOTIFICATION_${channel.toUpperCase()}`;
      if (env[`${prefix}_ENABLED`] !== 'true') continue;
      const limits = { attempts: positive(env[`${prefix}_DAILY_ATTEMPTS`], 1000), sends: positive(env[`${prefix}_DAILY_SENDS`], 1000) };
      try { validateNotificationLimits(limits); } catch { continue; }
      const provider = await resolveTransport(channel, { env });
      if (provider.available && typeof provider.transport === 'function') configured[channel] = { ...provider, limits };
    }
    if (!Object.keys(configured).length) return { state: 'disabled', reason: 'channel_or_limits_not_configured' };

    const db = cursorDb();
    const current = await db.getWithMetadata(CURSOR_KEY, { type: 'json' });
    if (current && !validCursor(current.data)) throw new Error('invalid_notification_cursor');
    if (current?.data?.leaseUntil > clock()) return { state: 'busy' };
    const token = randomUUID();
    const cursor = current?.data || { version: 1, tasks: [rootTask()], pending: [], cycles: 0 };
    Object.assign(cursor, { leaseToken: token, leaseUntil: clock() + 45_000 });
    const acquired = await db.setJSON(CURSOR_KEY, cursor, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
    if (!acquired.modified) return { state: 'busy' };
    const stats = { state: 'ran', pages: 0, inspected: 0, reservations: 0, invoked: 0, accepted: 0, unknown: 0, suppressed: 0, budgetBlocked: 0, conflicts: 0, errors: 0, cycles: cursor.cycles };
    try {
      while (stats.inspected < maxCandidates && stats.reservations < maxAttempts && clock() - started < maxDurationMs - 12_000) {
        if (!cursor.pending.length) {
          if (!cursor.tasks.length) { cursor.tasks.push(rootTask()); cursor.cycles++; break; }
          if (stats.pages + 2 > maxPages) break;
          const task = cursor.tasks.pop();
          let expanded;
          try { expanded = await expandTask(task, listingDb()); }
          catch (error) { cursor.tasks.push(task); throw error; }
          stats.pages += 2;
          cursor.tasks.push(...expanded.tasks);
          cursor.pending.push(...expanded.pending);
          if (!validCursor(cursor)) throw new Error('notification_cursor_bounds_exceeded');
          continue;
        }
        const path = cursor.pending[0];
        const reference = referenceFor(path);
        try {
          const provider = configured[reference.channel];
          if (provider) {
            const row = await outbox.get(reference); // verifies key/owner/event/channel binding
            if (row && ['pending', 'leased', 'sending'].includes(row.state)) {
              const lease = await outbox.claim(reference);
              if (lease) {
                const reservation = await budget.reserve(reference.owner, reference.channel, provider.limits);
                if (!reservation) stats.budgetBlocked++; // uninvoked lease can safely expire/retry
                else {
                  stats.reservations++;
                  let invoked = false;
                  let result = 'unknown';
                  try {
                    const delivered = await outbox.deliver(lease, async message => {
                      // Local deferral uses the outbox retry/backoff path without a
                      // provider call. Never carry yesterday's budget into a new day.
                      if (reservation.day !== new Date(clock()).toISOString().slice(0, 10)
                        || clock() - started >= maxDurationMs - 10_000) return { status: 'rejected', retryable: true };
                      invoked = true; stats.invoked++;
                      return provider.transport(message);
                    });
                    if (delivered.state === 'accepted') { stats.accepted++; result = 'accepted'; }
                    else if (delivered.state === 'unknown') { stats.unknown++; result = 'unknown'; }
                    else { if (delivered.state === 'suppressed') stats.suppressed++; result = 'rejected'; }
                  } catch (error) {
                    if (!invoked) result = 'rejected';
                    if (error.status === 409) stats.conflicts++; else stats.errors++;
                  }
                  // Rejections before acceptance free send capacity, never attempt capacity.
                  // Ambiguous provider outcomes or settlement failures retain the reservation.
                  try { await budget.settle(reservation, result); } catch { stats.errors++; }
                }
              }
            }
          }
        } catch (error) { if (error.status === 409) stats.conflicts++; else stats.errors++; }
        cursor.pending.shift();
        stats.inspected++;
      }
    } finally {
      if (!cursor.tasks.length && !cursor.pending.length) { cursor.tasks.push(rootTask()); cursor.cycles++; }
      const latest = await db.getWithMetadata(CURSOR_KEY, { type: 'json' });
      if (latest?.data?.leaseToken !== token) throw new Error('notification_cursor_lease_lost');
      const result = await db.setJSON(CURSOR_KEY, { ...cursor, leaseToken: null, leaseUntil: null }, { onlyIfMatch: latest.etag });
      if (!result.modified) throw new Error('notification_cursor_lease_lost');
    }
    return { ...stats, cycles: cursor.cycles, pendingScanTasks: cursor.tasks.length + cursor.pending.length };
  };
}
