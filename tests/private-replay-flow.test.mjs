import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { startCapsuleReviewServer } from '../utility/ui/capsule-review-server.mjs';
import { privateJobReference, matchingPrivateJob } from '../src/lib/private-job-reference.js';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { ownerKey, createAgent, listAgents, authenticateAgent, rotateAgent } from '../netlify/shared/agent-store.mjs';
import { createRunnerJobsHandler } from '../netlify/functions/cloud-runner-jobs.mjs';
import { normalizeJobQueue } from '../netlify/shared/job-queue-envelope.mjs';
import { pullOnce } from '../cloud/runner/worker.mjs';
import { runPrivateReplayChild } from '../utility/private-replay.mjs';
import { assertPreparedPrivateReplay } from '../utility/private-replay-prepare.mjs';

const targetRef = 'bcdefghijklmnopqrst0';
const requestId = '55555555-5555-4555-8555-555555555555';
function memoryDatabase() {
  const rows = new Map(); let sequence = 0;
  return {
    rows,
    async get(key) { return structuredClone(rows.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
    async setJSON(key, data, options = {}) {
      const previous = rows.get(key);
      if (options.onlyIfNew && previous || options.onlyIfMatch && previous?.etag !== options.onlyIfMatch) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++sequence) });
      return { modified: true };
    },
  };
}

async function setup(t, runnerId) {
  const f = await privateCapsuleFixture();
  f.options.runnerId = runnerId;
  t.after(async () => {
    const root = resolve(f.directory), base = resolve(tmpdir());
    assert.ok(root.startsWith(`${base}${sep}`) && basename(root).startsWith('portabase-capsule-review-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(f.directory, 'engine.json'), JSON.stringify({ projectRef: f.options.projectRef,
    backupDirectory: 'backups', statusDirectory: 'status', provider: { type: 's3', bucket: 'private-vault-canary' } }));
  const server = await startCapsuleReviewServer({ privateReview: { ...f.options, engineConfigPath: 'engine.json', targetRef } });
  try {
    const origin = new URL(server.url).origin, headers = { 'X-Portabase-Session': server.token };
    const bootstrap = await (await fetch(`${origin}/api/review`, { headers })).json();
    Object.assign(headers, { Origin: origin, 'X-Portabase-CSRF': bootstrap.csrf, 'Content-Type': 'application/json' });
    const post = async (path, body, status) => {
      const response = await fetch(`${origin}/api/review/${path}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error' });
      assert.equal(response.status, status); return response.json();
    };
    const review = await post('inspect', {}, 200);
    const saved = await post('plans', { revision: review.revision, selectedTables: ['public.orders'], selectedBuckets: [],
      selectedFunctions: [], maxBytes: 1000000, confirmEmpty: false }, 201);
    const response = await post('replay-reference', { planRef: saved.planRef, bindingSha256: saved.bindingSha256,
      targetRef, confirmTarget: targetRef, confirmReplay: true }, 201);
    // Same serialization as the download, then the real dashboard import parser.
    const reference = privateJobReference(JSON.parse(`${JSON.stringify(response, null, 2)}\n`), { id: f.options.runnerId });
    return { ...f, reference, saved };
  } finally { await server.close(); }
}

for (const scenario of ['success', 'wrong-key', 'rotated-retry', 'lost-claim', 'lost-idle']) test(`private GUI reference through real queue/worker/child: ${scenario}`, async t => {
  const wrongKey = scenario === 'wrong-key', rotatedRetry = scenario === 'rotated-retry';
  const db = memoryDatabase(), credentials = memoryDatabase(), user = { id: 'synthetic-owner', cloudVersion: 'supabase' };
  const issued = await createAgent(ownerKey(user), { projectRef: 'abcdefghijklmnopqrst' }, credentials, { user });
  let agentToken = issued.token, lostAcknowledgement = false, lostClaim = false;
  const runner = issued.agent;
  const f = await setup(t, runner.id), requests = [], publications = [];
  const adapters = { database: () => db, getSubscription: async () => null,
    publishCompletion: async ({ job }) => { publications.push(job.id); } };
  const handler = createJobsHandler({ ...adapters,
    authenticate: async event => { assert.equal(event.headers.authorization, 'Bearer synthetic-customer'); return user; },
    ownedRunners: async owner => { assert.equal(owner, ownerKey(user)); return listAgents(owner, credentials); },
  });
  const runnerHandler = createRunnerJobsHandler({ ...adapters,
    authenticateRunner: authorization => authenticateAgent(authorization, credentials) });
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://cloud.example.test/api/cloud/runner-jobs'); assert.equal(options.redirect, 'error');
    const headers = Object.fromEntries(new Headers(options.headers)), body = JSON.parse(options.body);
    assert.equal(headers.authorization, `Bearer ${agentToken}`);
    assert.equal(headers['x-portabase-agent-authorization'], undefined);
    assert.doesNotMatch(JSON.stringify(options), /synthetic-customer/);
    requests.push(body);
    const response = await runnerHandler({ httpMethod: 'POST', headers, body: options.body });
    if (scenario === 'lost-idle' && body.type === 'claim' && !lostClaim) {
      assert.equal(response.statusCode, 200);
      assert.equal(JSON.parse(response.body).job, null);
      lostClaim = true;
      throw new Error('synthetic lost idle decision');
    }
    if (scenario === 'lost-claim' && body.type === 'claim' && !lostClaim) {
      assert.equal(response.statusCode, 200);
      assert.equal(JSON.parse(response.body).job.status, 'running');
      lostClaim = true;
      throw new Error('synthetic lost claim after server assignment');
    }
    if (rotatedRetry && body.type === 'finish' && !lostAcknowledgement) {
      assert.equal(response.statusCode, 200);
      lostAcknowledgement = true;
      throw new Error('synthetic lost acknowledgement after server commit');
    }
    return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
      json: async () => JSON.parse(response.body) };
  };
  if (scenario === 'lost-idle') {
    await assert.rejects(pullOnce({ baseUrl: 'https://cloud.example.test', fetchImpl,
      env: { PORTABASE_RUNNER_CONFIG_DIR: f.directory, PORTABASE_RUNNER_ID: runner.id,
        PORTABASE_AGENT_TOKEN: agentToken, PORTABASE_PROJECT_REF: f.options.projectRef },
      spawnImpl: async () => assert.fail('idle claim cannot execute') }));
  }
  const queueEvent = { httpMethod: 'POST', headers: { authorization: 'Bearer synthetic-customer' }, body: JSON.stringify({ ...f.reference, requestId }) };
  const queued = await handler(queueEvent); assert.equal(queued.statusCode, 200);
  const queuedJob = JSON.parse(queued.body).job;
  assert.ok(matchingPrivateJob(queuedJob, f.reference, requestId));
  const duplicate = JSON.parse((await handler(queueEvent)).body);
  assert.equal(duplicate.job.id, queuedJob.id); assert.equal(duplicate.deduplicated, true);
  const env = { PORTABASE_CLOUD_TOKEN: 'synthetic-customer', PORTABASE_RUNNER_CONFIG_DIR: f.directory, PORTABASE_RUNNER_ID: runner.id,
    PORTABASE_PROJECT_REF: f.options.projectRef, PORTABASE_TARGET_PROJECT_REF: targetRef, PORTABASE_AGENT_TOKEN: agentToken,
    PORTABASE_ENCRYPTION_PASSPHRASE: wrongKey ? 'wrong-synthetic-key' : f.options.passphrase,
    PORTABASE_REVIEW_MAX_CIPHER_BYTES: String(f.options.maxCipherBytes), PORTABASE_REVIEW_MAX_EXPANDED_BYTES: String(f.options.maxExpandedBytes) };
  let launches = 0, executions = 0, preparedSnapshot;
  const run = () => pullOnce({ baseUrl: 'https://cloud.example.test', token: 'synthetic-customer', env, fetchImpl,
    spawnImpl: async (argv, options) => {
      launches++;
      assert.equal(options.env.PORTABASE_CLOUD_TOKEN, undefined);
      assert.deepEqual(argv, [process.execPath, fileURLToPath(new URL('../utility/private-replay.mjs', import.meta.url)), f.reference.configRef, '1']);
      assert.equal(options.env.PORTABASE_JOB_MAX_CAPSULE_BYTES, String(queuedJob.admission.maxBytes));
      await runPrivateReplayChild(argv.slice(2), { env: options.env, executePrepared: async (prepared, execution) => {
        executions++; preparedSnapshot = prepared;
        assertPreparedPrivateReplay(prepared);
        assert.equal(prepared.bindingSha256, f.saved.bindingSha256);
        assert.equal(prepared.selectedBytes, f.saved.selectedBytes);
        assert.deepEqual(prepared.plan.tables.map(row => [row.table, row.selected]), [['orders', true], ['empty', false]]);
        assert.equal(execution.targetRef, targetRef);
        assert.match(await readFile(join(prepared.extracted, 'database', 'data.sql'), 'utf8'), /private-row-value/);
        // This is the only simulated boundary: no target/database/provider operation.
        return { status: 'SELECTIVE_RESTORE_VERIFIED' };
      } });
      return { code: 0, stdout: 'private-output-canary' };
    } });
  if (wrongKey) { await assert.rejects(run()); assert.equal(launches, 0); assert.equal(executions, 0); }
  else {
    if (scenario === 'lost-idle') {
      assert.equal((await run()).idle, true);
      assert.equal(launches, 0); assert.equal(executions, 0);
      assert.deepEqual(requests[1], requests[0]);
      assert.equal(normalizeJobQueue(await db.get('jobs:supabase:synthetic-owner')).jobs[0].status, 'queued');
    }
    if (scenario === 'lost-claim') {
      await assert.rejects(run());
      assert.equal(launches, 0); assert.equal(executions, 0);
      assert.equal(normalizeJobQueue(await db.get('jobs:supabase:synthetic-owner')).jobs[0].status, 'running');
    }
    if (rotatedRetry) {
      await assert.rejects(run(), { code: 'job_result_unconfirmed' });
      const previousToken = agentToken;
      const rotated = await rotateAgent(ownerKey(user), { id: runner.id, expectedRevision: 1, enableJobAccess: true }, user, credentials);
      agentToken = rotated.token; env.PORTABASE_AGENT_TOKEN = agentToken;
      assert.equal(await authenticateAgent(`Bearer ${previousToken}`, credentials), null);
      const reconciled = await run();
      assert.equal(reconciled.reconciled, true); assert.equal(reconciled.completionCount, 1);
    } else assert.equal((await run()).status, 'succeeded');
    assert.equal(launches, 1); assert.equal(executions, 1);
    assert.throws(() => assertPreparedPrivateReplay(preparedSnapshot));
    assert.deepEqual(await readdir(join(f.directory, '.replay-runs')), []);
    let idle = await run();
    if (rotatedRetry && idle.reconciled) {
      assert.equal(idle.completionCount, 0);
      idle = await run();
    }
    assert.equal(idle.idle, true); assert.equal(launches, 1);
    if (scenario === 'lost-claim') {
      assert.equal(requests[0].type, 'claim');
      assert.deepEqual(requests[1], requests[0]);
    }
  }
  const persisted = normalizeJobQueue(await db.get('jobs:supabase:synthetic-owner')).jobs;
  assert.equal(persisted.length, 1); assert.equal(persisted[0].status, wrongKey ? 'failed' : 'succeeded');
  assert.deepEqual(publications, [queuedJob.id]);
  assert.doesNotMatch(JSON.stringify({ persisted, requests }), /private-vault|private-output|private-row|public\.orders|passphrase|bindingSha256|planRef|capsulePath|targetRef|projectRef/);
});
