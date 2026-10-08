import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { validScheduleInput, validScheduleRecord } from '../netlify/shared/schedule-contract.mjs';
import { normalizeJobQueue } from '../netlify/shared/job-queue-envelope.mjs';
import { ownerKey, agentKey, authenticateAgent, listAgents } from '../netlify/shared/agent-store.mjs';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { createRunnerJobsHandler } from '../netlify/functions/cloud-runner-jobs.mjs';
import { createSchedulesHandler } from '../netlify/functions/cloud-schedules.mjs';
import { createManagedScheduleDispatcher } from '../netlify/shared/managed-schedule-dispatch.mjs';

const user = { id: 'schedule-security-owner', cloudVersion: 'supabase' };
const foreign = { id: 'schedule-security-foreign', cloudVersion: 'supabase' };
const owner = ownerKey(user), accountKey = 'supabase:schedule-security-owner';
const runnerId = '11111111-1111-4111-8111-111111111111';
const configRef = '33333333-3333-4333-8333-333333333333';
const scheduleId = '55555555-5555-4555-8555-555555555555';
const instant = Date.parse('2026-10-05T12:00:00.000Z');
const token = `pb_agent_${owner}_0_${'b'.repeat(64)}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const paid = { userId: accountKey, plan: 'cloud-17', status: 'active', verifiedBy: 'square_api',
  squareVerifiedAt: '2026-10-05T00:00:00.000Z', squareSubscriptionId: 'synthetic-subscription', currentPeriodEnd: '2026-11-05T00:00:00.000Z' };
const input = () => ({ id: scheduleId, revision: 0, runnerId, configRef, configRevision: 1,
  everyHours: 24, startAt: new Date(instant + 60000).toISOString(), enabled: true });

function memoryStore() {
  const rows = new Map(); let revision = 0;
  return { rows, beforeWrite: null,
    async get(key) { return structuredClone(rows.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
    list({ prefix = '' } = {}) {
      const blobs = [...rows.keys()].filter(key => key.startsWith(prefix)).sort().map(key => ({ key }));
      return { async *[Symbol.asyncIterator]() { yield { blobs }; } };
    },
    async setJSON(key, data, options = {}) {
      if (this.beforeWrite) { const result = await this.beforeWrite(key, data, options); if (result !== undefined) return result; }
      const previous = rows.get(key);
      if (options.onlyIfNew && previous || options.onlyIfMatch && options.onlyIfMatch !== previous?.etag) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++revision) }); return { modified: true };
    },
  };
}

async function fixture() {
  const { createManagedSchedules } = await import('../netlify/shared/managed-schedules.mjs');
  const jobs = memoryStore(), agents = memoryStore(), index = memoryStore();
  const f = { jobs, agents, index, now: instant, subscription: structuredClone(paid), reads: 0,
    env: { PORTABASE_SCHEDULE_DISPATCH_ENABLED: 'true' } };
  f.agent = { id: runnerId, owner, slot: 0, accountKey, projectRef: 'abcdefghijklmnopqrst',
    credentialVersion: 2, credentialRevision: 1, jobAccess: true, tokenHash: hash(token), revokedAt: null };
  await agents.setJSON(agentKey(owner, 0), f.agent);
  f.service = createManagedSchedules({ database: () => jobs, indexDatabase: () => index, agentDatabase: () => agents,
    subscription: async requested => { f.reads++; assert.equal(requested.cloudVersion, 'supabase');
      return requested.id === user.id ? structuredClone(f.subscription) : null; },
    clock: () => f.now, env: f.env });
  f.queue = async () => normalizeJobQueue(await jobs.get(`jobs:${accountKey}`));
  f.save = body => f.service.save(user, body || input());
  f.dispatch = () => f.service.dispatchAccount({ version: 1, owner, accountKey });
  f.due = async () => { await f.save(); f.now += 60000; };
  f.disable = async () => {
    const schedule = (await f.queue()).schedules[0];
    return f.service.disable(user, { id: schedule.id, revision: schedule.revision, enabled: false });
  };
  const adapters = { database: () => jobs, getSubscription: async () => structuredClone(f.subscription),
    clock: () => f.now, ownedRunners: requested => listAgents(requested, agents),
    authenticateRunner: authorization => authenticateAgent(authorization, agents), publishCompletion: async () => {} };
  const accountHandler = createJobsHandler({ ...adapters, authenticate: async () => user });
  const runnerHandler = createRunnerJobsHandler(adapters);
  const send = async (handler, body) => {
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${token}` } });
    return { httpStatus: result.statusCode, ...JSON.parse(result.body) };
  };
  f.manual = () => send(accountHandler, { version: 2, type: 'backup', runnerId, configRef, configRevision: 1, requestId: randomUUID() });
  f.claimRequest = () => ({ version: 2, type: 'claim', runnerId, claimProtocol: 1, claimSequence: 1, claimRequestId: randomUUID() });
  f.runnerRequest = body => send(runnerHandler, body);
  return f;
}

test('schedule schema rejects credentials, private inventory, operation overrides and malformed retained data', () => {
  const good = input(); assert.equal(validScheduleInput(good), true);
  for (const patch of [{ password: 'synthetic-private' }, { payload: { tables: ['private.table'] } },
    { type: 'replay' }, { targetRef: 'abcdefghijklmnopqrst' }, { capsulePath: '/private' },
    { configRevision: 0 }, { configRevision: '1' }, { enabled: 'true' }, { startAt: '2026-10-05' },
    { startAt: '2026-02-31T12:00:00.000Z' }, { runnerId: '../escape' }, { everyHours: 0 }, { everyHours: 1.5 }]) {
    assert.equal(validScheduleInput({ ...good, ...patch }), false);
  }
  const record = { ...good, revision: 1, nextDueAt: good.startAt, lastScheduledAt: null, lastJobId: null,
    lastOutcome: 'waiting', updatedAt: new Date(instant).toISOString() };
  assert.equal(validScheduleRecord(record), true);
  for (const patch of [{ rawError: 'synthetic-private' }, { lastOutcome: 'private-provider-error' },
    { nextDueAt: 'tomorrow' }, { lastJobId: 'private name' }, { revision: 0 }]) {
    assert.equal(validScheduleRecord({ ...record, ...patch }), false);
    assert.throws(() => normalizeJobQueue({ version: 2, jobs: [], claimSlots: [], schedules: [{ ...record, ...patch }] }));
  }
});

test('free, unverified and expired billing cannot create scheduled execution or persist private fields', async () => {
  for (const record of [null, { ...paid, verifiedBy: 'browser' }, { ...paid, currentPeriodEnd: new Date(instant).toISOString() }]) {
    const f = await fixture(); f.subscription = record;
    await assert.rejects(f.save());
    assert.equal((await f.queue()).jobs.length, 0);
    assert.equal((await f.queue()).schedules?.length || 0, 0);
  }
  const f = await fixture();
  await assert.rejects(f.save({ ...input(), password: 'PRIVATE_CANARY', tables: ['PRIVATE_CANARY'] }));
  assert.doesNotMatch(JSON.stringify([...f.jobs.rows, ...f.index.rows]), /PRIVATE_CANARY/);
});

test('owner isolation denies foreign schedule reads, updates, deletion and poisoned dispatch indexes', async () => {
  const f = await fixture(); await f.due();
  const original = structuredClone([...f.jobs.rows]);
  assert.doesNotMatch(JSON.stringify(await f.service.read(foreign)), new RegExp(scheduleId));
  await assert.rejects(f.service.save(foreign, { ...input(), revision: 1 }));
  await assert.rejects(f.service.disable(foreign, { id: scheduleId, revision: 1, enabled: false }));
  await assert.rejects(f.service.remove(foreign, { id: scheduleId, revision: 1 }));
  for (const index of [{ version: 1, owner: ownerKey(foreign), accountKey },
    { version: 1, owner, accountKey: 'supabase:schedule-security-foreign' },
    { version: 1, owner, accountKey, credential: 'PRIVATE_CANARY' }]) await assert.rejects(f.service.dispatchAccount(index));
  assert.deepEqual([...f.jobs.rows], original);
});

test('revocation and slot replacement block due execution; credential rotation preserves runner identity', async () => {
  for (const patch of [{ revokedAt: new Date(instant).toISOString() }, { id: randomUUID() },
    { owner: ownerKey(foreign), accountKey: 'supabase:schedule-security-foreign' }, { jobAccess: false }]) {
    const f = await fixture(); await f.due();
    await f.agents.setJSON(agentKey(owner, 0), { ...f.agent, ...patch });
    await f.dispatch(); assert.equal((await f.queue()).jobs.length, 0);
    assert.equal((await f.queue()).schedules[0].lastOutcome, 'runner_unavailable');
  }
  const f = await fixture(); await f.due();
  await f.agents.setJSON(agentKey(owner, 0), { ...f.agent, credentialRevision: 2, tokenHash: hash('synthetic-rotated') });
  await f.dispatch(); assert.equal((await f.queue()).jobs.length, 1);
  assert.equal((await f.queue()).jobs[0].runnerId, runnerId);
});

test('CAS retry reloads revocation, billing expiry and schedule pause before reserving a job', async () => {
  for (const change of ['revoke', 'expire', 'pause']) {
    const f = await fixture(); await f.due(); let collided = false;
    f.jobs.beforeWrite = async (_, row) => {
      if (!(row.jobs || []).length || collided) return;
      collided = true; f.jobs.beforeWrite = null;
      if (change === 'revoke') await f.agents.setJSON(agentKey(owner, 0), { ...f.agent, revokedAt: new Date(f.now).toISOString() });
      if (change === 'expire') f.subscription.currentPeriodEnd = new Date(f.now).toISOString();
      if (change === 'pause') await f.disable();
      return { modified: false };
    };
    await f.dispatch(); assert.equal(collided, true); assert.equal((await f.queue()).jobs.length, 0);
    const schedule = (await f.queue()).schedules[0];
    assert.equal(change === 'pause' ? schedule.enabled : schedule.lastOutcome,
      change === 'pause' ? false : change === 'revoke' ? 'runner_unavailable' : 'subscription_required');
  }
});

test('manual and scheduled backup compete for the same account quota reservation', async () => {
  const f = await fixture(); f.subscription.plan = 'cloud-7'; await f.due();
  const [manual] = await Promise.all([f.manual(), f.dispatch()]);
  const queued = (await f.queue()).jobs;
  assert.equal(queued.length, 1); assert.equal(queued[0].type, 'backup');
  assert.ok([200, 429].includes(manual.httpStatus));
  await f.dispatch(); assert.equal((await f.queue()).jobs.length, 1);
});

test('paused queued schedules cannot claim and retain their consumed quota evidence', async () => {
  const f = await fixture(); f.subscription.plan = 'cloud-7'; await f.due(); await f.dispatch();
  assert.equal((await f.queue()).jobs.length, 1);
  await f.disable();
  const claimed = await f.runnerRequest(f.claimRequest());
  assert.equal(claimed.httpStatus, 200); assert.equal(claimed.job, null);
  assert.equal((await f.queue()).jobs.length, 1); assert.equal((await f.queue()).jobs[0].status, 'cancelled');
  assert.equal((await f.manual()).httpStatus, 429);
});

test('lost running claim cannot recover execution after pause, but exact completion remains acknowledgeable', async () => {
  const f = await fixture(); await f.due(); await f.dispatch();
  const request = f.claimRequest(), first = await f.runnerRequest(request);
  assert.equal(first.httpStatus, 200); assert.equal(first.job.status, 'running');
  await f.disable();
  const recovered = await f.runnerRequest(request);
  assert.equal(recovered.httpStatus, 409); assert.equal(recovered.error, 'schedule_no_longer_active');
  const completed = await f.runnerRequest({ version: 2, type: 'finish', runnerId, jobId: first.job.id,
    status: 'succeeded', safeError: null });
  assert.equal(completed.httpStatus, 200);
  const terminal = await f.runnerRequest(request);
  assert.equal(terminal.httpStatus, 200); assert.equal(terminal.job.status, 'succeeded');
});

test('disabled dispatch performs no queue mutation and API reports deployment state accurately', async () => {
  const f = await fixture(); await f.due();
  const before = structuredClone([...f.jobs.rows]);
  for (const flag of [undefined, '', 'false', true, 'TRUE', '1']) {
    f.env.PORTABASE_SCHEDULE_DISPATCH_ENABLED = flag;
    assert.deepEqual(await f.dispatch(), { state: 'disabled', queued: 0, blocked: 0 });
    assert.equal((await f.service.read(user)).dispatcherEnabled, false);
    assert.deepEqual([...f.jobs.rows], before);
  }
});

test('scheduled dispatcher persists bounded traversal and reaches every indexed account across invocations', async () => {
  const index = memoryStore(), cursor = memoryStore(), calls = [];
  const records = ['alpha', 'beta', 'gamma'].map((name, position) => {
    const indexedAccount = `supabase:dispatcher-${name}-${position}`, indexedOwner = hash(indexedAccount);
    return { key: `owners/${indexedOwner}`, row: { version: 1, owner: indexedOwner, accountKey: indexedAccount } };
  });
  for (const record of records) await index.setJSON(record.key, record.row);
  const dispatcher = createManagedScheduleDispatcher({
    env: { PORTABASE_SCHEDULE_DISPATCH_ENABLED: 'true' },
    service: { dispatchAccount: async record => { calls.push(record.accountKey); return { queued: 1, blocked: 0 }; } },
    indexDatabase: () => index,
    cursorDatabase: () => cursor,
    clock: () => instant,
    maxAccounts: 2,
  });
  const first = await dispatcher();
  assert.deepEqual(first, { state: 'ran', inspected: 2, queued: 2, blocked: 0, errors: 0, pages: 2 });
  const afterFirst = await cursor.get('cursor-v1');
  assert.equal(afterFirst.pending.length, 1); assert.equal(afterFirst.leaseUntil, 0); assert.equal(afterFirst.cycles, 0);
  const second = await dispatcher();
  assert.deepEqual(second, { state: 'ran', inspected: 1, queued: 1, blocked: 0, errors: 0, pages: 0 });
  assert.deepEqual(new Set(calls), new Set(records.map(record => record.row.accountKey)));
  const afterSecond = await cursor.get('cursor-v1');
  assert.equal(afterSecond.pending.length, 0); assert.deepEqual(afterSecond.tasks, ['']);
  assert.equal(afterSecond.cycles, 1); assert.equal(afterSecond.leaseUntil, 0);
});

test('scheduled dispatcher lease excludes overlap and malformed cursor state fails closed', async () => {
  const index = memoryStore(), cursor = memoryStore();
  const indexedAccount = 'supabase:dispatcher-lease', indexedOwner = hash(indexedAccount);
  await index.setJSON(`owners/${indexedOwner}`, { version: 1, owner: indexedOwner, accountKey: indexedAccount });
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const dispatcher = createManagedScheduleDispatcher({
    env: { PORTABASE_SCHEDULE_DISPATCH_ENABLED: 'true' },
    service: { dispatchAccount: async () => { enter(); await held; return { queued: 0, blocked: 1 }; } },
    indexDatabase: () => index,
    cursorDatabase: () => cursor,
    clock: () => instant,
  });
  const active = dispatcher();
  try {
    await Promise.race([entered, new Promise((_, reject) => setTimeout(() => reject(new Error('dispatcher_did_not_enter')), 1000))]);
    assert.deepEqual(await dispatcher(), { state: 'busy' });
  } finally { release(); }
  assert.equal((await active).blocked, 1);
  const released = await cursor.get('cursor-v1'); assert.equal(released.leaseUntil, 0);

  await cursor.setJSON('cursor-v1', { version: 1, tasks: ['PRIVATE_CANARY'], pending: [], cycles: 0,
    leaseToken: randomUUID(), leaseUntil: 0 });
  await assert.rejects(dispatcher(), { message: 'invalid_schedule_dispatch_cursor' });
});

test('customer API refuses unauthenticated and oversized mutations before service access', async () => {
  const service = new Proxy({}, { get: () => assert.fail('rejected request must not access service') });
  const denied = createSchedulesHandler({ authenticate: async () => { throw new Error('PRIVATE_CANARY'); }, service });
  for (const httpMethod of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const response = await denied({ httpMethod, body: JSON.stringify(input()) });
    assert.equal(response.statusCode, 401); assert.doesNotMatch(response.body, /PRIVATE_CANARY/);
  }
  const allowed = createSchedulesHandler({ authenticate: async () => user, service });
  for (const event of [{ httpMethod: 'PUT', body: 'x'.repeat(4097) },
    { httpMethod: 'PUT', body: Buffer.from('x'.repeat(4097)).toString('base64'), isBase64Encoded: true },
    { httpMethod: 'POST', body: '{}' }]) {
    const response = await allowed(event); assert.equal(response.statusCode, event.httpMethod === 'POST' ? 405 : 413);
  }
});

test('corrupt retained schedules fail closed at customer reads and dispatch without exposing private diagnostics', async () => {
  const f = await fixture(); await f.due();
  const queue = await f.queue(); queue.schedules[0].privateDiagnostic = 'PRIVATE_CANARY';
  await f.jobs.setJSON(`jobs:${accountKey}`, queue);
  const before = structuredClone([...f.jobs.rows]);
  const handler = createSchedulesHandler({ authenticate: async () => user, service: f.service });
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 503); assert.doesNotMatch(response.body, /PRIVATE_CANARY/);
  await assert.rejects(f.dispatch()); assert.deepEqual([...f.jobs.rows], before);
});
