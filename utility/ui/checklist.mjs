/**
 * Capsule checklist for `portabase ui` — pure functions, no I/O.
 *
 * Classifies a live inventory with the SAME exclusion lists `backup` passes to
 * pg_dump, so the checklist cannot drift from what a capsule actually holds.
 */
import {
  DATA_SCHEMA_EXCLUDES,
  DATA_TABLE_EXCLUDES,
  LOCAL_STARTER_MAX_BYTES,
  PLATFORM_SCHEMA_EXCLUDES,
  TRIAL_LIMITS,
  isLocalProvider,
} from '../portabase-core.mjs';

/** pg_dump-style pattern match: `*` is the only wildcard. */
export function schemaMatches(name, patterns) {
  return patterns.some(pattern => {
    if (!pattern.includes('*')) return pattern === name;
    const source = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`).test(name);
  });
}

/** What happens to one table in a capsule: structure and rows are decided separately. */
export function classifyTable(schema, name, { trial = false } = {}) {
  const platform = schemaMatches(schema, PLATFORM_SCHEMA_EXCLUDES);
  const dataExcluded = schemaMatches(schema, DATA_SCHEMA_EXCLUDES) || DATA_TABLE_EXCLUDES.includes(`${schema}.${name}`);
  const structure = platform
    ? { keep: false, reason: 'Platform-managed schema; Supabase recreates it on a new project.' }
    : { keep: true, reason: 'schema.sql' };
  let rows;
  if (dataExcluded) rows = { keep: false, reason: 'Platform data excluded from data.sql.' };
  else if (trial) rows = { keep: false, reason: 'Trial capture is schema-only.' };
  else rows = { keep: true, reason: 'data.sql' };
  return { structure, rows };
}

const item = (layer, name, status, detail, extra = {}) => ({ layer, name, status, detail, ...extra });

/**
 * Build the checklist from a snapshot.
 * status: KEEP (goes in), PARTIAL (some of it), SKIP (deliberately out),
 *         BLOCKED (would fail or be skipped for a missing prerequisite), NEVER (never in any capsule).
 */
export function buildChecklist({ config = {}, trial = false, readiness = {}, database = null, storage = null, functions = null }) {
  const capture = config.capture || {};
  const env = readiness.env || {};
  const tools = readiness.tools || {};
  const items = [];

  // Database
  if (capture.database === false) {
    items.push(item('database', 'Postgres database', 'SKIP', 'Disabled in portabase.config.json (capture.database = false).'));
  } else if (!env.SUPABASE_DB_URL) {
    items.push(item('database', 'Postgres database', 'BLOCKED', 'SUPABASE_DB_URL is not set; backup would record database as PARTIAL.'));
  } else if (!(tools.pg_dump && tools.pg_dumpall) && !tools.supabase) {
    items.push(item('database', 'Postgres database', 'BLOCKED', 'Neither PostgreSQL client tools nor the Supabase CLI were found.'));
  } else {
    items.push(item('database', 'Roles', 'KEEP', 'roles.sql — role definitions without passwords.'));
    if (database?.ok) {
      const tables = database.data.tables || [];
      let structureKept = 0;
      let rowsKept = 0;
      let bytesKept = 0;
      for (const table of tables) {
        const verdict = classifyTable(table.schema, table.name, { trial });
        if (verdict.structure.keep) structureKept += 1;
        if (verdict.rows.keep) { rowsKept += 1; bytesKept += Number(table.bytes) || 0; }
      }
      items.push(item('database', 'Table structure', 'KEEP', `schema.sql — ${structureKept} of ${tables.length} tables (platform schemas are recreated by Supabase).`));
      items.push(item('database', 'Table rows', trial ? 'SKIP' : 'KEEP',
        trial ? 'Trial capture is schema-only; no rows are included.' : `data.sql — rows from ${rowsKept} tables (size shown is on-disk incl. indexes; the dump is usually smaller).`,
        { bytes: trial ? 0 : bytesKept }));
      if (!trial && tables.some(t => t.schema === 'auth' && t.name === 'users')) {
        items.push(item('database', 'Auth users', 'KEEP', 'auth.users rows (including bcrypt password hashes) are in data.sql, inside the encrypted capsule.'));
      }
    } else {
      items.push(item('database', 'Tables and rows', 'KEEP', 'Will be captured; live inventory unavailable, so counts are unknown.'));
    }
    if (!tools.psql) items.push(item('database', 'Recovery inventory', 'BLOCKED', 'psql not found; the capsule would be marked PARTIAL (no exact row inventory).'));
  }

  // Storage
  if (capture.storage === false) {
    items.push(item('storage', 'Storage objects', 'SKIP', 'Disabled in portabase.config.json (capture.storage = false).'));
  } else if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    items.push(item('storage', 'Storage objects', 'BLOCKED', 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.'));
  } else if (storage?.ok) {
    storage.data.buckets.forEach((bucket, index) => {
      if (trial && index >= TRIAL_LIMITS.maxStorageBuckets) {
        items.push(item('storage', `Bucket ${bucket.id}`, 'SKIP', `Trial captures the first ${TRIAL_LIMITS.maxStorageBuckets} buckets only.`));
      } else if (trial && bucket.objectCount > TRIAL_LIMITS.maxStorageObjects) {
        items.push(item('storage', `Bucket ${bucket.id}`, 'PARTIAL', `Trial captures ${TRIAL_LIMITS.maxStorageObjects} of ${bucket.objectCount} objects.`));
      } else {
        items.push(item('storage', `Bucket ${bucket.id}`, 'KEEP', `${bucket.objectCount} ${bucket.objectCount === 1 ? 'object' : 'objects'}.`, { bytes: bucket.totalBytes }));
      }
    });
    if (!storage.data.buckets.length) items.push(item('storage', 'Storage objects', 'KEEP', 'No buckets exist; nothing to capture.'));
  } else {
    items.push(item('storage', 'Storage objects', 'KEEP', 'Will be captured; live listing unavailable.'));
  }

  // Edge Functions
  if (capture.functions === false) {
    items.push(item('functions', 'Edge Functions', 'SKIP', 'Disabled in portabase.config.json (capture.functions = false).'));
  } else if (!env.SUPABASE_ACCESS_TOKEN) {
    items.push(item('functions', 'Edge Functions', 'BLOCKED', 'SUPABASE_ACCESS_TOKEN is not set; backup skips functions and marks the capsule PARTIAL.'));
  } else if (functions?.ok) {
    functions.data.forEach((fn, index) => {
      const skip = trial && index >= TRIAL_LIMITS.maxFunctions;
      items.push(item('functions', `Function ${fn.slug || fn.name}`, skip ? 'SKIP' : 'KEEP',
        skip ? `Trial captures the first ${TRIAL_LIMITS.maxFunctions} functions only.` : 'Source + verify_jwt setting, with a redeploy script.'));
    });
    if (!functions.data.length) items.push(item('functions', 'Edge Functions', 'KEEP', 'No functions deployed; nothing to capture.'));
  } else {
    items.push(item('functions', 'Edge Functions', 'KEEP', 'Will be captured; live listing unavailable.'));
  }

  // Auth inventory (names only)
  if (capture.auth !== false) {
    items.push(item('auth', 'Auth user inventory', env.SUPABASE_SERVICE_ROLE_KEY ? 'KEEP' : 'BLOCKED',
      env.SUPABASE_SERVICE_ROLE_KEY ? 'Identity list (id, email, providers) for the first 500 users; never passwords.' : 'SUPABASE_SERVICE_ROLE_KEY is required.'));
  }

  // Encryption and destination
  items.push(item('capsule', 'Encryption', env.passphrase ? 'KEEP' : 'BLOCKED',
    env.passphrase ? 'AES-256-GCM with a scrypt key from your passphrase (held only in this process environment).' : 'Encryption passphrase env var is missing or shorter than 16 characters; backup refuses to run.'));
  const estimate = items.reduce((total, entry) => total + (Number(entry.bytes) || 0), 0);
  if (isLocalProvider(config) && estimate > LOCAL_STARTER_MAX_BYTES) {
    items.push(item('capsule', 'Local Starter size cap', 'BLOCKED', 'Estimated capture exceeds the Local Starter cap; use --allow-large-local or an off-machine destination.', { bytes: estimate }));
  }

  // Never captured, by design
  for (const [name, detail] of [
    ['API keys and JWT secret', 'Project keys are issued by the new project; never copied.'],
    ['Edge Function secrets', 'Secret values are never read; names only where the CLI exposes them.'],
    ['Auth provider settings', 'OAuth client secrets, SMTP credentials, and redirect URLs are re-entered on the new project.'],
    ['Database password', 'Stripped from roles.sql (--no-role-passwords).'],
    ['Logs and analytics', 'Platform logs are not part of a recovery capsule.'],
  ]) items.push(item('never', name, 'NEVER', detail));

  const counts = items.reduce((acc, entry) => ({ ...acc, [entry.status]: (acc[entry.status] || 0) + 1 }), {});
  return { trial, estimatedBytes: estimate, counts, items };
}
