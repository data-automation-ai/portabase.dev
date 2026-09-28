import test from 'node:test';
import assert from 'node:assert/strict';

import {
  baselineObjectUnchanged,
  computeTombstones,
  partitionChanged,
  findProtectedBaselines,
  mergeStorageManifests,
  mergeFunctionManifests,
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

test('mergeStorageManifests: delta wins per name, tombstones drop', () => {
  const baseline = { buckets: [{ id: 'b', objects: [{ name: 'keep', sha256: 'k' }, { name: 'chg', sha256: 'old' }, { name: 'del', sha256: 'd' }] }] };
  const delta = { buckets: [{ id: 'b', objects: [{ name: 'chg', sha256: 'new' }, { name: 'new', sha256: 'n' }] }] };
  const merged = mergeStorageManifests(baseline, delta, ['b/del']);
  assert.deepEqual(merged.buckets[0].objects.map(o => [o.name, o.sha256]), [['keep', 'k'], ['chg', 'new'], ['new', 'n']]);
});

test('mergeFunctionManifests: delta wins per (name, path)', () => {
  const baseline = [{ name: 'f', files: [{ path: 'a.ts', sha256: '1' }, { path: 'b.ts', sha256: '2' }] }];
  const delta = [{ name: 'f', files: [{ path: 'b.ts', sha256: '3' }] }, { name: 'g', files: [{ path: 'x.ts', sha256: '4' }] }];
  const merged = mergeFunctionManifests(baseline, delta);
  assert.deepEqual(merged.find(f => f.name === 'f').files.map(f => [f.path, f.sha256]), [['a.ts', '1'], ['b.ts', '3']]);
  assert.equal(merged.find(f => f.name === 'g').files.length, 1);
});

test('findProtectedBaselines: every referenced baseline is protected', () => {
  const metas = [{ id: 'full-1' }, { id: 'delta-1', baselineCapsuleId: 'full-1' }, { id: 'delta-2', baselineCapsuleId: 'full-1' }];
  assert.deepEqual([...findProtectedBaselines(metas)], ['full-1']);
  assert.deepEqual([...findProtectedBaselines([])], []);
});
