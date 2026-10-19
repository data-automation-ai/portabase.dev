/**
 * Portabase Multi-Project, Multi-Database & Binary Storage Scope Engine
 *
 * Manages project/database selections, database object trinary modes:
 * - Exclude ('skip') -> 0 MB
 * - Include structure only ('structure_only') -> structureSizeMb (~0.01 MB DDL)
 * - Include structure and data ('structure_and_data') -> full sizeMb
 *
 * And binary storage object binary modes:
 * - Exclude ('skip' / 'exclude') -> 0 MB
 * - Include ('include' / 'structure_and_data') -> full sizeMb in export manifest
 *
 * Pure ES module shared between the Google Cloud Run runner, console UI, and tests.
 */

export const DATABASE_COPY_MODES = Object.freeze({
  STRUCTURE_AND_DATA: 'structure_and_data',
  STRUCTURE_ONLY: 'structure_only',
  EXCLUDE: 'skip',
});

export const TABLE_COPY_MODES = Object.freeze({
  STRUCTURE_AND_DATA: 'structure_and_data',
  STRUCTURE_ONLY: 'structure_only',
  SKIP: 'skip',
});

export const BINARY_COPY_MODES = Object.freeze({
  INCLUDE: 'include',
  EXCLUDE: 'skip',
});

export const OBJECT_TYPES = Object.freeze({
  TABLE: 'TABLE',
  VIEW: 'VIEW',
  FUNCTION: 'FUNCTION',
  BINARY: 'BINARY',
});

export const DEFAULT_DATABASE_TABLES = Object.freeze([]);

/**
 * Computes the effective included megabytes for a single object row (DB object or Binary file)
 * based on its current operation switch and parent database mode.
 */
export function computeObjectIncludedMb(item, dbMode = DATABASE_COPY_MODES.STRUCTURE_AND_DATA) {
  if (!item) return 0;
  const objType = String(item.objectType || OBJECT_TYPES.TABLE).toUpperCase();
  const rawSizeMb = typeof item.sizeMb === 'number' && item.sizeMb >= 0 ? item.sizeMb : 0;
  const mode = item.mode || (objType === OBJECT_TYPES.BINARY ? BINARY_COPY_MODES.INCLUDE : TABLE_COPY_MODES.STRUCTURE_AND_DATA);

  if (dbMode === DATABASE_COPY_MODES.EXCLUDE || mode === TABLE_COPY_MODES.SKIP || mode === 'exclude') {
    return 0;
  }

  if (objType === OBJECT_TYPES.BINARY) {
    // Binary storage objects are either excluded (0 MB) or included in the export manifest (full sizeMb)
    if (dbMode === DATABASE_COPY_MODES.STRUCTURE_ONLY) {
      return mode === BINARY_COPY_MODES.INCLUDE || mode === TABLE_COPY_MODES.STRUCTURE_AND_DATA ? rawSizeMb : 0;
    }
    return rawSizeMb;
  }

  // Database object (TABLE, VIEW, FUNCTION)
  const ddlMb = typeof item.structureSizeMb === 'number' && item.structureSizeMb >= 0
    ? item.structureSizeMb
    : (objType === OBJECT_TYPES.VIEW || objType === OBJECT_TYPES.FUNCTION ? rawSizeMb : Math.min(rawSizeMb || 0.01, 0.02));

  if (dbMode === DATABASE_COPY_MODES.STRUCTURE_ONLY || mode === TABLE_COPY_MODES.STRUCTURE_ONLY) {
    return Number(ddlMb.toFixed(3));
  }

  return Number(rawSizeMb.toFixed(3));
}

/**
 * Creates an initial default database scope configuration.
 */
export function createDefaultDatabaseScope(projectRef = '', name = 'Primary Supabase App') {
  const cleanRef = String(projectRef || '').trim().toLowerCase();
  const displayName = name.trim() || 'Primary Supabase App';
  return [
    {
      id: cleanRef ? `db_${cleanRef.slice(0, 8)}` : 'db_primary',
      projectRef: cleanRef,
      projectName: displayName,
      name: displayName,
      databaseName: 'postgres',
      estimatedSizeMb: null,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: [],
      binaries: [],
    },
  ];
}

/**
 * Computes live summary metrics across all configured projects/databases,
 * including per-database totals, included table DDL + data MB, included binary storage MB,
 * and the Grand Sum Total MB.
 */
export function computeDatabaseScopeSummary(databases = []) {
  if (!Array.isArray(databases)) {
    return {
      selectedCount: 0,
      structureAndDataCount: 0,
      structureOnlyCount: 0,
      estimatedCompressedMb: 0,
      grandTotalMb: 0,
      totalSourceMb: 0,
      includedDatabaseMb: 0,
      includedBinaryMb: 0,
      savedMb: 0,
      recommendedTier: 'cloud-7',
      perDatabase: {},
    };
  }

  let selectedCount = 0;
  let structureAndDataCount = 0;
  let structureOnlyCount = 0;
  let totalNetMb = 0;
  let totalSavedMb = 0;
  let totalSourceMb = 0;
  let includedDatabaseMb = 0;
  let includedBinaryMb = 0;
  let hasUnknownSize = false;
  const perDatabase = {};

  for (const db of databases) {
    if (!db) continue;
    const allObjects = [
      ...(Array.isArray(db.tables) ? db.tables : []),
      ...(Array.isArray(db.binaries) ? db.binaries : []),
    ];

    let dbRawTablesMb = 0;
    let dbRawBinariesMb = 0;
    let dbIncludedTableMb = 0;
    let dbIncludedBinaryMb = 0;
    let dbSavedObjectsMb = 0;

    for (const item of allObjects) {
      if (!item) continue;
      const objType = String(item.objectType || OBJECT_TYPES.TABLE).toUpperCase();
      const rawMb = typeof item.sizeMb === 'number' && item.sizeMb >= 0 ? item.sizeMb : 0;
      if (objType === OBJECT_TYPES.BINARY) {
        dbRawBinariesMb += rawMb;
      } else {
        dbRawTablesMb += rawMb;
      }

      if (db.enabled !== false) {
        const incMb = computeObjectIncludedMb(item, db.mode);
        if (objType === OBJECT_TYPES.BINARY) {
          dbIncludedBinaryMb += incMb;
        } else {
          dbIncludedTableMb += incMb;
        }
        dbSavedObjectsMb += Math.max(0, rawMb - incMb);
      }
    }

    const dbRawObjectsMb = dbRawTablesMb + dbRawBinariesMb;
    const isSizeKnown = (typeof db.estimatedSizeMb === 'number' && db.estimatedSizeMb >= 0) || allObjects.length > 0;
    const baseDbSize = typeof db.estimatedSizeMb === 'number' && db.estimatedSizeMb >= 0
      ? Math.max(db.estimatedSizeMb, dbRawTablesMb) + dbRawBinariesMb
      : (allObjects.length > 0 ? dbRawObjectsMb : null);

    // If baseDbSize includes unlisted catalog/table overhead beyond the listed tables,
    // only compute net from the listed objects when all objects are accounted for, OR subtract savedMb
    const unlistedDbOverheadMb = (typeof db.estimatedSizeMb === 'number' && db.estimatedSizeMb > dbRawTablesMb && dbRawBinariesMb === 0)
      ? (db.estimatedSizeMb - dbRawTablesMb)
      : 0;

    const effectiveIncludedTableMb = db.mode === DATABASE_COPY_MODES.STRUCTURE_ONLY
      ? (allObjects.length > 0 ? dbIncludedTableMb : Math.min(baseDbSize ?? 0, 1))
      : (dbIncludedTableMb + unlistedDbOverheadMb);

    const dbIncludedTotalMb = allObjects.length > 0
      ? (effectiveIncludedTableMb + dbIncludedBinaryMb)
      : (baseDbSize !== null
        ? (db.mode === DATABASE_COPY_MODES.STRUCTURE_ONLY ? Math.min(baseDbSize, 1) : baseDbSize)
        : null);

    perDatabase[db.id] = {
      totalSourceMb: baseDbSize !== null ? Number(baseDbSize.toFixed(2)) : null,
      includedMb: db.enabled === false ? 0 : (dbIncludedTotalMb !== null ? Number(dbIncludedTotalMb.toFixed(2)) : null),
      includedTableMb: db.enabled === false ? 0 : Number(effectiveIncludedTableMb.toFixed(2)),
      includedBinaryMb: db.enabled === false ? 0 : Number(dbIncludedBinaryMb.toFixed(2)),
    };

    if (db.enabled === false) continue;
    selectedCount += 1;

    if (db.mode === DATABASE_COPY_MODES.STRUCTURE_ONLY) {
      structureOnlyCount += 1;
    } else {
      structureAndDataCount += 1;
    }

    if (!isSizeKnown || baseDbSize === null) {
      hasUnknownSize = true;
      continue;
    }

    totalSourceMb += baseDbSize;
    if (allObjects.length > 0) {
      includedDatabaseMb += effectiveIncludedTableMb;
      includedBinaryMb += dbIncludedBinaryMb;
      const net = effectiveIncludedTableMb + dbIncludedBinaryMb;
      totalNetMb += net;
      totalSavedMb += dbSavedObjectsMb;
    } else if (db.mode === DATABASE_COPY_MODES.STRUCTURE_ONLY) {
      const schemaOnlySizeMb = Math.min(baseDbSize, 1);
      includedDatabaseMb += schemaOnlySizeMb;
      totalNetMb += schemaOnlySizeMb;
      totalSavedMb += Math.max(0, baseDbSize - schemaOnlySizeMb);
    } else {
      includedDatabaseMb += baseDbSize;
      totalNetMb += baseDbSize;
    }
  }

  const estimatedCompressedMb = selectedCount === 0
    ? 0
    : hasUnknownSize
      ? null
      : Math.round(totalNetMb);

  const grandTotalMb = selectedCount === 0
    ? 0
    : hasUnknownSize
      ? null
      : Number(totalNetMb.toFixed(2));

  const savedMb = Math.round(totalSavedMb);

  const recommendedTier = (selectedCount <= 1 && (estimatedCompressedMb === null || estimatedCompressedMb <= 500))
    ? 'cloud-7'
    : 'cloud-17';

  return {
    selectedCount,
    structureAndDataCount,
    structureOnlyCount,
    estimatedCompressedMb,
    grandTotalMb,
    totalSourceMb: Number(totalSourceMb.toFixed(2)),
    includedDatabaseMb: Number(includedDatabaseMb.toFixed(2)),
    includedBinaryMb: Number(includedBinaryMb.toFixed(2)),
    savedMb,
    recommendedTier,
    perDatabase,
  };
}

/**
 * Builds pg_dump arguments and binary storage manifest filter for a database scope configuration.
 */
export function buildPgDumpArgsForDatabase(dbConfig) {
  if (!dbConfig) return [];

  if (dbConfig.mode === DATABASE_COPY_MODES.STRUCTURE_ONLY) {
    return ['--schema-only'];
  }

  const args = [];
  const tables = Array.isArray(dbConfig.tables) ? dbConfig.tables : [];

  for (const table of tables) {
    if (!table || !table.name) continue;
    const objType = String(table.objectType || OBJECT_TYPES.TABLE).toUpperCase();
    if (objType === OBJECT_TYPES.BINARY) continue;
    const tableName = String(table.name).trim();
    if (!tableName) continue;

    if (table.mode === TABLE_COPY_MODES.STRUCTURE_ONLY) {
      args.push(`--exclude-table-data=${tableName}`);
    } else if (table.mode === TABLE_COPY_MODES.SKIP) {
      args.push(`--exclude-table=${tableName}`);
    }
  }

  return args;
}

/**
 * Builds the export manifest of included binary storage objects and database objects.
 */
export function buildExportManifest(databases = []) {
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    databases: [],
    grandTotalMb: 0,
    includedDatabaseMb: 0,
    includedBinaryMb: 0,
  };
  const summary = computeDatabaseScopeSummary(databases);
  manifest.grandTotalMb = summary.grandTotalMb ?? 0;
  manifest.includedDatabaseMb = summary.includedDatabaseMb;
  manifest.includedBinaryMb = summary.includedBinaryMb;

  for (const db of Array.isArray(databases) ? databases : []) {
    if (!db || db.enabled === false) continue;
    const allObjects = [
      ...(Array.isArray(db.tables) ? db.tables : []),
      ...(Array.isArray(db.binaries) ? db.binaries : []),
    ];
    manifest.databases.push({
      id: db.id,
      projectRef: db.projectRef,
      projectName: db.projectName || db.name,
      databaseName: db.databaseName || 'postgres',
      mode: db.mode,
      pgDumpArgs: buildPgDumpArgsForDatabase(db),
      includedTables: allObjects
        .filter(o => String(o.objectType || 'TABLE').toUpperCase() !== 'BINARY' && o.mode !== TABLE_COPY_MODES.SKIP)
        .map(o => ({
          objectType: o.objectType || 'TABLE',
          schema: o.schema || o.name?.split('.')[0] || 'public',
          name: o.objectName || o.name,
          mode: o.mode || TABLE_COPY_MODES.STRUCTURE_AND_DATA,
          includedMb: computeObjectIncludedMb(o, db.mode),
        })),
      includedBinaries: allObjects
        .filter(o => String(o.objectType || '').toUpperCase() === 'BINARY' && o.mode !== TABLE_COPY_MODES.SKIP && o.mode !== 'exclude')
        .map(o => ({
          bucket: o.bucket || o.schema || 'default',
          fileName: o.objectName || o.name,
          sizeMb: o.sizeMb ?? 0,
          includedMb: computeObjectIncludedMb(o, db.mode),
        })),
    });
  }
  return manifest;
}
