/**
 * Supabase Management API access for Cloud "pick your database" (S2).
 *
 * The customer's Personal Access Token is used in-request only: it is never
 * stored, never logged, and never echoed back in a response body or error.
 * Every exported function accepts a `fetchImpl` for injection in tests.
 *
 * Read-only inventory SQL only (SELECT against pg_catalog / information_schema
 * equivalents + storage.*). Never DDL, never DML, never row bodies.
 */

const MGMT_BASE = 'https://api.supabase.com/v1';

const REF_RE = /^[a-z0-9]{20}$/;
// sbp_ personal access tokens, or a JWT-ish three-segment token. No whitespace, capped length.
const TOKEN_RE = /^(sbp_[a-zA-Z0-9_-]{20,200}|[A-Za-z0-9_-]{10,500}\.[A-Za-z0-9_-]{10,500}\.[A-Za-z0-9_-]{10,500})$/;

/**
 * Schemas Portabase treats as Supabase/Postgres internals, never customer
 * application data. Mirrors APPLICATION_SCHEMA_SQL / estimateApplicationTables
 * in utility/portabase.mjs (~436-447) and UI_DATABASE_SQL (~2467), with `auth`
 * kept IN the inventory (the capsule backs up auth) and `storage` handled
 * separately by the buckets query below.
 */
const INTERNAL_SCHEMAS = Object.freeze([
  'information_schema', '_analytics', '_realtime', '_supavisor',
  'cron', 'dbdev', 'extensions', 'graphql', 'graphql_public', 'net',
  'pgbouncer', 'pgmq', 'pgsodium', 'pgsodium_masks', 'pgtle', 'realtime',
  'repack', 'storage', 'supabase_functions', 'supabase_migrations',
  'tiger', 'tiger_data', 'topology', 'vault',
]);

const SCHEMA_FILTER_SQL = `schemaname NOT IN (${INTERNAL_SCHEMAS.map((s) => `'${s}'`).join(',')}) AND schemaname !~ '^pg_' AND schemaname !~ '^_timescaledb_'`;

const TABLES_SQL = `SELECT COALESCE(json_agg(json_build_object(
  'schema', schemaname,
  'name', tablename,
  'rows', GREATEST(c.reltuples, 0)::bigint,
  'sizeBytes', pg_total_relation_size(c.oid)::bigint
) ORDER BY schemaname, tablename), '[]'::json)::text AS result
FROM pg_catalog.pg_tables t
JOIN pg_catalog.pg_namespace n ON n.nspname = t.schemaname
JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = t.tablename AND c.relkind IN ('r','p')
WHERE (${SCHEMA_FILTER_SQL}) OR schemaname = 'auth';`;

const BUCKETS_SQL = `SELECT COALESCE(json_agg(json_build_object(
  'id', b.id,
  'objectCount', COALESCE(o.object_count, 0),
  'totalBytes', COALESCE(o.total_bytes, 0)
) ORDER BY b.id), '[]'::json)::text AS result
FROM storage.buckets b
LEFT JOIN (
  SELECT bucket_id, count(*) AS object_count, COALESCE(sum((metadata->>'size')::bigint), 0) AS total_bytes
  FROM storage.objects
  GROUP BY bucket_id
) o ON o.bucket_id = b.id;`;

const DB_SIZE_SQL = `SELECT pg_database_size(current_database())::bigint AS result;`;

export class SupabaseMgmtError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'SupabaseMgmtError';
    this.code = code;
  }
}

export function isValidRef(ref) {
  return typeof ref === 'string' && REF_RE.test(ref);
}

export function isValidToken(token) {
  if (typeof token !== 'string') return false;
  if (token.length === 0 || token.length > 500) return false;
  if (/\s/.test(token)) return false;
  return TOKEN_RE.test(token);
}

/** Map an upstream HTTP status to a safe, non-leaking error code. */
function statusToCode(status) {
  if (status === 401 || status === 403) return 'token_rejected';
  if (status === 404) return 'project_not_found';
  if (status === 429) return 'rate_limited';
  return 'upstream_error';
}

async function mgmtRequest(fetchImpl, path, { token, method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetchImpl(`${MGMT_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Network-level failure. Never include the underlying error (it could echo the URL/token in some environments).
    throw new SupabaseMgmtError('upstream_error', 'Could not reach Supabase.');
  }

  if (!res.ok) {
    throw new SupabaseMgmtError(statusToCode(res.status), 'Supabase Management API request failed.');
  }

  try {
    return await res.json();
  } catch {
    throw new SupabaseMgmtError('upstream_error', 'Supabase Management API returned an unreadable response.');
  }
}

/** Coerce a Postgres bigint (often a JSON string) to a safe finite number. */
function coerceNumber(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

function runQuery(fetchImpl, token, ref, query) {
  return mgmtRequest(fetchImpl, `/projects/${ref}/database/query`, {
    token,
    method: 'POST',
    body: { query },
  });
}

/** Rows come back either as an array of row objects or a bare array; be liberal. */
function firstResultColumn(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  if (row && typeof row === 'object' && 'result' in row) return row.result;
  return row;
}

/**
 * List the token owner's Supabase projects.
 * @returns {Promise<Array<{ref:string,name:string,region:string,status:string}>>}
 */
export async function listProjects(token, fetchImpl = fetch) {
  if (!isValidToken(token)) throw new SupabaseMgmtError('token_rejected', 'Invalid token format.');
  const data = await mgmtRequest(fetchImpl, '/projects', { token });
  const list = Array.isArray(data) ? data : [];
  return list.map((p) => ({
    ref: String(p.id || p.ref || ''),
    name: String(p.name || ''),
    region: String(p.region || ''),
    status: String(p.status || ''),
  })).filter((p) => p.ref);
}

/**
 * Fetch a read-only size inventory for one project: application tables
 * (including `auth`), Storage buckets, and total database size.
 * @returns {Promise<{tables:Array,buckets:Array,databaseBytes:number}>}
 */
export async function fetchInventory(token, ref, fetchImpl = fetch) {
  if (!isValidToken(token)) throw new SupabaseMgmtError('token_rejected', 'Invalid token format.');
  if (!isValidRef(ref)) throw new SupabaseMgmtError('project_not_found', 'Invalid project ref.');

  const [tablesRes, bucketsRes, dbSizeRes] = await Promise.all([
    runQuery(fetchImpl, token, ref, TABLES_SQL),
    runQuery(fetchImpl, token, ref, BUCKETS_SQL),
    runQuery(fetchImpl, token, ref, DB_SIZE_SQL),
  ]);

  const tablesRaw = firstResultColumn(tablesRes);
  const bucketsRaw = firstResultColumn(bucketsRes);
  const dbSizeRaw = firstResultColumn(dbSizeRes);

  const tablesJson = typeof tablesRaw === 'string' ? JSON.parse(tablesRaw) : (tablesRaw || []);
  const bucketsJson = typeof bucketsRaw === 'string' ? JSON.parse(bucketsRaw) : (bucketsRaw || []);

  const tables = tablesJson.map((t) => ({
    schema: String(t.schema || ''),
    name: String(t.name || ''),
    rows: coerceNumber(t.rows),
    sizeBytes: coerceNumber(t.sizeBytes),
  }));

  const buckets = bucketsJson.map((b) => ({
    id: String(b.id || ''),
    objectCount: coerceNumber(b.objectCount),
    totalBytes: coerceNumber(b.totalBytes),
  }));

  const databaseBytes = coerceNumber(dbSizeRaw);

  return { tables, buckets, databaseBytes };
}
