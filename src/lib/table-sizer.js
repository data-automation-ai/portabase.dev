/**
 * Advanced table + Storage-bucket sizer for Cloud job setup.
 *
 * Sizes come from the free engine doctor / size inventory already produced
 * by `portabase doctor` and capture (`database-inventory.json` tables +
 * Storage bucket inventory). No new CLI capture flags.
 *
 * Control plane may store: include list, size estimates, job metadata / hashes.
 * Never: keys, passphrase, row bodies, capsule bytes, object names.
 */

import { CLOUD_FREE, getCloudPlan } from './product.js';
import { FORBIDDEN_INVENTORY_KEY } from './zero-knowledge.js';

const FORBIDDEN_KEY = /^(passphrase|password|service[_-]?role|sb[_-]?secret|private[_-]?key|capsule[_-]?bytes|ciphertext|row[_-]?body|function[_-]?source|source[_-]?code|dump|object[_-]?name|table[_-]?rows|rowsData)$/i;

export const SIZER_SOURCE = Object.freeze({
  empty: 'empty',
  doctor: 'doctor',
  capture: 'capture',
  sample: 'sample',
});

export function tableKey(table) {
  if (table == null) return '';
  if (typeof table === 'string') return table.trim();
  const schema = String(table.schema || table.schemaname || 'public').trim() || 'public';
  const name = String(table.name || table.tablename || table.id || table.table || '').trim();
  if (!name) return '';
  return name.includes('.') ? name : `${schema}.${name}`;
}

export function bucketKey(bucket) {
  if (bucket == null) return '';
  if (typeof bucket === 'string') return bucket.trim();
  return String(bucket.id || bucket.name || bucket.bucketId || '').trim();
}

export function itemBytes(item) {
  const n = Number(item?.sizeBytes ?? item?.totalBytes ?? item?.bytes ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function itemRows(item) {
  const n = Number(item?.rows ?? item?.rowCount ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function itemObjects(item) {
  const n = Number(item?.objectCount ?? item?.objects ?? item?.count ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function cleanName(value) {
  const text = String(value || '').trim().slice(0, 160);
  if (!text || FORBIDDEN_INVENTORY_KEY.test(text) || FORBIDDEN_KEY.test(text)) return '';
  return text;
}

function sanitizeTable(raw) {
  const key = cleanName(tableKey(raw));
  if (!key) return null;
  const [schema, ...rest] = key.split('.');
  const name = rest.join('.') || schema;
  return {
    key,
    schema: rest.length ? schema : 'public',
    name: rest.length ? name : schema,
    rows: itemRows(raw),
    sizeBytes: itemBytes(raw),
  };
}

function sanitizeBucket(raw) {
  const key = cleanName(bucketKey(raw));
  if (!key) return null;
  return {
    key,
    id: key,
    objectCount: itemObjects(raw),
    sizeBytes: itemBytes(raw),
  };
}

/**
 * Accept doctor.inventory, sizeInventory, capture summaries, or flat tables+buckets.
 * Drops row bodies, object names, and secret-shaped keys.
 */
export function normalizeSizeInventory(raw = {}, { source = SIZER_SOURCE.doctor, mocked = false } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nested = src.sizeInventory || src.inventory || src.doctor?.inventory || src;
  const tablesIn = Array.isArray(nested.tables) ? nested.tables
    : Array.isArray(src.tables) ? src.tables
      : [];
  const bucketsIn = Array.isArray(nested.buckets) ? nested.buckets
    : Array.isArray(src.buckets) ? src.buckets
      : Array.isArray(nested.storage?.buckets) ? nested.storage.buckets
        : Array.isArray(src.storage?.buckets) ? src.storage.buckets
          : [];
  const tables = tablesIn.map(sanitizeTable).filter(Boolean);
  const buckets = bucketsIn.map(sanitizeBucket).filter(Boolean);
  const tableBytes = tables.reduce((sum, row) => sum + row.sizeBytes, 0);
  const bucketBytes = buckets.reduce((sum, row) => sum + row.sizeBytes, 0);
  const labeled = source === SIZER_SOURCE.sample || mocked === true || src.mocked === true || src.demo === true;
  return {
    source: labeled ? SIZER_SOURCE.sample : (source || SIZER_SOURCE.doctor),
    mocked: labeled,
    labeled: labeled
      ? 'SAMPLE inventory — not a live customer project. Sizes illustrate the sizer; they are not live telemetry.'
      : 'Doctor / size inventory from the free engine. Names and size estimates only.',
    tables,
    buckets,
    tableBytes,
    bucketBytes,
    totalBytes: tableBytes + bucketBytes,
    tableCount: tables.length,
    bucketCount: buckets.length,
    objectCount: buckets.reduce((sum, row) => sum + row.objectCount, 0),
    rowCount: tables.reduce((sum, row) => sum + row.rows, 0),
    empty: tables.length === 0 && buckets.length === 0,
    capturedAt: typeof nested.capturedAt === 'string' ? nested.capturedAt : (src.capturedAt || null),
  };
}

/** Labeled sample so the Cloud demo can show the sizer without inventing live telemetry. */
export function sampleSizeInventory() {
  return normalizeSizeInventory({
    mocked: true,
    capturedAt: '2026-09-20T12:00:00.000Z',
    tables: [
      { schema: 'public', name: 'profiles', rows: 1204, sizeBytes: 2_204_160 },
      { schema: 'public', name: 'orders', rows: 8442, sizeBytes: 19_292_160 },
      { schema: 'public', name: 'order_items', rows: 41008, sizeBytes: 43_220_992 },
      { schema: 'public', name: 'events', rows: 120400, sizeBytes: 67_960_832 },
      { schema: 'public', name: 'audit_log', rows: 890221, sizeBytes: 220_200_960 },
    ],
    buckets: [
      { id: 'avatars', objectCount: 184, totalBytes: 13_215_744 },
      { id: 'invoices', objectCount: 42, totalBytes: 29_491_200 },
      { id: 'media', objectCount: 2204, totalBytes: 1_266_647_040 },
    ],
  }, { source: SIZER_SOURCE.sample, mocked: true });
}

function keySet(list) {
  return new Set((list || []).map((item) => (typeof item === 'string' ? item : (item.key || tableKey(item) || bucketKey(item)))).filter(Boolean));
}

/**
 * Selective include. Default is include-all (nothing omitted).
 * Pass includeTables / includeBuckets to keep only those keys,
 * or excludeTables / excludeBuckets to drop keys from a full include.
 */
export function applySelection(inventory, selection = {}) {
  const inv = inventory?.tables ? inventory : normalizeSizeInventory(inventory);
  const includeTables = selection.includeTables;
  const includeBuckets = selection.includeBuckets;
  const excludeTables = keySet(selection.excludeTables);
  const excludeBuckets = keySet(selection.excludeBuckets);
  const includeTableSet = Array.isArray(includeTables) ? keySet(includeTables) : null;
  const includeBucketSet = Array.isArray(includeBuckets) ? keySet(includeBuckets) : null;

  const tables = inv.tables.map((table) => {
    const included = includeTableSet
      ? includeTableSet.has(table.key)
      : !excludeTables.has(table.key);
    return { ...table, included };
  });
  const buckets = inv.buckets.map((bucket) => {
    const included = includeBucketSet
      ? includeBucketSet.has(bucket.key)
      : !excludeBuckets.has(bucket.key);
    return { ...bucket, included };
  });
  return { ...inv, tables, buckets };
}

export function summarizeSelection(inventory, selection = {}) {
  const applied = applySelection(inventory, selection);
  const includedTables = applied.tables.filter((row) => row.included);
  const omittedTables = applied.tables.filter((row) => !row.included);
  const includedBuckets = applied.buckets.filter((row) => row.included);
  const omittedBuckets = applied.buckets.filter((row) => !row.included);
  const includedTableBytes = includedTables.reduce((sum, row) => sum + row.sizeBytes, 0);
  const omittedTableBytes = omittedTables.reduce((sum, row) => sum + row.sizeBytes, 0);
  const includedBucketBytes = includedBuckets.reduce((sum, row) => sum + row.sizeBytes, 0);
  const omittedBucketBytes = omittedBuckets.reduce((sum, row) => sum + row.sizeBytes, 0);
  const includedBytes = includedTableBytes + includedBucketBytes;
  const omittedBytes = omittedTableBytes + omittedBucketBytes;
  const omitted = omittedTables.length + omittedBuckets.length;
  const loud = omitted > 0;
  const omittedNames = [
    ...omittedTables.map((row) => row.key),
    ...omittedBuckets.map((row) => `bucket:${row.key}`),
  ];
  return {
    ...applied,
    includedTables,
    omittedTables,
    includedBuckets,
    omittedBuckets,
    includedTableBytes,
    omittedTableBytes,
    includedBucketBytes,
    omittedBucketBytes,
    includedBytes,
    omittedBytes,
    totalBytes: applied.totalBytes,
    coverageComplete: !loud,
    notCoverage: {
      loud,
      omitted,
      omittedTables: omittedTables.map((row) => row.key),
      omittedBuckets: omittedBuckets.map((row) => row.key),
      omittedBytes,
      names: omittedNames,
      headline: loud
        ? `NOT COVERED · ${omitted} item${omitted === 1 ? '' : 's'} omitted from this capsule`
        : 'Full coverage — every inventoried table and bucket is included',
      detail: loud
        ? `Omitted tables and Storage buckets will not be in this capsule. Restore will not bring them back. ${omittedNames.join(', ')}.`
        : 'This job includes every table and Storage bucket in the doctor / size inventory.',
    },
  };
}

export function planFit(estimatedBytes, planId = 'cloud-free') {
  const plan = getCloudPlan(planId) || CLOUD_FREE;
  const used = Math.max(0, Number(estimatedBytes) || 0);
  const cap = Math.max(0, Number(plan.storageCapBytes) || 0);
  const remaining = Math.max(0, cap - used);
  const overBy = Math.max(0, used - cap);
  const ratio = cap > 0 ? Math.min(1, used / cap) : 0;
  return {
    planId: plan.id,
    planTitle: plan.title,
    shortLabel: plan.shortLabel,
    capBytes: cap,
    capLabel: plan.storageCapLabel,
    scheduled: plan.scheduled !== false && plan.id !== 'cloud-free',
    usedBytes: used,
    remainingBytes: remaining,
    overByBytes: overBy,
    ratio,
    percent: Math.round(ratio * 100),
    fits: used <= cap,
    overCap: used > cap,
  };
}

/** Existing CLI flag only — comma-separated schema.table list. */
export function excludeTableListFlag(omittedTables = []) {
  const names = omittedTables
    .map((row) => (typeof row === 'string' ? row : row.key))
    .map(cleanName)
    .filter(Boolean);
  if (!names.length) return '';
  return names.join(',');
}

/**
 * Job metadata the control plane is allowed to keep.
 * Keys stay sealed to the runner. No row bodies.
 */
export function controlPlaneJobSpec({
  inventory,
  selection = {},
  planId = 'cloud-free',
  excludeBinaries = false,
} = {}) {
  const summary = summarizeSelection(inventory, selection);
  const fit = planFit(summary.includedBytes, planId);
  const excludeTableList = excludeTableListFlag(summary.omittedTables);
  return {
    includeTables: summary.includedTables.map((row) => row.key),
    excludeTables: summary.omittedTables.map((row) => row.key),
    includeBuckets: summary.includedBuckets.map((row) => row.key),
    excludeBuckets: summary.omittedBuckets.map((row) => row.key),
    estimatedBytes: summary.includedBytes,
    omittedBytes: summary.omittedBytes,
    tableEstimates: summary.includedTables.map((row) => ({
      key: row.key,
      sizeBytes: row.sizeBytes,
      rows: row.rows,
    })),
    bucketEstimates: summary.includedBuckets.map((row) => ({
      key: row.key,
      sizeBytes: row.sizeBytes,
      objectCount: row.objectCount,
    })),
    planId: fit.planId,
    planCapBytes: fit.capBytes,
    fits: fit.fits,
    coverageComplete: summary.coverageComplete,
    notCoverage: summary.notCoverage,
    excludeBinaries: Boolean(excludeBinaries),
    engineFlags: {
      excludeBinaries: Boolean(excludeBinaries),
      excludeTableList,
    },
    note: 'Control plane: include list + size estimates + job metadata only. Keys stay sealed to the runner. No row bodies.',
  };
}

export function meterPlanCards() {
  return [
    { id: CLOUD_FREE.id, title: CLOUD_FREE.title, capLabel: CLOUD_FREE.storageCapLabel, cadence: CLOUD_FREE.summary },
    { id: 'cloud-7', title: 'Starter Escape', capLabel: '10 GB', cadence: 'one database · 1 capsule / 24h' },
    { id: 'cloud-17', title: 'Daily Escape', capLabel: '25 GB', cadence: 'unlimited databases · 3 capsules / day' },
  ];
}
