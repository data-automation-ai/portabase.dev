/**
 * Real Supabase Multi-Project, Database Object & Binary Storage Discovery Engine
 *
 * Queries the Supabase Management API (`/v1/projects` and `/v1/projects/{ref}/database/query`)
 * using the customer's OAuth access token or Personal Access Token (`sbp_...`) to return:
 * - All accessible projects
 * - Each project's PostgreSQL database size + binary storage total size in MB
 * - Database objects (`TABLE`, `VIEW`, `FUNCTION`) with schema name, object name, size in MB,
 *   date created, and date last updated
 * - Binary storage objects (`BINARY` from `storage.objects`) with bucket name, file name,
 *   size in MB, date created, and date last updated
 */

export const DISCOVERY_SQL = `
WITH db_meta AS (
  SELECT
    pg_database_size(current_database())::bigint AS db_bytes,
    pg_postmaster_start_time() AS server_started_at
  FROM pg_database
  WHERE datname = current_database()
  LIMIT 1
),
rel_objects AS (
  SELECT
    CASE
      WHEN c.relkind IN ('r', 'p') THEN 'TABLE'
      WHEN c.relkind IN ('v', 'm') THEN 'VIEW'
      ELSE 'TABLE'
    END AS object_type,
    n.nspname AS schema_name,
    c.relname AS object_name,
    GREATEST(c.reltuples::bigint, 0) AS rows_estimate,
    pg_total_relation_size(c.oid)::bigint AS size_bytes,
    NULL::timestamptz AS created_at,
    GREATEST(s.last_analyze, s.last_autoanalyze, s.last_vacuum, s.last_autovacuum) AS updated_at
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND n.nspname NOT LIKE 'pg_temp_%'
    AND n.nspname NOT LIKE 'pg_toast_temp_%'
    AND c.relkind IN ('r', 'p', 'v', 'm')
  ORDER BY pg_total_relation_size(c.oid) DESC
),
fn_objects AS (
  SELECT
    'FUNCTION' AS object_type,
    n.nspname AS schema_name,
    p.proname AS object_name,
    0::bigint AS rows_estimate,
    OCTET_LENGTH(COALESCE(p.prosrc, ''))::bigint AS size_bytes,
    NULL::timestamptz AS created_at,
    NULL::timestamptz AS updated_at
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'auth', 'storage')
  ORDER BY p.proname ASC
),
bin_objects AS (
  SELECT
    'BINARY' AS object_type,
    COALESCE(o.bucket_id, 'default') AS schema_name,
    o.name AS object_name,
    1::bigint AS rows_estimate,
    COALESCE(
      NULLIF(regexp_replace(COALESCE(o.metadata->>'size', o.metadata->>'contentLength', '0'), '[^0-9]', '', 'g'), '')::bigint,
      0::bigint
    ) AS size_bytes,
    o.created_at AS created_at,
    COALESCE(o.updated_at, o.created_at) AS updated_at
  FROM storage.objects o
  WHERE o.name IS NOT NULL
  UNION ALL
  SELECT
    'BINARY' AS object_type,
    b.id AS schema_name,
    '(empty bucket)' AS object_name,
    0::bigint AS rows_estimate,
    0::bigint AS size_bytes,
    b.created_at AS created_at,
    COALESCE(b.updated_at, b.created_at) AS updated_at
  FROM storage.buckets b
  WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id)
)
SELECT json_build_object(
  'db_bytes', (SELECT db_bytes FROM db_meta),
  'server_started_at', (SELECT server_started_at FROM db_meta),
  'db_objects', COALESCE((SELECT json_agg(r) FROM (SELECT * FROM rel_objects UNION ALL SELECT * FROM fn_objects) r), '[]'::json),
  'binary_objects', COALESCE((SELECT json_agg(b) FROM bin_objects b), '[]'::json)
) AS payload;
`;

function formatIsoDate(val) {
  if (!val) return null;
  const str = String(val);
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str.slice(0, 16);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

/**
 * Inspects a single Supabase project's PostgreSQL database and Storage objects.
 */
export async function inspectSupabaseProjectDatabase(projectRef, token, fetchImpl = fetch, projectCreatedAt = null) {
  const res = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: DISCOVERY_SQL }),
  });

  if (!res.ok) {
    return null;
  }

  const rows = await res.json();
  const payload = rows?.[0]?.payload;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const dbBytes = payload.db_bytes != null && !Number.isNaN(Number(payload.db_bytes))
    ? Number(payload.db_bytes)
    : null;
  const dbCreatedAt = formatIsoDate(projectCreatedAt || payload.server_started_at);

  const rawDbObjects = Array.isArray(payload.db_objects) ? payload.db_objects : [];
  const rawBinObjects = Array.isArray(payload.binary_objects) ? payload.binary_objects : [];

  const tables = rawDbObjects.map((r) => {
    const rawBytes = r.size_bytes != null ? Number(r.size_bytes) : 0;
    const sizeMb = !Number.isNaN(rawBytes) && rawBytes > 0
      ? Number((rawBytes / (1024 * 1024)).toFixed(4))
      : 0;
    const schema = r.schema_name || 'public';
    const objectName = r.object_name || 'unknown';
    const objectType = r.object_type || 'TABLE';
    return {
      schema,
      objectName,
      objectType,
      sizeMb,
      createdAt: formatIsoDate(r.created_at) || dbCreatedAt,
      updatedAt: formatIsoDate(r.updated_at) || dbCreatedAt,
    };
  });

  const binaries = rawBinObjects.map((b) => {
    const rawBytes = b.size_bytes != null ? Number(b.size_bytes) : 0;
    const rawRows = b.rows_estimate != null ? Number(b.rows_estimate) : 1;
    const sizeMb = !Number.isNaN(rawBytes) && rawBytes > 0
      ? Number((rawBytes / (1024 * 1024)).toFixed(4))
      : 0;
    const bucket = b.schema_name || 'default';
    const objectName = b.object_name || 'unknown';
    const isEmptyBucket = objectName === '(empty bucket)' && rawRows === 0;
    return {
      schema: bucket,
      objectName,
      objectType: 'BINARY',
      ...(isEmptyBucket ? { isEmptyBucket: true } : {}),
      sizeMb,
      createdAt: formatIsoDate(b.created_at) || dbCreatedAt,
      updatedAt: formatIsoDate(b.updated_at) || dbCreatedAt,
    };
  });

  const dbObjectsMb = Number(tables.reduce((acc, t) => acc + (t.sizeMb || 0), 0).toFixed(2));
  const binaryStorageMb = Number(binaries.reduce((acc, b) => acc + (b.sizeMb || 0), 0).toFixed(2));
  const estimatedSizeMb = dbBytes !== null
    ? Number((dbBytes / (1024 * 1024)).toFixed(2))
    : dbObjectsMb;

  return {
    dbBytes,
    estimatedSizeMb,
    dbObjectsMb,
    binaryStorageMb,
    totalCombinedMb: Number((estimatedSizeMb + binaryStorageMb).toFixed(2)),
    tables,
    binaries,
  };
}

/**
 * Discovers all accessible Supabase projects and inspects active databases + binary storage.
 */
export async function discoverSupabaseProjectsAndDatabases({
  token,
  targetRef = '',
  inspectAllActive = true,
  fetchImpl = fetch,
}) {
  if (!token) {
    return {
      ok: true,
      connected: false,
      message: 'No Supabase OAuth / Management token supplied.',
      projects: [],
      databases: [],
    };
  }

  const pRes = await fetchImpl('https://api.supabase.com/v1/projects', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!pRes.ok) {
    const errText = await pRes.text().catch(() => '');
    throw new Error(`Supabase Management API returned HTTP ${pRes.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`);
  }

  const allProjects = await pRes.json();
  const projectList = Array.isArray(allProjects) ? allProjects : [];

  const normalizedTarget = (targetRef || '').trim().toLowerCase();
  let chosenRef = normalizedTarget;
  if (!chosenRef && projectList.length > 0) {
    const active = projectList.find((p) => p.status === 'ACTIVE_HEALTHY') || projectList[0];
    chosenRef = active.id;
  }

  // Inspect all active healthy projects concurrently (always prioritizing chosenRef)
  const projectsToInspect = projectList
    .filter((p) => {
      if (p.id === chosenRef) return true;
      if (inspectAllActive && p.status === 'ACTIVE_HEALTHY') return true;
      return false;
    })
    .sort((a, b) => (a.id === chosenRef ? -1 : b.id === chosenRef ? 1 : 0))
    .slice(0, 20);

  const inspectionMap = new Map();
  await Promise.all(
    projectsToInspect.map(async (proj) => {
      try {
        const result = await inspectSupabaseProjectDatabase(proj.id, token, fetchImpl, proj.created_at);
        if (result) {
          inspectionMap.set(proj.id, result);
        }
      } catch {
        // non-blocking per project
      }
    })
  );

  const databases = projectList.map((p) => {
    const inspected = inspectionMap.get(p.id);
    const isChosen = p.id === chosenRef || Boolean(inspected);
    const tables = inspected ? inspected.tables : [];
    const binaries = inspected ? inspected.binaries : [];
    const estimatedSizeMb = inspected ? inspected.estimatedSizeMb : null;
    const binaryStorageMb = inspected ? inspected.binaryStorageMb : 0;

    return {
      id: `db_${p.id.slice(0, 8)}`,
      projectRef: p.id,
      projectName: p.name || p.id,
      name: `${p.name || p.id} (postgres)`,
      region: p.region || 'us-east-1',
      status: p.status || 'ready',
      createdAt: p.created_at ? formatIsoDate(p.created_at) : null,
      estimatedSizeMb,
      binaryStorageMb,
      totalProjectMb: estimatedSizeMb !== null ? Number((estimatedSizeMb + binaryStorageMb).toFixed(2)) : null,
      enabled: isChosen,
      mode: 'structure_and_data',
      tables,
      binaries,
    };
  });

  return {
    ok: true,
    connected: true,
    targetProjectRef: chosenRef,
    projects: projectList.map((p) => {
      const inspected = inspectionMap.get(p.id);
      return {
        id: p.id,
        name: p.name,
        region: p.region,
        status: p.status,
        createdAt: p.created_at ? formatIsoDate(p.created_at) : null,
        databaseSizeMb: inspected ? inspected.estimatedSizeMb : null,
        binaryStorageMb: inspected ? inspected.binaryStorageMb : 0,
        totalMegabytes: inspected ? inspected.totalCombinedMb : null,
      };
    }),
    databases,
  };
}
