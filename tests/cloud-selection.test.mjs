import test from 'node:test';
import assert from 'node:assert/strict';
import { findForbiddenField } from '../cloud/control-plane/forbidden.mjs';
import { getCloudPlan } from '../netlify/shared/product.mjs';
import {
  getSelection,
  planExists,
  putSelection,
  selectionKey,
  validateSelection,
} from '../netlify/shared/selection-store.mjs';

const PLAN_7 = getCloudPlan('cloud-7');
const PLAN_17 = getCloudPlan('cloud-17');
const REF_A = 'abcdefghijklmnopqrst'; // 20 lowercase alnum chars
const REF_B = 'zzzzzzzzzzzzzzzzzzzz';

function baseInput(overrides = {}) {
  return {
    version: 1,
    planId: 'cloud-7',
    projectRef: REF_A,
    excludeTables: ['public.big_logs'],
    excludeBuckets: ['videos'],
    estimateBytes: 123,
    ...overrides,
  };
}

test('valid selection passes and server sets capBytes/planId/savedAt', () => {
  const result = validateSelection(baseInput(), PLAN_7);
  assert.equal(result.ok, true);
  assert.equal(result.selection.planId, 'cloud-7');
  assert.equal(result.selection.projectRef, REF_A);
  assert.deepEqual(result.selection.excludeTables, ['public.big_logs']);
  assert.deepEqual(result.selection.excludeBuckets, ['videos']);
  assert.equal(result.selection.estimateBytes, 123);
  assert.equal(result.selection.capBytes, PLAN_7.storageCapBytes);
  assert.equal(result.selection.savedAt, undefined); // set by store helper, not the pure validator
});

test('estimateBytes over the plan cap is rejected', () => {
  const result = validateSelection(baseInput({ estimateBytes: PLAN_7.storageCapBytes + 1 }), PLAN_7);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'over_cap');
  assert.equal(result.field, 'estimateBytes');
});

test('malformed projectRef is rejected', () => {
  const cases = ['short', 'ABCDEFGHIJKLMNOPQRST', 'abcdefghijklmnopqrs!', '', 12345, null];
  for (const bad of cases) {
    const result = validateSelection(baseInput({ projectRef: bad }), PLAN_7);
    assert.equal(result.ok, false, `expected reject for ${JSON.stringify(bad)}`);
    assert.equal(result.field, 'projectRef');
  }
});

test('two projectRefs on cloud-7 (1-DB plan) violate the plan DB limit', () => {
  const result = validateSelection(baseInput({ projectRef: [REF_A, REF_B] }), PLAN_7);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'db_limit_exceeded');
  assert.equal(result.field, 'projectRef');
});

test('multiple projectRefs are fine on an unlimited-DB plan', () => {
  const result = validateSelection(baseInput({ planId: 'cloud-17', projectRef: [REF_A, REF_B] }), PLAN_17);
  assert.equal(result.ok, true);
  assert.deepEqual(result.selection.projectRef, [REF_A, REF_B]);
});

test('injection-shaped excludeTables entries are rejected', () => {
  const bad = [
    'public.users; DROP TABLE users;--',
    "public.users' OR '1'='1",
    'public..users',
    'public.users.extra',
    'noSchemaJustTable',
    '1public.users',
    'public.1users',
  ];
  for (const t of bad) {
    const result = validateSelection(baseInput({ excludeTables: [t] }), PLAN_7);
    assert.equal(result.ok, false, `expected reject for ${JSON.stringify(t)}`);
    assert.equal(result.field, 'excludeTables');
  }
});

test('excludeTables over the 5000 cap is rejected', () => {
  const many = Array.from({ length: 5001 }, (_, i) => `public.t${i}`);
  const result = validateSelection(baseInput({ excludeTables: many }), PLAN_7);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'too_many_exclude_table');
  assert.equal(result.field, 'excludeTables');
});

test('excludeBuckets over the 1000 cap is rejected', () => {
  const many = Array.from({ length: 1001 }, (_, i) => `bucket-${i}`);
  const result = validateSelection(baseInput({ excludeBuckets: many }), PLAN_7);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'too_many_exclude_bucket');
  assert.equal(result.field, 'excludeBuckets');
});

test('malformed excludeBuckets entries are rejected', () => {
  const bad = ['has spaces', 'a'.repeat(101), '', 'valid/but-not/really'];
  for (const b of bad) {
    const result = validateSelection(baseInput({ excludeBuckets: [b] }), PLAN_7);
    assert.equal(result.ok, false, `expected reject for ${JSON.stringify(b)}`);
    assert.equal(result.field, 'excludeBuckets');
  }
});

test('client-supplied capBytes is ignored — server derives it from the plan', () => {
  const result = validateSelection(baseInput({ capBytes: 1 }), PLAN_7);
  assert.equal(result.ok, true);
  assert.equal(result.selection.capBytes, PLAN_7.storageCapBytes);
  assert.notEqual(result.selection.capBytes, 1);
});

test('a client capBytes of 1 does not let an over-cap estimate sneak through', () => {
  // Even if the client lies about capBytes, the real plan cap is enforced.
  const result = validateSelection(baseInput({ capBytes: 999999999999, estimateBytes: PLAN_7.storageCapBytes + 1 }), PLAN_7);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'over_cap');
});

test('unknown keys are stripped from the stored selection', () => {
  const result = validateSelection(baseInput({ evilExtra: 'nope', another: { nested: true } }), PLAN_7);
  assert.equal(result.ok, true);
  assert.equal(result.selection.evilExtra, undefined);
  assert.equal(result.selection.another, undefined);
  assert.deepEqual(Object.keys(result.selection).sort(), [
    'capBytes', 'estimateBytes', 'excludeBuckets', 'excludeTables', 'planId', 'projectRef', 'version',
  ].sort());
});

test('unknown planId is rejected before validation runs', () => {
  const result = validateSelection(baseInput(), { id: 'not-a-real-plan' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_plan');
  assert.equal(result.field, 'planId');
});

test('planExists is accurate for real, legacy-aliased, free, and bogus ids', () => {
  assert.equal(planExists('cloud-7'), true);
  assert.equal(planExists('cloud-17'), true);
  assert.equal(planExists('cloud-27'), true); // legacy alias -> cloud-17
  assert.equal(planExists('cloud-free'), true);
  assert.equal(planExists('cloud-999'), false);
  assert.equal(planExists(''), false);
  assert.equal(planExists(null), false);
});

test('wrong version is rejected', () => {
  const result = validateSelection(baseInput({ version: 2 }), PLAN_7);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_version');
  assert.equal(result.field, 'version');
});

test('optional projectName and measuredAt pass through when valid, reject when not', () => {
  const ok = validateSelection(baseInput({ projectName: 'My app', measuredAt: '2026-09-23T00:00:00.000Z' }), PLAN_7);
  assert.equal(ok.ok, true);
  assert.equal(ok.selection.projectName, 'My app');
  assert.equal(ok.selection.measuredAt, '2026-09-23T00:00:00.000Z');

  const badName = validateSelection(baseInput({ projectName: `${'x'.repeat(200)}!` }), PLAN_7);
  assert.equal(badName.ok, false);
  assert.equal(badName.field, 'projectName');

  const badDate = validateSelection(baseInput({ measuredAt: 'not-a-date' }), PLAN_7);
  assert.equal(badDate.ok, false);
  assert.equal(badDate.field, 'measuredAt');
});

// --- forbidden secret-shaped bodies ---------------------------------------

test('findForbiddenField rejects service_role and sb_secret_ shaped bodies', () => {
  assert.equal(findForbiddenField({ projectRef: REF_A, serviceRole: 'x' }), 'key:serviceRole');
  assert.equal(findForbiddenField({ projectRef: REF_A, note: 'sb_secret_abcdef' }), 'body.note');
  assert.equal(findForbiddenField({ projectRef: REF_A, note: 'service_role' }), 'body.note');
  assert.equal(findForbiddenField({ projectRef: REF_A }), null);
});

test('validateSelection itself rejects a secret-shaped body (service_role key)', () => {
  const result = validateSelection(baseInput({ service_role: 'nope' }), PLAN_7);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden_field');
});

test('validateSelection rejects a body whose value looks like sb_secret_', () => {
  const result = validateSelection(baseInput({ projectName: 'sb_secret_abcdefghijklmnop' }), PLAN_7);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'forbidden_field');
});

// --- store round-trip with an injected fake store -------------------------

function fakeStore() {
  const data = new Map();
  return {
    data,
    async get(key, { type } = {}) {
      const v = data.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async setJSON(key, value) {
      data.set(key, JSON.stringify(value));
    },
  };
}

test('selectionKey format and get/put round-trip through an injected store', async () => {
  assert.equal(selectionKey('u1'), 'sel:v1:u1');

  const s = fakeStore();
  const missing = await getSelection('u1', s);
  assert.equal(missing, null);

  const { selection } = validateSelection(baseInput(), PLAN_7);
  const saved = await putSelection('u1', selection, s);
  assert.equal(saved.planId, 'cloud-7');
  assert.ok(saved.savedAt);
  assert.ok(s.data.has('sel:v1:u1'));

  const fetched = await getSelection('u1', s);
  assert.deepEqual(fetched, saved);
});
