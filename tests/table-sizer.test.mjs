import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applySelection,
  controlPlaneJobSpec,
  excludeTableListFlag,
  normalizeSizeInventory,
  planFit,
  sampleSizeInventory,
  summarizeSelection,
} from '../src/lib/table-sizer.js';
import { CLOUD_FREE } from '../src/lib/product.js';

test('normalizer keeps table/bucket estimates and drops row bodies', () => {
  const inv = normalizeSizeInventory({
    tables: [
      { schema: 'public', name: 'orders', rows: 10, sizeBytes: 2048, row_body: 'SECRET_ROW' },
      { schema: 'public', name: 'noise', rows: 99, sizeBytes: 4096 },
    ],
    buckets: [
      { id: 'avatars', objectCount: 3, totalBytes: 1024, objectName: 'hidden.bin' },
    ],
  });
  assert.equal(inv.tables.length, 2);
  assert.equal(inv.tables[0].key, 'public.orders');
  assert.equal(inv.buckets[0].objectCount, 3);
  assert.equal(inv.totalBytes, 2048 + 4096 + 1024);
  const json = JSON.stringify(inv);
  assert.doesNotMatch(json, /SECRET_ROW|hidden\.bin|row_body|objectName/);
});

test('sample inventory is labeled and large enough to need excludes for Cloud Free', () => {
  const sample = sampleSizeInventory();
  assert.equal(sample.mocked, true);
  assert.equal(sample.source, 'sample');
  assert.match(sample.labeled, /SAMPLE/);
  assert.ok(sample.totalBytes > CLOUD_FREE.storageCapBytes);
  assert.ok(sample.tables.some((row) => row.key === 'public.audit_log'));
  assert.ok(sample.buckets.some((row) => row.key === 'media'));
});

test('selection omit is loud NOT COVERED and maps to existing --exclude-table-list', () => {
  const sample = sampleSizeInventory();
  const summary = summarizeSelection(sample, {
    excludeTables: ['public.audit_log'],
    excludeBuckets: ['media'],
  });
  assert.equal(summary.notCoverage.loud, true);
  assert.match(summary.notCoverage.headline, /NOT COVERED/);
  assert.ok(summary.omittedTables.some((row) => row.key === 'public.audit_log'));
  assert.ok(summary.omittedBuckets.some((row) => row.key === 'media'));
  assert.equal(excludeTableListFlag(summary.omittedTables), 'public.audit_log');
  const included = applySelection(sample, { includeTables: ['public.profiles'], includeBuckets: ['avatars'] });
  assert.equal(included.tables.filter((row) => row.included).map((row) => row.key).join(), 'public.profiles');
  assert.equal(included.buckets.filter((row) => row.included).map((row) => row.key).join(), 'avatars');
});

test('plan fit uses Free 100 MB / $7 10 GB / $17 25 GB', () => {
  const mb = 1024 * 1024;
  const gb = 1024 * mb;
  assert.equal(planFit(80 * mb, 'cloud-free').fits, true);
  assert.equal(planFit(120 * mb, 'cloud-free').overCap, true);
  assert.equal(planFit(120 * mb, 'cloud-free').capLabel, '100 MB');
  assert.equal(planFit(2 * gb, 'cloud-7').fits, true);
  assert.equal(planFit(11 * gb, 'cloud-7').overCap, true);
  assert.equal(planFit(11 * gb, 'cloud-17').fits, true);
  assert.equal(planFit(26 * gb, 'cloud-17').overCap, true);
});

test('empty include list is omit-all and stays NOT COVERED', () => {
  const sample = sampleSizeInventory();
  const selection = {
    includeTables: [],
    includeBuckets: [],
    excludeTables: sample.tables.map((row) => row.key),
    excludeBuckets: sample.buckets.map((row) => row.key),
  };
  const summary = summarizeSelection(sample, selection);
  assert.equal(summary.notCoverage.loud, true);
  assert.match(summary.notCoverage.headline, /NOT COVERED/);
  assert.equal(summary.includedTables.length, 0);
  const spec = controlPlaneJobSpec({ inventory: sample, selection, planId: 'cloud-free' });
  assert.equal(spec.includeTables.length, 0);
  assert.equal(spec.notCoverage.loud, true);
});

test('control plane spec is include list + estimates only — no keys or row bodies', () => {
  const spec = controlPlaneJobSpec({
    inventory: sampleSizeInventory(),
    selection: { excludeTables: ['public.audit_log'], excludeBuckets: ['media'] },
    planId: 'cloud-free',
    excludeBinaries: true,
  });
  assert.ok(spec.includeTables.includes('public.profiles'));
  assert.ok(spec.excludeTables.includes('public.audit_log'));
  assert.ok(spec.includeBuckets.includes('avatars'));
  assert.ok(spec.excludeBuckets.includes('media'));
  assert.equal(spec.engineFlags.excludeTableList, 'public.audit_log');
  assert.equal(spec.engineFlags.excludeBinaries, true);
  assert.match(spec.note, /include list/);
  const json = JSON.stringify(spec);
  assert.doesNotMatch(json, /passphrase|service.role|row body|row_body|ciphertext/i);
});

test('sizer UI stamps NOT COVERED on omitted rows and the loud banner', () => {
  const ui = readFileSync(new URL('../src/console/table-sizer.jsx', import.meta.url), 'utf8');
  assert.match(ui, /pb-sizer-loud/);
  assert.match(ui, /pb-sizer-omit-tag/);
  assert.match(ui, /NOT COVERED/);
  assert.match(ui, /summarizeSelection\(inv, selection\)/);
});
