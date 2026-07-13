#!/usr/bin/env node
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import {
  capsuleName,
  compareDatabaseInventories,
  decryptFile,
  encryptFile,
  hashFile,
  isCapsuleName,
  projectBaseUrl,
  providerCommand,
  providerRemote,
  providerVerifyCommand,
  formatBytes,
  recoveryEvidenceStatus,
  safeObjectPath,
  supabaseHeaders,
  TRIAL_LIMITS,
  trialProtectionLedger,
  validateBlankRestoreInventory,
  validateDrillCapsule,
  validateRestoreTarget,
  verifyChecksumFile,
} from './portabase-core.mjs';
import { resolveEdition } from './license.mjs';

export { providerCommand, safeObjectPath, validateRestoreTarget } from './portabase-core.mjs';

const VERSION = '0.3.0';
const CONFIG_NAME = 'portabase.config.json';
const argv = process.argv.slice(2);
const command = argv[0] || 'help';

function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function hasFlag(name) {
  return argv.includes(`--${name}`);
}

async function ask(prompt, fallback = '') {
  const rl = createInterface({ input, output });
  const answer = await rl.question(`${prompt}${fallback ? ` [${fallback}]` : ''}: `);
  rl.close();
  return answer.trim() || fallback;
}

async function loadConfig(path = flag('config', CONFIG_NAME)) {
  const fullPath = resolve(path);
  const runtime = process.env.PORTABASE_RUNTIME_CONFIG;
  if (!existsSync(fullPath) && !runtime) throw new Error(`Config not found: ${fullPath}. Run "portabase init" first.`);
  const config = runtime ? JSON.parse(runtime) : JSON.parse(await readFile(fullPath, 'utf8'));
  if (!config.projectRef) throw new Error('Config is missing projectRef.');
  if (!config.provider?.type) throw new Error('Config is missing provider.type.');
  return { path: fullPath, config };
}

function resolveTool(name) {
  const toolsDir = process.env.PORTABASE_TOOLS_DIR;
  if (toolsDir) {
    const executable = process.platform === 'win32' ? `${name}.exe` : name;
    for (const candidate of [join(toolsDir, executable), join(toolsDir, 'postgres', 'bin', executable)]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  if (name === 'supabase') {
    const packaged = resolve(
      'node_modules',
      '@supabase',
      `cli-windows-${process.arch === 'arm64' ? 'arm64' : 'x64'}`,
      'bin',
      'supabase.exe',
    );
    if (process.platform === 'win32' && existsSync(packaged)) return packaged;
  }
  const local = resolve('node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
  if (existsSync(local)) return local;
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(lookup, [name], { encoding: 'utf8', windowsHide: true });
  return found.status === 0 ? found.stdout.split(/\r?\n/).find(Boolean)?.trim() : null;
}

function run(name, commandArgs, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(name, commandArgs, {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      ...options,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${basename(name)} exited with code ${code}`)));
  });
}

async function init() {
  const projectRef = flag('project-ref') || await ask('Supabase project ref');
  const providerType = flag('provider') || await ask('Destination (google-drive, dropbox, local)', 'google-drive');
  const config = {
    version: 2,
    projectRef,
    backupDirectory: flag('directory', './portabase-capsules'),
    statusDirectory: './portabase-status',
    provider: { type: providerType },
    capture: { database: true, storage: true, functions: true },
    encryption: { passphraseEnv: 'PORTABASE_ENCRYPTION_PASSPHRASE' },
    retention: { keepLast: 30, pruneAfterBackup: false },
    schedule: { everyHours: 6 },
  };
  if (['google-drive', 'dropbox', 'rclone'].includes(providerType)) {
    config.provider.remote = flag('remote') || await ask('rclone remote name', providerType === 'google-drive' ? 'gdrive' : 'dropbox');
    config.provider.path = flag('path', '/PortaBase');
  } else if (providerType === 'local') {
    config.provider.path = flag('path') || await ask('Independent local/NAS destination (blank keeps capsule directory)', '');
  } else {
    throw new Error('Essentials supports google-drive, dropbox, rclone, or local. AWS is configured by the AWS Recovery package.');
  }
  if (!projectRef) throw new Error('Project ref is required.');
  await writeFile(resolve(CONFIG_NAME), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  console.log(`\nCreated ${CONFIG_NAME}. No credentials were written.`);
  console.log('Set SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,');
  console.log('SUPABASE_ACCESS_TOKEN (Functions), and PORTABASE_ENCRYPTION_PASSPHRASE locally.');
}

function sourceFetch(path, options = {}) {
  const url = projectBaseUrl(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  return fetch(`${url}${path}`, {
    ...options,
    headers: supabaseHeaders(key, { ...(options.body && !(options.body instanceof ReadableStream) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }),
  });
}

async function checkedSourceFetch(path, options = {}) {
  const response = await sourceFetch(path, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase API ${response.status}: ${body.slice(0, 300)}`);
  }
  return response;
}

async function authenticatedHealth() {
  try {
    const response = await sourceFetch('/storage/v1/bucket', { signal: AbortSignal.timeout(10000) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function doctor() {
  const { config } = await loadConfig();
  const rcloneNeeded = ['google-drive', 'dropbox', 'rclone'].includes(config.provider.type);
  const nativePostgres = Boolean(resolveTool('pg_dump') && resolveTool('pg_dumpall'));
  const checks = [
    ['Postgres dump tools', nativePostgres || Boolean(resolveTool('supabase')), nativePostgres ? 'native; Docker not required' : 'Supabase CLI fallback'],
    ['Supabase CLI', Boolean(resolveTool('supabase')), 'Edge Function capture'],
    ['tar', Boolean(resolveTool('tar')), 'encrypted capsule packaging'],
    ['SUPABASE_DB_URL', Boolean(process.env.SUPABASE_DB_URL), 'database capture'],
    ['SUPABASE_URL', Boolean(process.env.SUPABASE_URL), 'Storage capture'],
    ['SUPABASE_SERVICE_ROLE_KEY', Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), 'Storage capture'],
    ['SUPABASE_ACCESS_TOKEN', Boolean(process.env.SUPABASE_ACCESS_TOKEN), 'optional; Edge Function capture'],
    ['Encryption passphrase', Boolean(process.env[config.encryption?.passphraseEnv || 'PORTABASE_ENCRYPTION_PASSPHRASE']?.length >= 16), 'minimum 16 characters'],
    [rcloneNeeded ? 'rclone CLI' : 'Local destination', rcloneNeeded ? Boolean(resolveTool('rclone')) : true, 'destination transfer'],
  ];
  if (rcloneNeeded && resolveTool('rclone')) {
    const remotes = spawnSync(resolveTool('rclone'), ['listremotes'], { encoding: 'utf8', windowsHide: true });
    checks.push(['rclone remote', remotes.status === 0 && remotes.stdout.split(/\r?\n/).includes(`${config.provider.remote}:`), 'configured customer account']);
  }
  const health = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? await authenticatedHealth() : { ok: false };
  checks.push(['Authenticated Storage read', health.ok, health.ok ? `HTTP ${health.status}` : `credential check failed${health.status ? ` (HTTP ${health.status})` : ''}`]);
  console.log(`PortaBase ${VERSION} · ${config.provider.type} destination\n`);
  for (const [name, ok, note] of checks) console.log(`${ok ? 'PASS' : 'MISS'}  ${name.padEnd(28)} ${note}`);
  const optional = new Set(['SUPABASE_ACCESS_TOKEN']);
  if (checks.filter(([name]) => !optional.has(name)).some(([, ok]) => !ok)) process.exitCode = 2;
}

async function captureDatabase(rawDir, limits = null) {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL is missing.');
  const dbDir = join(rawDir, 'database');
  await mkdir(dbDir, { recursive: true });
  if (resolveTool('pg_dump') && resolveTool('pg_dumpall')) {
    return captureDatabaseNative(dbUrl, dbDir, limits);
  }
  const supabase = resolveTool('supabase');
  if (!supabase) throw new Error('Install PostgreSQL client tools or the Supabase CLI for database capture.');
  const common = ['db', 'dump', '--db-url', dbUrl];
  await run(supabase, [...common, '--file', join(dbDir, 'roles.sql'), '--role-only']);
  await run(supabase, [...common, '--file', join(dbDir, 'schema.sql')]);
  if (!limits?.databaseSchemaOnly) await run(supabase, [...common, '--file', join(dbDir, 'data.sql'), '--use-copy', '--data-only']);
  const files = limits?.databaseSchemaOnly ? ['roles.sql', 'schema.sql'] : ['roles.sql', 'schema.sql', 'data.sql'];
  const inventory = resolveTool('psql') ? await captureDatabaseInventory(dbUrl, join(dbDir, 'database-inventory.json'), { estimateRows: Boolean(limits) }) : null;
  return {
    complete: Boolean(inventory),
    reason: inventory ? null : 'Database dump captured, but psql was unavailable for exact recovery inventory.',
    limited: Boolean(limits),
    limitation: limits ? 'schema only; table rows are not included' : null,
    files,
    inventory: Boolean(inventory),
    summary: inventorySummary(inventory),
  };
}

function inventorySummary(inventory) {
  if (!inventory) return null;
  return {
    tables: inventory.tables.length,
    rows: inventory.tables.reduce((total, table) => total + (Number(table.rows) || 0), 0),
    approximateRows: Boolean(inventory.approximateRows),
    authUsers: Number(inventory.authUsers) || 0,
    policies: Number(inventory.policies) || 0,
    databaseFunctions: Number(inventory.databaseFunctions) || 0,
    triggers: Number(inventory.triggers) || 0,
  };
}

function postgresEnvironment(dbUrl) {
  const url = new URL(dbUrl);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
    PGSSLMODE: url.searchParams.get('sslmode') || 'require',
  };
}

const APPLICATION_SCHEMA_SQL = `schemaname NOT IN ('information_schema','_analytics','_realtime','_supavisor','auth','cron','dbdev','extensions','graphql','graphql_public','net','pgbouncer','pgmq','pgsodium','pgsodium_masks','pgtle','realtime','repack','storage','supabase_functions','supabase_migrations','tiger','tiger_data','topology','vault') AND schemaname !~ '^pg_' AND schemaname !~ '^_timescaledb_'`;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function psqlValue(dbUrl, sql) {
  const psql = resolveTool('psql');
  if (!psql) throw new Error('psql is required for exact recovery inventory.');
  const result = spawnSync(psql, ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql], {
    encoding: 'utf8', windowsHide: true, env: postgresEnvironment(dbUrl), maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Database inventory failed: ${(result.stderr || '').trim().slice(0, 300)}`);
  return result.stdout.trim();
}

async function captureDatabaseInventory(dbUrl, outputPath = null, { estimateRows = false } = {}) {
  let tables;
  if (estimateRows) {
    const tablesJson = psqlValue(dbUrl, `SELECT COALESCE(json_agg(json_build_object('schema', schemaname, 'name', tablename, 'rows', GREATEST(c.reltuples, 0)::bigint) ORDER BY schemaname, tablename), '[]'::json)::text FROM pg_catalog.pg_tables t JOIN pg_catalog.pg_namespace n ON n.nspname = t.schemaname JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = t.tablename AND c.relkind IN ('r','p') WHERE ${APPLICATION_SCHEMA_SQL};`);
    tables = JSON.parse(tablesJson || '[]');
    for (const table of tables) table.rows = Number(table.rows) || 0;
  } else {
    const tablesJson = psqlValue(dbUrl, `SELECT COALESCE(json_agg(json_build_object('schema', schemaname, 'name', tablename) ORDER BY schemaname, tablename), '[]'::json)::text FROM pg_catalog.pg_tables WHERE ${APPLICATION_SCHEMA_SQL};`);
    tables = JSON.parse(tablesJson || '[]');
    for (const table of tables) {
      const count = psqlValue(dbUrl, `SELECT count(*)::text FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)};`);
      table.rows = Number(count);
      if (!Number.isSafeInteger(table.rows) || table.rows < 0) throw new Error(`Invalid row count for ${table.schema}.${table.name}.`);
    }
  }
  const metricSql = `SELECT json_build_object(
    'authUsers', (SELECT count(*) FROM auth.users),
    'policies', (SELECT count(*) FROM pg_catalog.pg_policies WHERE ${APPLICATION_SCHEMA_SQL}),
    'databaseFunctions', (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('information_schema','auth','storage','extensions','graphql','graphql_public','net','realtime','supabase_functions','vault') AND n.nspname !~ '^pg_' AND n.nspname !~ '^_timescaledb_'),
    'triggers', (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT IN ('information_schema','auth','storage','extensions','realtime') AND n.nspname !~ '^pg_'),
    'extensions', (SELECT COALESCE(json_agg(extname ORDER BY extname), '[]'::json) FROM pg_catalog.pg_extension)
  )::text;`;
  const metrics = JSON.parse(psqlValue(dbUrl, metricSql));
  const inventory = { capturedAt: new Date().toISOString(), approximateRows: estimateRows, tables, ...metrics };
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

function runToFile(name, commandArgs, outputPath, options = {}) {
  return new Promise((resolveRun, reject) => {
    const outputFile = createWriteStream(outputPath, { flags: 'wx' });
    let exited = false;
    let closed = false;
    let failed = false;
    const finish = () => { if (!failed && exited && closed) resolveRun(); };
    const child = spawn(name, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, ...options,
    });
    child.stdout.pipe(outputFile);
    child.stderr.pipe(process.stderr);
    outputFile.once('close', () => { closed = true; finish(); });
    outputFile.once('error', error => { failed = true; reject(error); });
    child.once('error', error => { failed = true; reject(error); });
    child.once('exit', code => {
      if (code !== 0) {
        failed = true;
        reject(new Error(`${basename(name)} exited with code ${code}`));
      } else {
        exited = true;
        finish();
      }
    });
  });
}

async function transformSql(source, target, transform, prefix = '', suffix = '') {
  const writer = createWriteStream(target, { flags: 'wx' });
  if (prefix) writer.write(prefix);
  const lines = createInterface({ input: createReadStream(source), crlfDelay: Infinity });
  for await (const line of lines) {
    const changed = transform(line);
    if (changed !== null) writer.write(`${changed}\n`);
  }
  if (suffix) writer.write(suffix);
  await new Promise((resolveWrite, reject) => {
    writer.once('error', reject);
    writer.end(resolveWrite);
  });
}

const SCHEMA_EXCLUDES = 'information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault';
const DATA_EXCLUDES = 'information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|_analytics|_realtime|_supavisor';
const RESERVED_ROLES = '(anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin)';
const EXACT_EXCLUDED_SCHEMAS = new Set(SCHEMA_EXCLUDES.split('|').filter(name => !name.includes('*')));

function isExcludedSchemaName(name) {
  return EXACT_EXCLUDED_SCHEMAS.has(name) || name.startsWith('pg_') || name.startsWith('timescaledb_') || name.startsWith('_timescaledb_');
}

function grantSchemaName(line) {
  if (!/^(GRANT|REVOKE) /.test(line)) return null;
  return line.match(/\bIN SCHEMA "([^"]+)"/)?.[1]
    || line.match(/\bON (?:SCHEMA|TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|TYPE) "([^"]+)"/)?.[1]
    || null;
}

export function cleanSchemaLine(line) {
  if (/^\\(un)?restrict /.test(line)) return `-- ${line}`;
  if (/^CREATE SCHEMA "/.test(line)) line = line.replace('CREATE SCHEMA "', 'CREATE SCHEMA IF NOT EXISTS "');
  if (/^CREATE TABLE "/.test(line)) line = line.replace('CREATE TABLE "', 'CREATE TABLE IF NOT EXISTS "');
  if (/^CREATE SEQUENCE "/.test(line)) line = line.replace('CREATE SEQUENCE "', 'CREATE SEQUENCE IF NOT EXISTS "');
  if (/^CREATE VIEW "/.test(line)) line = line.replace('CREATE VIEW "', 'CREATE OR REPLACE VIEW "');
  if (/^CREATE FUNCTION "/.test(line)) line = line.replace('CREATE FUNCTION "', 'CREATE OR REPLACE FUNCTION "');
  if (/^CREATE TRIGGER "/.test(line)) line = line.replace('CREATE TRIGGER "', 'CREATE OR REPLACE TRIGGER "');
  if (/^CREATE PUBLICATION "supabase_realtime/.test(line)) return `-- ${line}`;
  if (/^(CREATE EVENT TRIGGER |         WHEN TAG IN |   EXECUTE FUNCTION |ALTER EVENT TRIGGER |ALTER PUBLICATION "supabase_realtime_|ALTER FOREIGN DATA WRAPPER )/.test(line)) return `-- ${line}`;
  if (/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/.test(line)) return `-- ${line}`;
  if (/^GRANT ALL ON FOREIGN DATA WRAPPER .+ TO "postgres" WITH GRANT OPTION/.test(line)) return `-- ${line}`;
  const referencedSchema = grantSchemaName(line);
  if (referencedSchema && isExcludedSchemaName(referencedSchema)) return `-- ${line}`;
  line = line.replace(/^(CREATE EXTENSION IF NOT EXISTS "(?:pg_tle|pgsodium|pgmq)").+/, '$1;');
  if (/^COMMENT ON EXTENSION /.test(line) || /^CREATE POLICY "cron_job_/.test(line) || /^ALTER TABLE "cron"/.test(line) || /^SET transaction_timeout = 0;/.test(line)) return `-- ${line}`;
  return line.startsWith('-- ') ? null : line;
}

function cleanRoleLine(line) {
  if (/^\\(un)?restrict /.test(line)) return `-- ${line}`;
  if (new RegExp(`^(CREATE|ALTER) ROLE "${RESERVED_ROLES}"`).test(line)) return null;
  line = line.replace(/ (NOSUPERUSER|NOREPLICATION)/g, '');
  const safeSetting = line.match(/^-- (.* SET "(?:pgaudit.*|pgrst.*|session_replication_role|statement_timeout|track_io_timing)" .*)/);
  if (safeSetting) return safeSetting[1];
  if (new RegExp(`GRANT ".*" TO "${RESERVED_ROLES}"`).test(line)) return null;
  return line.startsWith('-- ') ? null : line;
}

async function captureDatabaseNative(dbUrl, dbDir, limits = null) {
  const env = postgresEnvironment(dbUrl);
  const pgDump = resolveTool('pg_dump');
  const pgDumpAll = resolveTool('pg_dumpall');
  const rawRoles = join(dbDir, '.roles.raw.sql');
  const rawSchema = join(dbDir, '.schema.raw.sql');
  const rawData = join(dbDir, '.data.raw.sql');
  try {
    await runToFile(pgDumpAll, ['--roles-only', '--role', 'postgres', '--quote-all-identifiers', '--no-role-passwords', '--no-comments'], rawRoles, { env });
    await transformSql(rawRoles, join(dbDir, 'roles.sql'), cleanRoleLine, '', 'RESET ALL;\n');
    await runToFile(pgDump, ['--schema-only', '--quote-all-identifiers', '--role', 'postgres', '--exclude-schema', SCHEMA_EXCLUDES], rawSchema, { env });
    await transformSql(rawSchema, join(dbDir, 'schema.sql'), cleanSchemaLine);
    if (!limits?.databaseSchemaOnly) {
      await runToFile(pgDump, ['--data-only', '--quote-all-identifiers', '--role', 'postgres', '--exclude-schema', DATA_EXCLUDES, '--exclude-table', 'auth.schema_migrations', '--exclude-table', 'storage.migrations', '--exclude-table', 'supabase_functions.migrations', '--schema', '*'], rawData, { env });
      await transformSql(rawData, join(dbDir, 'data.sql'), line => /^\\(un)?restrict /.test(line) ? `-- ${line}` : line, 'SET session_replication_role = replica;\n', 'RESET ALL;\n');
    }
  } finally {
    await rm(rawRoles, { force: true });
    await rm(rawSchema, { force: true });
    await rm(rawData, { force: true });
  }
  const inventory = resolveTool('psql') ? await captureDatabaseInventory(dbUrl, join(dbDir, 'database-inventory.json'), { estimateRows: Boolean(limits) }) : null;
  const files = [
    'roles.sql',
    'schema.sql',
    ...(!limits?.databaseSchemaOnly ? ['data.sql'] : []),
    ...(inventory ? ['database-inventory.json'] : []),
  ];
  return {
    complete: Boolean(inventory),
    reason: inventory ? null : 'Database dump captured, but psql was unavailable for exact recovery inventory.',
    limited: Boolean(limits),
    limitation: limits ? 'schema only; table rows are not included' : null,
    engine: 'native-postgresql-client',
    files,
    inventory: Boolean(inventory),
    summary: inventorySummary(inventory),
  };
}

async function listBucketObjects(bucketId, prefix = '') {
  const objects = [];
  let offset = 0;
  while (true) {
    const response = await checkedSourceFetch(`/storage/v1/object/list/${encodeURIComponent(bucketId)}`, {
      method: 'POST',
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    const page = await response.json();
    for (const item of page) {
      const fullName = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.metadata === null || item.id === null) objects.push(...await listBucketObjects(bucketId, fullName));
      else objects.push({ ...item, fullName });
    }
    if (page.length < 1000) break;
    offset += page.length;
  }
  return objects;
}

async function captureStorage(rawDir, limits = null) {
  const storageDir = join(rawDir, 'storage');
  await mkdir(storageDir, { recursive: true });
  const buckets = await (await checkedSourceFetch('/storage/v1/bucket')).json();
  const manifest = { capturedAt: new Date().toISOString(), buckets: [], objectCount: 0, totalBytes: 0 };
  const inventory = { bucketCount: buckets.length, objectCount: 0, totalBytes: 0, buckets: [] };
  const listedObjects = new Map();
  for (const bucket of buckets) {
    const objects = await listBucketObjects(bucket.id);
    const bytes = objects.reduce((total, object) => total + (Number(object.metadata?.size) || 0), 0);
    listedObjects.set(bucket.id, objects);
    inventory.buckets.push({ id: bucket.id, objectCount: objects.length, totalBytes: bytes });
    inventory.objectCount += objects.length;
    inventory.totalBytes += bytes;
  }
  const selectedBuckets = limits ? buckets.slice(0, limits.maxStorageBuckets) : buckets;
  for (const bucket of selectedBuckets) {
    const record = {
      id: bucket.id,
      name: bucket.name,
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit ?? null,
      allowedMimeTypes: bucket.allowed_mime_types ?? null,
      objects: [],
    };
    for (const object of listedObjects.get(bucket.id)) {
      if (limits && manifest.objectCount >= limits.maxStorageObjects) break;
      const target = join(storageDir, safeObjectPath(bucket.id), safeObjectPath(object.fullName));
      await mkdir(dirname(target), { recursive: true });
      const objectPath = object.fullName.split('/').map(encodeURIComponent).join('/');
      const response = await checkedSourceFetch(`/storage/v1/object/authenticated/${encodeURIComponent(bucket.id)}/${objectPath}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: 'wx' }));
      const info = await stat(target);
      record.objects.push({ name: object.fullName, size: info.size, sha256: await hashFile(target), updatedAt: object.updated_at || null, contentType: object.metadata?.mimetype || null });
      manifest.objectCount += 1;
      manifest.totalBytes += info.size;
    }
    manifest.buckets.push(record);
  }
  manifest.sourceInventory = inventory;
  await writeFile(join(storageDir, 'storage-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { complete: true, limited: Boolean(limits), limitation: limits ? `first ${limits.maxStorageObjects} objects across ${limits.maxStorageBuckets} buckets` : null, bucketCount: manifest.buckets.length, objectCount: manifest.objectCount, totalBytes: manifest.totalBytes, inventory };
}

async function captureFunctions(config, rawDir, limits = null) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) return { complete: false, skipped: true, reason: 'SUPABASE_ACCESS_TOKEN not provided' };
  const supabase = resolveTool('supabase');
  if (!supabase) throw new Error('Supabase CLI is required for Edge Function capture.');
  const functionsDir = join(rawDir, 'functions');
  await mkdir(functionsDir, { recursive: true });
  const result = spawnSync(supabase, ['functions', 'list', '--project-ref', config.projectRef, '--output', 'json', '--workdir', functionsDir], {
    encoding: 'utf8', env: process.env, windowsHide: true, cwd: functionsDir,
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Unable to list Edge Functions.');
  const availableFunctions = JSON.parse(result.stdout || '[]');
  const functions = limits ? availableFunctions.slice(0, limits.maxFunctions) : availableFunctions;
  for (const fn of functions) {
    await run(supabase, ['functions', 'download', fn.name, '--project-ref', config.projectRef, '--workdir', functionsDir], { cwd: functionsDir, env: process.env });
  }
  return {
    complete: true,
    limited: Boolean(limits),
    limitation: limits ? `first ${limits.maxFunctions} Functions` : null,
    count: functions.length,
    names: functions.map(fn => fn.name),
    availableCount: availableFunctions.length,
    available: availableFunctions.map(fn => fn.name),
    secretNames: listSecretNames(supabase, config.projectRef),
  };
}

function listSecretNames(supabase, projectRef) {
  try {
    const result = spawnSync(supabase, ['secrets', 'list', '--project-ref', projectRef, '--output', 'json'], {
      encoding: 'utf8', env: process.env, windowsHide: true,
    });
    if (result.status === 0) {
      const parsed = JSON.parse(result.stdout || '[]');
      if (Array.isArray(parsed)) return parsed.map(secret => String(secret.name || secret)).filter(Boolean).sort();
    }
    const plain = spawnSync(supabase, ['secrets', 'list', '--project-ref', projectRef], {
      encoding: 'utf8', env: process.env, windowsHide: true,
    });
    if (plain.status !== 0) return null;
    return plain.stdout.split(/\r?\n/)
      .map(line => line.split('|')[0].trim())
      .filter(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name !== 'NAME')
      .sort();
  } catch {
    return null;
  }
}

async function listFiles(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(path));
    else found.push(path);
  }
  return found;
}

export async function writeTrialReport(capsuleDir, metadata) {
  const purchaseUrl = process.env.PORTABASE_PURCHASE_URL || 'https://portabase.dev/buy';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const number = value => Number(value ?? 0).toLocaleString('en-US');
  const contents = metadata.contents || {};
  const ledger = trialProtectionLedger(contents);
  const ledgerRows = ledger.rows.map(row => {
    const found = row.found === null ? 'Unknown' : `${row.approximate ? '~' : ''}${number(row.found)}${row.foundBytes != null ? ` · ${formatBytes(row.foundBytes)}` : ''}`;
    const saved = `${number(row.protected)}${row.protectedBytes != null ? ` · ${formatBytes(row.protectedBytes)}` : ''}`;
    const exposed = !row.byDesign && Number(row.found) > Number(row.protected);
    const full = !row.byDesign && row.found !== null && Number(row.found) <= Number(row.protected);
    const state = row.byDesign ? 'design' : exposed ? 'exposed' : full ? 'saved' : 'unknown';
    return `<tr class="${state}"><td><b>${escape(row.layer)}</b>${row.note ? `<span>${escape(row.note)}</span>` : ''}</td><td>${escape(found)} <i>${escape(row.unit)}</i></td><td>${escape(saved)} <i>${escape(row.unit)}</i></td></tr>`;
  }).join('');
  const summary = contents.database?.summary;
  const storageInventory = contents.storage?.inventory;
  const recoverLine = `A restore from this trial capsule would recover your database structure, ${number(contents.storage?.objectCount)} of ${storageInventory ? number(storageInventory.objectCount) : 'your'} Storage files, ${number(contents.functions?.count)} of ${contents.functions?.availableCount != null ? number(contents.functions.availableCount) : 'your'} Edge Functions, and 0 of ${summary ? `${summary.approximateRows ? '~' : ''}${number(summary.rows)}` : 'your'} database rows.`;
  const secretNames = contents.functions?.secretNames;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PortaBase trial result</title><style>body{margin:0;background:#090a0c;color:#fff;font-family:Segoe UI,sans-serif}.card{width:min(860px,calc(100% - 32px));margin:6vh auto;background:#141519;border:1px solid #303136;padding:40px;box-sizing:border-box}small{font:11px Consolas,monospace;color:#ff4b3e;letter-spacing:.12em}h1{font-size:44px;line-height:1;margin:18px 0}p{color:#aaa;line-height:1.65}table{width:100%;border-collapse:collapse;margin:30px 0;background:#101115}td,th{border:1px solid #303136;padding:14px 16px;text-align:left;vertical-align:top}th{font:11px Consolas,monospace;letter-spacing:.1em;color:#888}td b{display:block;font-size:15px}td span{display:block;font-size:11px;color:#82837e;margin-top:6px;max-width:340px}td i{font-style:normal;font-size:10px;color:#6d6e72;text-transform:uppercase}tr.exposed td:nth-child(2){color:#ff7066;font-weight:700}tr.exposed td:nth-child(3){color:#ff4b3e;font-weight:700}tr.saved td:nth-child(3){color:#c9ff4a;font-weight:700}tr.design td{color:#9a9b96}.recover{border-left:3px solid #ff4b3e;padding:15px 20px;background:#1b1515;font-size:15px;line-height:1.6}.privacy{border:1px solid #2c3f1d;background:#131a0d;padding:13px 18px;margin-top:22px;color:#a8c47e;font-size:12px;line-height:1.6}.secrets{margin-top:22px;padding:18px;border:1px solid #303136;background:#101115}.secrets b{font-size:13px}.secrets code{display:block;margin-top:10px;color:#8fb0c9;font-size:12px;line-height:1.8;word-break:break-all}.buy{display:inline-block;background:#c9ff4a;color:#111;text-decoration:none;padding:16px 22px;font-weight:800;margin-top:28px;border-radius:4px}@media(max-width:600px){.card{padding:22px}h1{font-size:34px}td,th{padding:10px}}</style></head>
<body><main class="card"><small>PORTABASE LIMITED TRIAL · PROTECTION LEDGER</small><h1>The real workflow ran.<br>Here is everything it found.</h1><p>Your sample capsule was captured, encrypted, transferred to your destination, and verified — the exact workflow a complete backup uses. The inventory below is everything PortaBase found in project <b>${escape(metadata.projectRef)}</b>.</p>
<table><tr><th>LAYER</th><th>IN YOUR PROJECT</th><th>IN THIS TRIAL CAPSULE</th></tr>${ledgerRows}</table>
<p class="recover"><b>${escape(recoverLine)}</b><br>Everything in red is currently unprotected against an account lockout, deletion, or billing freeze.</p>
${secretNames?.length ? `<div class="secrets"><b>Recovery checklist: ${number(secretNames.length)} secret name${secretNames.length === 1 ? '' : 's'} inventoried (values are never exported)</b><code>${secretNames.map(escape).join(' · ')}</code></div>` : ''}
<p class="privacy"><b>Computed locally. Transmitted nowhere.</b> This report, the inventory behind it, and your credentials never left this computer. PortaBase has no server that could receive them.</p>
<a class="buy" href="${escape(purchaseUrl)}">Protect all of it — Essentials, $147 once →</a></main></body></html>`;
  await writeFile(join(capsuleDir, 'TRIAL-REPORT.html'), html);
}

async function writeChecksums(capsuleDir) {
  const files = (await listFiles(capsuleDir)).filter(path => basename(path) !== 'checksums.sha256').sort();
  const lines = [];
  for (const path of files) lines.push(`${await hashFile(path)}  ${relative(capsuleDir, path).split(sep).join('/')}`);
  await writeFile(join(capsuleDir, 'checksums.sha256'), `${lines.join('\n')}\n`);
  return lines.length;
}

async function writeStatus(config, state) {
  const directory = resolve(config.statusDirectory || './portabase-status');
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `latest-${process.pid}.json`);
  await writeFile(temp, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  await rm(join(directory, 'latest.json'), { force: true });
  await rename(temp, join(directory, 'latest.json'));
}

async function sendAlert(config, state) {
  const envName = config.alerts?.webhookEnv;
  const url = envName ? process.env[envName] : null;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'PortaBase', projectRef: config.projectRef, ...state }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error(`Alert delivery failed: ${error.message}`);
  }
}

async function transferCapsule(config, capsuleDir) {
  if (config.provider.type === 'local') {
    if (!config.provider.path) return { destination: capsuleDir, verified: true };
    const target = join(resolve(config.provider.path), basename(capsuleDir));
    if (existsSync(target)) throw new Error(`Immutable destination already exists: ${target}`);
    await mkdir(dirname(target), { recursive: true });
    await cp(capsuleDir, target, { recursive: true, errorOnExist: true, force: false });
    const results = await verifyChecksumFile(target, join(target, 'checksums.sha256'));
    if (results.some(item => !item.ok)) throw new Error('Local destination verification failed.');
    return { destination: target, verified: true };
  }
  const upload = providerCommand(config, capsuleDir);
  if (!resolveTool(upload[0])) throw new Error(`${upload[0]} CLI is not installed.`);
  await run(resolveTool(upload[0]), upload[1]);
  const verifyRemote = providerVerifyCommand(config, capsuleDir);
  if (verifyRemote && config.provider.type === 'aws') {
    const result = spawnSync(resolveTool(verifyRemote[0]), verifyRemote[1], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || 'S3 destination verification failed.');
    if (result.stdout.trim()) throw new Error('S3 destination differs from the local capsule after upload.');
  } else if (verifyRemote) {
    await run(resolveTool(verifyRemote[0]), verifyRemote[1]);
  }
  return { destination: providerRemote(config, capsuleDir), verified: Boolean(verifyRemote) };
}

async function backup() {
  const { config } = await loadConfig();
  const entitlement = await resolveEdition({ forceTrial: hasFlag('trial'), licensePath: flag('license') });
  const trial = entitlement.edition === 'trial';
  console.log(trial
    ? `PortaBase trial limits active (${entitlement.license.reason}). A valid signed license enables complete capture.`
    : `PortaBase Essentials license verified offline (${entitlement.license.payload.licenseId}).`);
  const limits = trial ? TRIAL_LIMITS : null;
  const passphraseEnv = config.encryption?.passphraseEnv || 'PORTABASE_ENCRYPTION_PASSPHRASE';
  const passphrase = process.env[passphraseEnv];
  if (!passphrase || passphrase.length < 16) throw new Error(`${passphraseEnv} must contain at least 16 characters.`);
  const id = capsuleName(config.projectRef);
  const root = resolve(config.backupDirectory || './portabase-capsules');
  const capsuleDir = join(root, id);
  const workDir = join(root, `.work-${id}`);
  const rawDir = join(workDir, 'raw');
  const archive = join(workDir, 'capsule.tar.gz');
  if (existsSync(capsuleDir) || existsSync(workDir)) throw new Error(`Capsule already exists: ${id}`);
  await mkdir(rawDir, { recursive: true });
  await writeStatus(config, { state: 'RUNNING', capsule: id, startedAt: new Date().toISOString() });
  const manifest = {
    formatVersion: 1,
    portabaseVersion: VERSION,
    edition: entitlement.edition,
    projectRef: config.projectRef,
    createdAt: new Date().toISOString(),
    status: 'RUNNING',
    contents: {},
    errors: [],
  };
  try {
    for (const [name, enabled, capture] of [
      ['database', config.capture?.database !== false, () => captureDatabase(rawDir, limits)],
      ['storage', config.capture?.storage !== false, () => captureStorage(rawDir, limits)],
      ['functions', config.capture?.functions !== false, () => captureFunctions(config, rawDir, limits)],
    ]) {
      if (!enabled) {
        manifest.contents[name] = { complete: false, skipped: true, reason: 'disabled in config' };
        continue;
      }
      try {
        console.log(`Capturing ${name}...`);
        manifest.contents[name] = await capture();
      } catch (error) {
        manifest.contents[name] = { complete: false, error: error.message };
        manifest.errors.push(`${name}: ${error.message}`);
        console.error(`PARTIAL ${name}: ${error.message}`);
      }
    }
    manifest.status = manifest.errors.length || Object.values(manifest.contents).some(item => !item.complete) ? 'PARTIAL' : trial ? 'TRIAL' : 'COMPLETE';
    await writeFile(join(rawDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(rawDir, 'RECOVER.md'), '# PortaBase recovery capsule\n\nRestore only into a fresh, explicitly confirmed Supabase target. Run `portabase restore --capsule <directory>` for a dry-run recovery plan.\n');
    const tar = resolveTool('tar');
    if (!tar) throw new Error('tar is required to create the encrypted capsule.');
    await run(tar, ['-czf', archive, '-C', rawDir, '.']);
    await mkdir(capsuleDir, { recursive: false });
    const encryption = await encryptFile(archive, join(capsuleDir, 'capsule.pbase'), passphrase, id);
    const capsuleMetadata = {
      formatVersion: 1,
      id,
      edition: manifest.edition,
      licenseId: entitlement.license.valid ? entitlement.license.payload.licenseId : null,
      projectRef: config.projectRef,
      createdAt: manifest.createdAt,
      status: manifest.status,
      contents: manifest.contents,
      errors: manifest.errors,
      encryption,
    };
    await writeFile(join(capsuleDir, 'capsule.json'), `${JSON.stringify(capsuleMetadata, null, 2)}\n`);
    await writeFile(join(capsuleDir, 'RECOVER.txt'), 'This capsule is encrypted. Keep PORTABASE_ENCRYPTION_PASSPHRASE outside the backup destination. Use PortaBase restore without --execute to inspect the recovery plan.\n');
    if (trial) await writeTrialReport(capsuleDir, capsuleMetadata);
    await writeChecksums(capsuleDir);
    const transfer = await transferCapsule(config, capsuleDir);
    const state = { state: manifest.status, capsule: id, completedAt: new Date().toISOString(), destination: transfer.destination, verified: transfer.verified, errors: manifest.errors };
    await writeStatus(config, state);
    await sendAlert(config, state);
    console.log(`\n${manifest.status}: ${capsuleDir}`);
    console.log(`VERIFIED DESTINATION: ${transfer.destination}`);
    if (trial) console.log(`TRIAL REPORT: ${join(capsuleDir, 'TRIAL-REPORT.html')}`);
    if (!['COMPLETE', 'TRIAL'].includes(manifest.status)) process.exitCode = 3;
  } catch (error) {
    const state = { state: 'FAILED', capsule: id, failedAt: new Date().toISOString(), error: error.message };
    await writeStatus(config, state);
    await sendAlert(config, state);
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function verify() {
  const capsuleDir = resolve(flag('capsule', argv[1] || '.'));
  const results = await verifyChecksumFile(capsuleDir, join(capsuleDir, 'checksums.sha256'));
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.path}`);
  let failures = results.filter(item => !item.ok).length;
  if (hasFlag('decrypt')) {
    const metadata = JSON.parse(await readFile(join(capsuleDir, 'capsule.json'), 'utf8'));
    const temp = await mkdtemp(join(tmpdir(), 'portabase-verify-'));
    try {
      await decryptFile(join(capsuleDir, 'capsule.pbase'), join(temp, 'capsule.tar.gz'), process.env.PORTABASE_ENCRYPTION_PASSPHRASE, metadata.encryption);
      console.log('PASS  encryption authentication and plaintext checksum');
    } catch (error) {
      failures += 1;
      console.log(`FAIL  encryption authentication: ${error.message}`);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  console.log(`\n${failures ? 'FAILED' : 'VERIFIED'}: ${results.length - failures}/${results.length} files`);
  if (failures) process.exitCode = 4;
}

async function openCapsule(capsuleDir, passphrase) {
  const metadata = JSON.parse(await readFile(join(capsuleDir, 'capsule.json'), 'utf8'));
  const temp = await mkdtemp(join(tmpdir(), 'portabase-restore-'));
  const archive = join(temp, 'capsule.tar.gz');
  const extracted = join(temp, 'extracted');
  await mkdir(extracted);
  await decryptFile(join(capsuleDir, 'capsule.pbase'), archive, passphrase, metadata.encryption);
  const tar = resolveTool('tar');
  if (!tar) throw new Error('tar is required to inspect a capsule.');
  await run(tar, ['-xzf', archive, '-C', extracted]);
  const manifest = JSON.parse(await readFile(join(extracted, 'manifest.json'), 'utf8'));
  return { metadata, manifest, extracted, temp };
}

async function materializeCapsule(value) {
  if (!String(value).startsWith('s3://')) return { capsuleDir: resolve(value), cleanup: null };
  const aws = resolveTool('aws');
  if (!aws) throw new Error('AWS CLI is required to retrieve an S3 recovery capsule.');
  const temp = await mkdtemp(join(tmpdir(), 'portabase-s3-'));
  const capsuleDir = join(temp, 'capsule');
  await mkdir(capsuleDir);
  await run(aws, ['s3', 'cp', value, capsuleDir, '--recursive', '--only-show-errors', '--checksum-mode', 'ENABLED']);
  return { capsuleDir, cleanup: temp };
}

function targetFetch(path, options = {}) {
  const url = projectBaseUrl(process.env.PORTABASE_TARGET_SUPABASE_URL);
  const key = process.env.PORTABASE_TARGET_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('PORTABASE_TARGET_SUPABASE_URL and PORTABASE_TARGET_SERVICE_ROLE_KEY are required.');
  return fetch(`${url}${path}`, { ...options, headers: supabaseHeaders(key, options.headers || {}) });
}

async function restoreDatabase(extracted) {
  const psql = resolveTool('psql');
  const targetDb = process.env.PORTABASE_TARGET_DB_URL;
  if (!psql || !targetDb) throw new Error('psql and PORTABASE_TARGET_DB_URL are required for database restore.');
  const applied = [];
  for (const file of ['roles.sql', 'schema.sql', 'data.sql']) {
    const path = join(extracted, 'database', file);
    if (existsSync(path)) {
      await run(psql, [targetDb, '--set', 'ON_ERROR_STOP=1', '--file', path]);
      applied.push(file);
    }
  }
  return { applied };
}

async function restoreStorage(extracted) {
  const manifestPath = join(extracted, 'storage', 'storage-manifest.json');
  if (!existsSync(manifestPath)) return { verified: false, reason: 'Storage manifest is missing.', bucketCount: 0, objectCount: 0, hashesVerified: 0 };
  const storage = JSON.parse(await readFile(manifestPath, 'utf8'));
  let hashesVerified = 0;
  for (const bucket of storage.buckets) {
    const created = await targetFetch('/storage/v1/bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket.id, name: bucket.name, public: bucket.public, file_size_limit: bucket.fileSizeLimit, allowed_mime_types: bucket.allowedMimeTypes }),
    });
    if (!created.ok) throw new Error(`Unable to create blank-target bucket ${bucket.id}: HTTP ${created.status}`);
    for (const object of bucket.objects) {
      const source = join(extracted, 'storage', safeObjectPath(bucket.id), safeObjectPath(object.name));
      const objectPath = object.name.split('/').map(encodeURIComponent).join('/');
      const response = await targetFetch(`/storage/v1/object/${encodeURIComponent(bucket.id)}/${objectPath}`, {
        method: 'POST',
        headers: { 'Content-Type': object.contentType || 'application/octet-stream', 'x-upsert': 'false' },
        body: createReadStream(source),
        duplex: 'half',
      });
      if (!response.ok) throw new Error(`Unable to restore blank-target object ${bucket.id}/${object.name}: HTTP ${response.status}`);
      const readback = await targetFetch(`/storage/v1/object/authenticated/${encodeURIComponent(bucket.id)}/${objectPath}`);
      if (!readback.ok) throw new Error(`Unable to read back ${bucket.id}/${object.name}: HTTP ${readback.status}`);
      const remoteHash = createHash('sha256').update(Buffer.from(await readback.arrayBuffer())).digest('hex');
      const expectedHash = object.sha256 || await hashFile(source);
      if (remoteHash !== expectedHash) throw new Error(`Read-back hash mismatch for ${bucket.id}/${object.name}.`);
      hashesVerified += 1;
    }
  }
  return { verified: hashesVerified === Number(storage.objectCount || 0), bucketCount: storage.buckets.length, objectCount: storage.objectCount, hashesVerified };
}

async function restoreFunctions(extracted, manifest, targetRef) {
  const functions = manifest.contents.functions;
  if (!functions?.complete) return { verified: false, reason: functions?.reason || functions?.error || 'Function capture was incomplete.', expected: [], active: [] };
  if (!functions.names?.length) return { verified: true, expected: [], active: [] };
  const supabase = resolveTool('supabase');
  if (!supabase || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Supabase CLI and SUPABASE_ACCESS_TOKEN are required to restore Edge Functions.');
  for (const name of functions.names) {
    const workdir = join(extracted, 'functions');
    await run(supabase, ['functions', 'deploy', name, '--project-ref', targetRef, '--workdir', workdir], { cwd: workdir, env: process.env });
  }
  const result = spawnSync(supabase, ['functions', 'list', '--project-ref', targetRef, '--output', 'json'], {
    encoding: 'utf8', env: process.env, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Unable to verify restored Edge Functions: ${(result.stderr || '').trim().slice(0, 300)}`);
  const active = JSON.parse(result.stdout || '[]').map(fn => fn.name);
  const missing = functions.names.filter(name => !active.includes(name));
  return { verified: missing.length === 0, expected: functions.names, active, missing };
}

async function verifyRestoredDatabase(extracted, limited = false) {
  const expectedPath = join(extracted, 'database', 'database-inventory.json');
  if (!existsSync(expectedPath)) return { verified: false, reason: 'Source database inventory is missing.' };
  const expectedSource = JSON.parse(await readFile(expectedPath, 'utf8'));
  const expected = limited ? {
    ...expectedSource,
    tables: (expectedSource.tables || []).map(table => ({ ...table, rows: 0 })),
    authUsers: 0,
  } : expectedSource;
  const actual = await captureDatabaseInventory(process.env.PORTABASE_TARGET_DB_URL);
  return { ...compareDatabaseInventories(expected, actual), expected, actual };
}

const MANUAL_RECOVERY_ACTIONS = [
  'Replace application Supabase URL and publishable/anonymous key.',
  'Reconfigure Auth providers, redirect URLs, email templates, and SMTP.',
  'Re-enter Edge Function and webhook secrets that were intentionally not exported.',
  'Review Realtime publications, cron schedules, queues, and external integrations.',
  'Reconfigure custom domains and perform the customer-controlled DNS cutover.',
  'Run application-specific smoke tests before sending production traffic.',
];

function evidenceHtml(report) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const checks = [
    ['Database', report.database?.verified, report.database?.verified ? `${report.database.actualTableCount} tables and ${report.database.actualRows} rows matched` : report.database?.reason || 'Not verified'],
    ['Storage', report.storage?.verified, report.storage?.verified ? `${report.storage.hashesVerified} object hashes matched` : report.storage?.reason || 'Not verified'],
    ['Edge Functions', report.functions?.verified, report.functions?.verified ? `${report.functions.active?.length || 0} Functions verified` : report.functions?.reason || 'Not verified'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PortaBase recovery evidence</title><style>body{margin:0;background:#0d0e11;color:#f7f6f1;font-family:Segoe UI,sans-serif}.wrap{width:min(900px,calc(100% - 32px));margin:48px auto}.status{padding:24px;border:1px solid #34353a;background:#17181c}small{font:11px Consolas,monospace;color:#c9ff4a;letter-spacing:.1em}h1{font-size:42px;margin:12px 0}.meta{color:#92938f;line-height:1.7}.checks{display:grid;gap:1px;background:#34353a;margin:28px 0}.check{background:#17181c;padding:20px}.check b{display:block;font-size:18px}.pass{color:#c9ff4a}.fail{color:#ff4b3e}.manual{padding:24px;background:#f2f0e8;color:#17181c}.manual li{margin:10px 0;line-height:1.5}code{word-break:break-all}</style></head><body><main class="wrap"><section class="status"><small>PORTABASE RECOVERY EVIDENCE</small><h1 class="${report.status.includes('VERIFIED') || report.status.includes('PASSED') ? 'pass' : 'fail'}">${escape(report.status)}</h1><div class="meta">Capsule: <code>${escape(report.capsuleId)}</code><br>Source: ${escape(report.sourceProjectRef)}<br>Target: ${escape(report.targetProjectRef || 'Not selected')}<br>Started: ${escape(report.startedAt)}<br>Completed: ${escape(report.completedAt)}</div></section><section class="checks">${checks.map(([name, ok, note]) => `<div class="check"><b class="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'NOT VERIFIED'} · ${escape(name)}</b><span>${escape(note)}</span></div>`).join('')}</section><section class="manual"><h2>Manual work still required</h2><ol>${MANUAL_RECOVERY_ACTIONS.map(item => `<li>${escape(item)}</li>`).join('')}</ol></section></main></body></html>`;
}

async function writeRecoveryEvidence(report) {
  const directory = resolve(process.env.PORTABASE_EVIDENCE_DIRECTORY || './portabase-evidence');
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const base = `${report.capsuleId || 'unknown-capsule'}-${stamp}`;
  const completed = { ...report, completedAt: report.completedAt || new Date().toISOString(), manualActions: MANUAL_RECOVERY_ACTIONS };
  const jsonPath = join(directory, `${base}.json`);
  const htmlPath = join(directory, `${base}.html`);
  await writeFile(jsonPath, `${JSON.stringify(completed, null, 2)}\n`, { flag: 'wx' });
  await writeFile(htmlPath, evidenceHtml(completed), { flag: 'wx' });
  console.log(`\nRECOVERY EVIDENCE: ${jsonPath}`);
  console.log(`HUMAN REPORT: ${htmlPath}`);
  return { jsonPath, htmlPath };
}

async function readTargetInventory(targetRef) {
  const psql = resolveTool('psql');
  const supabase = resolveTool('supabase');
  const targetDb = process.env.PORTABASE_TARGET_DB_URL;
  if (!psql || !targetDb) throw new Error('Target preflight requires psql and PORTABASE_TARGET_DB_URL.');
  if (!supabase || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Target preflight requires the Supabase CLI and SUPABASE_ACCESS_TOKEN.');
  const tableQuery = "select count(*) from pg_catalog.pg_tables where schemaname !~ '^(pg_.*|information_schema|_analytics|_realtime|_supavisor|auth|cron|dbdev|extensions|graphql|graphql_public|net|pgbouncer|pgmq|pgsodium|pgsodium_masks|pgtle|realtime|repack|storage|supabase_functions|supabase_migrations|tiger|tiger_data|timescaledb_.*|_timescaledb_.*|topology|vault)$';";
  const tableResult = spawnSync(psql, ['--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', tableQuery], {
    encoding: 'utf8', windowsHide: true, env: postgresEnvironment(targetDb),
  });
  if (tableResult.status !== 0) throw new Error(`Unable to inspect target tables: ${(tableResult.stderr || '').trim().slice(0, 240)}`);
  const tableCount = Number(tableResult.stdout.trim());
  if (!Number.isInteger(tableCount)) throw new Error('Target table inspection returned an invalid count.');

  const [bucketsResponse, usersResponse] = await Promise.all([
    targetFetch('/storage/v1/bucket', { signal: AbortSignal.timeout(10000) }),
    targetFetch('/auth/v1/admin/users?page=1&per_page=1', { signal: AbortSignal.timeout(10000) }),
  ]);
  if (!bucketsResponse.ok) throw new Error(`Target Storage inspection failed: HTTP ${bucketsResponse.status}`);
  if (!usersResponse.ok) throw new Error(`Target Auth inspection failed: HTTP ${usersResponse.status}`);
  const buckets = await bucketsResponse.json();
  const users = await usersResponse.json();
  const functionsResult = spawnSync(supabase, ['functions', 'list', '--project-ref', targetRef, '--output', 'json'], {
    encoding: 'utf8', windowsHide: true, env: process.env,
  });
  if (functionsResult.status !== 0) throw new Error(`Target Function inspection failed: ${(functionsResult.stderr || '').trim().slice(0, 240)}`);
  let functions;
  try { functions = JSON.parse(functionsResult.stdout || '[]'); } catch { throw new Error('Target Function inspection returned invalid JSON.'); }
  const inventory = {
    applicationTables: tableCount,
    authUsers: Array.isArray(users?.users) ? users.users.length : 0,
    storageBuckets: Array.isArray(buckets) ? buckets.length : 0,
    edgeFunctions: Array.isArray(functions) ? functions.length : 0,
  };
  return inventory;
}

async function inspectRestoreTarget(targetRef) {
  return validateBlankRestoreInventory(await readTargetInventory(targetRef));
}

async function restore() {
  const materialized = await materializeCapsule(flag('capsule', argv[1] || '.'));
  let opened;
  const startedAt = new Date().toISOString();
  const drill = hasFlag('drill');
  const writesTarget = hasFlag('execute') || drill;
  const mode = drill ? 'limited-drill' : hasFlag('execute') ? 'execute' : hasFlag('preflight') ? 'preflight' : 'plan';
  let evidence = { formatVersion: 1, portabaseVersion: VERSION, mode, startedAt, status: 'RUNNING' };
  try {
    opened = await openCapsule(materialized.capsuleDir, process.env.PORTABASE_ENCRYPTION_PASSPHRASE);
    const { manifest, metadata, extracted } = opened;
    evidence = {
      ...evidence,
      capsuleId: metadata.id,
      edition: manifest.edition,
      captureStatus: manifest.status,
      sourceProjectRef: manifest.projectRef,
      targetProjectRef: process.env.PORTABASE_TARGET_PROJECT_REF || null,
      captureContents: manifest.contents,
      captureErrors: manifest.errors,
    };
    console.log(`PortaBase guarded recovery plan\n\nSource: ${manifest.projectRef}\nCapsule: ${metadata.id}\nCapture status: ${manifest.status}\n`);
    if (manifest.edition === 'trial') console.log('TRIAL SAMPLE: database rows and most Storage objects/Functions are intentionally absent. This is not a complete recovery backup.\n');
    for (const name of ['database', 'storage', 'functions']) {
      const item = manifest.contents[name];
      console.log(`${item?.complete ? 'READY' : 'GAP  '}  ${name}${item?.reason ? ` — ${item.reason}` : ''}${item?.error ? ` — ${item.error}` : ''}`);
    }
    console.log('\nManual reconfiguration remains: Auth providers/templates, project API keys, Realtime settings, external secrets, custom domains, and DNS cutover.');
    if (manifest.contents.functions?.secretNames?.length) {
      console.log(`Secrets to re-create on the new project (names only; values were never exported): ${manifest.contents.functions.secretNames.join(', ')}`);
    }
    if (drill) validateDrillCapsule(manifest.edition);
    if (!writesTarget && !hasFlag('preflight')) {
      console.log('\nDRY RUN ONLY. No target was changed. Add --execute --confirm-target <NEW_REF> after reviewing this plan.');
      evidence.status = recoveryEvidenceStatus({ mode: 'plan', captureStatus: manifest.status });
      await writeRecoveryEvidence(evidence);
      return;
    }
    const targetRef = process.env.PORTABASE_TARGET_PROJECT_REF;
    validateRestoreTarget(manifest.projectRef, targetRef, writesTarget ? flag('confirm-target') : targetRef, process.env.PORTABASE_TARGET_SUPABASE_URL);
    const health = await targetFetch('/storage/v1/bucket', { signal: AbortSignal.timeout(10000) });
    if (!health.ok) throw new Error(`Target credential check failed: HTTP ${health.status}`);
    const inventory = await inspectRestoreTarget(targetRef);
    evidence.preflight = { verified: true, inventory };
    console.log(`\nTARGET PREFLIGHT PASSED: ${targetRef}`);
    console.log(`Blank inventory: ${Object.entries(inventory).map(([name, count]) => `${name}=${count}`).join(', ')}`);
    if (!writesTarget) {
      console.log('\nNO-WRITE PREFLIGHT COMPLETE. The target was not changed. Type the exact target ref and execute only after reviewing this plan.');
      evidence.status = recoveryEvidenceStatus({ mode: 'preflight', captureStatus: manifest.status });
      await writeRecoveryEvidence(evidence);
      return;
    }
    console.log(`${drill ? 'LIMITED DRILL' : 'TARGET WRITE'} CONFIRMED: ${targetRef}`);
    const databaseApplied = await restoreDatabase(extracted);
    const storage = await restoreStorage(extracted);
    const functions = await restoreFunctions(extracted, manifest, targetRef);
    const database = await verifyRestoredDatabase(extracted, drill);
    evidence.database = { ...database, applied: databaseApplied.applied };
    evidence.storage = storage;
    evidence.functions = functions;
    evidence.status = recoveryEvidenceStatus({ mode, captureStatus: manifest.status, database, storage, functions });
    if (evidence.status === 'FAILED') throw new Error('Recovery verification failed. Review the generated evidence for mismatched or unverified layers.');
    if (drill) {
      const api = await targetFetch('/rest/v1/', { headers: { Accept: 'application/openapi+json' }, signal: AbortSignal.timeout(10000) });
      if (!api.ok) throw new Error(`Restored API surface verification failed: HTTP ${api.status}`);
      const proof = await readTargetInventory(targetRef);
      console.log(`\nREAD-BACK PROOF: ${Object.entries(proof).map(([name, count]) => `${name}=${count}`).join(', ')}`);
      console.log('LIMITED RESTORE DRILL COMPLETE. Database structure/API surface, hash-verified sample Storage objects, and sample Functions were written from the trial capsule. This validates the path; it is not a complete recovery.');
    } else {
      console.log('\nRECOVERY DATA PATH VERIFIED. Finish and verify the listed manual configuration before cutover.');
    }
    await writeRecoveryEvidence(evidence);
  } catch (error) {
    evidence.status = 'FAILED';
    evidence.error = error.message;
    try { await writeRecoveryEvidence(evidence); } catch (reportError) { console.error(`Unable to write recovery evidence: ${reportError.message}`); }
    throw error;
  } finally {
    if (opened) await rm(opened.temp, { recursive: true, force: true });
    if (materialized.cleanup) await rm(materialized.cleanup, { recursive: true, force: true });
  }
}

async function status() {
  const { config } = await loadConfig();
  const path = join(resolve(config.statusDirectory || './portabase-status'), 'latest.json');
  if (!existsSync(path)) throw new Error('No backup status exists yet.');
  const current = JSON.parse(await readFile(path, 'utf8'));
  console.log(JSON.stringify(current, null, 2));
  if (!['COMPLETE', 'TRIAL', 'RUNNING'].includes(current.state)) process.exitCode = 5;
}

async function prune() {
  const { config } = await loadConfig();
  const root = resolve(config.backupDirectory || './portabase-capsules');
  const keep = Number(flag('keep', config.retention?.keepLast ?? 30));
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be an integer of at least 1.');
  if (!existsSync(root)) return console.log('No capsule directory exists.');
  const capsules = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && isCapsuleName(config.projectRef, entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();
  const candidates = capsules.slice(keep);
  console.log(`Keeping ${Math.min(keep, capsules.length)} of ${capsules.length} recognized local capsules.`);
  if (!candidates.length) return console.log('Nothing to prune.');
  for (const name of candidates) console.log(`${hasFlag('execute') ? 'DELETE' : 'WOULD DELETE'}  ${name}`);
  if (!hasFlag('execute')) return console.log('\nDRY RUN ONLY. Add --execute after reviewing the exact capsule IDs.');
  for (const name of candidates) await rm(join(root, name), { recursive: true });
}

async function installSchedule() {
  const { path, config } = await loadConfig();
  const hours = Number(flag('every-hours', config.schedule?.everyHours || 6));
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error('--every-hours must be from 1 through 24.');
  const cli = resolve(process.argv[1]);
  const node = process.execPath;
  if (process.platform !== 'win32') {
    console.log(`Cron entry (review and install yourself):\n0 */${hours} * * * "${node}" "${cli}" backup --config "${path}"`);
    return;
  }
  const scheduleDir = resolve('.portabase');
  const wrapper = join(scheduleDir, `backup-${config.projectRef}.cmd`);
  const taskName = `PortaBase Backup ${config.projectRef}`;
  console.log(`Task: ${taskName}\nEvery: ${hours} hour(s)\nWrapper: ${wrapper}`);
  if (!hasFlag('execute')) return console.log('\nDRY RUN ONLY. Add --execute to create the task. Secrets must be available as Windows user environment variables.');
  await mkdir(scheduleDir, { recursive: true });
  await writeFile(wrapper, `@echo off\r\n"${node}" "${cli}" backup --config "${path}"\r\n`);
  const schtasks = resolveTool('schtasks');
  if (!schtasks) throw new Error('Windows Task Scheduler CLI was not found.');
  await run(schtasks, ['/Create', '/TN', taskName, '/SC', 'HOURLY', '/MO', String(hours), '/TR', wrapper, '/F']);
}

async function removeSchedule() {
  const { config } = await loadConfig();
  const taskName = `PortaBase Backup ${config.projectRef}`;
  if (!hasFlag('execute')) return console.log(`DRY RUN: would remove task "${taskName}". Add --execute to continue.`);
  const schtasks = resolveTool('schtasks');
  await run(schtasks, ['/Delete', '/TN', taskName, '/F']);
}

async function plan() {
  const { config } = await loadConfig();
  console.log(`PortaBase Essentials recovery plan\n\nProject: ${config.projectRef}\nDestination: ${config.provider.type}\nEncrypted staging: ${resolve(config.backupDirectory)}\n`);
  for (const name of ['database', 'storage', 'functions']) console.log(`${config.capture?.[name] === false ? 'SKIP' : 'KEEP'}  ${name}`);
  console.log(`\nRetention: keep ${config.retention?.keepLast ?? 30}; pruning is guarded and dry-run by default.`);
  console.log('Credentials and encryption keys remain local. No PortaBase API or telemetry endpoint is contacted.');
}

function help() {
  console.log(`PortaBase ${VERSION}\n\nEncrypted, customer-owned Supabase recovery capsules. No telemetry. No credential custody.\n\nCommands:\n  init                Create a non-secret Essentials configuration\n  doctor              Test tools, credentials, destination, and live authorization\n  plan                Show the capture and destination plan\n  backup              Capture, encrypt, transfer, and verify a capsule\n                      Missing/invalid license fails closed to trial limits\n                      Add --license <file> for an offline signed paid license\n  verify              Verify checksums; add --decrypt for authenticated decryption\n  status              Show the last durable backup result\n  prune               Preview retention; add --execute to delete recognized capsules\n  install-schedule    Preview a scheduled backup; add --execute to install\n  remove-schedule     Preview task removal; add --execute to remove\n  restore             Decrypt and plan restore; execution requires two target guards\n\nRequired secrets stay in environment variables and are never written into a capsule.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (command === 'init') await init();
    else if (command === 'doctor') await doctor();
    else if (command === 'plan') await plan();
    else if (command === 'backup') await backup();
    else if (command === 'verify') await verify();
    else if (command === 'status') await status();
    else if (command === 'prune') await prune();
    else if (command === 'install-schedule') await installSchedule();
    else if (command === 'remove-schedule') await removeSchedule();
    else if (command === 'restore') await restore();
    else help();
  } catch (error) {
    console.error(`\nPortaBase failed: ${error.message}`);
    process.exitCode = 1;
  }
}
