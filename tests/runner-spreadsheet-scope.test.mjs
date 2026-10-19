import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeObjectIncludedMb,
  computeDatabaseScopeSummary,
  buildExportManifest,
} from '../cloud/runner/database-scope.mjs';
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
