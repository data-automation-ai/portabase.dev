import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseJobRequest } from '../cloud/runner/job-intent.mjs';
import { normalizeJobQueue, storedJobQueue } from '../netlify/shared/job-queue-envelope.mjs';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { createRunnerJobsHandler } from '../netlify/functions/cloud-runner-jobs.mjs';
import { ownerKey } from '../netlify/shared/agent-store.mjs';

const runnerId = '11111111-1111-4111-8111-111111111111', configRef = '33333333-3333-4333-8333-333333333333';
const user = { cloudVersion: 'supabase', id: 'claim-test-owner' }, key = 'jobs:supabase:claim-test-owner';
const owner = ownerKey(user), token = `pb_agent_${owner}_0_${'b'.repeat(64)}`;
const instant = Date.parse('2026-10-05T12:00:00Z');
const durable = (sequence = 1, requestId = randomUUID()) => ({ version: 2, type: 'claim', runnerId,
  claimProtocol: 1, claimSequence: sequence, claimRequestId: requestId });
const intent = () => ({ version: 2, type: 'verify', runnerId, configRef, configRevision: 1 });
const job = (id = 'job_first') => ({ id, version: 2, runnerId, type: 'verify', status: 'queued',
  payload: { version: 2, runnerId, configRef, configRevision: 1 }, createdAt: new Date(instant).toISOString(),
  cloudVersion: 'supabase', admission: { paid: false, planId: 'cloud-free', maxBytes: 1000, manual: true } });
function memoryStore() {
  const rows = new Map(); let sequence = 0;
  return { rows, afterWrite: null,
    async get(name) { return structuredClone(rows.get(name)?.data ?? null); },
    async getWithMetadata(name) { return structuredClone(rows.get(name) ?? null); },
    async setJSON(name, data, options = {}) {
      const before = rows.get(name);
      if (options.onlyIfNew && before || options.onlyIfMatch && before?.etag !== options.onlyIfMatch) return { modified: false };
      rows.set(name, { data: structuredClone(data), etag: String(++sequence) });
      if (this.afterWrite) await this.afterWrite(name, data);
      return { modified: true };
    },
  };
}
async function setup(initial = [job()]) {
  const db = memoryStore(); await db.setJSON(key, initial);
  const f = { db, now: instant, subscription: null, outage: false, publications: 0, active: true, subscriptionReads: 0 };
  f.runner = { id: runnerId, owner, accountKey: 'supabase:claim-test-owner', slot: 0,
    projectRef: 'abcdefghijklmnopqrst', credentialVersion: 2, credentialRevision: 1, jobAccess: true };
  const adapters = { database: () => db, clock: () => f.now,
    getSubscription: async account => { assert.equal(account, 'supabase:claim-test-owner'); f.subscriptionReads++; return f.subscription; },
    authenticateRunner: async authorization => f.active && authorization === `Bearer ${token}` ? f.runner : null,
    ownedRunners: async () => [f.runner],
    publishCompletion: async () => { f.publications++; if (f.outage) throw new Error('synthetic publisher outage'); },
  };
  const runner = createRunnerJobsHandler(adapters), account = createJobsHandler({ ...adapters, authenticate: async () => user });
  f.request = async body => {
    const result = await runner({ httpMethod: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: result.statusCode, ...JSON.parse(result.body) };
  };
  f.queue = async body => {
    const result = await account({ httpMethod: 'POST', body: JSON.stringify(body) });
    return { status: result.statusCode, ...JSON.parse(result.body) };
  };
  f.read = async () => JSON.parse((await account({ httpMethod: 'GET' })).body);
  f.finish = id => f.request({ version: 2, type: 'finish', runnerId, jobId: id, status: 'succeeded', safeError: null });
  f.stored = async () => normalizeJobQueue(await db.get(key));
  return f;
}

test('durable claim fields are explicit, strict and separate from queue idempotency', () => {
  assert.equal(parseJobRequest({ version: 2, type: 'claim', runnerId }).ok, true);
  assert.equal(parseJobRequest(durable()).claimProtocol, 1);
  for (const patch of [{ claimProtocol: undefined }, { claimSequence: undefined }, { claimRequestId: undefined },
    { claimProtocol: 2 }, { claimSequence: '1' }, { claimSequence: 0 }, { claimSequence: 1.1 },
    { claimSequence: Number.MAX_SAFE_INTEGER + 1 }, { claimRequestId: 'private-name' }, { requestId: randomUUID() }]) {
    assert.equal(parseJobRequest({ ...durable(), ...patch }).ok, false);
  }
  assert.equal(parseJobRequest({ ...intent(), claimSequence: 1 }).ok, false);
});

test('envelope migration preserves legacy arrays and rejects malformed/unbounded claim metadata', () => {
  assert.deepEqual(normalizeJobQueue([job()]).jobs, [job()]);
  assert.deepEqual(storedJobQueue(normalizeJobQueue([job()]), [job()]), [job()]);
  const slot = { slot: 0, runnerId, sequence: 1, requestId: randomUUID(), jobId: null, decidedAt: new Date(instant).toISOString() };
  const envelope = { version: 1, jobs: [job()], claimSlots: [slot] };
  assert.deepEqual(storedJobQueue(envelope, [job()]), envelope);
  for (const value of [{}, { ...envelope, version: 2 }, { ...envelope, jobs: {} }, { ...envelope, privateData: 'refused' },
    { ...envelope, claimSlots: [slot, slot] }, { ...envelope, claimSlots: Array(13).fill(slot) },
    ...[{ slot: 12 }, { sequence: 0 }, { requestId: '../escape' }, { decidedAt: 'today' }, { jobId: 'private-name' }, { extra: true }]
      .map(patch => ({ ...envelope, claimSlots: [{ ...slot, ...patch }] }))]) assert.throws(() => normalizeJobQueue(value));
});

test('lost committed claim response recovers exact assignment and cannot consume a second job', async () => {
  const f = await setup([job('job_second'), job()]), request = durable();
  let lose = true;
  f.db.afterWrite = async (name, data) => { if (name === key && data.claimSlots?.length && lose) { lose = false; throw new Error('response lost after committed CAS'); } };
  assert.equal((await f.request(request)).status, 503);
  const retried = await f.request(request);
  assert.equal(retried.status, 200); assert.equal(retried.deduplicated, true); assert.equal(retried.job.id, 'job_first');
  assert.deepEqual(retried.claim, { protocol: 1, sequence: 1, requestId: request.claimRequestId, runnerId });
  assert.equal((await f.stored()).jobs.find(row => row.id === 'job_second').status, 'queued');
  assert.equal((await f.request(durable(2))).error, 'claim_previous_unfinished');
  assert.equal((await f.request({ version: 2, type: 'claim', runnerId })).error, 'durable_claim_required');
});

test('concurrent identical claims assign once; conflicting IDs and skipped sequences never claim more work', async () => {
  const f = await setup([job('job_second'), job()]), request = durable();
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.request(request)));
  assert.ok(responses.every(row => row.status === 200 && row.job.id === 'job_first'));
  assert.equal((await f.stored()).jobs.filter(row => row.status === 'running').length, 1);
  assert.equal((await f.request(durable())).error, 'claim_reference_conflict');
  assert.equal((await f.request(durable(3))).error, 'claim_sequence_conflict');
  const competing = await setup([job('job_second'), job()]);
  const pair = await Promise.all([competing.request(durable()), competing.request(durable())]);
  assert.deepEqual(pair.map(row => row.status).sort(), [200, 409]);
});

test('idle decision is durable even when work arrives; safe advance retires the prior sequence', async () => {
  const f = await setup([]), first = durable();
  f.db.afterWrite = async name => { if (name === key) { f.db.afterWrite = null; throw new Error('lost idle reply'); } };
  assert.equal((await f.request(first)).status, 503);
  const idle = await f.request(first); assert.equal(idle.status, 200); assert.equal(idle.job, null);
  assert.equal((await f.queue(intent())).status, 200);
  const repeated = await f.request(first); assert.equal(repeated.job, null); assert.deepEqual(repeated.claim, idle.claim);
  const next = await f.request(durable(2)); assert.equal(next.status, 200); assert.equal(next.job.status, 'running');
  assert.equal((await f.request(first)).error, 'claim_sequence_conflict');
  assert.equal((await f.stored()).claimSlots.length, 1);
});

test('completion outage blocks advance; retry preserves claim metadata, receipts and terminal recovery', async () => {
  const f = await setup([job('job_second'), job()]), first = durable();
  await f.request(first); f.outage = true;
  assert.equal((await f.finish('job_first')).status, 503);
  const terminal = await f.request(first); assert.equal(terminal.job.status, 'succeeded');
  assert.equal((await f.request(durable(2))).error, 'claim_previous_unfinished');
  f.outage = false; assert.equal((await f.finish('job_first')).status, 200);
  assert.equal((await f.stored()).claimSlots[0].requestId, first.claimRequestId);
  const subscriptionReads = f.subscriptionReads;
  assert.equal((await f.request(first)).job.status, 'succeeded'); assert.equal(f.subscriptionReads, subscriptionReads);
  assert.equal((await f.request(durable(2))).job.id, 'job_second');
  assert.ok(await f.db.get(`completions/${owner}/${runnerId}/job_first.json`));
});

test('current assignment remains pinned through pruning and unpins only after acknowledged advance', async () => {
  const f = await setup(), first = durable(); await f.request(first); await f.finish('job_first');
  f.now += 2 * 86400000;
  const recent = Array.from({ length: 60 }, (_, i) => ({ ...job(`job_recent_${i}`), status: 'succeeded',
    createdAt: new Date(f.now).toISOString(), finishedAt: new Date(f.now).toISOString(), safeError: null, completionEventsPending: false }));
  const stored = await f.stored(); await f.db.setJSON(key, { ...stored, jobs: [...recent, ...stored.jobs] });
  assert.equal((await f.queue(intent())).status, 200);
  assert.ok((await f.stored()).jobs.some(row => row.id === 'job_first'));
  assert.equal((await f.request(first)).job.id, 'job_first');
  const second = await f.request(durable(2)); await f.finish(second.job.id);
  assert.equal((await f.queue(intent())).status, 200);
  assert.equal((await f.stored()).jobs.some(row => row.id === 'job_first'), false);
  assert.equal((await f.finish('job_first')).status, 200); // Existing immutable receipt still acknowledges old results.
  assert.equal((await f.request(first)).error, 'claim_sequence_conflict');
});

test('recovered running assignment rechecks entitlement, terminal recovery does not grant new execution', async () => {
  const paidJob = { ...job(), admission: { paid: true, planId: 'cloud-7', maxBytes: 1000, manual: true } };
  const f = await setup([paidJob]), first = durable();
  f.subscription = { plan: 'cloud-7', status: 'active', verifiedBy: 'square_api', squareVerifiedAt: new Date(instant).toISOString(),
    squareSubscriptionId: 'synthetic-subscription', currentPeriodEnd: '2026-11-01T00:00:00Z' };
  assert.equal((await f.request(first)).status, 200);
  f.subscription = null;
  assert.equal((await f.request(first)).status, 402);
  assert.equal((await f.finish('job_first')).status, 200);
  assert.equal((await f.request(first)).job.status, 'succeeded');
  f.active = false; assert.equal((await f.request(first)).status, 401);
});

test('legacy transition cannot adopt running work; account projection never exposes internal claim state', async () => {
  const f = await setup();
  assert.equal((await f.request({ version: 2, type: 'claim', runnerId })).status, 200);
  assert.ok(Array.isArray(await f.db.get(key)));
  assert.equal((await f.request(durable())).error, 'runner_execution_pending');
  await f.finish('job_first');
  assert.equal((await f.request(durable())).status, 200);
  const read = await f.read(); assert.equal(read.ok, true); assert.ok(Array.isArray(read.jobs));
  assert.doesNotMatch(JSON.stringify(read), /claimSlots|claimSequence|decidedAt|claimProtocol|accountKey|pb_agent/);
});

test('foreign claims and corrupted assignment bindings cannot recover another job or create new work', async () => {
  const f = await setup(), first = durable(); await f.request(first);
  assert.equal((await f.request({ ...first, runnerId: randomUUID() })).status, 403);
  const original = await f.stored();
  for (const jobs of [[], [{ ...original.jobs[0], runnerId: randomUUID() }],
    [{ ...original.jobs[0], workerId: randomUUID() }], [{ ...original.jobs[0], status: 'queued' }]]) {
    await f.db.setJSON(key, { ...original, jobs });
    assert.equal((await f.request(first)).status, 503);
    assert.equal((await f.stored()).jobs.filter(row => row.id !== 'job_first').length, 0);
  }
  await f.db.setJSON(key, { ...original, claimSlots: [...original.claimSlots, ...original.claimSlots] });
  assert.equal((await f.request(first)).status, 503);
});

test('authorized runner-slot replacement starts at one without reviving the old running assignment', async () => {
  const f = await setup(), first = durable(); await f.request(first);
  const replacement = randomUUID(); f.runner = { ...f.runner, id: replacement };
  assert.equal((await f.request({ ...durable(2), runnerId: replacement })).error, 'claim_sequence_conflict');
  const next = await f.request({ ...durable(), runnerId: replacement });
  assert.equal(next.status, 200); assert.equal(next.job, null);
  const state = await f.stored(); assert.equal(state.claimSlots.length, 1); assert.equal(state.claimSlots[0].runnerId, replacement);
  assert.equal(state.jobs[0].status, 'running'); assert.equal(state.jobs[0].runnerId, runnerId);
  assert.equal((await f.request(first)).status, 403);
});
