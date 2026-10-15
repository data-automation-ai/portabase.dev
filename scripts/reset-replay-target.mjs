import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
}

loadEnv('.env.portabase.local');
loadEnv('.env.replay-target.local');

const targetRef = process.env.PORTABASE_TARGET_PROJECT_REF || 'exnipxvsgohnpspzlyzb';
const targetUrl = process.env.PORTABASE_TARGET_SUPABASE_URL || `https://${targetRef}.supabase.co`;
const serviceKey = process.env.PORTABASE_TARGET_SERVICE_ROLE_KEY || process.env.PORTABASE_TARGET_SUPABASE_SERVICE_ROLE_KEY;
const pat = process.env.SUPABASE_ACCESS_TOKEN;
const dbUrl = process.env.PORTABASE_TARGET_DB_URL;

if (targetRef === 'ekklokrukxmqlahtonnc') {
  throw new Error('Refusing to reset production source project!');
}

async function main() {
  // 1. Delete all storage buckets & objects on target
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const bucketsRes = await fetch(`${targetUrl}/storage/v1/bucket`, { headers });
  if (bucketsRes.ok) {
    const buckets = await bucketsRes.json();
    for (const b of buckets) {
      await fetch(`${targetUrl}/storage/v1/bucket/${encodeURIComponent(b.id)}/empty`, { method: 'POST', headers });
      await fetch(`${targetUrl}/storage/v1/bucket/${encodeURIComponent(b.id)}`, { method: 'DELETE', headers });
    }
  }

  // 2. Delete all Edge Functions on target via Management API
  const mgmtHeaders = {
    Authorization: `Bearer ${pat}`,
    'Content-Type': 'application/json',
  };
  const fnsRes = await fetch(`https://api.supabase.com/v1/projects/${targetRef}/functions`, { headers: mgmtHeaders });
  if (fnsRes.ok) {
    const fns = await fnsRes.json();
    for (const fn of fns) {
      const slug = fn.slug || fn.name;
      if (slug) {
        await fetch(`https://api.supabase.com/v1/projects/${targetRef}/functions/${encodeURIComponent(slug)}`, {
          method: 'DELETE',
          headers: mgmtHeaders,
        });
      }
    }
  }

  // 3. Reset application schemas, public schema, auth.users, and custom roles
  const resetSql = `
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT nspname FROM pg_namespace
    WHERE nspname !~ '^(pg_.*|information_schema|_analytics|_realtime|_supavisor|auth|cron|dbdev|extensions|graphql|graphql_public|net|pgbouncer|pgmq|pgsodium|pgsodium_masks|pgtle|realtime|repack|storage|supabase_functions|supabase_migrations|tiger|tiger_data|timescaledb_.*|_timescaledb_.*|topology|vault|etl|public)$'
  ) LOOP
    EXECUTE 'DROP SCHEMA IF EXISTS ' || quote_ident(r.nspname) || ' CASCADE';
  END LOOP;
END $$;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION pg_database_owner;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
TRUNCATE TABLE auth.users, auth.identities, auth.sessions, auth.refresh_tokens, auth.audit_log_entries, auth.flow_state, auth.mfa_factors, auth.mfa_challenges, auth.mfa_amr_claims, auth.sso_providers, auth.sso_domains, auth.saml_providers, auth.saml_relay_states, auth.one_time_tokens CASCADE;
SET session_replication_role = replica;
DELETE FROM storage.objects;
DELETE FROM storage.buckets;
SET session_replication_role = origin;
DROP ROLE IF EXISTS "admin", "svc_supabase";
NOTIFY pgrst, 'reload schema';
`;
  const u = new URL(dbUrl);
  const pgEnv = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.slice(1) || 'postgres'),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGSSLMODE: 'require',
  };
  const psqlRes = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-c', resetSql], { encoding: 'utf8', env: pgEnv });
  if (psqlRes.status !== 0) {
    throw new Error(`psql reset failed: ${psqlRes.stderr}`);
  }
  console.log(`Target ${targetRef} reset to blank (applicationTables=0, authUsers=0, storageBuckets=0, edgeFunctions=0).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
