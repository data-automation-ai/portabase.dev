import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRestorePlan, validateRestorePlan } from '../utility/portabase-core.mjs';
const plan = () => buildRestorePlan({ manifest: { projectRef: 'fixture' }, capsuleId: 'capsule-fixture',
  tableSizes: [{ schema: 'public', table: 'large', bytes: 200 }, { schema: 'public', table: 'small', bytes: 10 }], maxBytes: 100 });

test('negative, coerced and unsafe byte sizes cannot reduce the restore budget', () => {
  for (const value of [-200, '0', null, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const candidate = plan(); candidate.tables[1].bytes = value;
    assert.throws(() => validateRestorePlan(candidate), /bytes must/);
  }
  const overflow = plan(); overflow.maxBytes = Number.MAX_SAFE_INTEGER;
  overflow.tables.forEach(row => { row.bytes = Number.MAX_SAFE_INTEGER; });
  assert.throws(() => validateRestorePlan(overflow), /precision/);
});

test('ambiguous selection flags, duplicate identities and malformed collections are refused', () => {
  for (const value of ['false', 1, null, undefined]) {
    const candidate = plan(); candidate.tables[0].selected = value;
    assert.throws(() => validateRestorePlan(candidate), /invalid tables/);
  }
  const duplicate = plan(); duplicate.tables.push({ ...duplicate.tables[0], selected: false });
  assert.throws(() => validateRestorePlan(duplicate), /duplicate/);
  const malformed = plan(); malformed.buckets = {};
  assert.throws(() => validateRestorePlan(malformed), /must be an array/);
});

test('only explicit safe integer budgets and genuine deselection pass', () => {
  for (const value of ['100', 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateRestorePlan(plan(), { maxBytesOverride: value }), /positive safe integer/);
  }
  const valid = plan(); valid.tables[0].selected = false;
  assert.deepEqual(validateRestorePlan(valid), { selectedBytes: 10, maxBytes: 100 });
  valid.tables[0].selected = true;
  assert.throws(() => validateRestorePlan(valid), /over the .* budget/);
});
