import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent, authenticateAgent, ownerKey } from '../netlify/shared/agent-store.mjs';
import { createAgentsHandler } from '../netlify/functions/cloud-agents.mjs';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { createRunnerJobsHandler } from '../netlify/functions/cloud-runner-jobs.mjs';
import { createDashboardHandler } from '../netlify/functions/cloud-dashboard.mjs';
import { createJobCompletionPublisher } from '../netlify/shared/job-completion-events.mjs';
import { collectTelemetryEvents } from '../netlify/functions/cloud-telemetry-events.mjs';
import { pullOnce } from '../cloud/runner/worker.mjs';

function memoryStore() {
  const rows = new Map(); let revision = 0;
  return {
    rows,
    async get(key) { return structuredClone(rows.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
    async setJSON(key, data, options = {}) {
      const old = rows.get(key);
      if (options.onlyIfNew && old || options.onlyIfMatch && old?.etag !== options.onlyIfMatch) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++revision) });
      return { modified: true };
    },
  };
}

test('signed-in Square subscriber completes customer-runner backup flow to dashboard capsule', async t => {
  const user = { cloudVersion: 'supabase', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const session = 'synthetic-signed-in-session';
  const projectRef = 'abcdefghijklmnopqrst';
  const now = Date.now();
  const subscription = { plan: 'cloud-7', status: 'active', verifiedBy: 'square_api',
    squareSubscriptionId: 'synthetic-square-subscription', squareVerifiedAt: new Date(now - 60_000).toISOString(),
    currentPeriodEnd: new Date(now + 30 * 86_400_000).toISOString() };
  const authenticate = async event => {
    if (event.headers?.Authorization !== `Bearer ${session}`) throw new Error('unauthorized');
    return user;
  };
  const agents = memoryStore(), jobs = memoryStore(), telemetry = memoryStore();
  const register = createAgentsHandler({ verifyUser: authenticate,
    create: (owner, input, _store, options) => createAgent(owner, input, agents, options) });
  assert.equal((await register({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode, 401);
  const registration = await register({ httpMethod: 'POST', headers: { Authorization: `Bearer ${session}` },
    body: JSON.stringify({ name: 'Customer runner', projectRef }) });
  assert.equal(registration.statusCode, 201);
  const enrolled = JSON.parse(registration.body), runnerId = enrolled.agent.id, agentToken = enrolled.token;
  const runner = await authenticateAgent(`Bearer ${agentToken}`, agents);
  assert.equal(runner.owner, ownerKey(user));

  const publishCompletion = createJobCompletionPublisher({ telemetryStore: () => telemetry,
    enqueueNotifications: async () => {}, clock: () => Date.now() });
  const adapters = {
    database: () => jobs,
    clock: () => Date.now(),
    getSubscription: async account => account === `${user.cloudVersion}:${user.id}` ? subscription : null,
    authenticateRunner: authorization => authenticateAgent(authorization, agents),
    ownedRunners: async owner => owner === ownerKey(user) ? [runner] : [],
    publishCompletion,
  };
  const accountJobs = createJobsHandler({ ...adapters, authenticate });
  const configRef = '33333333-3333-4333-8333-333333333333';
  const queuedResponse = await accountJobs({ httpMethod: 'POST', headers: { Authorization: `Bearer ${session}` },
    body: JSON.stringify({ version: 2, type: 'backup', runnerId, configRef, configRevision: 1 }) });
  assert.equal(queuedResponse.statusCode, 200);
  const queued = JSON.parse(queuedResponse.body).job;
  assert.equal(queued.status, 'queued');
  assert.equal(queued.admission.paid, true);
  assert.equal(queued.admission.planId, 'cloud-7');

  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const directory = await mkdtemp(join(tmpdir(), 'portabase-customer-flow-'));
  t.after(async () => {
    const root = resolve(directory), base = resolve(tmpdir());
    assert.ok(root.startsWith(`${base}${sep}`) && basename(root).startsWith('portabase-customer-flow-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(directory, configRef));
  const engine = JSON.stringify({ projectRef, provider: { type: 's3', bucket: 'private-customer-vault' },
    backupDirectory: 'capsules', statusDirectory: 'status' });
  await writeFile(join(directory, 'engine.json'), engine);
  await writeFile(join(directory, configRef, '1.json'), JSON.stringify({ version: 2, runnerId, configRef,
    configRevision: 1, operation: 'backup', projectRef, engineConfigPath: 'engine.json',
    engineConfigSha256: createHash('sha256').update(engine).digest('hex'), excludeTables: [], excludeBuckets: [], incrementalBinary: false }));

  const runnerJobs = createRunnerJobsHandler(adapters);
  const capsuleId = 'abcdefghijklmnopqrst-20261005T120000Z';
  const capsuleHash = 'a'.repeat(64), manifestHash = 'b'.repeat(64);
  let engineRuns = 0;
  const workerResult = await pullOnce({ baseUrl: 'https://portabase.dev', env: {
    PORTABASE_RUNNER_CONFIG_DIR: directory, PORTABASE_RUNNER_ID: runnerId,
    PORTABASE_PROJECT_REF: projectRef, PORTABASE_AGENT_TOKEN: agentToken,
  }, fetchImpl: async (url, request) => {
    assert.equal(new URL(url).pathname, '/api/cloud/runner-jobs');
    const response = await runnerJobs({ httpMethod: request.method, headers: request.headers, body: request.body });
    return { ok: response.statusCode < 300, status: response.statusCode, json: async () => JSON.parse(response.body) };
  }, spawnImpl: async () => {
    engineRuns++;
    const statusDirectory = join(directory, 'status'); await mkdir(statusDirectory, { recursive: true });
    await writeFile(join(statusDirectory, 'latest.json'), JSON.stringify({ state: 'COMPLETE', capsule: capsuleId,
      projectRef, capsuleHash, manifestHash, sizeBytes: 4096, objectCount: 12, durationMs: 2500,
      destinationVerified: true, completedAt: new Date().toISOString(),
      destination: 's3://private-customer-vault/private-prefix', passphrase: 'runner-only-passphrase' }));
    return { code: 0 };
  } });
  assert.equal(workerResult.status, 'succeeded');
  assert.equal(engineRuns, 1);

  const eventRows = await collectTelemetryEvents({ owner: ownerKey(user), now: Date.now(), days: 1,
    listKeys: async prefix => [...telemetry.rows.keys()].filter(key => key.startsWith(prefix)),
    getRecord: key => telemetry.get(key) });
  assert.equal(eventRows.events.length, 1);
  assert.equal(eventRows.events[0].payload.capsuleId, capsuleId);
  assert.equal(eventRows.events[0].payload.destinationVerified, true);

  const dashboard = createDashboardHandler({ authenticate, jobsDatabase: () => jobs,
    subscription: async () => subscription, squareStatus: () => ({ ready: true, mode: 'LIVE', missing: [] }) });
  const dashboardResponse = await dashboard({ httpMethod: 'GET', headers: { Authorization: `Bearer ${session}` } });
  assert.equal(dashboardResponse.statusCode, 200);
  const view = JSON.parse(dashboardResponse.body);
  assert.equal(view.subscription.squareSubscriptionId, subscription.squareSubscriptionId);
  assert.equal(view.jobs[0].capsuleId, capsuleId);
  assert.equal(view.jobs[0].capsuleStatus, 'COMPLETE');
  assert.equal(view.jobs[0].capsuleHash, capsuleHash);
  assert.equal(view.jobs[0].destinationVerified, true);
  assert.equal(view.model.sizes[0].capsuleId, capsuleId);
  assert.equal(view.model.sizes[0].totalBytes, 4096);
  const publicBytes = JSON.stringify([eventRows, view]);
  assert.doesNotMatch(publicBytes, /runner-only-passphrase|private-customer-vault|private-prefix|engine\.json/);
});
