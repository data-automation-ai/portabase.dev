import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { createRunnerJobsHandler } from '../netlify/functions/cloud-runner-jobs.mjs';
import { ownerKey } from '../netlify/shared/agent-store.mjs';
import { createJobCompletionPublisher, jobCompletionEvent } from '../netlify/shared/job-completion-events.mjs';
import { createNotificationOutbox } from '../netlify/shared/notification-outbox.mjs';
import { notificationMessage } from '../netlify/shared/notification-message.mjs';
import { latestReportKey, runnerHealth } from '../netlify/shared/runner-reports.mjs';
import { collectTelemetryEvents } from '../netlify/functions/cloud-telemetry-events.mjs';
import { pullOnce } from '../cloud/runner/worker.mjs';
import { safeCloudEvent, CLOUD_EVENT_MAX_AGE_MS } from '../netlify/shared/safe-telemetry.mjs';
import { normalizeJobQueue } from '../netlify/shared/job-queue-envelope.mjs';

function memoryStore() {
  const rows = new Map(); let revision = 0;
  return {
    rows, beforeWrite: null,
    async get(key) { return structuredClone(rows.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
    async setJSON(key, data, options = {}) {
      this.beforeWrite?.(key, data);
      const old = rows.get(key);
      if (options.onlyIfNew && old || options.onlyIfMatch && old?.etag !== options.onlyIfMatch) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++revision) }); return { modified: true };
    },
  };
}
const runnerId = '11111111-1111-4111-8111-111111111111', configRef = '33333333-3333-4333-8333-333333333333';
const safeResult = { schemaVersion: 1, capsuleId: 'abcdefghijklmnopqrst-20261005T120000Z', status: 'COMPLETE',
  capsuleHash: 'a'.repeat(64), manifestHash: 'b'.repeat(64), sizeBytes: 4096, objectCount: 12,
  durationMs: 2500, destinationKind: 's3', destinationVerified: true, completedAt: '2026-10-05T12:00:00.000Z' };
async function fixture({ type = 'backup', consent = true, verified = true } = {}) {
  const user = { id: 'synthetic', cloudVersion: 'supabase' }, owner = ownerKey(user);
  const runner = { owner, id: runnerId, jobAccess: true, projectRef: 'abcdefghijklmnopqrst',
    accountKey: 'supabase:synthetic', credentialVersion: 2, credentialRevision: 1, slot: 0 };
  const token = `pb_agent_${owner}_0_${'b'.repeat(64)}`;
  const queue = memoryStore(), telemetry = memoryStore(), notifications = memoryStore();
  const state = { now: Date.parse('2026-10-05T12:00:00.000Z'), consent, verified, runner, publishes: 0 };
  const job = { id: 'job_first', version: 2, runnerId, workerId: runnerId, type, status: 'running',
    createdAt: '2026-10-05T11:59:00.000Z', claimedAt: '2026-10-05T11:59:01.000Z',
    payload: { version: 2, runnerId, configRef, configRevision: 1 }, admission: { maxBytes: 1000, paid: false, planId: 'cloud-free', manual: true } };
  await queue.setJSON('jobs:supabase:synthetic', [job]);
  const outbox = createNotificationOutbox({ store: notifications, clock: () => state.now,
    authenticate: async authorization => authorization === `Bearer ${token}` ? state.runner : null,
    agentActive: async (account, id) => account === owner && id === runnerId && !state.runner?.revokedAt,
    getPreferences: async () => state.consent ? { owner, revision: 1, preferences: { email: { onFailure: true, onSuccess: true }, sms: { onFailure: true, onSuccess: true } } } : null,
    getDestination: async (_, channel) => state.verified ? { owner, channel, id: `contact-${channel}`, revision: 1,
      address: channel === 'email' ? 'private-recipient@example.test' : '+15550000123', verifiedAt: '2026-10-01T00:00:00Z' } : null,
  });
  const publish = createJobCompletionPublisher({ telemetryStore: () => telemetry, enqueueNotifications: input => outbox.enqueue(input), clock: () => state.now });
  const adapters = { database: () => queue, clock: () => state.now,
    authenticateRunner: async authorization => authorization === `Bearer ${token}` ? state.runner : null,
    ownedRunners: async () => [runner], getSubscription: async () => null,
    publishCompletion: async input => { state.publishes++; await publish(input); },
  };
  const handler = createJobsHandler({ ...adapters, authenticate: async () => user });
  const runnerHandler = createRunnerJobsHandler(adapters);
  const request = body => handler({ httpMethod: 'POST', headers: { 'X-Portabase-Agent-Authorization': `Bearer ${token}` }, body: JSON.stringify(body) });
  const finish = (patch = {}) => request({ version: 2, type: 'finish', runnerId, jobId: job.id, status: 'succeeded', ...patch });
  return { user, owner, runner, token, queue, telemetry, notifications, state, job, outbox, request, finish, handler, runnerHandler };
}
const events = store => [...store.rows].filter(([key]) => key.includes('/job-')).map(([, row]) => row.data);
const alerts = store => [...store.rows.values()].map(row => row.data);

test('owned completed backup/verify/replay publishes minimal operation-specific events and opted-in outbox records', async () => {
  for (const type of ['backup', 'verify', 'replay']) for (const status of ['succeeded', 'failed']) {
    const f = await fixture({ type });
    const response = await f.finish({ status, safeError: 'private-table-or-provider-diagnostic' });
    assert.equal(response.statusCode, 200);
    const eventType = `${type === 'replay' ? 'restore' : type}.${status === 'failed' ? 'failed' : 'completed'}`;
    const records = events(f.telemetry); assert.equal(records.length, 1);
    assert.equal(records[0].event.eventType, eventType);
    assert.equal(records[0].event.occurredAt, '2026-10-05T12:00:00.000Z');
    assert.equal(records[0].receivedAt, records[0].event.occurredAt);
    assert.equal(Object.hasOwn(records[0].event.payload, 'verified'), false);
    assert.equal(alerts(f.notifications).length, 2);
    assert.ok(alerts(f.notifications).every(row => row.state === 'pending' && row.eventType === eventType));
    const health = runnerHealth(f.runner, await f.telemetry.get(latestReportKey(f.owner, runnerId)), f.state.now);
    assert.equal(health.state, status === 'failed' ? 'needs_attention' : 'completed');
    const serialized = JSON.stringify([records, alerts(f.notifications)]);
    assert.doesNotMatch(serialized, /private-table|private-recipient|15550000123|configRef|configRevision|restorePlan|capsulePath/);
    assert.equal(Object.hasOwn(JSON.parse(response.body).job, 'completionEventsPending'), false);
    assert.equal((await f.queue.get('jobs:supabase:synthetic'))[0].completionEventsPending, false);
    const collected = await collectTelemetryEvents({ owner: f.owner, now: f.state.now, days: 1,
      listKeys: async prefix => [...f.telemetry.rows.keys()].filter(key => key.startsWith(prefix)), getRecord: key => f.telemetry.get(key) });
    assert.equal(collected.events.length, 1); assert.equal(collected.events[0].eventType, eventType);
  }
});

test('backup completion carries only safe capsule metadata into response and telemetry', async () => {
  const f = await fixture();
  const response = await f.finish({ result: { ...safeResult } });
  assert.equal(response.statusCode, 200);
  const job = JSON.parse(response.body).job;
  for (const [key, value] of Object.entries(safeResult)) {
    assert.deepEqual(job[key === 'status' ? 'capsuleStatus' : key], value);
  }
  assert.equal(job.status, 'succeeded');
  assert.equal(job.projectRef, f.runner.projectRef);
  const payload = events(f.telemetry)[0].event.payload;
  for (const key of ['capsuleId', 'capsuleHash', 'manifestHash', 'sizeBytes', 'objectCount', 'durationMs', 'destinationKind', 'destinationVerified']) {
    assert.deepEqual(payload[key], safeResult[key]);
  }
  assert.doesNotMatch(JSON.stringify([job, payload]), /passphrase|credential|privatePath|objectName|capsuleBytes/);
});

test('default-off consent or missing verified destination produces only suppressed tombstones', async () => {
  for (const options of [{ consent: false }, { verified: false }]) {
    const f = await fixture(options); assert.equal((await f.finish()).statusCode, 200);
    assert.ok(alerts(f.notifications).every(row => row.state === 'suppressed'));
    f.state.consent = true; f.state.verified = true;
    assert.equal((await f.finish()).statusCode, 200);
    assert.equal(f.state.publishes, 1); assert.ok(alerts(f.notifications).every(row => row.state === 'suppressed'));
  }
});

test('partial persistence after terminal job returns503 and unchanged retry repairs exactly one event per job/channel', async () => {
  const f = await fixture({ type: 'replay' }); let failSms = true;
  f.notifications.beforeWrite = key => { if (failSms && key.endsWith('/sms')) throw new Error('synthetic outbox unavailable'); };
  assert.equal((await f.finish({ status: 'failed' })).statusCode, 503);
  const original = (await f.queue.get('jobs:supabase:synthetic'))[0];
  assert.equal(original.status, 'failed'); assert.equal(original.completionEventsPending, true);
  assert.equal(events(f.telemetry).length, 1); assert.equal(f.notifications.rows.size, 1);
  f.state.now += 86400000; failSms = false;
  const repaired = await f.finish({ status: 'failed' }); assert.equal(repaired.statusCode, 200);
  assert.equal(JSON.parse(repaired.body).deduplicated, true);
  const final = (await f.queue.get('jobs:supabase:synthetic'))[0];
  assert.equal(final.finishedAt, original.finishedAt); assert.equal(final.completionEventsPending, false);
  assert.equal(events(f.telemetry).length, 1); assert.equal(f.notifications.rows.size, 2);
  assert.ok(alerts(f.notifications).every(row => row.occurredAt === original.finishedAt));
  const snapshot = JSON.stringify([...f.notifications.rows]); await f.finish({ status: 'failed' });
  assert.equal(JSON.stringify([...f.notifications.rows]), snapshot); assert.equal(f.state.publishes, 2);
});

test('simultaneous retries coalesce, distinct jobs at the same timestamp remain distinct', async () => {
  const f = await fixture();
  const replies = await Promise.all(Array.from({ length: 8 }, () => f.finish()));
  assert.ok(replies.every(reply => reply.statusCode === 200));
  assert.equal(events(f.telemetry).length, 1); assert.equal(f.notifications.rows.size, 2);
  await f.queue.setJSON('jobs:supabase:synthetic', [...await f.queue.get('jobs:supabase:synthetic'), { ...f.job, id: 'job_second' }]);
  assert.equal((await f.finish({ jobId: 'job_second' })).statusCode, 200);
  assert.equal(events(f.telemetry).length, 2); assert.equal(f.notifications.rows.size, 4);
  assert.equal(new Set(alerts(f.notifications).map(row => row.eventId)).size, 2);
  assert.equal(new Set(events(f.telemetry).map(row => row.event.occurredAt)).size, 1);
});

test('unauthorized/conflicting finishes cannot emit; outbox job identity binds authenticated owner and runner', async () => {
  const f = await fixture();
  f.state.runner = { ...f.runner, owner: 'f'.repeat(64) };
  assert.equal((await f.finish()).statusCode, 403); assert.equal(f.telemetry.rows.size, 0);
  f.state.runner = f.runner; await f.finish();
  const size = f.notifications.rows.size;
  assert.equal((await f.finish({ status: 'failed' })).statusCode, 409); assert.equal(f.notifications.rows.size, size);
  const event = events(f.telemetry)[0].event;
  for (const patch of [{ sourceJobId: '../other' }, { expectedOwner: 'f'.repeat(64) }, { expectedAgentId: 'other' }]) {
    await assert.rejects(f.outbox.enqueue({ authorization: `Bearer ${f.token}`, input: event, sourceJobId: f.job.id,
      expectedOwner: f.owner, expectedAgentId: runnerId, ...patch }), /invalid_notification_job_binding/);
  }
  assert.throws(() => jobCompletionEvent({ ...f.job, status: 'succeeded', finishedAt: new Date(f.state.now).toISOString(), workerId: 'other' }, f.runner, f.state.now));
});

test('unpublished terminal completion survives queue trimming after24hours', async () => {
  const f = await fixture(); f.notifications.beforeWrite = () => { throw new Error('unavailable'); };
  await f.finish(); const pending = (await f.queue.get('jobs:supabase:synthetic'))[0];
  f.state.now += 2 * 86400000;
  const recent = Array.from({ length: 51 }, (_, i) => ({ id: `job_old_${i}`, type: 'verify', status: 'succeeded', createdAt: new Date(f.state.now).toISOString() }));
  await f.queue.setJSON('jobs:supabase:synthetic', [...recent, pending]);
  const queued = await f.request({ version: 2, type: 'verify', runnerId, configRef, configRevision: 1 });
  assert.equal(queued.statusCode, 200);
  assert.ok((await f.queue.get('jobs:supabase:synthetic')).some(row => row.id === f.job.id && row.completionEventsPending));
});

test('real worker completion journal retries notification outage without rerunning its synthetic engine', async t => {
  const f = await fixture();
  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const directory = await mkdtemp(join(tmpdir(), 'portabase-completion-events-test-'));
  t.after(async () => {
    const root = resolve(directory), base = resolve(tmpdir());
    assert.ok(root.startsWith(`${base}${sep}`) && basename(root).startsWith('portabase-completion-events-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(directory, configRef));
  const engine = JSON.stringify({ projectRef: f.runner.projectRef, backupDirectory: 'backups', statusDirectory: 'status' });
  await writeFile(join(directory, 'engine.json'), engine);
  await writeFile(join(directory, configRef, '1.json'), JSON.stringify({ ...f.job.payload, operation: 'backup', projectRef: f.runner.projectRef,
    engineConfigPath: 'engine.json', engineConfigSha256: createHash('sha256').update(engine).digest('hex'), excludeTables: [], excludeBuckets: [], incrementalBinary: false }));
  await f.queue.setJSON('jobs:supabase:synthetic', [{ ...f.job, status: 'queued', workerId: undefined }]);
  let runs = 0, fail = true;
  f.notifications.beforeWrite = () => { if (fail) throw new Error('outbox unavailable'); };
  const options = { baseUrl: 'https://cloud.example.test', token: 'synthetic', env: { PORTABASE_RUNNER_CONFIG_DIR: directory,
    PORTABASE_RUNNER_ID: runnerId, PORTABASE_PROJECT_REF: f.runner.projectRef, PORTABASE_AGENT_TOKEN: f.token },
    fetchImpl: async (url, request) => {
      assert.equal(new URL(url).pathname, '/api/cloud/runner-jobs');
      const response = await f.runnerHandler({ httpMethod: request.method, headers: request.headers, body: request.body });
      return { ok: response.statusCode < 300, status: response.statusCode, json: async () => JSON.parse(response.body) }; },
    spawnImpl: async () => { runs++; return { code: 0 }; } };
  await assert.rejects(pullOnce(options), { code: 'job_result_unconfirmed' });
  assert.equal(runs, 1); assert.equal(normalizeJobQueue(await f.queue.get('jobs:supabase:synthetic')).jobs[0].status, 'succeeded');
  fail = false; f.state.now += 60000;
  const retry = await pullOnce(options); assert.equal(retry.reconciled, true); assert.equal(runs, 1);
  assert.equal(events(f.telemetry).length, 1); assert.equal(f.notifications.rows.size, 2);
});

test('verification success and restore failure have accurate separately consented messages', () => {
  assert.match(notificationMessage({ eventType: 'verify.completed' }, { onSuccess: true }).text, /does not confirm a tested restore/);
  assert.equal(notificationMessage({ eventType: 'verify.completed' }, { onFailure: true }), null);
  assert.match(notificationMessage({ eventType: 'restore.failed' }, { onFailure: true }).text, /restore problem/);
  assert.equal(notificationMessage({ eventType: 'restore.failed' }, { onSuccess: true }), null);
});

test('overdue owned completion reconciles its original timestamp but permanently suppresses alerts', async () => {
  const f = await fixture(); let failed = true;
  f.notifications.beforeWrite = () => { if (failed) throw new Error('outbox unavailable'); };
  assert.equal((await f.finish()).statusCode, 503);
  const original = events(f.telemetry)[0];
  f.state.now += CLOUD_EVENT_MAX_AGE_MS + 86400000; failed = false;
  assert.equal((await f.finish()).statusCode, 200);
  assert.deepEqual(events(f.telemetry), [original]);
  assert.ok(alerts(f.notifications).every(row => row.state === 'suppressed' && row.reason === 'completion_too_old' && row.occurredAt === original.event.occurredAt));
  assert.throws(() => safeCloudEvent(original.event, f.runner, f.state.now), /invalid_timestamp/);
  await assert.rejects(f.outbox.enqueue({ authorization: `Bearer ${f.token}`, input: original.event }), /invalid_timestamp/);
  for (const row of alerts(f.notifications)) assert.equal(await f.outbox.claim(row), null);
  assert.equal((await f.queue.get('jobs:supabase:synthetic'))[0].completionEventsPending, false);
});

test('immutable terminal receipt acknowledges pruned history without new events or execution', async () => {
  const f = await fixture({ type: 'replay' }); assert.equal((await f.finish()).statusCode, 200);
  const original = JSON.parse((await f.finish()).body).job;
  f.state.now += 2 * 86400000;
  const completed = (await f.queue.get('jobs:supabase:synthetic'))[0];
  const recent = Array.from({ length: 51 }, (_, i) => ({ id: `job_new_${i}`, type: 'verify', status: 'succeeded', createdAt: new Date(f.state.now).toISOString() }));
  await f.queue.setJSON('jobs:supabase:synthetic', [...recent, completed]);
  assert.equal((await f.request({ version: 2, type: 'verify', runnerId, configRef, configRevision: 1 })).statusCode, 200);
  assert.equal((await f.queue.get('jobs:supabase:synthetic')).some(row => row.id === f.job.id), false);
  const response = await f.finish(); assert.equal(response.statusCode, 200);
  const returned = JSON.parse(response.body).job;
  for (const key of ['id', 'type', 'runnerId', 'version', 'status', 'safeError', 'finishedAt']) assert.equal(returned[key], original[key]);
  assert.deepEqual(returned.payload, original.payload);
  assert.equal(f.state.publishes, 1); assert.equal(events(f.telemetry).length, 1); assert.equal(f.notifications.rows.size, 2);
  assert.equal((await f.finish({ status: 'failed' })).statusCode, 409);
  f.state.runner = { ...f.runner, id: '22222222-2222-4222-8222-222222222222' };
  assert.equal((await f.finish({ runnerId: f.state.runner.id })).statusCode, 403);
});

test('receipt persistence failure retains completion retry and corrupted receipts fail closed', async () => {
  const f = await fixture(); let receiptUnavailable = true;
  f.queue.beforeWrite = key => { if (receiptUnavailable && key.startsWith('completions/')) throw new Error('receipt unavailable'); };
  assert.equal((await f.finish()).statusCode, 503);
  assert.equal((await f.queue.get('jobs:supabase:synthetic'))[0].completionEventsPending, true);
  receiptUnavailable = false; assert.equal((await f.finish()).statusCode, 200);
  assert.equal(f.notifications.rows.size, 2); assert.equal(events(f.telemetry).length, 1);
  const key = [...f.queue.rows.keys()].find(key => key.startsWith('completions/')), receipt = await f.queue.get(key);
  await f.queue.setJSON('jobs:supabase:synthetic', []);
  for (const mutate of [
    row => { row.owner = 'f'.repeat(64); }, row => { row.job.workerId = 'other'; },
    row => { row.job.payload.configRevision = '1'; }, row => { row.job.payload.extra = 'private'; },
    row => { row.job.status = 'running'; }, row => { row.job.safeError = 'private diagnostic'; },
    row => { row.extra = 'x'.repeat(3000); },
  ]) {
    const corrupt = structuredClone(receipt); mutate(corrupt); await f.queue.setJSON(key, corrupt);
    assert.equal((await f.finish()).statusCode, 503);
  }
  assert.equal(f.notifications.rows.size, 2);
});
