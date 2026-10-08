import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationBudget } from '../netlify/shared/notification-budget.mjs';
import { createNotificationDispatcher } from '../netlify/shared/notification-dispatch.mjs';
import { createNotificationOutbox, notificationKey } from '../netlify/shared/notification-outbox.mjs';
import { config as scheduledConfig } from '../netlify/functions/notification-dispatch.mjs';

const owner = 'a'.repeat(64), other = 'b'.repeat(64);
const env = {
  PORTABASE_NOTIFICATION_SENDING_ENABLED: 'true', PORTABASE_NOTIFICATION_EMAIL_ENABLED: 'true',
  PORTABASE_NOTIFICATION_MAX_ATTEMPTS_PER_RUN: '3', PORTABASE_NOTIFICATION_EMAIL_DAILY_ATTEMPTS: '5', PORTABASE_NOTIFICATION_EMAIL_DAILY_SENDS: '3',
};
function memoryStore({ pageSize = 1000 } = {}) {
  const rows = new Map(); const lists = []; let revision = 0;
  return {
    rows, lists,
    async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
    async setJSON(key, data, conditions = {}) {
      const old = rows.get(key);
      if (conditions.onlyIfNew && old || conditions.onlyIfMatch && old?.etag !== conditions.onlyIfMatch) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++revision) }); return { modified: true };
    },
    list({ prefix = '', directories }) {
      lists.push({ prefix, directories });
      let entries = [...rows.keys()].filter(key => key.startsWith(prefix)).sort();
      if (directories) entries = [...new Set(entries.map(key => {
        const slash = key.indexOf('/', prefix.length);
        return slash < 0 ? null : key.slice(0, slash);
      }).filter(Boolean))];
      return { async *[Symbol.asyncIterator]() {
        if (!entries.length) yield { blobs: [], directories: [] };
        for (let start = 0; start < entries.length; start += pageSize) {
          const page = entries.slice(start, start + pageSize);
          yield { blobs: directories ? [] : page.map(key => ({ key })), directories: directories ? page : [] };
        }
      } };
    },
  };
}
function fixture(options = {}) {
  const state = { now: Date.parse('2026-10-05T12:00:01Z'), active: true, optedIn: true, destinationRevoked: false, preferenceRevision: 1, sends: 0, transportResult: { status: 'accepted', providerId: 'test-provider-id' } };
  const store = memoryStore({ pageSize: options.pageSize });
  const cursors = memoryStore(), budgets = memoryStore();
  const outbox = createNotificationOutbox({ store,
    authenticate: async () => ({ owner, id: 'test-agent', projectRef: 'abcdefghijklmnopqrst' }),
    agentActive: async () => state.active,
    getPreferences: async account => ({ owner: account, revision: state.preferenceRevision, preferences: { email: { onFailure: state.optedIn, onSuccess: false }, sms: { onFailure: false } } }),
    getDestination: async (account, channel) => ({ owner: account, channel, id: 'dest-1', revision: 1, address: channel === 'email' ? 'synthetic@example.test' : '+12025550123', verifiedAt: '2026-10-05T00:00:00Z', revokedAt: state.destinationRevoked ? '2026-10-05' : null }),
    clock: () => state.now,
  });
  const budget = createNotificationBudget({ store: budgets, clock: () => state.now });
  const dispatcher = overrides => createNotificationDispatcher({ env: { ...env, ...(options.env || {}) }, outbox, budget, cursorStore: cursors, listingStore: store,
    resolveTransport: async () => ({ available: true, transport: async () => { state.sends++; if (state.transportThrows) throw new Error('private-provider-body'); return state.transportResult.status === 'accepted' ? { ...state.transportResult, providerId: `${state.transportResult.providerId}-${state.sends}` } : state.transportResult; } }),
    clock: () => state.now, maxPages: 16, ...overrides });
  async function add(eventId, patch = {}, account = owner) {
    const reference = { owner: account, eventId, channel: 'email' };
    await store.setJSON(notificationKey(reference), { ...reference, agentId: 'test-agent', eventType: 'backup.failed', occurredAt: '2026-10-05T12:00:00Z', state: 'pending', attempts: 0, availableAt: state.now, consentRevision: 1, destinationId: 'dest-1', destinationRevision: 1, ...patch });
    return reference;
  }
  return { state, store, cursors, budgets, outbox, budget, dispatcher, add };
}

test('scheduled entry point is not an API route, and disabled/missing limits never resolve a sender or open stores', async () => {
  assert.ok(scheduledConfig.schedule);
  assert.equal(scheduledConfig.path, undefined);
  let touches = 0;
  for (const config of [{}, { PORTABASE_NOTIFICATION_SENDING_ENABLED: 'true' }]) {
    const run = createNotificationDispatcher({ env: config, resolveTransport: async () => { touches++; throw new Error('must not resolve'); }, cursorStore: () => { touches++; throw new Error('must not open'); } });
    assert.equal((await run()).state, 'disabled');
  }
  assert.equal(touches, 0);
  const run = createNotificationDispatcher({ env, resolveTransport: async () => ({ available: false, reason: 'configuration_missing' }), cursorStore: () => { throw new Error('must not open'); } });
  assert.equal((await run()).state, 'disabled');
});

test('concurrent scheduled scans acquire one cursor lease and one outbox send', async () => {
  const f = fixture(); const ref = await f.add('1'.repeat(64));
  const results = await Promise.all([f.dispatcher()(), f.dispatcher()()]);
  assert.equal(results.filter(result => result.state === 'busy').length, 1);
  assert.equal(f.state.sends, 1);
  assert.equal((await f.outbox.get(ref)).state, 'accepted');
  await f.dispatcher()();
  assert.equal(f.state.sends, 1);
});

test('per-run cap checkpoints remaining candidates and daily caps gate before provider calls', async () => {
  const f = fixture({ env: { PORTABASE_NOTIFICATION_MAX_ATTEMPTS_PER_RUN: '1', PORTABASE_NOTIFICATION_EMAIL_DAILY_SENDS: '2' } });
  for (const digit of ['1', '2', '3']) await f.add(digit.repeat(64));
  assert.equal((await f.dispatcher()()).invoked, 1);
  assert.equal((await f.dispatcher()()).invoked, 1);
  assert.equal((await f.dispatcher()()).budgetBlocked, 1);
  assert.equal(f.state.sends, 2);
  assert.equal((await f.outbox.get({ owner, eventId: '2'.repeat(64), channel: 'email' })).state, 'accepted');
  const third = await f.outbox.get({ owner, eventId: '3'.repeat(64), channel: 'email' });
  assert.equal(third.state, 'leased');
  assert.equal(third.attempts, 0);
  f.state.now += 86_400_001;
  await f.dispatcher()();
  assert.equal(f.state.sends, 3);
});

test('concurrent daily reservations cannot exceed caps; unknown/crashed attempts keep capacity', async () => {
  const store = memoryStore(); const budget = createNotificationBudget({ store, clock: () => Date.parse('2026-10-05') });
  const results = await Promise.all(Array.from({ length: 10 }, () => budget.reserve(owner, 'sms', { attempts: 5, sends: 2 })));
  const reserved = results.filter(Boolean);
  assert.equal(reserved.length, 2);
  await budget.settle(reserved[0], 'unknown');
  await budget.settle(reserved[0], 'rejected');
  assert.equal(await budget.reserve(owner, 'sms', { attempts: 5, sends: 2 }), null);
  assert.ok(await budget.reserve(other, 'sms', { attempts: 5, sends: 2 }));
  assert.ok(await budget.reserve(owner, 'email', { attempts: 5, sends: 2 }));
});

test('explicit rejections free send capacity but still exhaust the attempt budget', async () => {
  const store = memoryStore(); const budget = createNotificationBudget({ store, clock: () => Date.parse('2026-10-05') });
  for (let i = 0; i < 2; i++) { const entry = await budget.reserve(owner, 'email', { attempts: 2, sends: 1 }); assert.ok(entry); await budget.settle(entry, 'rejected'); }
  assert.equal(await budget.reserve(owner, 'email', { attempts: 2, sends: 1 }), null);
});

test('opt-out, destination revocation and post-claim opt-out never call a provider', async () => {
  for (const timing of ['opt-out', 'destination', 'after-claim']) {
    const f = fixture(); const ref = await f.add('1'.repeat(64));
    if (timing === 'opt-out') f.state.optedIn = false;
    if (timing === 'destination') f.state.destinationRevoked = true;
    let budget = f.budget;
    if (timing === 'after-claim') budget = { ...f.budget, async reserve(...args) { const result = await f.budget.reserve(...args); f.state.optedIn = false; f.state.preferenceRevision++; return result; } };
    await f.dispatcher({ budget })();
    assert.equal(f.state.sends, 0);
    assert.equal((await f.outbox.get(ref)).state, 'suppressed');
  }
});

test('unknown provider outcome consumes the cap and is never automatically resent', async () => {
  const f = fixture({ env: { PORTABASE_NOTIFICATION_EMAIL_DAILY_SENDS: '1' } });
  f.state.transportThrows = true;
  const first = await f.add('1'.repeat(64)); await f.add('2'.repeat(64));
  const run = await f.dispatcher()();
  assert.equal(run.unknown, 1);
  assert.equal(run.budgetBlocked, 1);
  assert.equal((await f.outbox.get(first)).state, 'unknown');
  f.state.now += 60_001;
  await f.dispatcher()();
  assert.equal(f.state.sends, 1);
  assert.equal(JSON.stringify([...f.budgets.rows.values()]).includes('private-provider'), false);
});

test('prefix cursor progresses past multiple historical pages and reaches a late pending key', async () => {
  const f = fixture({ pageSize: 2 });
  for (const digit of ['0', '1', '2', '3', '4']) await f.add(digit.repeat(64), { state: 'accepted' });
  const pending = await f.add('f'.repeat(64));
  const dispatch = f.dispatcher({ maxPages: 4 });
  for (let i = 0; i < 12 && !f.state.sends; i++) {
    const result = await dispatch();
    assert.ok(result.pages <= 4);
  }
  assert.equal(f.state.sends, 1);
  assert.equal((await f.outbox.get(pending)).state, 'accepted');
  assert.equal(f.store.lists.filter(row => row.prefix === 'owners/').length, 1);
  assert.ok(f.store.lists.some(row => row.prefix.endsWith('/outbox/f')));
});

test('owner directory pagination advances to a later account without restarting the root scan', async () => {
  const f = fixture({ pageSize: 2 });
  for (const digit of ['0', '1', '2']) await f.add('1'.repeat(64), { state: 'accepted' }, digit.repeat(64));
  const pending = await f.add('1'.repeat(64), {}, 'f'.repeat(64));
  const dispatch = f.dispatcher({ maxPages: 4 });
  for (let i = 0; i < 24 && !f.state.sends; i++) await dispatch();
  assert.equal(f.state.sends, 1);
  assert.equal((await f.outbox.get(pending)).state, 'accepted');
  assert.equal(f.store.lists.filter(row => row.prefix === 'owners/').length, 1);
  assert.ok(f.store.lists.some(row => row.prefix === 'owners/f'));
});

test('foreign records and malformed list keys cannot become notification sends', async () => {
  const f = fixture();
  await f.add('1'.repeat(64), { owner: other });
  await f.store.setJSON(`owners/${owner}/outbox/not-an-event/email`, { owner, state: 'pending' });
  const result = await f.dispatcher()();
  assert.equal(f.state.sends, 0);
  assert.equal(result.errors, 1);
});

test('budget storage outage blocks provider dispatch and keeps the outbox reclaimable', async () => {
  const f = fixture(); const ref = await f.add('1'.repeat(64));
  const result = await f.dispatcher({ budget: { reserve: async () => { throw new Error('private storage detail'); } } })();
  assert.equal(result.errors, 1);
  assert.equal(f.state.sends, 0);
  assert.equal((await f.outbox.get(ref)).state, 'leased');
});

test('a reservation cannot authorize a provider call after its UTC budget day changes', async () => {
  const f = fixture();
  f.state.now = Date.parse('2026-10-05T23:59:59.999Z');
  const ref = await f.add('1'.repeat(64));
  const budget = { ...f.budget, async reserve(...args) { const reservation = await f.budget.reserve(...args); f.state.now++; return reservation; } };
  await f.dispatcher({ budget })();
  assert.equal(f.state.sends, 0);
  assert.equal((await f.outbox.get(ref)).state, 'pending');
});

test('a slow pre-dispatch check defers before the provider timeout can exceed the run budget', async () => {
  const f = fixture(); const ref = await f.add('1'.repeat(64));
  const budget = { ...f.budget, async reserve(...args) { const reservation = await f.budget.reserve(...args); f.state.now += 11_000; return reservation; } };
  await f.dispatcher({ budget })();
  assert.equal(f.state.sends, 0);
  assert.equal((await f.outbox.get(ref)).state, 'pending');
});
