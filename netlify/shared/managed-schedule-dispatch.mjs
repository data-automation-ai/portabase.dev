import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { createManagedSchedules, scheduleIndexIdentity, SCHEDULE_INDEX_STORE } from './managed-schedules.mjs';
import { uuid } from './schedule-contract.mjs';

const HEX = '0123456789abcdef', KEY = 'cursor-v1';
const validKey = value => typeof value === 'string' && /^owners\/[a-f0-9]{64}$/.test(value);
function validCursor(row) {
  return row?.version === 1 && Array.isArray(row.tasks) && row.tasks.length <= 1024 && row.tasks.every(prefix => typeof prefix === 'string' && /^[a-f0-9]{0,64}$/.test(prefix))
    && Array.isArray(row.pending) && row.pending.length <= 100 && row.pending.every(validKey)
    && Number.isSafeInteger(row.cycles) && row.cycles >= 0 && uuid(row.leaseToken)
    && Number.isSafeInteger(row.leaseUntil) && row.leaseUntil >= 0;
}
async function expand(prefix, db) {
  if (prefix.length === 64) return { tasks: [], pending: [`owners/${prefix}`] };
  const iterator = db.list({ prefix: `owners/${prefix}`, paginate: true })[Symbol.asyncIterator]();
  const first = await iterator.next(), second = first.done ? { done: true } : await iterator.next();
  await iterator.return?.();
  const keys = first.done ? [] : (first.value.blobs || []).map(row => row.key);
  if (!second.done || keys.length > 100) return { tasks: [...HEX].reverse().map(char => `${prefix}${char}`), pending: [] };
  return { tasks: [], pending: keys.filter(key => validKey(key) && key.startsWith(`owners/${prefix}`)) };
}

/** Bounded, persisted traversal; a large account prefix cannot starve later
 * owners forever. Queue CAS, not this traversal lease, guarantees uniqueness. */
export function createManagedScheduleDispatcher({ env = process.env, service = createManagedSchedules({ env }),
  indexDatabase = () => getStore({ name: SCHEDULE_INDEX_STORE, consistency: 'strong' }),
  cursorDatabase = () => getStore({ name: 'portabase-schedule-dispatch', consistency: 'strong' }),
  clock = Date.now, maxPages = 16, maxAccounts = 25, maxDurationMs = 20000 } = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 2 || maxPages > 64 || !Number.isSafeInteger(maxAccounts) || maxAccounts < 1 || maxAccounts > 100
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1000 || maxDurationMs > 25000) throw new Error('invalid_schedule_dispatch_options');
  return async () => {
    if (env.PORTABASE_SCHEDULE_DISPATCH_ENABLED !== 'true') return { state: 'disabled' };
    const started = clock(), db = cursorDatabase(), index = indexDatabase(), previous = await db.getWithMetadata(KEY, { type: 'json' });
    if (previous && !validCursor(previous.data)) throw new Error('invalid_schedule_dispatch_cursor');
    if (previous?.data.leaseUntil > started) return { state: 'busy' };
    const cursor = previous?.data || { version: 1, tasks: [''], pending: [], cycles: 0 };
    cursor.leaseToken = randomUUID(); cursor.leaseUntil = started + 45000;
    if (!(await db.setJSON(KEY, cursor, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true })).modified) return { state: 'busy' };
    const stats = { state: 'ran', inspected: 0, queued: 0, blocked: 0, errors: 0, pages: 0 };
    try {
      while (stats.inspected < maxAccounts && clock() - started < maxDurationMs) {
        if (!cursor.pending.length) {
          if (!cursor.tasks.length) { cursor.tasks.push(''); cursor.cycles++; break; }
          if (stats.pages + 2 > maxPages) break;
          const prefix = cursor.tasks.pop();
          try { const next = await expand(prefix, index); cursor.tasks.push(...next.tasks); cursor.pending.push(...next.pending); }
          catch { cursor.tasks.push(prefix); throw new Error('schedule_index_unavailable'); }
          stats.pages += 2; continue;
        }
        const key = cursor.pending.shift(); stats.inspected++;
        try {
          const record = await index.get(key, { type: 'json' });
          if (!record) continue;
          scheduleIndexIdentity(record);
          if (`owners/${record.owner}` !== key) throw new Error('invalid_schedule_index');
          const result = await service.dispatchAccount(record);
          stats.queued += result.queued; stats.blocked += result.blocked;
        } catch { stats.errors++; }
      }
      return stats;
    } finally {
      const current = await db.getWithMetadata(KEY, { type: 'json' });
      if (current?.data?.leaseToken === cursor.leaseToken) {
        cursor.leaseUntil = 0;
        if (!validCursor(cursor)) throw new Error('invalid_schedule_dispatch_cursor');
        if (!(await db.setJSON(KEY, cursor, { onlyIfMatch: current.etag })).modified) throw new Error('schedule_dispatch_cursor_changed');
      }
    }
  };
}
