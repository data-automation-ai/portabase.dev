import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerKey } from '../netlify/shared/agent-store.mjs';
import { createNotificationDestinationService, notificationDestinationKey } from '../netlify/shared/notification-destinations.mjs';
import { createNotificationDestinationsHandler } from '../netlify/functions/cloud-notification-destinations.mjs';
import { createNotificationOutbox } from '../netlify/shared/notification-outbox.mjs';

const alice = { id: 'alice', cloudVersion: 'supabase', email: 'alice@example.com', emailVerified: true };
const bob = { id: 'bob', cloudVersion: 'supabase', email: 'bob@example.com' };
function fixture(extra = {}) {
  const state = { now: Date.parse('2026-10-05T12:00:00Z'), outcome: { status: 'accepted' } };
  const rows = new Map(), messages = []; let etag = 0;
  const store = {
    async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
    async setJSON(key, data, options = {}) {
      const current = rows.get(key);
      if ((options.onlyIfNew && current) || (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++etag) });
      return { modified: true };
    },
  };
  const service = createNotificationDestinationService({ store, receiptStore: store, clock: () => state.now, sendChallenge: async message => {
    messages.push(message); return { providerId: message.channel === 'sms' ? `SM${String(messages.length).padStart(32, '0')}` : `challenge-${messages.length}@mail.portabase.dev`, ...state.outcome };
  }, ...extra });
  const code = () => messages.at(-1).text.match(/\b\d{8}\b/)[0];
  const handler = createNotificationDestinationsHandler({ service, authenticate: async event => {
    if (!event.user) throw new Error(); return event.user;
  } });
  return { service, handler, messages, code, rows, store, state };
}
const post = (body, user = alice) => ({ user, httpMethod: 'POST', body: JSON.stringify(body) });

test('verified auth flags do not replace challenge proof; stored challenges are hashed and API never returns a code', async () => {
  const { handler, rows, messages, code, service } = fixture();
  const response = await handler(post({ action: 'request', channel: 'email' }));
  assert.equal(response.statusCode, 202);
  const challenge = JSON.parse(response.body);
  assert.equal(messages[0].to, alice.email);
  assert.equal(response.body.includes(code()), false);
  assert.equal(JSON.stringify([...rows.values()]).includes(code()), false);
  assert.equal(await service.resolve(ownerKey(alice), 'email'), null);
  const verified = await handler(post({ action: 'verify', channel: 'email', challengeId: challenge.challengeId, code: code() }));
  assert.equal(verified.statusCode, 200);
  assert.equal(JSON.parse(verified.body).destination.verified, true);
  assert.equal((await service.resolve(ownerKey(alice), 'email')).address, alice.email);
  const stored = rows.get(notificationDestinationKey(ownerKey(alice), 'email')).data;
  assert.equal(stored.challenge.hash, null); assert.equal(stored.challenge.salt, null);
});

test('email addresses, owner identities and verified flags cannot be supplied by the client', async () => {
  const { handler, messages } = fixture();
  for (const field of [{ email: 'other@example.com' }, { address: 'other@example.com' }, { owner: ownerKey(bob) }, { verified: true }, { phone: '+12025550123' }]) {
    assert.equal((await handler(post({ action: 'request', channel: 'email', ...field }))).statusCode, 400);
  }
  assert.equal(messages.length, 0);
  assert.equal((await handler(post({ action: 'request', channel: 'email' }, null))).statusCode, 401);
});

test('wrong owner and wrong code fail; five attempts exhaust the challenge and replay is rejected', async () => {
  const { service, code } = fixture();
  const challenge = await service.request(alice, 'email'); const correct = code();
  await assert.rejects(service.verify(bob, 'email', challenge.challengeId, correct), /verification_unavailable/);
  const wrong = correct === '00000000' ? '99999999' : '00000000';
  for (let i = 0; i < 5; i++) await assert.rejects(service.verify(alice, 'email', challenge.challengeId, wrong), /incorrect_verification_code/);
  await assert.rejects(service.verify(alice, 'email', challenge.challengeId, correct), error => error.status === 429);
  assert.equal(await service.resolve(ownerKey(alice), 'email'), null);
});

test('challenge is single-use under simultaneous verification and expires after ten minutes', async () => {
  const { service, code, state } = fixture();
  const challenge = await service.request(alice, 'email');
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.verify(alice, 'email', challenge.challengeId, code())));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  await assert.rejects(service.verify(alice, 'email', challenge.challengeId, code()), /verification_unavailable/);
  state.now += 60_001;
  const next = await service.request(alice, 'email'); const nextCode = code();
  state.now += 600_000;
  await assert.rejects(service.verify(alice, 'email', next.challengeId, nextCode), /verification_unavailable/);
});

test('request CAS and rolling rate limits bound provider sends including rejected attempts', async () => {
  const { service, messages, state } = fixture();
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.request(alice, 'email')));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(messages.length, 1);
  state.outcome = { status: 'rejected', retryable: true };
  for (let i = 0; i < 2; i++) { state.now += 60_001; await service.request(alice, 'email'); }
  state.now += 60_001;
  await assert.rejects(service.request(alice, 'email'), error => error.status === 429);
  state.now += 3600_000;
  for (let i = 0; i < 2; i++) { await service.request(alice, 'email'); state.now += 60_001; }
  await assert.rejects(service.request(alice, 'email'), error => error.status === 429);
  assert.equal(messages.length, 5);
});

test('email identity changes invalidate an outstanding code; SMS candidates require challenge proof', async () => {
  const { service, code, handler, messages } = fixture();
  const email = await service.request(alice, 'email');
  await assert.rejects(service.verify({ ...alice, email: 'changed@example.com' }, 'email', email.challengeId, code()), /account_contact_changed/);
  assert.equal((await handler(post({ action: 'request', channel: 'sms', phone: '202-555-0123' }))).statusCode, 400);
  const response = await handler(post({ action: 'request', channel: 'sms', phone: '+12025550123' }));
  assert.equal(response.statusCode, 202); assert.equal(messages.at(-1).to, '+12025550123');
  const challenge = JSON.parse(response.body);
  assert.equal(await service.resolve(ownerKey(alice), 'sms'), null);
  assert.equal((await handler(post({ action: 'verify', channel: 'sms', challengeId: challenge.challengeId, code: code(), phone: '+12025550124' }))).statusCode, 400);
  await service.verify(alice, 'sms', challenge.challengeId, code());
  assert.equal((await service.resolve(ownerKey(alice), 'sms')).address, '+12025550123');
});

test('new request/revocation invalidates old proof and old queued alerts', async () => {
  const { service, code, store, state } = fixture();
  const first = await service.request(alice, 'email'); await service.verify(alice, 'email', first.challengeId, code());
  const owner = ownerKey(alice), agent = { owner, id: 'runner', projectRef: 'abcdefghijklmnopqrst' };
  const outbox = createNotificationOutbox({ store, authenticate: async () => agent, agentActive: async () => true,
    getPreferences: async () => ({ owner, revision: 1, preferences: { email: { onFailure: true } } }),
    getDestination: service.resolve, clock: () => state.now });
  const [reference] = await outbox.enqueue({ authorization: 'test', input: { eventType: 'backup.failed', projectRef: agent.projectRef, occurredAt: new Date(state.now).toISOString() } });
  const lease = await outbox.claim(reference); assert.ok(lease);
  await service.revoke(alice, 'email');
  assert.equal(await service.resolve(owner, 'email'), null);
  const result = await outbox.deliver(lease, async () => { throw new Error('must not send'); });
  assert.equal(result.state, 'suppressed');
  await assert.rejects(service.verify(alice, 'email', first.challengeId, code()), /verification_unavailable/);
  state.now += 60_001;
  const next = await service.request(alice, 'email'); await service.verify(alice, 'email', next.challengeId, code());
  assert.equal(await outbox.claim(reference), null);
});

test('new candidate invalidates the previous verified SMS destination before send completes', async () => {
  const { service, code, state } = fixture();
  const original = await service.request(alice, 'sms', '+12025550123'); await service.verify(alice, 'sms', original.challengeId, code());
  assert.ok(await service.resolve(ownerKey(alice), 'sms'));
  state.now += 60_001;
  await service.request(alice, 'sms', '+12025550124');
  assert.equal(await service.resolve(ownerKey(alice), 'sms'), null);
  await assert.rejects(service.verify(alice, 'sms', original.challengeId, code()), /verification_unavailable/);
});

test('unconfigured transport returns 503 without pretending a challenge was sent', async () => {
  const { handler, messages, rows } = fixture({ sendChallenge: null });
  const response = await handler(post({ action: 'request', channel: 'email' }));
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, 'verification_delivery_unconfigured');
  assert.equal(messages.length, 0); assert.equal(rows.size, 0);
});

test('unknown delivery is reported honestly but possession of the code can still verify; rejected delivery cannot', async () => {
  const { handler, service, state, code } = fixture();
  state.outcome = { status: 'unknown' };
  const unknown = await handler(post({ action: 'request', channel: 'email' }));
  assert.equal(unknown.statusCode, 503); assert.equal(JSON.parse(unknown.body).deliveryStatus, 'unknown');
  await service.verify(alice, 'email', JSON.parse(unknown.body).challengeId, code());
  state.now += 60_001; state.outcome = { status: 'rejected', retryable: false };
  const rejected = await handler(post({ action: 'request', channel: 'email' }));
  assert.equal(JSON.parse(rejected.body).deliveryStatus, 'rejected');
  await assert.rejects(service.verify(alice, 'email', JSON.parse(rejected.body).challengeId, code()), /verification_unavailable/);
});

test('accepted challenge records only a private receipt binding, even when revoked during provider dispatch', async () => {
  let started, finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const sending = new Promise(resolve => { started = resolve; });
  const f = fixture({ sendChallenge: async () => { started(); return pending; } });
  const request = f.service.request(alice, 'sms', '+12025550123');
  await sending;
  await f.service.revoke(alice, 'sms');
  finish({ status: 'accepted', providerId: `SM${'a'.repeat(32)}` });
  await assert.rejects(request, /destination_changed/);
  const indexes = [...f.rows].filter(([key]) => key.startsWith('provider-index/'));
  assert.equal(indexes.length, 1);
  const record = indexes[0][1].data;
  assert.deepEqual(Object.keys(record).sort(), ['challengeId', 'channel', 'owner', 'purpose']);
  assert.equal(record.purpose, 'verification'); assert.equal(record.owner, ownerKey(alice));
  assert.equal(JSON.stringify(record).includes('+12025550123'), false);
  assert.equal(await f.service.resolve(ownerKey(alice), 'sms'), null);
});

test('receipt-index storage failure does not pretend an accepted challenge was fully recorded or resend it', async () => {
  const f = fixture({ receiptStore: { setJSON: async () => { throw new Error('storage unavailable'); } } });
  await assert.rejects(f.service.request(alice, 'email'), /storage unavailable/);
  assert.equal(f.messages.length, 1);
  await assert.rejects(f.service.request(alice, 'email'), error => error.status === 429);
  assert.equal(f.messages.length, 1);
  const row = f.rows.get(notificationDestinationKey(ownerKey(alice), 'email')).data;
  assert.equal(row.challenge.deliveryStatus, 'sending');
  await f.service.verify(alice, 'email', row.challenge.id, f.code());
  assert.ok(await f.service.resolve(ownerKey(alice), 'email'));
});
