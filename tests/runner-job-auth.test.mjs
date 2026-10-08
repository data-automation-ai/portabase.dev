import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, rotateAgent, revokeAgent, authenticateAgent, agentKey, ownerKey, runnerJobIdentity } from '../netlify/shared/agent-store.mjs';
import { createAgentsHandler } from '../netlify/functions/cloud-agents.mjs';
import { createRunnerJobsHandler } from '../netlify/functions/cloud-runner-jobs.mjs';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { getSubscriptionForUser } from '../netlify/shared/subscription-store.mjs';

const user = { cloudVersion: 'supabase', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const otherUser = { cloudVersion: 'supabase', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const owner = ownerKey(user), projectRef = 'abcdefghijklmnopqrst', now = Date.parse('2026-10-05T12:00:00Z');
const paid = { plan: 'cloud-7', status: 'active', verifiedBy: 'square_api', squareVerifiedAt: '2026-10-05T00:00:00Z',
  squareSubscriptionId: 'synthetic-subscription', currentPeriodEnd: '2026-11-01T00:00:00Z' };
function memoryStore() {
  const rows = new Map(); let sequence = 0;
  return { rows, get: async key => structuredClone(rows.get(key)?.data ?? null),
    getWithMetadata: async key => structuredClone(rows.get(key) ?? null),
    async setJSON(key, data, options = {}) {
      const old = rows.get(key);
      if (options.onlyIfNew && old || options.onlyIfMatch && options.onlyIfMatch !== old?.etag) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++sequence) }); return { modified: true };
    } };
}
const request = (token, body, extra = {}) => ({ httpMethod: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body), ...extra });
const claim = id => ({ version: 2, type: 'claim', runnerId: id });
const finish = (id, jobId, status = 'succeeded') => ({ version: 2, type: 'finish', runnerId: id, jobId, status, safeError: null });
const payload = runnerId => ({ version: 2, runnerId, configRef: '33333333-3333-4333-8333-333333333333', configRevision: 1 });
async function setup() {
  const credentials = memoryStore(), jobs = memoryStore();
  const created = await createAgent(owner, { projectRef }, credentials, { user });
  const runnerId = created.agent.id, accountKey = `supabase:${user.id}`;
  const job = { id: 'job_assigned', type: 'verify', version: 2, runnerId, payload: payload(runnerId),
    status: 'queued', createdAt: new Date(now).toISOString(), cloudVersion: 'supabase',
    admission: { paid: true, planId: 'cloud-7', maxBytes: 100000, manual: true } };
  await jobs.setJSON(`jobs:${accountKey}`, [job]);
  const queried = [], published = [];
  const options = { authenticateRunner: header => authenticateAgent(header, credentials), database: () => jobs, clock: () => now,
    getSubscription: async key => { queried.push(key); return paid; }, publishCompletion: async input => { published.push(input.job.id); } };
  return { credentials, jobs, created, runnerId, accountKey, job, queried, published, options, handle: createRunnerJobsHandler(options) };
}

test('new enrollment maps verified account server-side; caller mapping/flags never control credentials or public output', async () => {
  const store = memoryStore();
  const h = createAgentsHandler({ verifyUser: async () => user, create: (who, input, ignored, options) => createAgent(who, input, store, options) });
  const result = await h({ httpMethod: 'POST', body: JSON.stringify({ projectRef, owner: ownerKey(otherUser), accountKey: `supabase:${otherUser.id}`, jobAccess: false,
    user: otherUser, credentialVersion: 99, credentialRevision: 99 }) });
  assert.equal(result.statusCode, 201); assert.equal(result.headers['Cache-Control'], 'no-store');
  const exposed = JSON.parse(result.body), record = await authenticateAgent(`Bearer ${exposed.token}`, store);
  assert.equal(record.accountKey, `supabase:${user.id}`); assert.equal(record.owner, owner); assert.equal(record.jobAccess, true);
  assert.deepEqual(runnerJobIdentity(record), user); assert.equal(exposed.agent.credentialRevision, 1); assert.equal(exposed.agent.jobAccess, true);
  assert.doesNotMatch(JSON.stringify(exposed.agent), /accountKey|tokenHash|aaaaaaaa-aaaa/);
  assert.equal(JSON.stringify([...store.rows.values()]).includes(exposed.token), false);
  await assert.rejects(createAgent(owner, { projectRef }, store, { user: otherUser }), /invalid_runner_account/);
});

test('owner-authenticated rotation upgrades legacy telemetry credential, preserves identity and invalidates prior token', async () => {
  const store = memoryStore(), legacy = await createAgent(owner, { projectRef }, store);
  assert.equal(legacy.agent.jobAccess, false); assert.equal(legacy.agent.credentialRevision, 0);
  const h = createAgentsHandler({ verifyUser: async () => user, rotate: (who, input, identity) => rotateAgent(who, input, identity, store) });
  const body = { id: legacy.agent.id, expectedRevision: 0, enableJobAccess: true };
  const response = await h({ httpMethod: 'PATCH', body: JSON.stringify(body) }); assert.equal(response.statusCode, 200);
  const rotated = JSON.parse(response.body);
  for (const key of ['id', 'projectRef', 'slot', 'createdAt', 'name']) assert.equal(rotated.agent[key], legacy.agent[key]);
  assert.equal(rotated.agent.jobAccess, true); assert.equal(rotated.agent.credentialRevision, 1);
  assert.equal(await authenticateAgent(`Bearer ${legacy.token}`, store), null);
  assert.deepEqual(runnerJobIdentity(await authenticateAgent(`Bearer ${rotated.token}`, store)), user);
  assert.equal((await h({ httpMethod: 'PATCH', body: JSON.stringify(body) })).statusCode, 409);
  for (const patch of [{ enableJobAccess: 'true' }, { expectedRevision: '1' }, { accountKey: `supabase:${otherUser.id}` }, { id: ['x'] }]) {
    assert.equal((await h({ httpMethod: 'PATCH', body: JSON.stringify({ ...body, ...patch }) })).statusCode, 400);
  }
  const foreign = createAgentsHandler({ verifyUser: async () => otherUser, rotate: (who, input, identity) => rotateAgent(who, input, identity, store) });
  assert.equal((await foreign({ httpMethod: 'PATCH', body: JSON.stringify({ ...body, expectedRevision: 1 }) })).statusCode, 404);
  const unauthenticated = createAgentsHandler({ verifyUser: async () => { throw new Error('synthetic'); } });
  assert.equal((await unauthenticated({ httpMethod: 'PATCH', body: JSON.stringify(body) })).statusCode, 401);
  await revokeAgent(owner, legacy.agent.id, store);
  await assert.rejects(rotateAgent(owner, { ...body, expectedRevision: 1 }, user, store), error => error.status === 409);
});

test('concurrent rotations publish only one valid new token and cannot revive a revoked credential', async () => {
  const store = memoryStore(), legacy = await createAgent(owner, { projectRef }, store);
  const body = { id: legacy.agent.id, expectedRevision: 0, enableJobAccess: true };
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => rotateAgent(owner, body, user, store)));
  const successes = attempts.filter(row => row.status === 'fulfilled'); assert.equal(successes.length, 1);
  assert.equal(attempts.filter(row => row.status === 'rejected' && row.reason.status === 409).length, 5);
  assert.ok(await authenticateAgent(`Bearer ${successes[0].value.token}`, store));
  assert.equal(await authenticateAgent(`Bearer ${legacy.token}`, store), null);
  const race = await Promise.allSettled([rotateAgent(owner, { ...body, expectedRevision: 1 }, user, store), revokeAgent(owner, legacy.agent.id, store)]);
  const current = await store.get(agentKey(owner, legacy.agent.slot));
  if (current.revokedAt) {
    for (const result of race) if (result.status === 'fulfilled' && result.value.token) assert.equal(await authenticateAgent(`Bearer ${result.value.token}`, store), null);
  } else assert.ok(race.some(row => row.status === 'rejected' && row.reason.status === 409));
});

test('agent-only endpoint claims/finishes assigned jobs with existing admission and durable retry policy, without user authentication', async () => {
  const f = await setup();
  const handle = createRunnerJobsHandler({ ...f.options, authenticate: () => assert.fail('must never use account authentication') });
  const response = await handle(request(f.created.token, claim(f.runnerId)));
  assert.equal(response.statusCode, 200); assert.equal(JSON.parse(response.body).job.id, f.job.id);
  assert.deepEqual(f.queried, [f.accountKey]);
  const completed = await handle(request(f.created.token, finish(f.runnerId, f.job.id)));
  assert.equal(completed.statusCode, 200); assert.equal(JSON.parse(completed.body).job.status, 'succeeded');
  const repeated = await handle(request(f.created.token, finish(f.runnerId, f.job.id)));
  assert.equal(repeated.statusCode, 200); assert.equal(JSON.parse(repeated.body).deduplicated, true);
  assert.deepEqual(f.published, [f.job.id]); assert.deepEqual(f.queried, [f.accountKey]);
});

test('scope denies GET/queue/v1, foreign runner/jobs, caller account overrides and mixed authentication', async () => {
  const f = await setup(), other = await createAgent(ownerKey(otherUser), { projectRef }, f.credentials, { user: otherUser });
  const before = JSON.stringify([...f.jobs.rows]);
  const attempts = [
    request(f.created.token, claim(f.runnerId), { httpMethod: 'GET' }),
    request(f.created.token, { ...payload(f.runnerId), type: 'verify' }),
    request(f.created.token, { type: 'claim' }),
    request(f.created.token, claim(other.agent.id)),
    request(other.token, finish(other.agent.id, f.job.id)),
    request(f.created.token, { ...claim(f.runnerId), accountKey: `supabase:${otherUser.id}` }),
    request(f.created.token, claim(f.runnerId), { headers: { Authorization: `Bearer ${f.created.token}`, 'X-Portabase-Agent-Authorization': `Bearer ${other.token}` } }),
    request('synthetic-user-session', claim(f.runnerId)),
  ];
  for (const req of attempts) assert.ok([400, 401, 403, 405].includes((await f.handle(req)).statusCode));
  assert.equal(JSON.stringify([...f.jobs.rows]), before); assert.deepEqual(f.queried, []);
});

test('legacy, corrupt mapping, slot, project, revoked and rotated credentials fail closed', async () => {
  const f = await setup(), legacy = await createAgent(owner, { projectRef }, f.credentials);
  assert.equal((await f.handle(request(legacy.token, claim(legacy.agent.id)))).statusCode, 403);
  const key = agentKey(owner, f.created.agent.slot), original = await f.credentials.get(key);
  for (const patch of [{ accountKey: `supabase:${otherUser.id}` }, { accountKey: `aws:${user.id}` }, { accountKey: undefined }, { jobAccess: 'true' },
    { credentialRevision: 0 }, { slot: 11 }, { projectRef: 'invalid' }, { id: 'invalid' }, { revokedAt: '2026-10-05' }]) {
    await f.credentials.setJSON(key, { ...original, ...patch });
    assert.ok([401, 403].includes((await f.handle(request(f.created.token, claim(f.runnerId)))).statusCode), JSON.stringify(patch));
  }
  await f.credentials.setJSON(key, original);
  const rotated = await rotateAgent(owner, { id: f.runnerId, expectedRevision: 1, enableJobAccess: true }, user, f.credentials);
  assert.equal((await f.handle(request(f.created.token, claim(f.runnerId)))).statusCode, 401);
  assert.equal((await f.handle(request(rotated.token, claim(f.runnerId)))).statusCode, 200);
  assert.equal((await f.handle(request(rotated.token, finish(f.runnerId, f.job.id)))).statusCode, 200);
});

test('outages and expired access refuse new claims; in-flight finish works after expiry; revocation between auth reads blocks mutation', async () => {
  const f = await setup();
  const outage = createRunnerJobsHandler({ ...f.options, getSubscription: async () => { throw new Error('private-secret-error'); } });
  const response = await outage(request(f.created.token, claim(f.runnerId))); assert.equal(response.statusCode, 503); assert.doesNotMatch(response.body, /private-secret/);
  const expired = createRunnerJobsHandler({ ...f.options, getSubscription: async () => ({ ...paid, currentPeriodEnd: '2026-10-01T00:00:00Z' }) });
  assert.equal((await expired(request(f.created.token, claim(f.runnerId)))).statusCode, 402);
  assert.equal((await f.handle(request(f.created.token, claim(f.runnerId)))).statusCode, 200);
  assert.equal((await expired(request(f.created.token, finish(f.runnerId, f.job.id)))).statusCode, 200);
  const g = await setup(); let reads = 0;
  const revoked = createRunnerJobsHandler({ ...g.options, authenticateRunner: async auth => {
    if (++reads === 2) await revokeAgent(owner, g.runnerId, g.credentials);
    return authenticateAgent(auth, g.credentials);
  } });
  assert.equal((await revoked(request(g.created.token, claim(g.runnerId)))).statusCode, 403);
  assert.equal((await g.jobs.get(`jobs:${g.accountKey}`))[0].status, 'queued');
});

test('mapped provider account uses exact namespaced subscription identity; same bare ID under another provider cannot authorize', async () => {
  const f = await setup(), lookups = [];
  const handle = createRunnerJobsHandler({ ...f.options, getSubscription: async key => {
    assert.equal(key, `supabase:${user.id}`);
    return getSubscriptionForUser(user, async queried => { lookups.push(queried); return { ...paid, userId: `aws:${user.id}` }; });
  } });
  assert.equal((await handle(request(f.created.token, claim(f.runnerId)))).statusCode, 503);
  assert.deepEqual(lookups, [`supabase:${user.id}`]);
  const legacyAccountHandler = createJobsHandler({ authenticate: async () => { throw new Error('agent bearer is not a user session'); } });
  assert.equal((await legacyAccountHandler(request(f.created.token, claim(f.runnerId), { httpMethod: 'GET' }))).statusCode, 401);
});
