import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationOutbox } from '../netlify/shared/notification-outbox.mjs';
import { createNotificationTransport } from '../netlify/shared/notification-transports.mjs';

const owner = 'a'.repeat(64), other = 'b'.repeat(64);
const agent = { owner, id: 'agent-a', projectRef: 'abcdefghijklmnopqrst' };
const input = { eventType: 'backup.failed', projectRef: agent.projectRef, occurredAt: '2026-10-05T12:00:00Z',
  payload: { error: 'private@example.com postgres://user:secret@db', objectName: 'private/medical.pdf' } };

function fixture(options = {}) {
  const state = {
    now: Date.parse('2026-10-05T12:00:01Z'), active: true,
    prefs: { owner, revision: 1, preferences: { email: { onFailure: true, onSuccess: false }, sms: { onFailure: false, onSuccess: false } } },
    destination: { owner, channel: 'email', id: 'destination-1', revision: 1, address: 'customer@example.com', verifiedAt: '2026-10-05T00:00:00Z', revokedAt: null },
  };
  const rows = new Map(); let revision = 0;
  const store = {
    async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
    async setJSON(key, data, condition = {}) {
      const old = rows.get(key);
      if ((condition.onlyIfNew && old) || (condition.onlyIfMatch && old?.etag !== condition.onlyIfMatch)) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++revision) });
      state.afterWrite?.(data);
      return { modified: true };
    },
  };
  const outbox = createNotificationOutbox({ store, authenticate: async token => token === 'valid' ? agent : null,
    agentActive: async (account, id) => state.active && account === owner && id === agent.id,
    getPreferences: async () => structuredClone(state.prefs), getDestination: async (_, channel) => channel === 'email' ? structuredClone(state.destination) : null,
    clock: () => state.now, ...options });
  const enqueue = async (event = input) => (await outbox.enqueue({ authorization: 'valid', input: event })).find(row => row.channel === 'email');
  return { state, rows, store, outbox, enqueue };
}

test('authenticated event binding deduplicates concurrent retries without storing private payload or address', async () => {
  const { outbox, enqueue, rows } = fixture();
  const replies = await Promise.all(Array.from({ length: 10 }, () => enqueue({ ...input, owner: other, agentId: 'forged' })));
  assert.equal(new Set(replies.map(row => row.eventId)).size, 1);
  assert.equal(replies.filter(row => row.created).length, 1);
  assert.equal(rows.size, 2); // email pending; SMS opt-out tombstone
  const stored = JSON.stringify([...rows.values()]);
  for (const secret of ['private@example.com', 'postgres:', 'medical.pdf', 'customer@example.com', 'forged']) assert.equal(stored.includes(secret), false);
  await assert.rejects(outbox.enqueue({ authorization: 'bad', input }), error => error.status === 401);
  await assert.rejects(enqueue({ ...input, projectRef: 'zzzzzzzzzzzzzzzzzzzz' }), /invalid_event/);
  const anotherType = await enqueue({ ...input, eventType: 'verify.failed' });
  assert.notEqual(anotherType.eventId, replies[0].eventId);
});

test('opt-out events remain suppressed when replayed after consent is enabled', async () => {
  const { state, enqueue, outbox } = fixture();
  state.prefs.preferences.email.onFailure = false;
  const original = await enqueue();
  assert.equal(original.state, 'suppressed');
  state.prefs.preferences.email.onFailure = true;
  state.prefs.revision++;
  assert.equal((await enqueue()).state, 'suppressed');
  assert.equal(await outbox.claim(original), null);
});

test('unverified, foreign, or revoked destinations cannot become sendable', async () => {
  for (const patch of [{ verifiedAt: null }, { verifiedAt: '2099-01-01' }, { owner: other }, { channel: 'sms' }, { revokedAt: '2026-10-05' }]) {
    const { state, enqueue, outbox } = fixture();
    Object.assign(state.destination, patch);
    const ref = await enqueue();
    assert.equal(ref.state, 'suppressed');
    assert.equal(await outbox.claim(ref), null);
  }
});

test('claims recheck agent revocation and consent; foreign reference cannot access the owner outbox', async () => {
  const { state, outbox, enqueue } = fixture();
  const ref = await enqueue();
  assert.equal(await outbox.claim({ ...ref, owner: other }), null);
  state.active = false;
  assert.equal(await outbox.claim(ref), null);
  assert.equal((await outbox.get(ref)).state, 'suppressed');
});

test('revocation between claim and send or during durable sending transition prevents dispatch', async () => {
  for (const moment of ['after-claim', 'during-write']) {
    const { state, outbox, enqueue } = fixture();
    const ref = await enqueue(); const lease = await outbox.claim(ref);
    const revoke = () => { state.prefs.preferences.email.onFailure = false; state.prefs.revision++; };
    if (moment === 'after-claim') revoke();
    else state.afterWrite = record => { if (record.state === 'sending') revoke(); };
    let sends = 0;
    const result = await outbox.deliver(lease, async () => { sends++; return { status: 'accepted', providerId: 'message' }; });
    assert.equal(result.state, 'suppressed'); assert.equal(sends, 0);
  }
});

test('recipient changes and revoked-then-restored consent do not redirect old notifications', async () => {
  for (const kind of ['recipient', 'consent']) {
    const { state, outbox, enqueue } = fixture();
    const ref = await enqueue(); const lease = await outbox.claim(ref);
    if (kind === 'recipient') { state.destination.address = 'different@example.com'; state.destination.revision++; }
    else state.prefs.revision += 2;
    const result = await outbox.deliver(lease, async () => { throw new Error('must not dispatch'); });
    assert.equal(result.state, 'suppressed');
  }
});

test('only one concurrent lease is issued; an expired pre-send lease can be reclaimed safely', async () => {
  const { state, outbox, enqueue } = fixture(); const ref = await enqueue();
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => outbox.claim(ref)));
  const leases = results.filter(row => row.status === 'fulfilled' && row.value).map(row => row.value);
  assert.equal(leases.length, 1);
  state.now += 60_001;
  const second = await outbox.claim(ref);
  assert.notEqual(second.leaseToken, leases[0].leaseToken);
  await assert.rejects(outbox.deliver(leases[0], async () => ({ status: 'accepted', providerId: 'unexpected' })), error => error.status === 409);
  const accepted = await outbox.deliver(second, async () => ({ status: 'accepted', providerId: 'message-1' }));
  assert.equal(accepted.state, 'accepted');
  assert.equal(await outbox.claim(ref), null);
});

test('explicit provider rejection retries with backoff and stops at attempt limit', async () => {
  const { state, outbox, enqueue } = fixture({ maxAttempts: 2 }); const ref = await enqueue();
  const first = await outbox.deliver(await outbox.claim(ref), async () => ({ status: 'rejected', retryable: true }));
  assert.equal(first.state, 'pending'); assert.equal(first.attempts, 1);
  assert.equal(await outbox.claim(ref), null);
  state.now += 30_000;
  const second = await outbox.deliver(await outbox.claim(ref), async () => ({ status: 'rejected', retryable: true }));
  assert.equal(second.state, 'rejected'); assert.equal(second.attempts, 2);
  state.now += 3600_000; assert.equal(await outbox.claim(ref), null);
});

test('ambiguous provider outcomes and exceptions are durable unknowns with no automatic resend', async () => {
  for (const transport of [async () => ({ status: 'unknown' }), async () => { throw new Error('private response body'); }, async () => ({ status: 'accepted' })]) {
    const { state, outbox, enqueue, rows } = fixture(); const ref = await enqueue();
    assert.equal((await outbox.deliver(await outbox.claim(ref), transport)).state, 'unknown');
    state.now += 3600_000;
    assert.equal(await outbox.claim(ref), null);
    assert.equal(JSON.stringify([...rows.values()]).includes('private response'), false);
  }
});

test('expired sending leases become unknown instead of dispatching twice', async () => {
  const { state, outbox, enqueue } = fixture(); const ref = await enqueue();
  let entered, complete;
  const started = new Promise(resolve => { entered = resolve; });
  const response = new Promise(resolve => { complete = resolve; });
  const sending = outbox.deliver(await outbox.claim(ref), async () => { entered(); return response; }).catch(error => error);
  await started;
  state.now += 60_001;
  assert.equal(await outbox.claim(ref), null);
  assert.equal((await outbox.get(ref)).state, 'unknown');
  complete({ status: 'accepted', providerId: 'late-acceptance' });
  assert.equal((await sending).status, 409);
  assert.equal(await outbox.claim(ref), null);
});

test('outbox and Mailgun adapter agree on acceptance without exposing private telemetry', async () => {
  const { outbox, enqueue } = fixture(); const ref = await enqueue();
  const requests = [];
  const transport = createNotificationTransport({ mailgun: { apiKey: 'fake-key', from: 'alerts@portabase.dev', domain: 'mail.portabase.dev', region: 'us' },
    fetchImpl: async (url, options) => { requests.push({ url, text: options.body.get('text'), to: options.body.get('to') });
      return new Response(JSON.stringify({ id: '<fixed-message@mail.portabase.dev>' }), { status: 200 }); } });
  const result = await outbox.deliver(await outbox.claim(ref), transport);
  assert.equal(result.state, 'accepted'); assert.equal(result.deliveredAt, undefined);
  assert.equal(requests.length, 1); assert.equal(requests[0].to, 'customer@example.com');
  assert.equal(requests[0].text.includes('postgres:'), false);
  assert.equal(requests[0].text.includes('private@example.com'), false);
});

test('storage failure propagates and no provider call occurs without a durable sending record', async () => {
  const { outbox, enqueue, store } = fixture(); const ref = await enqueue(); const lease = await outbox.claim(ref);
  store.setJSON = async () => { throw new Error('store unavailable'); };
  let calls = 0;
  await assert.rejects(outbox.deliver(lease, async () => { calls++; return { status: 'accepted', providerId: 'no' }; }), /store unavailable/);
  assert.equal(calls, 0);
});
