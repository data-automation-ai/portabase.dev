import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { createPrivateCapsuleReview } from '../utility/ui/private-capsule-review.mjs';
import { resolvePrivateJob } from '../cloud/runner/private-config.mjs';
import { engineArgvForJob, pullOnce } from '../cloud/runner/worker.mjs';
import { parseJobRequest } from '../cloud/runner/job-intent.mjs';

const configRef = '33333333-3333-4333-8333-333333333333';
const targetRef = 'bcdefghijklmnopqrst0';
async function fixture(t) {
  const f = await privateCapsuleFixture();
  t.after(async () => {
    const root = resolve(f.directory), base = resolve(tmpdir());
    assert.ok(root.startsWith(`${base}${sep}`) && basename(root).startsWith('portabase-capsule-review-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const service = await createPrivateCapsuleReview(f.options), review = await service.inspect({});
  const saved = await service.save({ revision: review.revision, selectedTables: ['public.orders'],
    selectedBuckets: [], selectedFunctions: [], maxBytes: 1000000, confirmEmpty: false });
  const reference = { version: 2, runnerId: f.options.runnerId, configRef, configRevision: 1 };
  await mkdir(join(f.directory, configRef));
  const engine = JSON.stringify({ projectRef: f.options.projectRef, backupDirectory: 'backups', statusDirectory: 'status' });
  await writeFile(join(f.directory, 'engine.json'), engine);
  const record = { ...reference, operation: 'replay', projectRef: f.options.projectRef, targetRef,
    engineConfigPath: 'engine.json', engineConfigSha256: createHash('sha256').update(engine).digest('hex'),
    capsulePath: 'capsule', restorePlanRef: saved.planRef, restorePlanBindingSha256: saved.bindingSha256 };
  const save = value => writeFile(join(f.directory, configRef, '1.json'), JSON.stringify(value));
  await save(record);
  const job = { id: 'job_synthetic', version: 2, runnerId: reference.runnerId, type: 'replay',
    payload: reference, admission: { maxBytes: 1000 } };
  return { ...f, saved, record, save, job, options: { ...f.options, targetRef } };
}

test('private resolver authenticates UI-saved selection, isolates metadata and refuses unfiltered execution', async t => {
  const f = await fixture(t), result = await resolvePrivateJob(f.job, f.options);
  assert.equal(result.restorePlan.bindingSha256, f.saved.bindingSha256);
  assert.equal(result.restorePlan.planPath, join(f.directory, f.saved.planPath));
  assert.equal(result.restorePlan.selectedBytes, f.saved.selectedBytes);
  assert.equal(result.restorePlan.maxBytes, 1000);
  assert.deepEqual(result.restorePlan.plan.tables.map(row => row.selected), [true, false]);
  assert.deepEqual(result.job.payload, { projectRef: f.options.projectRef, targetRef,
    capsulePath: f.capsule, excludeTables: [], excludeBuckets: [], excludeObjects: {}, incrementalBinary: false });
  assert.doesNotMatch(JSON.stringify(result.job), /restorePlan|public\.orders|bindingSha256|passphrase|plan\.json/);
  assert.doesNotMatch(JSON.stringify(result), /private-row-value|private-object.jpg|synthetic-private-customer-passphrase/);
  assert.throws(() => engineArgvForJob(result.job, result), { code: 'private_restore_execution_unavailable' });
  for (const key of ['restorePlanRef', 'restorePlanBindingSha256', 'restorePlan']) {
    assert.equal(parseJobRequest({ ...f.job.payload, type: 'replay', [key]: 'private-value' }).ok, false);
    await assert.rejects(resolvePrivateJob({ ...f.job, payload: { ...f.job.payload, [key]: 'private-value' } }, f.options), { code: 'mixed_private_job_fields' });
  }
});

test('plan reference is an exact UUID/hash pair restricted to replay', async t => {
  const f = await fixture(t);
  for (const patch of [
    { restorePlanRef: undefined }, { restorePlanBindingSha256: undefined },
    { restorePlanRef: null }, { restorePlanBindingSha256: null },
    { restorePlanRef: '../escape' }, { restorePlanRef: f.saved.planRef.toUpperCase() },
    { restorePlanBindingSha256: 'f'.repeat(63) }, { restorePlanBindingSha256: 'F'.repeat(64) },
    { restorePlanBindingSha256: 1 },
  ]) {
    await f.save({ ...f.record, ...patch });
    await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'invalid_private_restore_plan' });
  }
  for (const operation of ['backup', 'verify']) {
    await f.save({ ...f.record, operation });
    await assert.rejects(resolvePrivateJob({ ...f.job, type: operation }, f.options), { code: 'invalid_private_restore_plan' });
  }
});

test('planned replay needs explicit private review limits/key and numeric admission from the job', async t => {
  const f = await fixture(t);
  for (const patch of [{ passphrase: undefined }, { maxCipherBytes: undefined }, { maxExpandedBytes: undefined },
    { maxCipherBytes: '1000000' }, { maxExpandedBytes: Infinity }]) {
    await assert.rejects(resolvePrivateJob(f.job, { ...f.options, ...patch }), { code: 'restore_plan_setup_required' });
  }
  for (const maxBytes of [undefined, null, 0, -1, '1000', Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(resolvePrivateJob({ ...f.job, admission: { maxBytes } }, { ...f.options, admissionMaxBytes: 1000000 }), { code: 'restore_plan_setup_required' });
  }
  await assert.rejects(resolvePrivateJob({ ...f.job, admission: undefined }, f.options), { code: 'restore_plan_setup_required' });
  await assert.rejects(resolvePrivateJob({ ...f.job, admission: { maxBytes: f.saved.selectedBytes - 1 } }, f.options), { code: 'restore_plan_over_budget' });
  const exact = await resolvePrivateJob({ ...f.job, admission: { maxBytes: f.saved.selectedBytes } }, f.options);
  assert.equal(exact.restorePlan.maxBytes, f.saved.selectedBytes);
});

test('the saved descriptor binds the exact capsule and immutable plan bytes at inspection', async t => {
  const f = await fixture(t);
  await cp(f.capsule, join(f.directory, 'other-capsule'), { recursive: true });
  await f.save({ ...f.record, capsulePath: 'other-capsule' });
  await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'restore_plan_binding_mismatch' });
  await f.save({ ...f.record, restorePlanBindingSha256: '0'.repeat(64) });
  await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'restore_plan_binding_mismatch' });
  await f.save(f.record);
  const planPath = join(f.directory, f.saved.planPath), plan = JSON.parse(await readFile(planPath));
  plan.tables[0].selected = false;
  await writeFile(planPath, JSON.stringify(plan));
  await assert.rejects(resolvePrivateJob(f.job, f.options), { code: 'restore_plan_binding_mismatch' });
});

test('legacy no-plan replay retains existing explicit target/capsule behavior', async t => {
  const f = await fixture(t), record = { ...f.record };
  delete record.restorePlanRef; delete record.restorePlanBindingSha256;
  await f.save(record);
  const { passphrase, maxCipherBytes, maxExpandedBytes, ...options } = f.options;
  const result = await resolvePrivateJob({ ...f.job, admission: undefined }, options);
  assert.equal(Object.hasOwn(result, 'restorePlan'), false);
  const argv = engineArgvForJob(result.job, result);
  assert.equal(argv[argv.indexOf('--capsule') + 1], f.capsule);
  assert.equal(argv.includes('--restore-plan'), false);
});

test('current worker fails planned replay before spawn and publishes only a safe failure', async t => {
  const f = await fixture(t), requests = []; let spawns = 0;
  const env = { PORTABASE_RUNNER_CONFIG_DIR: f.directory, PORTABASE_RUNNER_ID: f.options.runnerId,
    PORTABASE_PROJECT_REF: f.options.projectRef, PORTABASE_TARGET_PROJECT_REF: targetRef,
    PORTABASE_AGENT_TOKEN: `pb_agent_${'a'.repeat(64)}_0_${'b'.repeat(64)}` };
  await assert.rejects(pullOnce({ baseUrl: 'https://cloud.example.test', token: 'synthetic', env,
    fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return { ok: true, json: async () => body.type === 'claim' ? { ok: true, job: { ...f.job, status: 'running' },
        claim: { protocol: 1, sequence: body.claimSequence, requestId: body.claimRequestId, runnerId: body.runnerId } }
        : { ok: true, job: { ...f.job, status: body.status, safeError: body.safeError } } };
    }, spawnImpl: async () => { spawns++; return { code: 0 }; },
  }), { code: 'restore_plan_setup_required' });
  assert.equal(spawns, 0);
  assert.equal(requests.at(-1).safeError, 'worker_failed');
  assert.doesNotMatch(JSON.stringify(requests), /restorePlan|bindingSha256|private-row|plan\.json|passphrase|public\.orders/);
});
