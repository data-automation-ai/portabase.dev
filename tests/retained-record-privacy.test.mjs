import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardHandler } from '../netlify/functions/cloud-dashboard.mjs';
import { createRunnersHandler } from '../netlify/functions/cloud-runners.mjs';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { collectTelemetryEvents } from '../netlify/functions/cloud-telemetry-events.mjs';
import { createAgentsHandler } from '../netlify/functions/cloud-agents.mjs';
import { listAgents, ownerKey, agentKey } from '../netlify/shared/agent-store.mjs';
import { publicJobRecord } from '../netlify/shared/public-records.mjs';

const user = { id: 'synthetic-a', cloudVersion: 'supabase' }, authenticate = async () => user;
const owner = ownerKey(user), projectRef = 'abcdefghijklmnopqrst', runnerId = '11111111-1111-4111-8111-111111111111';
const privateName = 'public.customer_ledger', diagnostic = 'diagnostic-customer-invoice-314';
const now = Date.parse('2026-10-05T12:00:00Z'), at = new Date(now).toISOString();
const clean = value => assert.doesNotMatch(typeof value === 'string' ? value : JSON.stringify(value), /customer_ledger|diagnostic-customer-invoice-314|legacyInventory|rawDiagnostic|retainedSecret/);
const job = () => ({ id: 'job_owned', version: 2, type: 'verify', status: 'succeeded', runnerId, createdAt: at, finishedAt: at, safeError: null,
  cloudVersion: 'supabase', payload: { version: 2, runnerId, configRef: '22222222-2222-4222-8222-222222222222', configRevision: 1 },
  admission: { paid: true, planId: 'cloud-7', maxBytes: 1024, manual: true } });

test('dashboard projects legacy free text and table flags before rendering, retains safe metrics, and never mutates stored rows', async () => {
  const stored = [{ id: 'job_legacy', type: 'backup', status: 'failed', createdAt: at, payload: {
    phase: diagnostic, flags: { excludeTableList: privateName, excludeBinaries: true }, region: { rawDiagnostic: diagnostic },
    objectCount: 3, sizeBytes: 50, capsuleHash: 'a'.repeat(64), layerHashes: { database: { hash: 'b'.repeat(64), sizeBytes: 50, rawDiagnostic: diagnostic } },
  } }];
  const original = structuredClone(stored);
  for (const raw of [stored, { version: 1, jobs: stored, claimSlots: [] }]) {
    const handler = createDashboardHandler({ authenticate, jobsDatabase: () => ({ get: async () => raw }), subscription: async () => null, squareStatus: () => ({}) });
    const response = await handler({ httpMethod: 'GET' }); assert.equal(response.statusCode, 200); clean(response.body);
    const returned = JSON.parse(response.body).jobs[0];
    assert.equal(returned.objectCount, 3); assert.equal(returned.sizeBytes, 50); assert.equal(returned.capsuleHash, 'a'.repeat(64));
    assert.equal(returned.phase, null); assert.equal(returned.region, null); assert.equal(returned.flags.length, 1);
    assert.equal(returned.flags[0].id, 'excludeBinaries');
  }
  assert.deepEqual(stored, original);
});

test('runner GET and sleep responses cannot return retained inventory or diagnostics; stored fields are preserved', async () => {
  let rows = [{ runnerId: `run_${runnerId}`, subscriberId: `supabase:${user.id}`, status: 'sleeping', region: 'us-east-1',
    createdAt: at, inventory: { tables: [privateName] }, errorMessage: diagnostic, sealedEnvelope: { retainedSecret: 'synthetic' } }];
  const retained = structuredClone(rows[0]);
  const db = { get: async () => rows, getWithMetadata: async () => ({ data: rows, etag: '1' }),
    setJSON: async (key, next) => { rows = next; return { modified: true }; } };
  const handler = createRunnersHandler({ authenticate, database: () => db, clock: () => now });
  const get = await handler({ httpMethod: 'GET' }); assert.equal(get.statusCode, 200); clean(get.body);
  assert.equal(JSON.parse(get.body).runners[0].region, 'us-east-1');
  assert.deepEqual(rows[0], retained);
  const sleep = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'sleep', runnerId: retained.runnerId }) });
  assert.equal(sleep.statusCode, 202); clean(sleep.body);
  assert.deepEqual(rows[0].inventory, retained.inventory); assert.equal(rows[0].errorMessage, retained.errorMessage);
  assert.equal(JSON.parse(sleep.body).runner.desiredStatus, 'sleeping');
});

test('job projection strips unexpected payload/admission fields, rejects coerced scalars and fixes raw errors without breaking valid runner envelope', async () => {
  const valid = job(); assert.deepEqual(publicJobRecord(valid), { ...valid, claimedAt: null });
  const stored = { ...valid, safeError: diagnostic, payload: { ...valid.payload, legacyInventory: [privateName] }, admission: { ...valid.admission, rawDiagnostic: diagnostic },
    requestId: { rawDiagnostic: diagnostic } };
  const original = structuredClone(stored);
  const projected = publicJobRecord(stored); clean(projected); assert.equal(projected.safeError, 'worker_failed');
  assert.deepEqual(projected.payload, valid.payload); assert.deepEqual(projected.admission, valid.admission); assert.deepEqual(stored, original);
  const malformed = publicJobRecord({ ...valid, type: [privateName], status: { rawDiagnostic: diagnostic }, createdAt: [diagnostic], runnerId: [runnerId],
    admission: { ...valid.admission, planId: ['cloud-7'] } });
  clean(malformed); assert.equal(malformed.type, 'unknown'); assert.equal(malformed.status, 'unknown');
  assert.equal(malformed.payload, null); assert.equal(malformed.admission, null); assert.equal(malformed.runnerId, null);
  const handler = createJobsHandler({ authenticate, database: () => ({ get: async () => [stored] }) });
  const response = await handler({ httpMethod: 'GET' }); assert.equal(response.statusCode, 200); clean(response.body);
});

test('telemetry read validates retained identity fields and timestamp while preserving safe legacy reports without agent IDs', async () => {
  const event = { eventType: 'backup.completed', projectRef, agentId: runnerId, occurredAt: at, payload: { status: 'completed', phase: 'capture', rawDiagnostic: diagnostic } };
  const values = [
    { owner, receivedAt: diagnostic, event },
    { owner, receivedAt: at, event: { ...event, projectRef: privateName } },
    { owner, receivedAt: at, event: { ...event, agentId: { details: privateName } } },
    { owner, receivedAt: at, event: { ...event, agentId: [runnerId] } },
    { owner, receivedAt: at, event: { ...event, agentId: undefined } },
  ];
  const original = structuredClone(values), prefix = `owners/${owner}/2026-10-05/`;
  const result = await collectTelemetryEvents({ owner, days: 1, now, listKeys: async () => values.map((row, index) => `${prefix}${index}`),
    getRecord: async key => values[Number(key.slice(prefix.length))] });
  clean(result); assert.equal(result.events.length, 2); assert.equal(result.events[0].receivedAt, null);
  assert.equal(result.events[0].projectRef, projectRef); assert.deepEqual(result.events[0].payload, { status: 'completed', phase: 'capture' });
  assert.equal(result.events[1].agentId, null); assert.deepEqual(values, original);
});

test('agent listing omits nested retained data under public scalar names and keeps account mapping private', async () => {
  const record = { owner, id: runnerId, name: { details: privateName }, projectRef, slot: 0, createdAt: { rawDiagnostic: diagnostic },
    tokenHint: { details: diagnostic }, accountKey: `supabase:${user.id}`, credentialRevision: { rawDiagnostic: diagnostic } };
  const original = structuredClone(record), store = { get: async key => key === agentKey(owner, 0) ? record : null };
  const handler = createAgentsHandler({ verifyUser: authenticate, list: who => listAgents(who, store), health: async (who, agents) => agents });
  const response = await handler({ httpMethod: 'GET' }); assert.equal(response.statusCode, 200); clean(response.body);
  assert.doesNotMatch(response.body, /accountKey|tokenHash/);
  const agent = JSON.parse(response.body).agents[0]; assert.equal(agent.id, runnerId); assert.equal(agent.projectRef, projectRef);
  assert.equal(agent.name, 'Capsule runner'); assert.equal(agent.tokenHint, null); assert.equal(agent.createdAt, null); assert.equal(agent.credentialRevision, 0);
  assert.deepEqual(record, original);
});
