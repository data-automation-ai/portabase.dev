import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { createRunnersHandler } from '../netlify/functions/cloud-runners.mjs';
import { runnerAdmission } from '../netlify/shared/runner-admission.mjs';
import { configReference } from '../cloud/runner/config-reference.mjs';
import { ownerKey } from '../netlify/shared/agent-store.mjs';

const now = Date.parse('2026-10-05T12:00:00Z');
const ref = 'abcdefghijklmnopqrst';
const paid = { plan: 'cloud-7', status: 'active', verifiedBy: 'square_api', squareVerifiedAt: '2026-10-05T00:00:00Z',
  squareSubscriptionId: 'subscription', currentPeriodEnd: '2026-11-01T00:00:00Z' };
const addon = { extraTransfersAddon: true, addonStatus: 'active', addonVerifiedBy: 'square_api', addonVerifiedAt: '2026-10-05T00:00:00Z',
  squareAddonSubscriptionId: 'addon', addonCurrentPeriodEnd: '2026-11-01T00:00:00Z' };
const authenticate = async () => ({ id: 'a', cloudVersion: 'supabase' });
function database() {
  const rows = new Map(); let sequence = 0;
  return {
    rows,
    async get(key) { return structuredClone(rows.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
    async setJSON(key, data, options = {}) {
      const old = rows.get(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && options.onlyIfMatch !== old?.etag)) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++sequence) });
      return { modified: true };
    },
  };
}
const post = body => ({ httpMethod: 'POST', body: JSON.stringify(body) });
const runnerId = '11111111-1111-4111-8111-111111111111';
const backup = { version: 2, type: 'backup', runnerId, configRef: '33333333-3333-4333-8333-333333333333', configRevision: 1 };
const claim = { version: 2, type: 'claim', runnerId };

test('private job intents require owned runners and credential-bound claim/completion', async () => {
  const runnerId = '11111111-1111-4111-8111-111111111111';
  const otherId = '22222222-2222-4222-8222-222222222222';
  const owner = ownerKey(await authenticate());
  let identity = { owner, id: runnerId, revokedAt: null };
  const db = database();
  const handler = createJobsHandler({ authenticate, database: () => db, clock: () => now, publishCompletion: async () => {},
    getSubscription: async () => paid,
    ownedRunners: async requested => { assert.equal(requested, owner); return [{ id: runnerId, jobAccess: true }, { id: otherId, jobAccess: true }]; },
    authenticateRunner: async authorization => authorization === 'Bearer synthetic-agent' ? identity : null,
  });
  const request = body => ({ ...post(body), headers: { 'X-Portabase-Agent-Authorization': 'Bearer synthetic-agent' } });
  const intent = { version: 2, type: 'backup', runnerId, configRef: '33333333-3333-4333-8333-333333333333', configRevision: 1,
    requestId: '55555555-5555-4555-8555-555555555555' };
  assert.equal((await handler(post({ ...intent, runnerId: '44444444-4444-4444-8444-444444444444' }))).statusCode, 403);
  const simultaneous = await Promise.all(Array.from({ length: 4 }, () => handler(post(intent))));
  const queued = simultaneous[0]; assert.equal(queued.statusCode, 200);
  const job = JSON.parse(queued.body).job;
  assert.ok(simultaneous.every(reply => reply.statusCode === 200 && JSON.parse(reply.body).job.id === job.id));
  const retries = await Promise.all(Array.from({ length: 5 }, () => handler(post(intent))));
  assert.ok(retries.every(reply => reply.statusCode === 200 && JSON.parse(reply.body).job.id === job.id && JSON.parse(reply.body).deduplicated));
  assert.equal((await db.get('jobs:supabase:a')).length, 1);
  assert.equal(job.requestId, intent.requestId);
  assert.equal(job.payload.requestId, undefined);
  const conflict = await handler(post({ ...intent, configRevision: 2 }));
  assert.equal(conflict.statusCode, 409); assert.equal(JSON.parse(conflict.body).error, 'request_id_conflict');
  assert.equal(job.version, 2); assert.equal(job.runnerId, runnerId);
  assert.equal(job.payload.projectRef, undefined); assert.equal(job.payload.excludeTables, undefined);
  const legacyClaim = await handler(post({ type: 'claim' }));
  assert.equal(legacyClaim.statusCode, 410);
  const claim = { version: 2, type: 'claim', runnerId };
  assert.equal((await handler(post(claim))).statusCode, 403);
  identity = { owner: 'f'.repeat(64), id: runnerId };
  assert.equal((await handler(request(claim))).statusCode, 403);
  identity = { owner, id: otherId };
  assert.equal((await handler(request(claim))).statusCode, 403);
  identity = { owner, id: runnerId, revokedAt: '2026-10-04' };
  assert.equal((await handler(request(claim))).statusCode, 403);
  identity = { owner, id: runnerId };
  const claimed = await handler(request(claim)); assert.equal(claimed.statusCode, 200);
  assert.equal(JSON.parse(claimed.body).job.id, job.id);
  const finish = { version: 2, type: 'finish', runnerId, jobId: job.id, status: 'succeeded' };
  assert.equal((await handler(post({ type: 'finish', jobId: job.id, status: 'succeeded' }))).statusCode, 410);
  identity = { owner, id: otherId };
  assert.equal((await handler(request({ ...finish, runnerId: otherId }))).statusCode, 403);
  identity = { owner, id: runnerId };
  assert.equal((await handler(request(finish))).statusCode, 200);
  assert.equal((await db.get('jobs:supabase:a'))[0].status, 'succeeded');
  const stored = structuredClone([...db.rows]);
  const repeated = await handler(request(finish));
  assert.equal(repeated.statusCode, 200); assert.equal(JSON.parse(repeated.body).deduplicated, true);
  assert.deepEqual([...db.rows], stored);
  const contradiction = await handler(request({ ...finish, status: 'failed', safeError: 'worker_failed' }));
  assert.equal(contradiction.statusCode, 409);
  assert.equal(JSON.parse(contradiction.body).error, 'job_result_conflict');
  identity = { owner, id: otherId };
  assert.equal((await handler(request({ ...finish, runnerId: otherId }))).statusCode, 403);
  assert.deepEqual([...db.rows], stored);
});
const fixture = (factory, record = null, options = {}) => {
  const db = database(); const lookups = [];
  const handler = factory({ authenticate, clock: () => now, database: () => db,
    getSubscription: async key => { lookups.push(key); return record; },
    ownedRunners: async () => [{ id: runnerId, jobAccess: true }],
    authenticateRunner: async () => ({ id: runnerId, owner: ownerKey(await authenticate()) }),
    publishCompletion: async () => {}, ...options });
  return { db, lookups, handler };
};

test('legacy job requests cannot store private selections and retained records expose no private payload', async () => {
  const { handler, db, lookups } = fixture(createJobsHandler);
  const retained = [{ id: 'job_legacy', type: 'backup', status: 'failed',
    payload: { excludeTables: ['public.PRIVATE_TABLE'], note: 'PRIVATE_NOTE', capsuleId: 'PRIVATE_CAPSULE' },
    safeError: 'PRIVATE_DIAGNOSTIC', createdAt: new Date(now).toISOString() }];
  await db.setJSON('jobs:supabase:a', retained);
  const snapshot = structuredClone([...db.rows]);
  for (const version of [undefined, 1]) {
    for (const type of ['backup', 'claim', 'finish']) {
      const response = await handler(post({ version, type, projectRef: ref,
        excludeTables: ['public.PRIVATE_TABLE'], note: 'PRIVATE_NOTE', jobId: 'job_legacy', status: 'succeeded' }));
      assert.equal(response.statusCode, 410);
      assert.equal(JSON.parse(response.body).error, 'private_runner_setup_required');
    }
  }
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.body, /PRIVATE_|excludeTables|capsuleId/);
  assert.equal(JSON.parse(response.body).jobs[0].migrationRequired, true);
  assert.deepEqual([...db.rows], snapshot);
  assert.deepEqual(lookups, []);
});

test('telemetry-only registrations cannot consume quota or queue work before explicit job authorization', async () => {
  for (const jobAccess of [undefined, false]) {
    const { handler, db, lookups } = fixture(createJobsHandler, paid, {
      ownedRunners: async () => [{ id: runnerId, jobAccess }],
    });
    const response = await handler(post(backup));
    assert.equal(response.statusCode, 403);
    assert.equal(JSON.parse(response.body).error, 'runner_job_access_required');
    assert.equal(db.rows.size, 0);
    assert.deepEqual(lookups, []);
  }
});

test('no paid default or extra quota can come from unverified, expired, or invalid billing records', () => {
  for (const record of [null, { plan: 'cloud-17', status: 'active' }, { ...paid, currentPeriodEnd: '2026-10-01T00:00:00Z' },
    { ...paid, plan: 'invented' }, { ...paid, status: 'past_due' }]) {
    assert.equal(runnerAdmission(record, now).paid, false);
    assert.equal(runnerAdmission(record, now).plan.id, 'cloud-free');
  }
  assert.equal(runnerAdmission({ ...paid, extraTransfersAddon: true }, now).extraTransfersAddon, false);
  assert.equal(runnerAdmission({ ...paid, ...addon }, now).extraTransfersAddon, true);
  assert.equal(runnerAdmission({ ...paid, ...addon, addonCurrentPeriodEnd: new Date(now).toISOString() }, now).extraTransfersAddon, false);
});

test('Cloud Free keeps one manual backup; concurrent requests cannot exceed it or fall back to a bare ID', async () => {
  const { handler, lookups, db } = fixture(createJobsHandler);
  const replies = await Promise.all(Array.from({ length: 8 }, () => handler(post(backup))));
  assert.equal(replies.filter(row => row.statusCode === 200).length, 1);
  assert.ok(replies.filter(row => row.statusCode !== 200).every(row => row.statusCode === 429));
  assert.ok(lookups.every(key => key === 'supabase:a'));
  const jobs = await db.get('jobs:supabase:a');
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].admission, { paid: false, planId: 'cloud-free', maxBytes: 100 * 1024 * 1024, manual: true });
});

test('paid Starter gets three transfers only with a verified unexpired add-on', async () => {
  for (const [record, limit] of [
    [{ ...paid, extraTransfersAddon: true }, 1], [{ ...paid, ...addon }, 3],
    [{ ...paid, ...addon, addonCurrentPeriodEnd: '2026-10-04T00:00:00Z' }, 1],
    [{ ...paid, ...addon, addonVerifiedBy: null }, 1],
  ]) {
    const { handler } = fixture(createJobsHandler, record);
    for (let i = 0; i < limit; i++) assert.equal((await handler(post(backup))).statusCode, 200);
    assert.equal((await handler(post(backup))).statusCode, 429);
  }
});

test('a storage outage cannot become a free-plan admission or an empty success', async () => {
  for (const factory of [createJobsHandler, createRunnersHandler]) {
    const { handler, db } = fixture(factory, null, { getSubscription: async () => { throw new Error('private provider failure'); } });
    const result = await handler(post(factory === createJobsHandler ? backup : { action: 'provision' }));
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.includes('private'), false);
    assert.equal(db.rows.size, 0);
    const broken = factory({ authenticate, database: () => ({ get: async () => { throw new Error('outage'); } }) });
    assert.equal((await broken({ httpMethod: 'GET' })).statusCode, 503);
  }
});

test('expired customers can read jobs and finish running work, but cannot claim paid queued jobs', async () => {
  const { handler, db } = fixture(createJobsHandler);
  await db.setJSON('jobs:supabase:a', [
    { id: 'job_running', version: 2, runnerId, workerId: runnerId, payload: configReference(backup), createdAt: new Date(now - 2000).toISOString(), claimedAt: new Date(now - 1000).toISOString(), status: 'running', type: 'backup', admission: { paid: true, maxBytes: 10e9 } },
    { id: 'job_waiting', version: 2, runnerId, payload: configReference(backup), status: 'queued', type: 'backup', admission: { paid: true, maxBytes: 10e9 } },
  ]);
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 200);
  assert.equal((await handler(post(claim))).statusCode, 402);
  assert.equal((await handler(post({ version: 2, type: 'finish', runnerId, jobId: 'job_running', status: 'succeeded' }))).statusCode, 200);
  assert.equal((await db.get('jobs:supabase:a'))[1].status, 'queued');
});

test('free customers cannot provision or wake persistent runners; sleep and status remain available', async () => {
  const { handler, db, lookups } = fixture(createRunnersHandler);
  await db.setJSON('runners:supabase:a', [{ runnerId: 'runner-a', status: 'running' }]);
  assert.equal((await handler(post({ action: 'provision' }))).statusCode, 402);
  assert.equal((await handler(post({ action: 'wake', runnerId: 'runner-a' }))).statusCode, 402);
  const sleep = await handler(post({ action: 'sleep', runnerId: 'runner-a' }));
  assert.equal(sleep.statusCode, 202);
  assert.equal(JSON.parse(sleep.body).runner.status, 'running');
  assert.equal(JSON.parse(sleep.body).runner.desiredStatus, 'sleeping');
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 200);
  assert.ok(lookups.every(key => key === 'supabase:a'));
});

test('runner writes are account-scoped and retain all existing records at the limit', async () => {
  const { handler, db } = fixture(createRunnersHandler, paid);
  await db.setJSON('runners:supabase:b', [{ runnerId: 'foreign-runner', status: 'sleeping' }]);
  assert.equal((await handler(post({ action: 'wake', runnerId: 'foreign-runner' }))).statusCode, 404);
  const rows = Array.from({ length: 11 }, (_, i) => ({ runnerId: `existing-${i}` }));
  await db.setJSON('runners:supabase:a', rows);
  const replies = await Promise.all(Array.from({ length: 4 }, () => handler(post({ action: 'provision' }))));
  assert.equal(replies.filter(row => row.statusCode === 202).length, 1);
  assert.equal(replies.filter(row => row.statusCode === 409).length, 3);
  const stored = await db.get('runners:supabase:a');
  assert.equal(stored.length, 12);
  assert.ok(rows.every(old => stored.some(row => old.runnerId === row.runnerId)));
  assert.equal(stored[0].status, 'unprovisioned');
  assert.equal(stored[0].provisioning, 'metadata_only');
});

test('queued job claims are atomic and preserve quota evidence when many other jobs finish', async () => {
  const { handler, db } = fixture(createJobsHandler, paid);
  const queued = await handler(post(backup));
  assert.equal(queued.statusCode, 200);
  const replies = await Promise.all(Array.from({ length: 4 }, () => handler(post(claim))));
  assert.equal(replies.filter(row => JSON.parse(row.body).job).length, 1);
  const rows = await db.get('jobs:supabase:a');
  await db.setJSON('jobs:supabase:a', [...Array.from({ length: 60 }, (_, i) => ({ id: `job_${i}`, status: 'succeeded', type: 'heartbeat', createdAt: new Date(now).toISOString() })), ...rows]);
  assert.equal((await handler(post(backup))).statusCode, 429);
});
