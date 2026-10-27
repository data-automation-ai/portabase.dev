// All methods execute inside the attested workload. Never return credentials
// from this module's provisioning methods through an unencrypted HTTP response.
const API = 'https://api.supabase.com/v1';
export const projectRef = value => {
  if (!/^[a-z]{20}$/.test(value || '')) throw new Error('invalid_project_reference');
  return value;
};
export function supabaseAccess(accessToken, fetchImpl = fetch) {
  if (typeof accessToken !== 'string' || accessToken.length < 20) throw new Error('supabase_connection_required');
  async function request(path, { method = 'GET', body } = {}) {
    if (!path.startsWith('/') || path.includes('..') || path.includes('://')) throw new Error('invalid_provider_path');
    const r = await fetchImpl(API + path, { method,
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`supabase_request_${r.status}`);
    if (r.status === 204) return null;
    return r.json();
  }
  async function query(ref, sql) {
    return request(`/projects/${projectRef(ref)}/database/query`, { method: 'POST', body: { query: sql } });
  }
  async function projects() {
    const list = await request('/projects');
    if (!Array.isArray(list)) throw new Error('invalid_provider_response');
    return list.map(p => ({ ref: projectRef(p.id), name: String(p.name), region: String(p.region), status: String(p.status) }));
  }
  async function inspect(ref) {
    projectRef(ref);
    const selected = (await projects()).find(p => p.ref === ref);
    if (!selected) throw new Error('project_not_authorized');
    const data = await query(ref, `SELECT pg_database_size(current_database())::text AS database_bytes,
      (SELECT COALESCE(sum(CASE WHEN metadata->>'size' ~ '^[0-9]+$' THEN (metadata->>'size')::numeric ELSE 0 END),0)::text FROM storage.objects) AS storage_bytes,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema','auth','storage','realtime','supabase_functions','supabase_migrations','extensions','vault','graphql','graphql_public','net','pgsodium','pgsodium_masks','cron','_realtime','_analytics')) AS application_tables,
      (SELECT count(*)::int FROM auth.users) AS auth_users,
      (SELECT count(*)::int FROM storage.objects) AS storage_objects`);
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) throw new Error('database_inspection_failed');
    const functions = await request(`/projects/${ref}/functions`);
    if (!Array.isArray(functions)) throw new Error('function_inspection_failed');
    const databaseBytes = Number(row.database_bytes), storageBytes = Number(row.storage_bytes);
    if (![databaseBytes,storageBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('invalid_project_size');
    return { ...selected, databaseBytes, storageBytes, measuredBytes: databaseBytes + storageBytes,
      applicationTables: Number(row.application_tables), authUsers: Number(row.auth_users),
      storageObjects: Number(row.storage_objects), functions: functions.length,
      blank: Number(row.application_tables) === 0 && Number(row.auth_users) === 0 && Number(row.storage_objects) === 0 && functions.length === 0,
      checkedAt: new Date().toISOString() };
  }
  async function credentials(ref, { readOnly = true } = {}) {
    projectRef(ref);
    if (!(await projects()).some(p => p.ref === ref)) throw new Error('project_not_authorized');
    const [login, poolers, keys] = await Promise.all([
      request(`/projects/${ref}/cli/login-role`, { method: 'POST', body: { read_only: readOnly } }),
      request(`/projects/${ref}/config/database/pooler`),
      request(`/projects/${ref}/api-keys?reveal=true`),
    ]);
    if (!/^cli_login_[a-z0-9_]+$/i.test(login?.role || '') || !login.password || !(login.ttl_seconds > 0)) throw new Error('temporary_login_unavailable');
    const pool = Array.isArray(poolers) && poolers.find(p => /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(p.db_host || ''));
    if (!pool) throw new Error('session_pooler_unavailable');
    const key = Array.isArray(keys) && (
      keys.find(k => k.type === 'secret' && k.name === 'portabase' && k.api_key)
      || keys.find(k => (k.type === 'secret' || String(k.api_key || '').startsWith('sb_secret_')) && k.api_key)
      || keys.find(k => k.name === 'service_role' && k.api_key)
    );
    if (!key?.api_key) throw new Error('storage_auth_key_unavailable');
    const uri = new URL(`postgresql://${pool.db_host}:5432/postgres`);
    uri.username = `${login.role}.${ref}`; uri.password = login.password;
    uri.searchParams.set('sslmode', 'verify-full');
    return { ref, databaseUrl: uri.toString(), serviceKey: key.api_key,
      managementToken: accessToken, expiresAt: Date.now() + login.ttl_seconds * 1000, readOnly };
  }
  return { projects, inspect, credentials, query };
}
