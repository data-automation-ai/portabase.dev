import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeObjectIncludedMb,
  computeDatabaseScopeSummary,
  buildExportManifest,
  groupDatabaseObjectsBySchemaAndBucket,
  setSchemaModeInDatabase,
  setBucketModeInDatabase,
} from '../cloud/runner/database-scope.mjs';
import { DISCOVERY_SQL } from '../cloud/runner/supabase-discovery.mjs';
import { createCloudRunServer } from '../cloud/runner/cloud-run-server.mjs';

const SAMPLE_MULTI_PROJECT_SCOPE = [
  {
    id: 'db_ekklokru',
    projectRef: 'ekklokrukxmqlahtonnc',
    projectName: 'DataAutomation Prod',
    name: 'DataAutomation Prod (postgres)',
    estimatedSizeMb: 142.5,
    enabled: true,
    mode: 'structure_and_data',
    tables: [
      {
        name: 'public.orders',
        schema: 'public',
        objectName: 'orders',
        objectType: 'TABLE',
        sizeMb: 120.5,
        createdAt: '2026-07-01 10:00:00 UTC',
        updatedAt: '2026-10-18 14:22:00 UTC',
        mode: 'structure_and_data',
      },
      {
        name: 'public.active_orders_view',
        schema: 'public',
        objectName: 'active_orders_view',
        objectType: 'VIEW',
        sizeMb: 0.02,
        createdAt: '2026-07-01 10:00:00 UTC',
        updatedAt: '2026-10-18 14:22:00 UTC',
        mode: 'structure_only',
      },
    ],
    binaries: [
      {
        name: 'invoices/2026-10-invoice.pdf',
        bucket: 'invoices',
        schema: 'invoices',
        objectName: '2026-10-invoice.pdf',
        objectType: 'BINARY',
        sizeMb: 18.4,
        createdAt: '2026-10-01 09:15:00 UTC',
        updatedAt: '2026-10-01 09:15:00 UTC',
        mode: 'include',
      },
    ],
  },
  {
    id: 'db_svltssnx',
    projectRef: 'svltssnxzqsrxtbjgaex',
    projectName: 'Analytics Warehouse',
    name: 'Analytics Warehouse (postgres)',
    estimatedSizeMb: 56.0,
    enabled: true,
    mode: 'structure_and_data',
    tables: [
      {
        name: 'public.events',
        schema: 'public',
        objectName: 'events',
        objectType: 'TABLE',
        sizeMb: 50.0,
        createdAt: '2026-08-12 08:00:00 UTC',
        updatedAt: '2026-10-19 01:00:00 UTC',
        mode: 'structure_and_data',
      },
    ],
    binaries: [
      {
        name: 'exports/daily.parquet',
        bucket: 'exports',
        schema: 'exports',
        objectName: 'daily.parquet',
        objectType: 'BINARY',
        sizeMb: 6.0,
        createdAt: '2026-10-18 23:00:00 UTC',
        updatedAt: '2026-10-18 23:00:00 UTC',
        mode: 'include',
      },
    ],
  },
];

test('DISCOVERY_SQL does not impose any 300-row LIMIT on database or binary storage objects', () => {
  assert.doesNotMatch(DISCOVERY_SQL, /LIMIT\s+120/i);
  assert.doesNotMatch(DISCOVERY_SQL, /LIMIT\s+30/i);
  assert.doesNotMatch(DISCOVERY_SQL, /LIMIT\s+150/i);
});

test('groupDatabaseObjectsBySchemaAndBucket groups >1000 objects into SCHEMA and BUCKET summary rows with 1-click mode switches', () => {
  const manyTables = Array.from({ length: 650 }, (_, i) => ({
    name: `public.tbl_${i}`,
    schema: 'public',
    objectName: `tbl_${i}`,
    objectType: 'TABLE',
    sizeMb: 0.5,
    mode: 'structure_and_data',
  }));
  const manyBins = Array.from({ length: 850 }, (_, i) => ({
    name: `documents/doc_${i}.pdf`,
    bucket: 'documents',
    schema: 'documents',
    objectName: `doc_${i}.pdf`,
    objectType: 'BINARY',
    sizeMb: 0.25,
    mode: 'include',
  }));
  const db = {
    id: 'db_large',
    enabled: true,
    mode: 'structure_and_data',
    tables: manyTables,
    binaries: manyBins,
  };

  const groups = groupDatabaseObjectsBySchemaAndBucket(db);
  assert.equal(groups.length, 2);

  const schemaGroup = groups.find((g) => g.objectType === 'SCHEMA' && g.schemaOrBucket === 'public');
  assert.ok(schemaGroup);
  assert.equal(schemaGroup.objectCount, 650);
  assert.equal(schemaGroup.sizeMb, 325);
  assert.equal(schemaGroup.mode, 'structure_and_data');

  const bucketGroup = groups.find((g) => g.objectType === 'BUCKET' && g.schemaOrBucket === 'documents');
  assert.ok(bucketGroup);
  assert.equal(bucketGroup.objectCount, 850);
  assert.equal(bucketGroup.sizeMb, 212.5);
  assert.equal(bucketGroup.mode, 'include');

  // 1-click Schema switch to structure_only updates all 650 tables in schema "public"
  const afterSchemaStruct = setSchemaModeInDatabase(db, 'public', 'structure_only');
  const groupsAfterStruct = groupDatabaseObjectsBySchemaAndBucket(afterSchemaStruct);
  assert.equal(groupsAfterStruct.find((g) => g.schemaOrBucket === 'public').mode, 'structure_only');

  // 1-click Bucket switch to skip excludes all 850 files in bucket "documents"
  const afterBucketSkip = setBucketModeInDatabase(afterSchemaStruct, 'documents', 'skip');
  const groupsAfterSkip = groupDatabaseObjectsBySchemaAndBucket(afterBucketSkip);
  const updatedBucket = groupsAfterSkip.find((g) => g.schemaOrBucket === 'documents');
  assert.equal(updatedBucket.mode, 'skip');
  assert.equal(updatedBucket.includedMb, 0);
});

test('computeObjectIncludedMb handles 3-way DB object switch and 2-way BINARY switch', () => {
  const tableObj = { objectType: 'TABLE', name: 'public.orders', sizeMb: 120.5 };

  // 1. Exclude -> 0 MB
  assert.equal(computeObjectIncludedMb({ ...tableObj, mode: 'skip' }), 0);

  // 2. Structure only -> DDL estimate (0.02 MB cap)
  assert.equal(computeObjectIncludedMb({ ...tableObj, mode: 'structure_only' }), 0.02);

  // 3. Structure and data -> full 120.5 MB
  assert.equal(computeObjectIncludedMb({ ...tableObj, mode: 'structure_and_data' }), 120.5);

  // Binary object 2-way switch
  const binObj = { objectType: 'BINARY', bucket: 'avatars', objectName: 'hero.png', sizeMb: 14.75 };
  assert.equal(computeObjectIncludedMb({ ...binObj, mode: 'skip' }), 0);
  assert.equal(computeObjectIncludedMb({ ...binObj, mode: 'include' }), 14.75);
});

test('computeDatabaseScopeSummary and buildExportManifest compute accurate per-database and grand sum totals', () => {
  const summaryInitial = computeDatabaseScopeSummary(SAMPLE_MULTI_PROJECT_SCOPE);

  assert.equal(summaryInitial.selectedCount, 2);
  assert.equal(summaryInitial.includedDatabaseMb, 170.52);
  assert.equal(summaryInitial.includedBinaryMb, 24.4);
  assert.equal(summaryInitial.grandTotalMb, 194.92);

  // Exclude binary object on first DB and switch public.orders to structure_only
  const modifiedScope = SAMPLE_MULTI_PROJECT_SCOPE.map((db, idx) => {
    if (idx !== 0) return db;
    return {
      ...db,
      tables: db.tables.map((t) =>
        t.name === 'public.orders' ? { ...t, mode: 'structure_only' } : t
      ),
      binaries: db.binaries.map((b) => ({ ...b, mode: 'skip' })),
    };
  });

  const summaryAfter = computeDatabaseScopeSummary(modifiedScope);
  assert.ok(summaryAfter.includedDatabaseMb < summaryInitial.includedDatabaseMb);
  assert.equal(summaryAfter.includedBinaryMb, 6.0);

  const manifest = buildExportManifest(modifiedScope);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.grandTotalMb, summaryAfter.grandTotalMb);
  assert.equal(manifest.databases.length, 2);
  assert.equal(manifest.databases[0].includedBinaries.length, 0);
  assert.equal(manifest.databases[1].includedBinaries.length, 1);
});

test('createCloudRunServer serves /health, interior HTML /, and /api/runner/manifest', async () => {
  const server = createCloudRunServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.service, 'portabase-runner');
    assert.equal(health.platform, 'google-cloud-run');

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /INSIDE GOOGLE CLOUD RUNNER/);
    assert.match(html, /Operation Switch \(3-Way DB \/ 2-Way Binary\)/);
    assert.match(html, /Default view shows Schema &amp; Bucket level/);
    assert.match(html, /Grand Sum Total/);

    const manRes = await fetch(`${baseUrl}/api/runner/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databases: SAMPLE_MULTI_PROJECT_SCOPE }),
    });
    assert.equal(manRes.status, 200);
    const manData = await manRes.json();
    assert.equal(manData.ok, true);
    assert.equal(manData.scopeSummary.grandTotalMb, 194.92);
    assert.equal(manData.exportManifest.version, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('subtotal MBs update accurately when schemas and buckets are toggled between Include, Exclude, and Struct (511.png regression)', () => {
  let db = {
    id: 'db_data_automation',
    projectRef: 'ekklokrukxmqlahtonnc',
    projectName: 'DataAutomation',
    name: 'DataAutomation',
    estimatedSizeMb: 625.02, // pg_database_size can differ from sum of tables
    enabled: true,
    mode: 'structure_and_data',
    tables: [
      { name: 'public.events', schema: 'public', objectName: 'events', objectType: 'TABLE', sizeMb: 451.72, mode: 'structure_and_data' },
      { name: 'auth.users', schema: 'auth', objectName: 'users', objectType: 'TABLE', sizeMb: 8.69, mode: 'structure_and_data' },
      { name: 'storage.objects', schema: 'storage', objectName: 'objects', objectType: 'TABLE', sizeMb: 12.14, mode: 'structure_and_data' },
      { name: 'cron.job_run_details', schema: 'cron', objectName: 'job_run_details', objectType: 'TABLE', sizeMb: 2.38, mode: 'structure_and_data' },
    ],
    binaries: [
      { name: 'Storage/archive.tar', bucket: 'Storage', schema: 'Storage', objectName: 'archive.tar', objectType: 'BINARY', sizeMb: 11474.99, mode: 'include' },
      { name: 'documents/bundle.zip', bucket: 'documents', schema: 'documents', objectName: 'bundle.zip', objectType: 'BINARY', sizeMb: 473.03, mode: 'include' },
      { name: 'market-intel/report.pdf', bucket: 'market-intel', schema: 'market-intel', objectName: 'report.pdf', objectType: 'BINARY', sizeMb: 2.18, mode: 'include' },
    ],
  };

  // Initial state: all included -> 12425.13 MB
  const initialSummary = computeDatabaseScopeSummary([db]);
  const initialMetrics = initialSummary.perDatabase[db.id];
  assert.equal(initialMetrics.totalSourceMb, 12425.13);
  assert.equal(initialMetrics.includedMb, 12425.13);
  assert.equal(initialMetrics.excludedMb, 0);

  // Exclude "Storage" bucket (11474.99 MB), "public" schema (451.72 MB), and "cron" schema (2.38 MB) -> 496.04 MB included
  db = setBucketModeInDatabase(db, 'Storage', 'skip');
  db = setSchemaModeInDatabase(db, 'public', 'skip');
  db = setSchemaModeInDatabase(db, 'cron', 'skip');

  const afterExcludeSummary = computeDatabaseScopeSummary([db]);
  const afterExcludeMetrics = afterExcludeSummary.perDatabase[db.id];
  const groupsAfterExclude = groupDatabaseObjectsBySchemaAndBucket(db);
  const stackedGroupSum = Number(groupsAfterExclude.reduce((acc, g) => acc + g.includedMb, 0).toFixed(2));

  assert.equal(afterExcludeMetrics.includedMb, 496.04);
  assert.equal(stackedGroupSum, 496.04);
  assert.equal(afterExcludeMetrics.excludedMb, 11929.09);
  assert.equal(afterExcludeSummary.grandTotalMb, 496.04);

  // Switch "storage" schema (12.14 MB) to structure_only (0.02 MB DDL)
  db = setSchemaModeInDatabase(db, 'storage', 'structure_only');
  const afterStructSummary = computeDatabaseScopeSummary([db]);
  const afterStructMetrics = afterStructSummary.perDatabase[db.id];
  assert.equal(afterStructMetrics.includedMb, 483.92);
});

