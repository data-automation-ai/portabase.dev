/**
 * Portabase Multi-Database Scope & Copy-Mode Engine
 * 
 * Manages database selections and table copy modes:
 * - Structure + Data (full backup)
 * - Structure Only (--schema-only or --exclude-table-data)
 * - Skip (--exclude-table)
 * 
 * Pure ES module shared between cloud runner, console UI, and tests.
 */

export const DATABASE_COPY_MODES = Object.freeze({
  STRUCTURE_AND_DATA: 'structure_and_data',
  STRUCTURE_ONLY: 'structure_only',
});

export const TABLE_COPY_MODES = Object.freeze({
  STRUCTURE_AND_DATA: 'structure_and_data',
  STRUCTURE_ONLY: 'structure_only',
  SKIP: 'skip',
});

export const DEFAULT_DATABASE_TABLES = Object.freeze([
  { name: 'public.users', rowsEstimate: 1500, sizeMb: 15, mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA },
  { name: 'public.orders', rowsEstimate: 12000, sizeMb: 45, mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA },
  { name: 'public.audit_logs', rowsEstimate: 65000, sizeMb: 75, mode: TABLE_COPY_MODES.STRUCTURE_ONLY },
  { name: 'public.webhook_events', rowsEstimate: 20000, sizeMb: 25, mode: TABLE_COPY_MODES.SKIP },
]);

/**
 * Creates an initial default database scope configuration.
 */
export function createDefaultDatabaseScope(projectRef = '', name = 'Primary Supabase App') {
  const cleanRef = String(projectRef || '').trim().toLowerCase();
  return [
    {
      id: cleanRef ? `db_${cleanRef.slice(0, 8)}` : 'db_primary',
      projectRef: cleanRef,
      name: name.trim() || 'Primary Supabase App',
      estimatedSizeMb: 160,
      enabled: true,
      mode: DATABASE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: DEFAULT_DATABASE_TABLES.map(t => ({ ...t })),
    },
  ];
}

/**
 * Computes live summary metrics for a list of configured databases.
 * 
 * @param {Array} databases - Array of database scope entries
 * @returns {Object} Summary with selectedCount, structureAndDataCount, structureOnlyCount,
 *                   estimatedCompressedMb, savedMb, and recommendedTier ('cloud-7' | 'cloud-17')
 */
export function computeDatabaseScopeSummary(databases = []) {
  if (!Array.isArray(databases)) {
    return {
      selectedCount: 0,
      structureAndDataCount: 0,
      structureOnlyCount: 0,
      estimatedCompressedMb: 0,
      savedMb: 0,
      recommendedTier: 'cloud-7',
    };
  }

  let selectedCount = 0;
  let structureAndDataCount = 0;
  let structureOnlyCount = 0;
  let totalNetMb = 0;
  let totalSavedMb = 0;

  for (const db of databases) {
    if (!db || db.enabled === false) continue;
    selectedCount += 1;

    const baseDbSize = typeof db.estimatedSizeMb === 'number' && db.estimatedSizeMb >= 0
      ? db.estimatedSizeMb
      : 100;

    if (db.mode === DATABASE_COPY_MODES.STRUCTURE_ONLY) {
      structureOnlyCount += 1;
      // In structure-only mode, row data is skipped (0 rows). Schema DDL is ~1 MB.
      const schemaOnlySizeMb = Math.min(baseDbSize, 1);
      totalNetMb += schemaOnlySizeMb;
      totalSavedMb += Math.max(0, baseDbSize - schemaOnlySizeMb);
    } else {
      structureAndDataCount += 1;
      // Structure and data: check individual table modes if present
      const tables = Array.isArray(db.tables) ? db.tables : [];
      let excludedTableMb = 0;

      for (const table of tables) {
        if (!table) continue;
        const tableSize = typeof table.sizeMb === 'number' && table.sizeMb >= 0 ? table.sizeMb : 0;
        if (table.mode === TABLE_COPY_MODES.STRUCTURE_ONLY) {
          // Exclude table row data, keep table schema
          excludedTableMb += tableSize;
        } else if (table.mode === TABLE_COPY_MODES.SKIP) {
          // Completely omit table
          excludedTableMb += tableSize;
        }
      }

      // Saved bytes cannot exceed database size
      const effectiveSaved = Math.min(baseDbSize, excludedTableMb);
      const netDbSize = Math.max(1, baseDbSize - effectiveSaved);
      totalNetMb += netDbSize;
      totalSavedMb += effectiveSaved;
    }
  }

  const estimatedCompressedMb = Math.round(totalNetMb);
  const savedMb = Math.round(totalSavedMb);

  // 'cloud-7' if <= 500 MB and at most 1 database; 'cloud-17' if multiple databases or > 500 MB
  const recommendedTier = (selectedCount <= 1 && estimatedCompressedMb <= 500)
    ? 'cloud-7'
    : 'cloud-17';

  return {
    selectedCount,
    structureAndDataCount,
    structureOnlyCount,
    estimatedCompressedMb,
    savedMb,
    recommendedTier,
  };
}

/**
 * Builds pg_dump arguments for a specific database scope configuration.
 * 
 * - When mode === 'structure_only', returns ['--schema-only']
 * - When mode === 'structure_and_data', returns --exclude-table-data for structure_only tables
 *   and --exclude-table for skip tables.
 * 
 * @param {Object} dbConfig - Database configuration entry
 * @returns {Array<string>} CLI arguments for pg_dump
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
