import test from 'node:test';
import assert from 'node:assert/strict';

import {
  baselineObjectUnchanged,
  computeTombstones,
  partitionChanged,
  findProtectedBaselines,
} from '../utility/portabase-core.mjs';

test('baselineObjectUnchanged: size+tag match reuses; anything weaker re-downloads', () => {
  const base = { sha256: 'abc', size: 100, etag: 'e1', updatedAt: 't1' };
  assert.equal(baselineObjectUnchanged(base, { size: 100, etag: 'e1' }), true);
  assert.equal(baselineObjectUnchanged({ sha256: 'abc', size: 100, updatedAt: 't1' }, { size: 100, updatedAt: 't1' }), true);
  assert.equal(baselineObjectUnchanged(base, { size: 100 }), false);
  assert.equal(baselineObjectUnchanged(base, { size: 100, etag: 'other' }), false);
  assert.equal(baselineObjectUnchanged(base, { size: 101, etag: 'e1' }), false);
  assert.equal(baselineObjectUnchanged({ size: 100, etag: 'e1' }, { size: 100, etag: 'e1' }), false);
});

test('computeTombstones: baseline-only keys are deletions', () => {
  assert.deepEqual(computeTombstones(['a/1', 'a/2', 'b/1'], ['a/2', 'b/1', 'c/1']), ['a/1']);
  assert.deepEqual(computeTombstones([], ['a/1']), []);
});

test('partitionChanged: identical sha reuses, new/different stores, baseline-only is missing', () => {
  assert.deepEqual(
    partitionChanged({ 'a.sql': 'h1', 'b.sql': 'h2', 'c.sql': 'h3' }, { 'a.sql': 'h1', 'b.sql': 'old', 'gone.sql': 'h9' }),
    {
      changed: ['b.sql', 'c.sql'],
      reused: [{ path: 'a.sql', sha256: 'h1' }],
      missing: ['gone.sql'],
    },
  );
});

test('findProtectedBaselines: every referenced baseline is protected', () => {
  const metas = [{ id: 'full-1' }, { id: 'delta-1', baselineCapsuleId: 'full-1' }, { id: 'delta-2', baselineCapsuleId: 'full-1' }];
  assert.deepEqual([...findProtectedBaselines(metas)], ['full-1']);
  assert.deepEqual([...findProtectedBaselines([])], []);
});
