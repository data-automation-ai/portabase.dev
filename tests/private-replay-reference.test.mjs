import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { createPrivateCapsuleReview } from '../utility/ui/private-capsule-review.mjs';
import { startCapsuleReviewServer } from '../utility/ui/capsule-review-server.mjs';
import { resolvePrivateJob } from '../cloud/runner/private-config.mjs';
import { privateJobReference } from '../src/lib/private-job-reference.js';

const targetRef = 'bcdefghijklmnopqrst0';
const selection = review => ({ revision: review.revision, selectedTables: ['public.orders'], selectedBuckets: [], selectedFunctions: [], maxBytes: 1000000, confirmEmpty: false });
const confirmation = saved => ({ planRef: saved.planRef, bindingSha256: saved.bindingSha256, targetRef, confirmTarget: targetRef, confirmReplay: true });
async function fixture(t) {
  const f = await privateCapsuleFixture();
  t.after(async () => {
    const root = resolve(f.directory), base = resolve(tmpdir());
    assert.ok(root.startsWith(`${base}${sep}`) && basename(root).startsWith('portabase-capsule-review-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const engine = { projectRef: f.options.projectRef, backupDirectory: 'backups', statusDirectory: 'status', provider: { type: 's3', bucket: 'private-vault-canary' } };
  await writeFile(join(f.directory, 'engine.json'), JSON.stringify(engine));
  const options = { ...f.options, engineConfigPath: 'engine.json', targetRef }, service = await createPrivateCapsuleReview(options);
  return { ...f, options, service, engine };
}

test('explicit replay action writes a private immutable revision and returns dashboard-compatible opaque reference', async t => {
  const f = await fixture(t), review = await f.service.inspect({}), saved = await f.service.save(selection(review));
  assert.equal(saved.execution, 'not_started');
  const before = await readdir(f.directory);
  assert.equal(before.some(name => /^[a-f0-9-]{36}$/.test(name)), false);
  const reference = await f.service.createReplayReference(confirmation(saved));
  assert.deepEqual(Object.keys(reference).sort(), ['configRef', 'configRevision', 'runnerId', 'type', 'version']);
  assert.deepEqual(privateJobReference(reference, { id: f.options.runnerId }), reference);
  assert.equal(reference.type, 'replay');
  assert.doesNotMatch(JSON.stringify(reference), /private-vault|targetRef|projectRef|planRef|bindingSha256|orders|passphrase|engine/);
  const recordPath = join(f.directory, reference.configRef, '1.json'), record = JSON.parse(await readFile(recordPath));
  assert.equal(record.restorePlanRef, saved.planRef); assert.equal(record.restorePlanBindingSha256, saved.bindingSha256);
  assert.equal(record.targetRef, targetRef); assert.equal(record.capsulePath, 'capsule');
  assert.deepEqual(JSON.parse(await readFile(join(f.directory, record.engineConfigPath))), f.engine);
  // Original mutable engine config is no longer the execution source.
  await writeFile(join(f.directory, 'engine.json'), '{}');
  const { type, ...payload } = reference;
  const execution = await resolvePrivateJob({ type, payload, admission: { maxBytes: 1000 } }, f.options);
  assert.equal(execution.restorePlan.selectedBytes, saved.selectedBytes);
  const original = await readFile(recordPath);
  await assert.rejects(f.service.createReplayReference(confirmation(saved)), { code: 'capsule_review_changed' });
  assert.deepEqual(await readFile(recordPath), original);
});

test('reference requires exact current saved plan, target confirmation and strict body fields', async t => {
  const f = await fixture(t), saved = await f.service.save(selection(await f.service.inspect({}))), body = confirmation(saved);
  for (const patch of [
    { confirmReplay: false }, { confirmReplay: 'true' }, { confirmReplay: undefined },
    { targetRef: f.options.projectRef }, { confirmTarget: targetRef.toUpperCase() }, { confirmTarget: ` ${targetRef}` },
    { targetRef: 'cdefghijklmnopqrstu01', confirmTarget: 'cdefghijklmnopqrstu01' },
    { planRef: '11111111-1111-4111-8111-111111111111' }, { bindingSha256: '0'.repeat(64) },
    { engineConfigPath: 'attacker.json' }, { passphrase: 'private-value' }, { admissionMaxBytes: 99999999 },
  ]) await assert.rejects(f.service.createReplayReference({ ...body, ...patch }));
  const results = await Promise.allSettled([f.service.createReplayReference(body), f.service.createReplayReference(body)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await readdir(f.directory)).filter(name => /^[a-f0-9-]{36}$/.test(name)).length, 1);
});

test('refresh, tampered saved plan and invalid engine configuration cannot produce replay references', async t => {
  const f = await fixture(t), saved = await f.service.save(selection(await f.service.inspect({})));
  await f.service.inspect({});
  await assert.rejects(f.service.createReplayReference(confirmation(saved)), { code: 'capsule_review_changed' });
  const newer = await f.service.save(selection(await f.service.inspect({})));
  await writeFile(join(f.directory, newer.planPath), '{}');
  await assert.rejects(f.service.createReplayReference(confirmation(newer)), { code: 'restore_plan_binding_mismatch' });
  const fresh = await f.service.save(selection(await f.service.inspect({})));
  await writeFile(join(f.directory, 'engine.json'), JSON.stringify({ ...f.engine, projectRef: targetRef }));
  await assert.rejects(f.service.createReplayReference(confirmation(fresh)), { code: 'project_ref_mismatch' });
  assert.equal((await readdir(f.directory)).some(name => /^[a-f0-9-]{36}$/.test(name)), false);
});

test('save-only review remains usable without configured replay engine/target', async t => {
  const f = await fixture(t);
  for (const patch of [{ engineConfigPath: undefined }, { targetRef: undefined }, { targetRef: f.options.projectRef }]) {
    const service = await createPrivateCapsuleReview({ ...f.options, ...patch });
    assert.equal(service.bootstrap().replayConfigured, false);
    assert.equal(Object.hasOwn(service.bootstrap(), 'targetRef'), false);
    const saved = await service.save(selection(await service.inspect({})));
    await assert.rejects(service.createReplayReference(confirmation(saved)), { code: 'private_replay_setup_required' });
  }
});

test('new reference endpoint retains session/origin/CSRF/body limits and emits only opaque identifiers', async t => {
  const f = await fixture(t), server = await startCapsuleReviewServer({ privateReview: f.options });
  t.after(() => server.close());
  const origin = new URL(server.url).origin, session = { 'X-Portabase-Session': server.token };
  const bootstrap = await (await fetch(`${origin}/api/review`, { headers: session })).json();
  const headers = { ...session, Origin: origin, 'X-Portabase-CSRF': bootstrap.csrf, 'Content-Type': 'application/json' };
  const post = (path, body, options = {}) => fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body), ...options });
  const path = '/api/review/replay-reference';
  assert.equal((await post(path, {}, { headers: {} })).status, 401);
  assert.equal((await post(path, {}, { headers: session })).status, 403);
  assert.equal((await post(path, {}, { headers: { ...headers, Origin: 'https://foreign.test' } })).status, 403);
  assert.equal((await post(path, {}, { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await post(path, {}, { body: ' '.repeat(256 * 1024 + 1) })).status, 413);
  const review = await (await post('/api/review/inspect', {})).json();
  const saved = await (await post('/api/review/plans', selection(review))).json();
  const response = await post(path, confirmation(saved)); assert.equal(response.status, 201);
  const reference = await response.json(); assert.deepEqual(privateJobReference(reference, { id: f.options.runnerId }), reference);
  assert.equal(Object.keys(reference).length, 5);
  assert.equal((await post(path, confirmation(saved))).status, 409);
});
