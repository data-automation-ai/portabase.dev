import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateAgent, createAgent, listAgents, ownerKey, revokeAgent } from '../netlify/shared/agent-store.mjs';
import { createTelemetryHandler } from '../netlify/functions/cloud-telemetry.mjs';
import { createAgentsHandler } from '../netlify/functions/cloud-agents.mjs';
import { collectTelemetryEvents } from '../netlify/functions/cloud-telemetry-events.mjs';
import { agentsWithHealth, latestReportKey, runnerHealth, storeLatestReport } from '../netlify/shared/runner-reports.mjs';
import { createNotificationOutbox } from '../netlify/shared/notification-outbox.mjs';

const owner = id => ownerKey({ id, cloudVersion: 'supabase' });
const A = owner('customer-a');
const B = owner('customer-b');
const ref = 'abcdefghijklmnopqrst';
const now = Date.parse('2026-10-04T12:00:00Z');
const input = { eventType: 'backup.completed', projectRef: ref, occurredAt: new Date(now).toISOString(), payload: { status: 'COMPLETE', sizeBytes: 200 } };

test('authenticated telemetry feeds the durable outbox once per event and never sends private payloads', async () => {
  const credentials = memoryStore(), reports = memoryStore(), queue = memoryStore();
  const { token } = await createAgent(A, { projectRef: ref }, credentials);
  const authenticate = header => authenticateAgent(header, credentials);
  const outbox = createNotificationOutbox({ store: queue, authenticate, clock: () => now, agentActive: async () => true,
    getPreferences: async owner => ({ owner, revision: 1, preferences: { email: { onSuccess: true } } }),
    getDestination: async (owner, channel) => channel === 'email' ? { owner, channel, id: 'verified-email', revision: 1, address: 'customer@example.com', verifiedAt: new Date(now - 1000).toISOString() } : null });
  const handle = createTelemetryHandler({ authenticate, storeFactory: () => reports, now: () => now, enqueueNotifications: args => outbox.enqueue(args) });
  for (let i = 0; i < 2; i++) assert.equal((await handle(request(token, { ...input, payload: { ...input.payload, privateLabel: 'confidential-sentinel' } }))).status, 202);
  assert.equal(queue.rows.size, 2);
  assert.equal([...queue.rows.values()].filter(row => row.data.state === 'pending').length, 1);
  assert.ok(!JSON.stringify([...queue.rows.values()]).includes('confidential-sentinel'));
  assert.ok(!JSON.stringify([...queue.rows.values()]).includes('customer@example.com'));
});

test('queue outage reports partial persistence rather than successful notification enqueue', async () => {
  const reports = memoryStore(), credentials = memoryStore();
  const { token } = await createAgent(A, { projectRef: ref }, credentials);
  const handle = createTelemetryHandler({ authenticate: header => authenticateAgent(header, credentials), storeFactory: () => reports, now: () => now,
    enqueueNotifications: async () => { throw new Error('private-provider-error'); } });
  const response = await handle(request(token));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'notification_queue_unavailable', telemetryStored: true });
  assert.ok(reports.rows.size > 0);
});

function memoryStore() {
  const rows = new Map();
  let revision = 0;
  return {
    rows,
    async get(key) { return structuredClone(rows.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
    async setJSON(key, data, conditions = {}) {
      const old = rows.get(key);
      if (conditions.onlyIfNew && old || conditions.onlyIfMatch && old?.etag !== conditions.onlyIfMatch) return { modified: false };
      const etag = String(++revision);
      rows.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    },
    async listKeys(prefix) { return [...rows.keys()].filter(key => key.startsWith(prefix)); },
  };
}
function request(token, body = input) {
  return new Request('https://portabase.dev/api/cloud/telemetry', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}
const read = (store, account) => collectTelemetryEvents({ owner: account, now, days: 1, listKeys: store.listKeys, getRecord: store.get });

test('credentials are hashed at rest, shown once, and scoped to the verified account', async () => {
  const store = memoryStore();
  const { token, agent } = await createAgent(A, { name: 'Primary runner', projectRef: ref, owner: B }, store);
  assert.equal((await authenticateAgent(`Bearer ${token}`, store)).owner, A);
  assert.equal(JSON.stringify([...store.rows.values()]).includes(token), false);
  assert.deepEqual(await listAgents(B, store), []);
  assert.equal((await listAgents(A, store))[0].tokenHash, undefined);
  assert.equal(agent.owner, undefined);
  await assert.rejects(revokeAgent(B, agent.id, store), error => error.status === 404);
  await revokeAgent(A, agent.id, store);
  assert.equal(await authenticateAgent(`Bearer ${token}`, store), null);
  const replacement = await createAgent(A, { projectRef: ref }, store);
  assert.equal(replacement.agent.slot, agent.slot);
  assert.notEqual(replacement.agent.id, agent.id);
  assert.equal(await authenticateAgent(`Bearer ${token}`, store), null);
});

test('concurrent enrollment enforces the 12 credential limit without overwriting active credentials', async () => {
  const store = memoryStore();
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => createAgent(A, { projectRef: ref }, store)));
  const accepted = results.filter(result => result.status === 'fulfilled');
  assert.equal(accepted.length, 12);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 8);
  assert.equal(new Set(accepted.map(result => result.value.agent.slot)).size, 12);
  for (const result of accepted) assert.ok(await authenticateAgent(`Bearer ${result.value.token}`, store));
});

test('enrollment rejects coerced project references and non-text runner names', async () => {
  const store = memoryStore();
  for (const body of [{ projectRef: [ref] }, { projectRef: ref, name: ['Runner'] }, null]) {
    await assert.rejects(createAgent(A, body, store), error => error.status === 400);
  }
  assert.equal(store.rows.size, 0);
});

test('enrollment HTTP endpoint derives ownership, prevents credential caching, and bounds decoded body bytes', async () => {
  const store = memoryStore();
  const handle = createAgentsHandler({ verifyUser: async () => ({ id: 'customer-a', cloudVersion: 'supabase' }), create: (account, input) => createAgent(account, input, store) });
  const response = await handle({ httpMethod: 'POST', isBase64Encoded: true, body: Buffer.from(JSON.stringify({ projectRef: ref, owner: B })).toString('base64') });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal((await authenticateAgent(`Bearer ${JSON.parse(response.body).token}`, store)).owner, A);
  const oversize = await handle({ httpMethod: 'POST', body: JSON.stringify({ projectRef: ref, name: 'é'.repeat(1100) }) });
  assert.equal(oversize.statusCode, 413);
  assert.equal(store.rows.size, 1);
  const unauthenticated = createAgentsHandler({ verifyUser: async () => { throw new Error('private detail'); } });
  assert.equal((await unauthenticated({ httpMethod: 'GET' })).statusCode, 401);
});

test('ingest and read isolate accounts sharing a project ref and discard confidential payload fields', async () => {
  const credentials = memoryStore();
  const reports = memoryStore();
  const a = await createAgent(A, { projectRef: ref }, credentials);
  const b = await createAgent(B, { projectRef: ref }, credentials);
  const handle = createTelemetryHandler({ enqueueNotifications: async () => [], authenticate: header => authenticateAgent(header, credentials), storeFactory: () => reports, now: () => now });
  const forged = { ...input, owner: B, agentId: b.agent.id, hostname: 'private-host', payload: { ...input.payload, email: 'private@example.test', manifest: { tables: ['private_table'] }, note: 'confidential', rawLog: 'private log', durationMs: -5, verified: true } };
  assert.equal((await handle(request(a.token, forged))).status, 202);
  const visibleA = await read(reports, A);
  assert.equal(visibleA.events.length, 1);
  assert.equal(visibleA.events[0].agentId, a.agent.id);
  assert.deepEqual(visibleA.events[0].payload, { sizeBytes: 200, status: 'COMPLETE', verified: true });
  assert.deepEqual((await read(reports, B)).events, []);
  const serialized = JSON.stringify([...reports.rows.values()]);
  for (const privateText of ['private', 'confidential', 'rawLog', 'durationMs']) assert.equal(serialized.includes(privateText), false);
  await revokeAgent(A, a.agent.id, credentials);
  assert.equal((await handle(request(a.token))).status, 401);
  assert.equal((await handle(request('old-global-token'))).status, 401);
  assert.equal(reports.rows.size, 2);
});

test('invalid project, timestamps, types and oversize reports never reach storage', async () => {
  const credentials = memoryStore();
  const reports = memoryStore();
  const { token } = await createAgent(A, { projectRef: ref }, credentials);
  const handle = createTelemetryHandler({ enqueueNotifications: async () => [], authenticate: header => authenticateAgent(header, credentials), storeFactory: () => reports, now: () => now });
  for (const bad of [{ projectRef: '../../account-b' }, { occurredAt: '2027-01-01' }, { occurredAt: '2020-01-01' }, { occurredAt: [input.occurredAt] }, { payload: [] }, { payload: 'private log' }, { eventType: 'unknown' }, { payload: { runnerState: 'healthy' } }, { payload: { nextScheduledAt: ['2026-10-04T13:00:00Z'] } }, { payload: { nextScheduledAt: '2026-02-31T13:00:00Z' } }, { payload: { nextScheduledAt: '2028-01-01T13:00:00Z' } }]) {
    assert.equal((await handle(request(token, { ...input, ...bad }))).status, 400);
  }
  assert.equal((await handle(request(token, { ...input, note: 'x'.repeat(17000) }))).status, 413);
  assert.equal(reports.rows.size, 0);
});

test('arrays cannot masquerade as approved hash or version strings', async () => {
  const credentials = memoryStore();
  const reports = memoryStore();
  const { token } = await createAgent(A, { projectRef: ref }, credentials);
  const handle = createTelemetryHandler({ enqueueNotifications: async () => [], authenticate: header => authenticateAgent(header, credentials), storeFactory: () => reports, now: () => now });
  const event = { ...input, portabaseVersion: ['0.4.1'], payload: { capsuleHash: ['a'.repeat(64)], manifestHash: 'b'.repeat(64) } };
  assert.equal((await handle(request(token, event))).status, 202);
  const { events } = await read(reports, A);
  assert.equal(events[0].portabaseVersion, 'unknown');
  assert.deepEqual(events[0].payload, { manifestHash: 'b'.repeat(64) });
});

test('storage outages do not become successful ingest or empty healthy dashboards', async () => {
  const unavailable = async () => { throw new Error('sensitive-provider-detail'); };
  const handle = createTelemetryHandler({ enqueueNotifications: async () => [], authenticate: async () => ({ owner: A, projectRef: ref, id: 'runner-a' }), storeFactory: () => ({ setJSON: unavailable }), now: () => now });
  const response = await handle(request('test-token'));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'telemetry_store_unavailable' });
  await assert.rejects(collectTelemetryEvents({ owner: A, now, listKeys: unavailable, getRecord: unavailable }));
});

test('reader rejects mismatched stored owners and keys outside the requested account prefix', async () => {
  const report = { owner: B, receivedAt: new Date(now).toISOString(), event: input };
  const result = await collectTelemetryEvents({ owner: A, days: 1, now, listKeys: async prefix => [`${prefix}bad.json`, `owners/${B}/2026-10-04/a.json`], getRecord: async () => report });
  assert.equal(result.events.length, 0);
});

test('latest reports survive capped history and reject older deliveries or another tenant', async () => {
  const credentials = memoryStore();
  const reports = memoryStore();
  const { agent, token } = await createAgent(A, { projectRef: ref }, credentials);
  const handle = createTelemetryHandler({ enqueueNotifications: async () => [], authenticate: header => authenticateAgent(header, credentials), storeFactory: () => reports, now: () => now });
  for (let i = 0; i < 201; i++) await reports.setJSON(`owners/${A}/2026-10-04/old-${i}`, { owner: A, receivedAt: new Date(now).toISOString(), event: { ...input, agentId: agent.id } });
  assert.equal((await handle(request(token, { ...input, eventType: 'agent.heartbeat', payload: { runnerState: 'waiting', nextScheduledAt: '2026-10-05T00:00:00Z' } }))).status, 202);
  assert.equal((await read(reports, A)).truncated, true);
  const health = (await agentsWithHealth(A, [agent], reports, now))[0].health;
  assert.equal(health.state, 'waiting');
  assert.equal(health.nextScheduledAt, '2026-10-05T00:00:00.000Z');
  assert.equal((await handle(request(token, { ...input, occurredAt: '2026-10-04T11:00:00Z', eventType: 'backup.failed' }))).status, 202);
  assert.equal((await agentsWithHealth(A, [agent], reports, now))[0].health.state, 'waiting');
  assert.equal((await agentsWithHealth(B, [agent], reports, now))[0].health.freshness, 'missing');
  const latest = await reports.get(latestReportKey(A, agent.id));
  await reports.setJSON(latestReportKey(A, agent.id), { ...latest, owner: B });
  assert.equal((await agentsWithHealth(A, [agent], reports, now))[0].health.freshness, 'missing');
});

test('missing, revoked, delayed, and sleeping reports never become false healthy states', () => {
  const agent = { id: 'd9ad1c08-797e-4bd6-a119-afd477bff42a', projectRef: ref };
  const report = event => ({ owner: A, event: { ...input, ...event, agentId: agent.id }, receivedAt: new Date(now).toISOString() });
  assert.equal(runnerHealth(agent, null, now).state, 'unknown');
  const waiting = report({ eventType: 'agent.heartbeat', payload: { runnerState: 'waiting', nextScheduledAt: '2026-10-05T00:00:00Z' } });
  assert.equal(runnerHealth(agent, waiting, now).state, 'waiting');
  const stale = runnerHealth(agent, waiting, now + 20 * 60_000);
  assert.equal(stale.state, 'unknown');
  assert.equal(stale.lastKnownState, 'waiting');
  assert.equal(stale.nextScheduledAt, '2026-10-05T00:00:00.000Z');
  assert.equal(stale.freshness, 'stale');
  assert.equal(runnerHealth({ ...agent, revokedAt: new Date(now).toISOString() }, waiting, now).freshness, 'revoked');
  assert.equal(runnerHealth(agent, report({ occurredAt: '2026-10-04T11:00:00Z', eventType: 'job.started' }), now).state, 'unknown');
  assert.equal(runnerHealth(agent, report({ eventType: 'job.failed', payload: { runnerState: 'completed' } }), now + 20 * 60_000).state, 'needs_attention');
  assert.equal(runnerHealth(agent, report({ eventType: 'job.started' }), now).state, 'running');
  assert.equal(runnerHealth(agent, report({ eventType: 'agent.heartbeat', payload: { runnerState: 'starting' } }), now).state, 'starting');
  assert.equal(runnerHealth(agent, report({ eventType: 'job.completed' }), now).state, 'completed');
});

test('concurrent latest-report updates cannot regress event time', async () => {
  const store = memoryStore();
  const agentId = 'd9ad1c08-797e-4bd6-a119-afd477bff42a';
  await Promise.all([2, 0, 1, 3].map(offset => storeLatestReport(store, { owner: A, receivedAt: new Date(now).toISOString(), event: { ...input, agentId, occurredAt: new Date(now + offset * 1000).toISOString() } })));
  assert.equal((await store.get(latestReportKey(A, agentId))).event.occurredAt, new Date(now + 3000).toISOString());
});

test('a failed latest-report index never returns a successful ingest or healthy account response', async () => {
  const credentials = memoryStore();
  const { token } = await createAgent(A, { projectRef: ref }, credentials);
  const reports = memoryStore();
  const unavailable = { ...reports, getWithMetadata: async () => { throw new Error('private provider error'); } };
  const handle = createTelemetryHandler({ enqueueNotifications: async () => [], authenticate: header => authenticateAgent(header, credentials), storeFactory: () => unavailable, now: () => now });
  assert.equal((await handle(request(token))).status, 503);
  const account = createAgentsHandler({ verifyUser: async () => ({ id: 'customer-a', cloudVersion: 'supabase' }), list: owner => listAgents(owner, credentials), health: () => { throw new Error('private provider error'); } });
  const response = await account({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.includes('private provider error'), false);
});

test('a failure wins equal-timestamp delivery races with successful reports', async () => {
  const store = memoryStore();
  const agentId = 'd9ad1c08-797e-4bd6-a119-afd477bff42a';
  for (const eventType of ['job.completed', 'job.failed', 'agent.heartbeat']) {
    await storeLatestReport(store, { owner: A, receivedAt: new Date(now).toISOString(), event: { ...input, agentId, eventType, payload: { runnerState: 'waiting' } } });
  }
  assert.equal((await store.get(latestReportKey(A, agentId))).event.eventType, 'job.failed');
});
