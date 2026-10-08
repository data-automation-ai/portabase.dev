import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rm, rename, symlink, link, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { createPrivateCapsuleReview } from '../utility/ui/private-capsule-review.mjs';
import { validatePrivateRestorePlan, withValidatedPrivateRestorePlan, PRIVATE_RESTORE_PLAN_JSON_BYTES } from '../cloud/runner/private-restore-plan.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, { empty = false } = {}) {
  const f = await privateCapsuleFixture();
  t.after(async () => {
    const root = resolve(f.directory), base = resolve(tmpdir());
    assert.ok(root.startsWith(`${base}${sep}`) && basename(root).startsWith('portabase-capsule-review-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const service = await createPrivateCapsuleReview(f.options), review = await service.inspect({});
  const saved = await service.save({ revision: review.revision, selectedTables: empty ? [] : ['public.orders'], selectedBuckets: [], selectedFunctions: [], maxBytes: 1000000, confirmEmpty: empty });
  const planPath = join(f.directory, saved.planPath), bindingPath = join(dirname(planPath), 'binding.json');
  const plan = JSON.parse(await readFile(planPath)), binding = JSON.parse(await readFile(bindingPath));
  return { ...f, saved, plan, binding, planPath, bindingPath, review,
    validate: { ...f.options, planRef: saved.planRef, expectedBindingSha256: saved.bindingSha256 } };
}
async function rewrite(f, changePlan = () => {}, changeBinding = () => {}) {
  const plan = structuredClone(f.plan), binding = structuredClone(f.binding);
  changePlan(plan);
  const bytes = `${JSON.stringify(plan)}\n`;
  await writeFile(f.planPath, bytes);
  binding.planSha256 = digest(bytes); changeBinding(binding);
  const descriptor = `${JSON.stringify(binding)}\n`;
  await writeFile(f.bindingPath, descriptor);
  return { ...f.validate, expectedBindingSha256: digest(descriptor) };
}

test('saved UI plan authenticates capsule and returns exact pinned selection and paths', async t => {
  const f = await fixture(t), result = await validatePrivateRestorePlan(f.validate);
  assert.deepEqual(result.plan, f.plan); assert.deepEqual(result.binding, f.binding);
  assert.equal(result.planPath, f.planPath); assert.equal(result.bindingPath, f.bindingPath);
  assert.equal(result.bindingSha256, f.saved.bindingSha256);
  assert.equal(result.selectedBytes, f.review.tables.find(row => row.table === 'orders').bytes);
  assert.equal(result.plan.tables.find(row => row.table === 'empty').selected, false);
  assert.equal(result.plan.buckets[0].selected, false); assert.equal(result.plan.functions[0].selected, false);
  assert.doesNotMatch(JSON.stringify(result), /private-row-value|private-object.jpg|private-raw-diagnostic|synthetic-private-customer-passphrase/);
  assert.deepEqual(await readdir(join(f.directory, '.capsule-review')), []);
  assert.equal(Object.hasOwn(result, 'archivePath'), false);
  assert.equal(Object.hasOwn(result, 'metadata'), false);
});

test('retained plan callback consumes authenticated snapshot and cleanup waits for completion', async t => {
  const f = await fixture(t), original = await readFile(f.archive);
  let callbackPath, calls = 0;
  const result = await withValidatedPrivateRestorePlan(f.validate, async value => {
    calls++; callbackPath = value.archivePath;
    assert.deepEqual(value.plan, f.plan);
    assert.equal(value.bindingSha256, f.saved.bindingSha256);
    assert.equal(value.selectedBytes, f.saved.selectedBytes);
    assert.equal(value.metadata.id, f.metadata.id);
    assert.deepEqual(await readFile(callbackPath), original);
    // Replacing original files after authentication cannot change retained bytes.
    await writeFile(join(f.capsule, 'capsule.pbase'), 'replacement');
    await writeFile(f.planPath, '{}');
    await Promise.resolve();
    assert.deepEqual(await readFile(callbackPath), original);
    assert.deepEqual(value.plan, f.plan);
    return 'consumed-private-snapshot';
  });
  assert.equal(result, 'consumed-private-snapshot'); assert.equal(calls, 1);
  await assert.rejects(readFile(callbackPath), { code: 'ENOENT' });
  assert.deepEqual(await readdir(join(f.directory, '.capsule-review')), []);
});

test('callback failures clean plaintext and expose only allowed safe errors', async t => {
  const f = await fixture(t);
  for (const code of [undefined, 'restore_plan_archive_refused']) {
    let callbackPath;
    await assert.rejects(withValidatedPrivateRestorePlan(f.validate, async value => {
      callbackPath = value.archivePath;
      assert.ok((await readFile(callbackPath)).length > 0);
      if (code) throw Object.assign(new Error(code), { code });
      throw new Error('private-path-or-raw-diagnostic');
    }), { code: code || 'restore_plan_unavailable', message: code || 'restore_plan_unavailable' });
    await assert.rejects(readFile(callbackPath), { code: 'ENOENT' });
    assert.deepEqual(await readdir(join(f.directory, '.capsule-review')), []);
  }
});

test('callback never receives an unvalidated or over-budget plan', async t => {
  const f = await fixture(t); let calls = 0;
  const callback = () => { calls++; };
  await assert.rejects(withValidatedPrivateRestorePlan(f.validate), { code: 'restore_plan_setup_required' });
  await assert.rejects(withValidatedPrivateRestorePlan({ ...f.validate, admissionMaxBytes: 1 }, callback), { code: 'restore_plan_over_budget' });
  const input = await rewrite(f, plan => { plan.tables[0].bytes = 0; });
  await assert.rejects(withValidatedPrivateRestorePlan(input, callback), { code: 'restore_plan_inventory_mismatch' });
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(join(f.directory, '.capsule-review')), []);
});
test('descriptor hash pins exact plan selection and bytes before any later execution', async t => {
  const f = await fixture(t);
  await assert.rejects(validatePrivateRestorePlan({ ...f.validate, expectedBindingSha256: '0'.repeat(64) }), { code: 'restore_plan_binding_mismatch' });
  await writeFile(f.planPath, `${JSON.stringify({ ...f.plan, maxBytes: 2000000 })}\n`);
  await assert.rejects(validatePrivateRestorePlan(f.validate), { code: 'restore_plan_binding_mismatch' });
  await rewrite(f, plan => { plan.tables[0].selected = false; });
  await assert.rejects(validatePrivateRestorePlan(f.validate), { code: 'restore_plan_binding_mismatch' });
});
test('descriptor rejects wrong runner, source, capsule, fixed path and capsule digests even with newly pinned bytes', async t => {
  const f = await fixture(t);
  for (const patch of [
    { runnerId: '22222222-2222-4222-8222-222222222222' }, { projectRef: 'bcdefghijklmnopqrstu0' },
    { capsuleId: 'wrong-capsule' }, { capsulePath: '../capsule' }, { version: 2 },
    { planRef: '22222222-2222-4222-8222-222222222222' }, { metadataSha256: '0'.repeat(64) },
    { ciphertextSha256: '0'.repeat(64) }, { planSha256: '0'.repeat(64) }, { extra: true },
  ]) {
    const input = await rewrite(f, () => {}, binding => Object.assign(binding, patch));
    await assert.rejects(validatePrivateRestorePlan(input), error => ['restore_plan_binding_mismatch', 'restore_plan_invalid'].includes(error.code));
  }
});
test('all inventory identities and byte counts must match, including unselected rows', async t => {
  const f = await fixture(t);
  for (const mutate of [
    plan => { plan.tables.pop(); },
    plan => { plan.tables[1] = { ...plan.tables[0] }; },
    plan => { plan.tables[0].table = 'injected'; },
    plan => { plan.tables[0].bytes = 1; },
    plan => { plan.tables[1].bytes = 0; },
    plan => { plan.buckets[0].objectCount = 0; },
    plan => { plan.buckets[0].bytes = 0; },
    plan => { plan.functions[0].name = 'injected'; },
    plan => { plan.functions = []; },
    plan => { plan.tables[0].selected = 'false'; },
    plan => { plan.buckets[0].selected = 0; },
    plan => { plan.functions[0].extra = true; },
  ]) {
    const input = await rewrite(f, mutate);
    await assert.rejects(validatePrivateRestorePlan(input), error => ['restore_plan_inventory_mismatch', 'restore_plan_invalid'].includes(error.code));
  }
  // Identity matching is exact but does not depend on JSON row ordering.
  const reordered = await rewrite(f, plan => plan.tables.reverse());
  assert.equal((await validatePrivateRestorePlan(reordered)).selectedBytes, f.review.tables[0].bytes);
});
test('budget is the smaller of pinned plan and numeric admission, with no coercion', async t => {
  const f = await fixture(t), bytes = f.review.tables[0].bytes;
  const exact = await validatePrivateRestorePlan({ ...f.validate, admissionMaxBytes: bytes });
  assert.equal(exact.selectedBytes, bytes); assert.equal(exact.maxBytes, bytes);
  await assert.rejects(validatePrivateRestorePlan({ ...f.validate, admissionMaxBytes: bytes - 1 }), { code: 'restore_plan_over_budget' });
  for (const admissionMaxBytes of [0, -1, String(bytes), NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    await assert.rejects(validatePrivateRestorePlan({ ...f.validate, admissionMaxBytes }), { code: 'restore_plan_setup_required' });
  }
  const tooSmall = await rewrite(f, plan => { plan.maxBytes = bytes - 1; });
  await assert.rejects(validatePrivateRestorePlan({ ...tooSmall, admissionMaxBytes: 1000000 }), { code: 'restore_plan_over_budget' });
  const invalid = await rewrite(f, plan => { plan.maxBytes = String(bytes); });
  await assert.rejects(validatePrivateRestorePlan(invalid), { code: 'restore_plan_invalid' });
});
test('explicitly saved empty selection stays empty and does not imply execution', async t => {
  const f = await fixture(t, { empty: true }), result = await validatePrivateRestorePlan(f.validate);
  assert.equal(result.selectedBytes, 0);
  assert.equal(result.plan.tables.some(row => row.selected), false);
  assert.equal(result.execution, undefined);
});
test('wrong passphrase, changed ciphertext and review limits cannot release validated plans', async t => {
  const f = await fixture(t);
  await assert.rejects(validatePrivateRestorePlan({ ...f.validate, passphrase: 'synthetic-wrong-passphrase' }), { code: 'capsule_authentication_failed' });
  await assert.rejects(validatePrivateRestorePlan({ ...f.validate, maxCipherBytes: 1 }), { code: 'capsule_file_refused' });
  await assert.rejects(validatePrivateRestorePlan({ ...f.validate, maxExpandedBytes: 1024 }), { code: 'capsule_review_limit' });
  await writeFile(join(f.capsule, 'capsule.pbase'), 'changed');
  await assert.rejects(validatePrivateRestorePlan(f.validate), { code: 'capsule_changed' });
  assert.deepEqual(await readdir(join(f.directory, '.capsule-review')), []);
});
test('fixed UUID paths reject traversal, forbidden drives, hard links and linked plan directories', async t => {
  const f = await fixture(t);
  for (const planRef of ['../outside', 'F:/plan', '\\\\server\\share', '', f.saved.planRef.toUpperCase()]) {
    await assert.rejects(validatePrivateRestorePlan({ ...f.validate, planRef }), { code: 'restore_plan_setup_required' });
  }
  for (const capsulePath of ['../outside', 'F:/capsule', '\\\\server\\share', f.directory]) await assert.rejects(validatePrivateRestorePlan({ ...f.validate, capsulePath }));
  await link(f.planPath, join(f.directory, 'hard-linked-plan'));
  await assert.rejects(validatePrivateRestorePlan(f.validate), { code: 'restore_plan_path_refused' });
  await rm(join(f.directory, 'hard-linked-plan'));
  const moved = join(f.directory, 'moved-plan');
  await rename(dirname(f.planPath), moved);
  await symlink(moved, dirname(f.planPath), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(validatePrivateRestorePlan(f.validate), { code: 'private_config_path_refused' });
});
test('bounded descriptor/plan reads refuse oversized and malformed JSON with fixed errors', async t => {
  const f = await fixture(t);
  for (const path of [f.bindingPath, f.planPath]) {
    const original = await readFile(path);
    await writeFile(path, Buffer.alloc(PRIVATE_RESTORE_PLAN_JSON_BYTES + 1, 32));
    await assert.rejects(validatePrivateRestorePlan(f.validate), { code: 'restore_plan_too_large' });
    await writeFile(path, '{"private-secret":');
    await assert.rejects(validatePrivateRestorePlan(f.validate), error => error.code === 'restore_plan_invalid' && !error.message.includes('private-secret'));
    await writeFile(path, original);
  }
});
