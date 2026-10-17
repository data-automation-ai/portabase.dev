import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  DATABASE_COPY_MODES,
  TABLE_COPY_MODES,
  computeDatabaseScopeSummary,
  buildPgDumpArgsForDatabase,
  createDefaultDatabaseScope,
} from '../cloud/runner/database-scope.mjs';

test('computeDatabaseScopeSummary handles null and empty inputs safely', () => {
  const empty = computeDatabaseScopeSummary([]);
  assert.equal(empty.selectedCount, 0);
  assert.equal(empty.structureAndDataCount, 0);
  assert.equal(empty.structureOnlyCount, 0);
  assert.equal(empty.estimatedCompressedMb, 0);
  assert.equal(empty.savedMb, 0);
  assert.equal(empty.recommendedTier, 'cloud-7');

  const nullSummary = computeDatabaseScopeSummary(null);
  assert.equal(nullSummary.selectedCount, 0);
  assert.equal(nullSummary.recommendedTier, 'cloud-7');
});

test('computeDatabaseScopeSummary: single database <= 500 MB recommends cloud-7 ($7/mo)', () => {
  const dbs = [
    {
      id: 'db1',
      name: 'Production DB',
      estimatedSizeMb: 320,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: [],
    },
  ];
  const summary = computeDatabaseScopeSummary(dbs);
  assert.equal(summary.selectedCount, 1);
  assert.equal(summary.structureAndDataCount, 1);
  assert.equal(summary.structureOnlyCount, 0);
  assert.equal(summary.estimatedCompressedMb, 320);
  assert.equal(summary.savedMb, 0);
  assert.equal(summary.recommendedTier, 'cloud-7');
});

test('computeDatabaseScopeSummary: single database > 500 MB recommends cloud-17 ($17/mo)', () => {
  const dbs = [
    {
      id: 'db1',
      name: 'Large DB',
      estimatedSizeMb: 680,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: [],
    },
  ];
  const summary = computeDatabaseScopeSummary(dbs);
  assert.equal(summary.selectedCount, 1);
  assert.equal(summary.estimatedCompressedMb, 680);
  assert.equal(summary.recommendedTier, 'cloud-17');
});

test('computeDatabaseScopeSummary: multiple databases recommend cloud-17 expansion regardless of size', () => {
  const dbs = [
    {
      id: 'db1',
      name: 'App DB',
      estimatedSizeMb: 80,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
    },
    {
      id: 'db2',
      name: 'Staging DB',
      estimatedSizeMb: 60,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
    },
  ];
  const summary = computeDatabaseScopeSummary(dbs);
  assert.equal(summary.selectedCount, 2);
  assert.equal(summary.estimatedCompressedMb, 140);
  assert.equal(summary.recommendedTier, 'cloud-17');
});

test('computeDatabaseScopeSummary: disabled databases are skipped in calculations', () => {
  const dbs = [
    {
      id: 'db1',
      name: 'Active DB',
      estimatedSizeMb: 150,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
    },
    {
      id: 'db2',
      name: 'Inactive DB',
      estimatedSizeMb: 400,
      enabled: false,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
    },
  ];
  const summary = computeDatabaseScopeSummary(dbs);
  assert.equal(summary.selectedCount, 1);
  assert.equal(summary.estimatedCompressedMb, 150);
  assert.equal(summary.recommendedTier, 'cloud-7');
});

test('computeDatabaseScopeSummary: structure_only mode on database reduces size and computes savedMb', () => {
  const dbs = [
    {
      id: 'db1',
      name: 'Analytics Warehouse',
      estimatedSizeMb: 450,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_ONLY,
    },
  ];
  const summary = computeDatabaseScopeSummary(dbs);
  assert.equal(summary.selectedCount, 1);
  assert.equal(summary.structureAndDataCount, 0);
  assert.equal(summary.structureOnlyCount, 1);
  assert.equal(summary.estimatedCompressedMb, 1); // 1 MB DDL/schema footprint
  assert.equal(summary.savedMb, 449);
  assert.equal(summary.recommendedTier, 'cloud-7');
});

test('computeDatabaseScopeSummary: table-level structure_only and skip exclusions compute saved MB', () => {
  const dbs = [
    {
      id: 'db1',
      name: 'Production DB',
      estimatedSizeMb: 250,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: [
        { name: 'public.users', rowsEstimate: 2000, sizeMb: 20, mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA },
        { name: 'public.audit_logs', rowsEstimate: 100000, sizeMb: 80, mode: TABLE_COPY_MODES.STRUCTURE_ONLY },
        { name: 'public.temp_scratch', rowsEstimate: 30000, sizeMb: 30, mode: TABLE_COPY_MODES.SKIP },
      ],
    },
  ];
  const summary = computeDatabaseScopeSummary(dbs);
  assert.equal(summary.selectedCount, 1);
  assert.equal(summary.structureAndDataCount, 1);
  // Saved = 80 (audit_logs structure-only) + 30 (temp_scratch skip) = 110 MB
  assert.equal(summary.savedMb, 110);
  assert.equal(summary.estimatedCompressedMb, 140);
  assert.equal(summary.recommendedTier, 'cloud-7');
});

test('buildPgDumpArgsForDatabase: returns --schema-only for structure_only database', () => {
  const db = {
    id: 'db1',
    mode: DATABASE_COPY_MODES.STRUCTURE_ONLY,
  };
  const args = buildPgDumpArgsForDatabase(db);
  assert.deepEqual(args, ['--schema-only']);
});

test('buildPgDumpArgsForDatabase: returns empty args when full backup with no exclusions', () => {
  const db = {
    id: 'db1',
    mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
    tables: [
      { name: 'public.users', mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA },
      { name: 'public.orders', mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA },
    ],
  };
  const args = buildPgDumpArgsForDatabase(db);
  assert.deepEqual(args, []);
});

test('buildPgDumpArgsForDatabase: returns --exclude-table-data for structure_only tables and --exclude-table for skip tables', () => {
  const db = {
    id: 'db1',
    mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
    tables: [
      { name: 'public.users', mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA },
      { name: 'public.audit_logs', mode: TABLE_COPY_MODES.STRUCTURE_ONLY },
      { name: 'public.analytics_events', mode: TABLE_COPY_MODES.STRUCTURE_ONLY },
      { name: 'public.debug_traces', mode: TABLE_COPY_MODES.SKIP },
    ],
  };
  const args = buildPgDumpArgsForDatabase(db);
  assert.deepEqual(args, [
    '--exclude-table-data=public.audit_logs',
    '--exclude-table-data=public.analytics_events',
    '--exclude-table=public.debug_traces',
  ]);
});

test('createDefaultDatabaseScope returns sensible starter configuration', () => {
  const scope = createDefaultDatabaseScope('abcdefghijklmnopqrst', 'Main Project');
  assert.equal(scope.length, 1);
  assert.equal(scope[0].projectRef, 'abcdefghijklmnopqrst');
  assert.equal(scope[0].name, 'Main Project');
  assert.equal(scope[0].enabled, true);
  assert.equal(scope[0].mode, DATABASE_COPY_MODES.STRUCTURE_AND_DATA);
  assert.ok(scope[0].tables.length > 0);
});

test('sealed vault payload integration: encrypts and decrypts databaseScope cleanly with WebCrypto', async () => {
  const databaseScope = [
    {
      id: 'db_prod',
      projectRef: 'abcdefghijklmnopqrst',
      name: 'Production DB',
      estimatedSizeMb: 200,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: [
        { name: 'public.users', mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA, sizeMb: 20 },
        { name: 'public.audit_logs', mode: TABLE_COPY_MODES.STRUCTURE_ONLY, sizeMb: 60 },
      ],
    },
    {
      id: 'db_staging',
      projectRef: '12345678901234567890',
      name: 'Staging DB',
      estimatedSizeMb: 50,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_ONLY,
      tables: [],
    },
  ];

  const sealingPassword = 'SuperSecretVaultPassword123!';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));

  const baseKey = await webcrypto.subtle.importKey(
    'raw',
    enc.encode(sealingPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const derivedKey = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const payload = JSON.stringify({
    projectRef: 'abcdefghijklmnopqrst',
    databaseScope,
    storageDestination: 'gdrive',
    sealedAt: new Date().toISOString(),
  });

  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    enc.encode(payload)
  );

  assert.ok(ciphertext.byteLength > 0);

  // Decrypt to verify full roundtrip
  const decrypted = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    ciphertext
  );

  const recovered = JSON.parse(dec.decode(decrypted));
  assert.equal(recovered.projectRef, 'abcdefghijklmnopqrst');
  assert.equal(recovered.databaseScope.length, 2);
  assert.equal(recovered.databaseScope[0].mode, 'structure_and_data');
  assert.equal(recovered.databaseScope[1].mode, 'structure_only');
  assert.equal(recovered.databaseScope[0].tables[1].mode, 'structure_only');
});
