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
  DATA_SCHEMA_EXCLUDES,
  generateFunctionRedeployScripts,
  PINNED_SUPABASE_CLI,
  schemaExcludePattern,
  shouldSkipStorageDownload,
  storageCacheKey,
  storageObjectIdentity,
  supabaseHeaders,
  mapPool,
  resolveStorageConcurrency,
  TRIAL_LIMITS,
  FIRST_PER_BUCKET_STORAGE,
  trialProtectionLedger,
  fingerprintSortedKeys,
  storageObjectKeysFromBuckets,
  storageInventoryLine,
  fingerprintsMatch,
  validateBlankRestoreInventory,
  validateDrillCapsule,
  validateRestoreTarget,
  verifyChecksumFile,
  packDirectoryTarGz,
  LOCAL_STARTER_MAX_BYTES,
  LOCAL_STARTER_MAX_LABEL,
  isLocalProvider,
  directoryByteSize,
  assertLocalStarterSize,
  localStarterPolicyNote,
  DEFAULT_RESTORE_PLAN_MAX_BYTES,
  classifyFunctionDirs,
  measureDataSqlTables,
  filterDataSqlByTables,
  buildRestorePlan,
  restorePlanSelectedBytes,
  validateRestorePlan,
  restorePlanSelectedTableKeys,
  filterStorageManifestByPlan,
  restorePlanSelectedFunctionNames,
  applyRestorePlanToExpectedInventory,
  enableCliFlag,
} from './portabase-core.mjs';
import { resolveEdition } from './license.mjs';
import { emitTelemetry } from './telemetry.mjs';

export {
  providerCommand,
  safeObjectPath,
  validateRestoreTarget,
  generateFunctionRedeployScripts,
  shouldSkipStorageDownload,
  storageObjectIdentity,
} from './portabase-core.mjs';

const VERSION = '0.4.0';
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

function progress(event) {
  if (hasFlag('progress')) console.log(`@portabase ${JSON.stringify(event)}`);
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
  const providerType = flag('provider') || await ask('Destination (google-drive, dropbox, local, aws)', 'local');
  const config = {
    version: 3,
    projectRef,
    backupDirectory: flag('directory', './portabase-capsules'),
    statusDirectory: './portabase-status',
    provider: { type: providerType },
    capture: { database: true, storage: true, functions: true },
    encryption: { passphraseEnv: 'PORTABASE_ENCRYPTION_PASSPHRASE' },
    retention: { keepLast: 14, pruneAfterBackup: true },
    schedule: { everyHours: 6 },
    cloud: {
      enabled: false,
      endpointEnv: 'PORTABASE_CLOUD_URL',
      tokenEnv: 'PORTABASE_CLOUD_TOKEN',
      agentId: null,
    },
    alerts: {
      webhookEnv: 'PORTABASE_ALERT_WEBHOOK_URL',
    },
  };
  if (['google-drive', 'dropbox', 'rclone'].includes(providerType)) {
    config.provider.remote = flag('remote') || await ask('rclone remote name', providerType === 'google-drive' ? 'gdrive' : 'dropbox');
    config.provider.path = flag('path', '/Portabase');
  } else if (providerType === 'local') {
    // Local Starter: no third-party vault required — folder on this PC / USB / NAS.
    const defaultPath = resolve('./portabase-capsules/vault');
    config.provider.path = flag('path') || await ask(
      `Local Starter vault folder (≤ ${LOCAL_STARTER_MAX_LABEL} per capsule; blank = ${defaultPath})`,
      defaultPath,
    ) || defaultPath;
    config.provider.mode = 'local-starter';
    config.provider.maxBytes = LOCAL_STARTER_MAX_BYTES;
    config.provider.allowLargeLocal = hasFlag('allow-large-local');
    console.log(`\n${localStarterPolicyNote()}`);
    console.log('Prefer Dropbox or S3 when you can — Escape fails if this disk dies with the laptop.');
  } else if (providerType === 'aws') {
    config.provider.bucket = flag('bucket') || await ask('S3 bucket name');
    config.provider.prefix = flag('prefix', 'portabase');
  } else {
    throw new Error('Supported destinations: local (starter), google-drive, dropbox, rclone, aws.');
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
  const awsNeeded = config.provider.type === 'aws';
  const nativePostgres = Boolean(resolveTool('pg_dump') && resolveTool('pg_dumpall'));
  const installHints = [];
  if (!nativePostgres && !resolveTool('supabase')) {
    installHints.push('Install PostgreSQL client tools (pg_dump) OR Supabase CLI: https://supabase.com/docs/guides/cli');
  }
  if (!resolveTool('tar')) installHints.push('Install tar (Windows: Git for Windows or bsdtar).');
  if (rcloneNeeded && !resolveTool('rclone')) installHints.push('Install rclone: https://rclone.org/install/');
  if (awsNeeded && !resolveTool('aws')) installHints.push('Install AWS CLI v2: https://docs.aws.amazon.com/cli/');
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    installHints.push('Optional: set SUPABASE_ACCESS_TOKEN for Edge Functions (CLI or Management API fallback).');
  }
  if (isLocalProvider(config)) {
    installHints.push(localStarterPolicyNote());
    installHints.push('Local Starter is for no S3/Dropbox yet. Prefer off-machine storage for real Escape.');
  } else {
    installHints.push('You provide binary storage (S3/Drive/Dropbox/NAS). Portabase Cloud never hosts capsules.');
  }
  installHints.push('After first complete backup, run: portabase replay --confirm-target <NEW_REF> (prove restore works).');

  const checks = [
    ['Postgres dump tools', nativePostgres || Boolean(resolveTool('supabase')), nativePostgres ? 'native; Docker not required' : 'Supabase CLI fallback'],
    ['Supabase CLI', Boolean(resolveTool('supabase')), `Edge Functions (pin ${PINNED_SUPABASE_CLI}; Management API fallback if missing)`],
    ['tar', Boolean(resolveTool('tar')), 'encrypted capsule packaging'],
    ['SUPABASE_DB_URL', Boolean(process.env.SUPABASE_DB_URL), 'database capture'],
    ['SUPABASE_URL', Boolean(process.env.SUPABASE_URL), 'Storage capture'],
    ['SUPABASE_SERVICE_ROLE_KEY', Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), 'Storage + Auth inventory'],
    ['SUPABASE_ACCESS_TOKEN', Boolean(process.env.SUPABASE_ACCESS_TOKEN), 'Edge Functions (recommended)'],
    ['Encryption passphrase', Boolean(process.env[config.encryption?.passphraseEnv || 'PORTABASE_ENCRYPTION_PASSPHRASE']?.length >= 16), 'minimum 16 characters · never sent to Cloud'],
    [rcloneNeeded ? 'rclone CLI' : awsNeeded ? 'AWS CLI' : 'Local Starter vault',
      rcloneNeeded ? Boolean(resolveTool('rclone')) : awsNeeded ? Boolean(resolveTool('aws')) : true,
      isLocalProvider(config)
        ? `folder on this PC/USB/NAS · max ${LOCAL_STARTER_MAX_LABEL}/capsule`
        : 'destination transfer (BYO storage)'],
  ];
  if (rcloneNeeded && resolveTool('rclone')) {
    const remotes = spawnSync(resolveTool('rclone'), ['listremotes'], { encoding: 'utf8', windowsHide: true });
    checks.push(['rclone remote', remotes.status === 0 && remotes.stdout.split(/\r?\n/).includes(`${config.provider.remote}:`), 'configured customer account']);
  }
  if (awsNeeded && config.provider.bucket) {
    checks.push(['AWS bucket configured', Boolean(config.provider.bucket), config.provider.bucket]);
  }
  if (isLocalProvider(config)) {
    const vaultPath = config.provider.path
      ? resolve(config.provider.path)
      : resolve(config.backupDirectory || './portabase-capsules');
    let vaultOk = true;
    try {
      await mkdir(vaultPath, { recursive: true });
    } catch {
      vaultOk = false;
    }
    checks.push(['Local vault path writable', vaultOk, vaultPath]);
    checks.push([
      'Local size policy',
      true,
      `refuse > ${formatBytes(config.provider.maxBytes || LOCAL_STARTER_MAX_BYTES)} unless allowLargeLocal`,
    ]);
  }
  const health = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? await authenticatedHealth() : { ok: false };
  checks.push(['Authenticated Storage read', health.ok, health.ok ? `HTTP ${health.status}` : `credential check failed${health.status ? ` (HTTP ${health.status})` : ''}`]);
  console.log(`Portabase ${VERSION} · ${config.provider.type} destination · max agents (Cloud plan): 12\n`);
  for (const [name, ok, note] of checks) console.log(`${ok ? 'PASS' : 'MISS'}  ${name.padEnd(28)} ${note}`);
  if (installHints.length) {
    console.log('\nNext steps / install hints:');
    for (const hint of installHints) console.log(`  • ${hint}`);
  }
  const optional = new Set(['SUPABASE_ACCESS_TOKEN']);
  if (checks.filter(([name]) => !optional.has(name)).some(([, ok]) => !ok)) process.exitCode = 2;
}

/** W4: simple agent registry on the runner (status directory) */
async function touchAgentRegistry(config, event = {}) {
  try {
    const dir = resolve(config.statusDirectory || './portabase-status');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'agent-registry.json');
    let registry = { formatVersion: 1, agents: [] };
    if (existsSync(path)) {
      try { registry = JSON.parse(await readFile(path, 'utf8')); } catch { /* reset */ }
    }
    const agentId = process.env.PORTABASE_AGENT_ID || config.agentId || 'local-runner';
    const entry = {
      id: agentId,
      hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown',
      projectRef: config.projectRef,
      lastEvent: event.type || 'heartbeat',
      lastCapsule: event.capsule || null,
      lastSeenAt: new Date().toISOString(),
      version: VERSION,
    };
    registry.agents = [entry, ...(registry.agents || []).filter(a => a.id !== agentId)].slice(0, 12);
    registry.updatedAt = entry.lastSeenAt;
    await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`);
  } catch { /* non-fatal */ }
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
  announceApplicationTables(dbUrl);
  const common = ['db', 'dump', '--db-url', dbUrl];
  await run(supabase, [...common, '--file', join(dbDir, 'roles.sql'), '--role-only']);
  await run(supabase, [...common, '--file', join(dbDir, 'schema.sql')]);
  if (!limits?.databaseSchemaOnly) await run(supabase, [...common, '--file', join(dbDir, 'data.sql'), '--use-copy', '--data-only']);
  const files = limits?.databaseSchemaOnly ? ['roles.sql', 'schema.sql'] : ['roles.sql', 'schema.sql', 'data.sql'];
  const inventory = resolveTool('psql') ? await captureDatabaseInventory(dbUrl, join(dbDir, 'database-inventory.json'), { estimateRows: Boolean(limits) }) : null;
  const schemaOnly = Boolean(limits?.databaseSchemaOnly);
  const summary = inventorySummary(inventory);
  const inventoryFingerprint = databaseInventoryFingerprint(inventory);
  if (inventoryFingerprint) {
    console.log(
      `Database inventory fingerprint (MD5): ${inventoryFingerprint.fingerprint} · count=${inventoryFingerprint.count}`,
    );
  }
  return {
    complete: Boolean(inventory),
    reason: inventory ? null : 'Database dump captured, but psql was unavailable for exact recovery inventory.',
    limited: schemaOnly,
    limitation: schemaOnly ? 'schema only; table rows are not included' : null,
    files,
    inventory: Boolean(inventory),
    summary,
    inventoryFingerprintMd5: inventoryFingerprint,
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

/** Non-storage fingerprint: schema.table + reported row count (order-independent). */
function databaseInventoryFingerprint(inventory) {
  if (!inventory?.tables?.length) return null;
  const lines = inventory.tables.map((table) => {
    const schema = table.schema || 'public';
    const name = table.name || table.table || '';
    const rows = Number(table.rows) || 0;
    return `${schema}.${name}\t${rows}`;
  });
  return fingerprintSortedKeys(lines, 'md5');
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

function estimateApplicationTables(dbUrl) {
  // `bytes` is pg_total_relation_size (heap + indexes + TOAST) — the only honest basis for a
  // progress meter. Row counts alone mislead badly: one 142 MB table and 400 empty ones would
  // render as "400/588 done" while almost no data has actually moved.
  const tablesJson = psqlValue(dbUrl, `SELECT COALESCE(json_agg(json_build_object('schema', schemaname, 'name', tablename, 'rows', GREATEST(c.reltuples, 0)::bigint, 'bytes', pg_total_relation_size(c.oid)::bigint) ORDER BY schemaname, tablename), '[]'::json)::text FROM pg_catalog.pg_tables t JOIN pg_catalog.pg_namespace n ON n.nspname = t.schemaname JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = t.tablename AND c.relkind IN ('r','p') WHERE ${APPLICATION_SCHEMA_SQL};`);
  const tables = JSON.parse(tablesJson || '[]');
  for (const table of tables) {
    table.rows = Number(table.rows) || 0;
    table.bytes = Number(table.bytes) || 0;
  }
  return tables;
}

function announceApplicationTables(dbUrl) {
  if (!hasFlag('progress') || !resolveTool('psql')) return;
  try {
    const tables = estimateApplicationTables(dbUrl);
    progress({
      phase: 'database-manifest',
      count: tables.length,
      totalRows: tables.reduce((total, table) => total + table.rows, 0),
      totalBytes: tables.reduce((total, table) => total + table.bytes, 0),
      tables: tables.slice(0, 120).map(table => ({ item: `${table.schema}.${table.name}`, rows: table.rows, bytes: table.bytes })),
    });
  } catch { /* the animation manifest is optional; capture proceeds regardless */ }
}

async function captureDatabaseInventory(dbUrl, outputPath = null, { estimateRows = false } = {}) {
  let tables;
  if (estimateRows) {
    tables = estimateApplicationTables(dbUrl);
  } else {
    const tablesJson = psqlValue(dbUrl, `SELECT COALESCE(json_agg(json_build_object('schema', schemaname, 'name', tablename) ORDER BY schemaname, tablename), '[]'::json)::text FROM pg_catalog.pg_tables WHERE ${APPLICATION_SCHEMA_SQL};`);
    tables = JSON.parse(tablesJson || '[]');
    for (const table of tables) {
      const count = psqlValue(dbUrl, `SELECT count(*)::text FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)};`);
      table.rows = Number(count);
      if (!Number.isSafeInteger(table.rows) || table.rows < 0) throw new Error(`Invalid row count for ${table.schema}.${table.name}.`);
      progress({ phase: 'database', item: `${table.schema}.${table.name}`, rows: table.rows });
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
    let exitCode = null;
    let closed = false;
    let processError = null;
    let outputError = null;
    let stderr = '';
    const finish = () => {
      if (!closed || (exitCode === null && !processError)) return;
      if (outputError) reject(outputError);
      else if (processError) reject(processError);
      else if (exitCode !== 0) {
        const detail = stderr.trim().slice(-2000);
        reject(new Error(`${basename(name)} exited with code ${exitCode}${detail ? `: ${detail}` : ''}`));
      } else resolveRun();
    };
    const child = spawn(name, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, ...options,
    });
    child.stdout.pipe(outputFile);
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr = `${stderr}${text}`.slice(-4000);
      process.stderr.write(text);
    });
    outputFile.once('close', () => { closed = true; finish(); });
    outputFile.once('error', error => { outputError = error; closed = true; finish(); });
    child.once('error', error => {
      processError = error;
      outputFile.destroy();
      finish();
    });
    child.once('exit', code => {
      exitCode = code ?? -1;
      finish();
    });
  });
}

async function runDumpToFile(name, commandArgs, outputPath, options = {}) {
  const configured = Number.parseInt(process.env.PORTABASE_DATABASE_DUMP_ATTEMPTS || '3', 10);
  const attempts = Number.isSafeInteger(configured) ? Math.min(Math.max(configured, 1), 5) : 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await rm(outputPath, { force: true });
    try {
      await runToFile(name, commandArgs, outputPath, options);
      return;
    } catch (error) {
      lastError = error;
      await rm(outputPath, { force: true });
      if (attempt === attempts) break;
      const delayMs = attempt * 3000;
      console.warn(`Database export attempt ${attempt}/${attempts} failed. Retrying in ${delayMs / 1000}s: ${error.message}`);
      await new Promise(resolveDelay => setTimeout(resolveDelay, delayMs));
    }
  }
  throw new Error(`Database export failed after ${attempts} attempts: ${lastError?.message || 'unknown error'}`);
}

async function transformSql(source, target, transform, prefix = '', suffix = '') {
  const writer = createWriteStream(target, { flags: 'wx' });
  try {
    if (prefix) writer.write(prefix);
    const input = createReadStream(source);
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      const changed = transform(line);
      if (changed !== null) {
        if (!writer.write(`${changed}\n`)) {
          await new Promise(resolveDrain => writer.once('drain', resolveDrain));
        }
      }
    }
    if (suffix) writer.write(suffix);
    await new Promise((resolveWrite, reject) => {
      writer.once('error', reject);
      writer.end(resolveWrite);
    });
  } catch (error) {
    writer.destroy();
    await rm(target, { force: true }).catch(() => {});
    throw new Error(`SQL transform failed for ${basename(source)}: ${error.message}`);
  }
}

// W10: single source of truth lives in portabase-core PLATFORM_SCHEMA_EXCLUDES
const SCHEMA_EXCLUDES = schemaExcludePattern();
const DATA_EXCLUDES = schemaExcludePattern(DATA_SCHEMA_EXCLUDES);
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
  announceApplicationTables(dbUrl);
  try {
    progress({ phase: 'database', item: 'roles' });
    await runDumpToFile(pgDumpAll, ['--roles-only', '--role', 'postgres', '--quote-all-identifiers', '--no-role-passwords', '--no-comments'], rawRoles, { env });
    await transformSql(rawRoles, join(dbDir, 'roles.sql'), cleanRoleLine, '', 'RESET ALL;\n');
    progress({ phase: 'database', item: 'schema' });
    await runDumpToFile(pgDump, ['--schema-only', '--quote-all-identifiers', '--role', 'postgres', '--exclude-schema', SCHEMA_EXCLUDES], rawSchema, { env });
    await transformSql(rawSchema, join(dbDir, 'schema.sql'), cleanSchemaLine);
    if (!limits?.databaseSchemaOnly) {
      progress({ phase: 'database', item: 'table rows' });
      await runDumpToFile(pgDump, ['--data-only', '--quote-all-identifiers', '--role', 'postgres', '--exclude-schema', DATA_EXCLUDES, '--exclude-table', 'auth.schema_migrations', '--exclude-table', 'storage.migrations', '--exclude-table', 'supabase_functions.migrations', '--schema', '*'], rawData, { env });
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
  const schemaOnly = Boolean(limits?.databaseSchemaOnly);
  const summary = inventorySummary(inventory);
  const inventoryFingerprint = databaseInventoryFingerprint(inventory);
  if (inventoryFingerprint) {
    console.log(
      `Database inventory fingerprint (MD5): ${inventoryFingerprint.fingerprint} · count=${inventoryFingerprint.count}`,
    );
  }
  return {
    complete: Boolean(inventory),
    reason: inventory ? null : 'Database dump captured, but psql was unavailable for exact recovery inventory.',
    limited: schemaOnly,
    limitation: schemaOnly ? 'schema only; table rows are not included' : null,
    engine: 'native-postgresql-client',
    files,
    inventory: Boolean(inventory),
    summary,
    inventoryFingerprintMd5: inventoryFingerprint,
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

function lastStorageManifestPath(config) {
  return join(resolve(config.statusDirectory || './portabase-status'), 'last-storage-manifest.json');
}

async function loadPriorStorageIndex(config) {
  // Optional resume index from previous successful capture (object identity only — not capsule bytes)
  try {
    const priorPath = lastStorageManifestPath(config);
    if (!existsSync(priorPath)) return new Map();
    const prior = JSON.parse(await readFile(priorPath, 'utf8'));
    const map = new Map();
    for (const bucket of prior.buckets || []) {
      for (const object of bucket.objects || []) {
        map.set(`${bucket.id}/${object.name}`, object);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

async function captureStorage(rawDir, limits = null, config = {}) {
  const storageDir = join(rawDir, 'storage');
  const cacheRoot = resolve(config.backupDirectory || './portabase-capsules', '.storage-object-cache');
  await mkdir(storageDir, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  const buckets = await (await checkedSourceFetch('/storage/v1/bucket')).json();
  const concurrency = resolveStorageConcurrency(config);
  const manifest = {
    capturedAt: new Date().toISOString(),
    formatVersion: 3,
    buckets: [],
    objectCount: 0,
    totalBytes: 0,
    skippedUnchanged: 0,
    cacheHits: 0,
    downloaded: 0,
    concurrency,
  };
  const inventory = { bucketCount: buckets.length, objectCount: 0, totalBytes: 0, buckets: [] };
  const listedObjects = new Map();
  const priorIndex = await loadPriorStorageIndex(config);
  const seenKeys = new Set();

  // List buckets in parallel (metadata only; nested prefix walks still sequential per bucket).
  const listResults = await mapPool(buckets, Math.min(8, concurrency), async (bucket) => {
    progress({ phase: 'scan', item: bucket.id });
    const objects = await listBucketObjects(bucket.id);
    const bytes = objects.reduce((total, object) => total + (Number(object.metadata?.size) || 0), 0);
    return { bucketId: bucket.id, objects, bytes };
  });
  const sourceObjectKeys = [];
  for (const row of listResults) {
    listedObjects.set(row.bucketId, row.objects);
    inventory.buckets.push({ id: row.bucketId, objectCount: row.objects.length, totalBytes: row.bytes });
    inventory.objectCount += row.objects.length;
    inventory.totalBytes += row.bytes;
    for (const object of row.objects) {
      const name = object.fullName || object.name;
      if (!name) continue;
      const size = Number(object.metadata?.size ?? object.metadata?.contentLength ?? object.size ?? 0) || 0;
      sourceObjectKeys.push(storageInventoryLine(row.bucketId, name, size));
    }
  }
  // Snapshot at list-time: name+reported-size inventory fingerprint (not full object bytes).
  inventory.namesFingerprintMd5 = fingerprintSortedKeys(sourceObjectKeys, 'md5');
  inventory.namesFingerprintSha256 = fingerprintSortedKeys(sourceObjectKeys, 'sha256');
  console.log(
    `Storage inventory: ${inventory.bucketCount} buckets · ${inventory.objectCount} objects · ${formatBytes(inventory.totalBytes)} · concurrency=${concurrency}`,
  );
  console.log(
    `Storage name+size snapshot (MD5): ${inventory.namesFingerprintMd5.fingerprint} · count=${inventory.namesFingerprintMd5.count}`,
  );

  // firstObjectPerBucket: every bucket, one object each (empty buckets kept in manifest with 0 objects).
  // trial: cap buckets + total objects.
  // default: all buckets, all objects.
  const selectedBuckets = limits?.firstObjectPerBucket
    ? buckets
    : limits?.maxStorageBuckets
      ? buckets.slice(0, limits.maxStorageBuckets)
      : buckets;
  // Flatten work queue so concurrency is global (not stuck on one huge bucket).
  const jobs = [];
  if (limits?.firstObjectPerBucket) {
    for (const bucket of selectedBuckets) {
      const objects = listedObjects.get(bucket.id) || [];
      if (objects.length > 0) jobs.push({ bucket, object: objects[0] });
    }
    console.log(
      `Storage sample: first object per bucket → ${jobs.length} download(s) `
      + `(of ${inventory.objectCount} source objects across ${inventory.bucketCount} buckets)`,
    );
  } else {
    for (const bucket of selectedBuckets) {
      for (const object of listedObjects.get(bucket.id) || []) {
        if (limits?.maxStorageObjects != null && jobs.length >= limits.maxStorageObjects) break;
        jobs.push({ bucket, object });
      }
      if (limits?.maxStorageObjects != null && jobs.length >= limits.maxStorageObjects) break;
    }
  }

  // Scaled sample fingerprint: first object per bucket from the listing (expected capsule set).
  // Full source fingerprint stays above; these two intentionally differ under first-per-bucket.
  const sampleExpectedKeys = jobs.map(({ bucket, object }) => {
    const name = object.fullName || object.name;
    const size = Number(object.metadata?.size ?? object.metadata?.contentLength ?? object.size ?? 0) || 0;
    return storageInventoryLine(bucket.id, name, size);
  });
  const sampleExpectedFingerprintMd5 = fingerprintSortedKeys(sampleExpectedKeys, 'md5');
  const sampleExpectedFingerprintSha256 = fingerprintSortedKeys(sampleExpectedKeys, 'sha256');
  if (limits?.firstObjectPerBucket) {
    console.log(
      `Storage sample-expected name+size (MD5): ${sampleExpectedFingerprintMd5.fingerprint} · count=${sampleExpectedFingerprintMd5.count} `
      + `(full source count=${inventory.namesFingerprintMd5.count} — fingerprints differ by design)`,
    );
  }

  let completed = 0;
  const startedAt = Date.now();
  async function copyBestEffort(src, dest, { retries = 4 } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await mkdir(dirname(dest), { recursive: true });
        await cp(src, dest, { force: true });
        return true;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await new Promise(r => setTimeout(r, 25 * attempt));
      }
    }
    throw lastErr;
  }

  const objectResults = await mapPool(jobs, concurrency, async ({ bucket, object }) => {
    const identity = storageObjectIdentity(object);
    const key = `${bucket.id}/${object.fullName}`;
    seenKeys.add(key);
    const target = join(storageDir, safeObjectPath(bucket.id), safeObjectPath(object.fullName));
    await mkdir(dirname(target), { recursive: true });
    const prior = priorIndex.get(key) || null;
    let skipped = false;
    let fromCache = false;
    const tentativeCache = storageCacheKey(identity, prior?.sha256 || '');
    const identityOnlyKey = storageCacheKey(identity, '');

    // Cache is best-effort: never fail the backup because of cache I/O races on Windows.
    try {
      const lookupKeys = [prior?.sha256, tentativeCache, identityOnlyKey].filter(Boolean);
      for (const keyHash of lookupKeys) {
        if (fromCache) break;
        const candidate = join(cacheRoot, String(keyHash).slice(0, 2), String(keyHash));
        if (!existsSync(candidate)) continue;
        const cached = await stat(candidate);
        if (Number(identity.size) > 0 && Number(cached.size) !== Number(identity.size)) continue;
        await copyBestEffort(candidate, target);
        fromCache = true;
        skipped = true;
      }
    } catch {
      fromCache = false;
      skipped = false;
    }

    if (!fromCache && existsSync(target)) {
      try {
        const local = await stat(target);
        if (shouldSkipStorageDownload(local, identity, prior)) {
          skipped = true;
        }
      } catch { /* re-download */ }
    }
    if (!skipped && !fromCache) {
      const objectPath = object.fullName.split('/').map(encodeURIComponent).join('/');
      let response = await sourceFetch(`/storage/v1/object/authenticated/${encodeURIComponent(bucket.id)}/${objectPath}`);
      if (!response.ok) {
        response = await sourceFetch(`/storage/v1/object/${encodeURIComponent(bucket.id)}/${objectPath}`);
      }
      if (!response.ok) {
        throw new Error(`Unable to download storage object ${bucket.id}/${object.fullName}: HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: 'w' }));
    }
    const info = await stat(target);
    const sha256 = await hashFile(target);
    // Dual-key cache promote — best-effort only
    try {
      const cacheKeys = new Set([storageCacheKey(identity, sha256), identityOnlyKey].filter(Boolean));
      for (const keyHash of cacheKeys) {
        const destCache = join(cacheRoot, keyHash.slice(0, 2), keyHash);
        if (existsSync(destCache)) continue;
        const tmp = `${destCache}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
        try {
          await mkdir(dirname(destCache), { recursive: true });
          await cp(target, tmp, { force: true });
          await rename(tmp, destCache);
        } catch {
          await rm(tmp, { force: true }).catch(() => {});
        }
      }
    } catch { /* cache is optional */ }

    completed += 1;
    if (completed % 50 === 0 || completed === jobs.length) {
      const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
      const rate = (completed / elapsedSec).toFixed(1);
      console.log(`Storage progress: ${completed}/${jobs.length} objects (${rate}/s) · concurrency=${concurrency}`);
    }
    progress({
      phase: 'storage',
      item: `${bucket.id}/${object.fullName}${fromCache ? ' (cache)' : skipped ? ' (resume)' : ''}`,
      bytes: info.size,
      completed,
      total: jobs.length,
    });
    return {
      bucketId: bucket.id,
      entry: {
        name: object.fullName,
        size: info.size,
        sha256,
        updatedAt: identity.updatedAt,
        etag: identity.etag,
        contentType: identity.contentType || null,
        resumed: skipped || fromCache,
        cacheHit: fromCache,
        downloaded: !skipped && !fromCache,
      },
    };
  });

  const byBucket = new Map();
  for (const bucket of selectedBuckets) {
    byBucket.set(bucket.id, {
      id: bucket.id,
      name: bucket.name,
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit ?? null,
      allowedMimeTypes: bucket.allowed_mime_types ?? null,
      objects: [],
    });
  }
  for (const result of objectResults) {
    if (!result) continue;
    const record = byBucket.get(result.bucketId);
    if (!record) continue;
    record.objects.push(result.entry);
    if (result.entry.cacheHit) manifest.cacheHits += 1;
    else if (result.entry.resumed) manifest.skippedUnchanged += 1;
    else if (result.entry.downloaded) manifest.downloaded += 1;
    manifest.objectCount += 1;
    manifest.totalBytes += result.entry.size;
  }
  for (const bucket of selectedBuckets) {
    const record = byBucket.get(bucket.id);
    if (record) manifest.buckets.push(record);
  }

  // W8: reconcile — drop prior keys no longer present (stale index entries)
  manifest.reconciledDropped = [...priorIndex.keys()].filter(k => !seenKeys.has(k)).length;
  // Capsule-side fingerprint: only objects actually written into this capsule
  const capsuleObjectKeys = storageObjectKeysFromBuckets(manifest.buckets);
  manifest.capsuleNamesFingerprintMd5 = fingerprintSortedKeys(capsuleObjectKeys, 'md5');
  manifest.capsuleNamesFingerprintSha256 = fingerprintSortedKeys(capsuleObjectKeys, 'sha256');
  // Source-side fingerprint: full listing snapshot from backup start (may be larger when sampling)
  manifest.sourceNamesFingerprintMd5 = inventory.namesFingerprintMd5;
  manifest.sourceNamesFingerprintSha256 = inventory.namesFingerprintSha256;
  // Scaled expected sample (first-per-bucket plan at list time) — should match capsule when downloads succeed
  manifest.sampleExpectedNamesFingerprintMd5 = sampleExpectedFingerprintMd5;
  manifest.sampleExpectedNamesFingerprintSha256 = sampleExpectedFingerprintSha256;
  manifest.sampleMatchesCapsule = fingerprintsMatch(
    sampleExpectedFingerprintMd5,
    manifest.capsuleNamesFingerprintMd5,
  );
  manifest.sourceInventory = inventory;
  const manifestPath = join(storageDir, 'storage-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let limitation = null;
  if (limits?.firstObjectPerBucket) {
    limitation = `first object per bucket (${manifest.objectCount} of ${inventory.objectCount} source objects; ${inventory.bucketCount} buckets)`;
  } else if (limits) {
    limitation = `first ${limits.maxStorageObjects} objects across ${limits.maxStorageBuckets} buckets`;
  }
  console.log(
    `Storage capsule name+size (MD5): ${manifest.capsuleNamesFingerprintMd5.fingerprint} · count=${manifest.capsuleNamesFingerprintMd5.count}`
    + (limits?.firstObjectPerBucket
      ? ` · sample-expected MD5=${sampleExpectedFingerprintMd5.fingerprint}`
        + ` match=${manifest.sampleMatchesCapsule}`
        + ` · full-source MD5=${manifest.sourceNamesFingerprintMd5.fingerprint}`
        + ` (count=${manifest.sourceNamesFingerprintMd5.count}, not expected to match sample)`
      : limits
        ? ` · source inventory MD5=${manifest.sourceNamesFingerprintMd5.fingerprint} (count=${manifest.sourceNamesFingerprintMd5.count})`
        : ''),
  );
  return {
    complete: true,
    limited: Boolean(limits?.firstObjectPerBucket || limits?.maxStorageObjects != null),
    limitation,
    bucketCount: manifest.buckets.length,
    objectCount: manifest.objectCount,
    totalBytes: manifest.totalBytes,
    skippedUnchanged: manifest.skippedUnchanged,
    cacheHits: manifest.cacheHits,
    downloaded: manifest.downloaded,
    concurrency,
    inventory,
    namesFingerprintMd5: manifest.capsuleNamesFingerprintMd5,
    sourceNamesFingerprintMd5: manifest.sourceNamesFingerprintMd5,
    sampleExpectedNamesFingerprintMd5: sampleExpectedFingerprintMd5,
    sampleMatchesCapsule: manifest.sampleMatchesCapsule,
    manifestPath,
  };
}

async function managementApiJson(path, { method = 'GET', body } = {}) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN required for Management API');
  const response = await fetch(`https://api.supabase.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Management API ${response.status}: ${String(text).slice(0, 240)}`);
  return data;
}

/** W2: Management API fallback when Supabase CLI download fails */
async function captureFunctionViaManagementApi(projectRef, name, fnRoot) {
  await mkdir(fnRoot, { recursive: true });
  const details = await managementApiJson(`/v1/projects/${projectRef}/functions/${encodeURIComponent(name)}`);
  const body = await managementApiJson(`/v1/projects/${projectRef}/functions/${encodeURIComponent(name)}/body`);
  const entry = typeof body === 'string' ? body
    : body?.body || body?.source || body?.entrypoint_path
      ? (typeof body.body === 'string' ? body.body : JSON.stringify(body, null, 2))
      : JSON.stringify(body, null, 2);
  // Prefer index.ts layout CLI expects
  const mainFile = join(fnRoot, 'index.ts');
  await writeFile(mainFile, entry);
  await writeFile(join(fnRoot, 'metadata.json'), `${JSON.stringify({
    name,
    verify_jwt: details?.verify_jwt !== false,
    import_map: details?.import_map || null,
    source: 'management-api',
  }, null, 2)}\n`);
  return { verifyJwt: details?.verify_jwt !== false, via: 'management-api' };
}

async function captureFunctions(config, rawDir, limits = null) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) return { complete: false, skipped: true, reason: 'SUPABASE_ACCESS_TOKEN not provided' };
  const supabase = resolveTool('supabase');
  const functionsDir = join(rawDir, 'functions');
  await mkdir(functionsDir, { recursive: true });

  let availableFunctions = [];
  let listVia = 'cli';
  if (supabase) {
    const result = spawnSync(supabase, ['functions', 'list', '--project-ref', config.projectRef, '--output', 'json', '--workdir', functionsDir], {
      encoding: 'utf8', env: process.env, windowsHide: true, cwd: functionsDir,
    });
    if (result.status === 0) {
      availableFunctions = JSON.parse(result.stdout || '[]');
    } else {
      listVia = 'management-api';
      availableFunctions = await managementApiJson(`/v1/projects/${config.projectRef}/functions`);
      if (!Array.isArray(availableFunctions)) availableFunctions = availableFunctions?.functions || [];
    }
  } else {
    listVia = 'management-api';
    availableFunctions = await managementApiJson(`/v1/projects/${config.projectRef}/functions`);
    if (!Array.isArray(availableFunctions)) availableFunctions = availableFunctions?.functions || [];
  }

  const functions = (limits?.maxFunctions != null)
    ? availableFunctions.slice(0, limits.maxFunctions)
    : availableFunctions;
  const functionMeta = [];
  for (const fn of functions) {
    const name = fn.name || fn.slug;
    progress({ phase: 'functions', item: name });
    const fnRoot = join(functionsDir, name);
    let via = 'cli';
    let verifyJwt = fn.verify_jwt !== false && fn.verifyJwt !== false;
    try {
      if (!supabase) throw new Error('no_cli');
      await run(supabase, ['functions', 'download', name, '--project-ref', config.projectRef, '--workdir', functionsDir], { cwd: functionsDir, env: process.env });
    } catch (error) {
      // W2 fallback — skip missing/ghost functions instead of failing the whole layer
      try {
        const fallback = await captureFunctionViaManagementApi(config.projectRef, name, fnRoot);
        via = fallback.via;
        verifyJwt = fallback.verifyJwt;
      } catch (fallbackError) {
        const msg = fallbackError.message || String(fallbackError);
        if (/404|not found/i.test(msg)) {
          console.warn(`Skipping function ${name}: not found (stale list entry).`);
          functionMeta.push({ name, verifyJwt, files: [], captureVia: 'skipped-missing', error: msg });
          continue;
        }
        throw fallbackError;
      }
    }
    const files = [];
    if (existsSync(fnRoot)) {
      for (const filePath of await listFiles(fnRoot)) {
        files.push({
          path: relative(fnRoot, filePath).split(sep).join('/'),
          bytes: (await stat(filePath)).size,
          sha256: await hashFile(filePath),
        });
      }
    }
    functionMeta.push({ name, verifyJwt, files, captureVia: via });
  }

  const redeploy = generateFunctionRedeployScripts(
    functionMeta.map(fn => ({ name: fn.name, verifyJwt: fn.verifyJwt })),
    { projectRef: config.projectRef, supabaseCliVersion: PINNED_SUPABASE_CLI },
  );
  const functionsManifest = {
    ...redeploy.manifest,
    functions: functionMeta,
    secretNames: listSecretNames(supabase, config.projectRef),
  };
  await writeFile(join(functionsDir, 'functions-manifest.json'), `${JSON.stringify(functionsManifest, null, 2)}\n`);
  await writeFile(join(functionsDir, 'REDEPLOY-ALL.ps1'), redeploy.ps1);
  await writeFile(join(functionsDir, 'redeploy-all.sh'), redeploy.bash);

  const functionsLimited = limits?.maxFunctions != null;
  // Non-storage fingerprint: function name + file path + content sha256
  const functionFpLines = [];
  for (const fn of functionMeta) {
    if (!fn.name) continue;
    if (!fn.files?.length) {
      functionFpLines.push(`${fn.name}\t0`);
      continue;
    }
    for (const file of fn.files) {
      functionFpLines.push(`${fn.name}/${file.path}\t${file.sha256 || file.bytes || 0}`);
    }
  }
  const inventoryFingerprintMd5 = fingerprintSortedKeys(functionFpLines, 'md5');
  console.log(
    `Functions inventory fingerprint (MD5): ${inventoryFingerprintMd5.fingerprint} · count=${inventoryFingerprintMd5.count}`,
  );
  return {
    complete: true,
    limited: functionsLimited,
    limitation: functionsLimited ? `first ${limits.maxFunctions} Functions` : null,
    count: functions.length,
    names: functionMeta.map(fn => fn.name),
    verifyJwt: Object.fromEntries(functionMeta.map(fn => [fn.name, fn.verifyJwt])),
    availableCount: availableFunctions.length,
    available: availableFunctions.map(fn => fn.name || fn.slug),
    secretNames: functionsManifest.secretNames,
    redeployScripts: ['REDEPLOY-ALL.ps1', 'redeploy-all.sh'],
    manifestFile: 'functions-manifest.json',
    listVia,
    supabaseCliVersion: PINNED_SUPABASE_CLI,
    inventoryFingerprintMd5,
  };
}

/** W3: Auth inventory (no passwords) — recovery checklist layer */
async function captureAuth(config, rawDir) {
  const authDir = join(rawDir, 'auth');
  await mkdir(authDir, { recursive: true });
  const inventory = { capturedAt: new Date().toISOString(), users: [], count: 0, note: 'Passwords and provider secrets are never exported.' };
  try {
    // Prefer Auth Admin API via service role
    const response = await sourceFetch('/auth/v1/admin/users?page=1&per_page=200');
    if (response.ok) {
      const data = await response.json();
      const users = data.users || data || [];
      if (Array.isArray(users)) {
        inventory.users = users.slice(0, 500).map(u => ({
          id: u.id,
          email: u.email || null,
          phone: u.phone || null,
          role: u.role || null,
          created_at: u.created_at || null,
          last_sign_in_at: u.last_sign_in_at || null,
          providers: (u.app_metadata?.providers || u.identities?.map(i => i.provider) || []).filter(Boolean),
        }));
        inventory.count = inventory.users.length;
        inventory.truncated = true;
      }
    } else {
      inventory.truncated = false;
      inventory.reason = `Auth admin list HTTP ${response.status}`;
    }
  } catch (error) {
    inventory.truncated = false;
    inventory.reason = error.message;
  }
  // Always write cutover checklist (threats: false confidence mitigation)
  const checklist = [
    '# Auth cutover checklist (manual — by design)',
    '',
    `- Project: ${config.projectRef}`,
    `- Users inventoried: ${inventory.count} (ids/emails only; no password hashes exported)`,
    '',
    '## Must reconfigure on the NEW project before cutover',
    '- [ ] Auth providers (Google, GitHub, Apple, etc.) client IDs/secrets',
    '- [ ] Site URL + redirect URLs',
    '- [ ] SMTP / email templates',
    '- [ ] MFA policies',
    '- [ ] Hook / SMS provider secrets',
    '',
    'Portabase restores application data and Storage/Functions; Auth *configuration* stays with you.',
    '',
  ].join('\n');
  await writeFile(join(authDir, 'auth-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  await writeFile(join(authDir, 'AUTH-CUTOVER.md'), checklist);
  // Non-storage fingerprint: auth user id + email (no secrets)
  const authFpLines = (inventory.users || []).map((u) => `${u.id || ''}\t${u.email || ''}`);
  const inventoryFingerprintMd5 = fingerprintSortedKeys(authFpLines, 'md5');
  console.log(
    `Auth inventory fingerprint (MD5): ${inventoryFingerprintMd5.fingerprint} · count=${inventoryFingerprintMd5.count}`,
  );
  return {
    complete: inventory.truncated !== false,
    partial: !inventory.truncated,
    count: inventory.count,
    checklist: 'AUTH-CUTOVER.md',
    inventoryFile: 'auth-inventory.json',
    reason: inventory.reason || null,
    inventoryFingerprintMd5,
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
  const purchaseUrl = process.env.PORTABASE_PURCHASE_URL || 'https://portabase.dev/cloud';
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
<title>Portabase trial result</title><style>body{margin:0;background:#090a0c;color:#fff;font-family:Segoe UI,sans-serif}.card{width:min(860px,calc(100% - 32px));margin:6vh auto;background:#141519;border:1px solid #303136;padding:40px;box-sizing:border-box}small{font:11px Consolas,monospace;color:#ff4b3e;letter-spacing:.12em}h1{font-size:44px;line-height:1;margin:18px 0}p{color:#aaa;line-height:1.65}table{width:100%;border-collapse:collapse;margin:30px 0;background:#101115}td,th{border:1px solid #303136;padding:14px 16px;text-align:left;vertical-align:top}th{font:11px Consolas,monospace;letter-spacing:.1em;color:#888}td b{display:block;font-size:15px}td span{display:block;font-size:11px;color:#82837e;margin-top:6px;max-width:340px}td i{font-style:normal;font-size:10px;color:#6d6e72;text-transform:uppercase}tr.exposed td:nth-child(2){color:#ff7066;font-weight:700}tr.exposed td:nth-child(3){color:#ff4b3e;font-weight:700}tr.saved td:nth-child(3){color:#c9ff4a;font-weight:700}tr.design td{color:#9a9b96}.recover{border-left:3px solid #ff4b3e;padding:15px 20px;background:#1b1515;font-size:15px;line-height:1.6}.privacy{border:1px solid #2c3f1d;background:#131a0d;padding:13px 18px;margin-top:22px;color:#a8c47e;font-size:12px;line-height:1.6}.secrets{margin-top:22px;padding:18px;border:1px solid #303136;background:#101115}.secrets b{font-size:13px}.secrets code{display:block;margin-top:10px;color:#8fb0c9;font-size:12px;line-height:1.8;word-break:break-all}.buy{display:inline-block;background:#c9ff4a;color:#111;text-decoration:none;padding:16px 22px;font-weight:800;margin-top:28px;border-radius:4px}@media(max-width:600px){.card{padding:22px}h1{font-size:34px}td,th{padding:10px}}</style></head>
<body><main class="card"><small>PORTABASE LIMITED TRIAL · PROTECTION LEDGER</small><h1>The real workflow ran.<br>Here is everything it found.</h1><p>Your sample capsule was captured, encrypted, transferred to your destination, and verified — the exact workflow a complete backup uses. The inventory below is everything Portabase found in project <b>${escape(metadata.projectRef)}</b>.</p>
<table><tr><th>LAYER</th><th>IN YOUR PROJECT</th><th>IN THIS TRIAL CAPSULE</th></tr>${ledgerRows}</table>
<p class="recover"><b>${escape(recoverLine)}</b><br>Everything in red is currently unprotected against an account lockout, deletion, or billing freeze.</p>
${secretNames?.length ? `<div class="secrets"><b>Recovery checklist: ${number(secretNames.length)} secret name${secretNames.length === 1 ? '' : 's'} inventoried (values are never exported)</b><code>${secretNames.map(escape).join(' · ')}</code></div>` : ''}
<p class="privacy"><b>Computed locally. Transmitted nowhere.</b> This report, the inventory behind it, and your credentials never left this computer. Portabase has no server that could receive them.</p>
<a class="buy" href="${escape(purchaseUrl)}">Full capture is free open source · Cloud $17/mo optional →</a></main></body></html>`;
  await writeFile(join(capsuleDir, 'TRIAL-REPORT.html'), html);
}

export async function writeChecksums(capsuleDir) {
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
  const eventType = state.state === 'FAILED' || state.state === 'PARTIAL'
    ? 'backup.failed'
    : ['COMPLETE', 'TRIAL'].includes(state.state)
      ? 'backup.completed'
      : null;
  if (!eventType) return;
  try {
    const result = await emitTelemetry(config, {
      eventType,
      portabaseVersion: VERSION,
      payload: {
        capsuleId: state.capsule || null,
        status: state.state,
        destinationKind: config.provider?.type || null,
        verified: Boolean(state.verified),
        errorCount: Array.isArray(state.errors) ? state.errors.length : (state.error ? 1 : 0),
        errorClass: state.error ? 'backup_error' : null,
      },
    });
    if (result.sent === false && result.reason !== 'telemetry_disabled') {
      console.error('Telemetry delivery incomplete.');
    }
  } catch (error) {
    console.error(`Alert delivery failed: ${error.message}`);
  }
}

export async function transferCapsule(config, capsuleDir) {
  if (config.provider.type === 'local') {
    const bytes = await directoryByteSize(capsuleDir);
    const allowLargeLocal = Boolean(config.provider.allowLargeLocal) || hasFlag('allow-large-local');
    const sizeGate = assertLocalStarterSize(bytes, {
      allowLargeLocal,
      maxBytes: config.provider.maxBytes || LOCAL_STARTER_MAX_BYTES,
    });
    if (sizeGate.allowedByOverride) {
      console.warn(
        `WARNING: Local Starter override — capsule is ${formatBytes(bytes)} (limit ${formatBytes(sizeGate.maxBytes)}). `
        + 'Same-disk Escape risk accepted via allowLargeLocal.',
      );
    } else {
      console.log(`Local Starter vault: capsule ${formatBytes(bytes)} ≤ ${formatBytes(sizeGate.maxBytes)}`);
    }

    // No separate path: encrypted capsule directory is the vault (still size-gated).
    if (!config.provider.path) {
      return {
        destination: capsuleDir,
        verified: true,
        mode: 'local-starter',
        bytes,
        maxBytes: sizeGate.maxBytes,
      };
    }
    const target = join(resolve(config.provider.path), basename(capsuleDir));
    if (existsSync(target)) throw new Error(`Immutable destination already exists: ${target}`);
    await mkdir(dirname(target), { recursive: true });
    await cp(capsuleDir, target, { recursive: true, errorOnExist: true, force: false });
    const results = await verifyChecksumFile(target, join(target, 'checksums.sha256'));
    if (results.some(item => !item.ok)) throw new Error('Local destination verification failed.');
    return {
      destination: target,
      verified: true,
      mode: 'local-starter',
      bytes,
      maxBytes: sizeGate.maxBytes,
    };
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
  const firstPerBucket = !trial && (
    hasFlag('storage-first-per-bucket')
    || config.capture?.storageSample === 'first-per-bucket'
  );
  if (trial) {
    console.log('Portabase demo mode (--trial): limited sample capture for safe drills. Full open-source capture is the default without this flag.');
  } else if (firstPerBucket) {
    console.log(
      'Portabase community edition: FULL database, Functions, and Auth; '
      + 'Storage = first object from every bucket (size-bounded multi-bucket proof).',
    );
  } else {
    console.log('Portabase community edition: full open-source capture. No license required.');
  }
  const limits = trial
    ? TRIAL_LIMITS
    : firstPerBucket
      ? FIRST_PER_BUCKET_STORAGE
      : null;
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
  const startedAt = Date.now();
  await writeStatus(config, { state: 'RUNNING', capsule: id, startedAt: new Date().toISOString() });
  try {
    await emitTelemetry(config, {
      eventType: 'backup.started',
      portabaseVersion: VERSION,
      payload: { capsuleId: id, edition: entitlement.edition },
    });
  } catch { /* non-fatal */ }
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
      ['storage', config.capture?.storage !== false, () => captureStorage(rawDir, limits, config)],
      ['functions', config.capture?.functions !== false, () => captureFunctions(config, rawDir, limits)],
      ['auth', config.capture?.auth !== false, () => captureAuth(config, rawDir)],
    ]) {
      if (!enabled) {
        manifest.contents[name] = { complete: false, skipped: true, reason: 'disabled in config' };
        continue;
      }
      try {
        console.log(`Capturing ${name}...`);
        progress({ phase: 'capture', item: name });
        manifest.contents[name] = await capture();
      } catch (error) {
        manifest.contents[name] = { complete: false, error: error.message };
        manifest.errors.push(`${name}: ${error.message}`);
        console.error(`PARTIAL ${name}: ${error.message}`);
      }
    }
    manifest.status = manifest.errors.length || Object.values(manifest.contents).some(item => !item.complete) ? 'PARTIAL' : trial ? 'TRIAL' : 'COMPLETE';
    await writeFile(join(rawDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // Persist storage object identity for next-run resume (metadata only; lives outside capsule)
    try {
      const sm = manifest.contents.storage?.manifestPath;
      if (sm && existsSync(sm)) {
        await mkdir(resolve(config.statusDirectory || './portabase-status'), { recursive: true });
        await writeFile(lastStorageManifestPath(config), await readFile(sm, 'utf8'));
      }
    } catch { /* non-fatal */ }
    const recoverMd = [
      '# Portabase recovery capsule',
      '',
      'Restore only into a fresh, explicitly confirmed Supabase target.',
      '',
      '## Replay (validate on a new account)',
      '',
      '```bash',
      'portabase replay --capsule <this-directory> --confirm-target <NEW_PROJECT_REF>',
      '```',
      '',
      '## Edge Functions manual redeploy',
      '',
      'After decrypting the capsule, see `functions/REDEPLOY-ALL.ps1` and `functions/redeploy-all.sh`.',
      'Secret values are never exported — recreate them on the target before cutover.',
      '',
      '```bash',
      'portabase restore --capsule <directory>           # dry-run plan',
      'portabase restore --capsule <directory> --preflight',
      'portabase restore --capsule <directory> --execute --confirm-target <NEW_REF>',
      '```',
      '',
    ].join('\n');
    await writeFile(join(rawDir, 'RECOVER.md'), recoverMd);
    progress({ phase: 'package' });
    console.log('Packaging capsule archive...');
    // Prefer pure-Node tar.gz on Windows (system tar often fails on large trees / missing drives).
    try {
      await packDirectoryTarGz(rawDir, archive);
    } catch (packError) {
      const tar = resolveTool('tar');
      if (!tar) throw new Error(`Archive pack failed: ${packError.message}`);
      console.warn(`Node pack failed (${packError.message}); falling back to system tar...`);
      await run(tar, ['-czf', archive, '-C', rawDir, '.']);
    }
    progress({ phase: 'encrypt' });
    console.log('Encrypting capsule...');
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
      durationMs: Date.now() - startedAt,
    };
    await writeFile(join(capsuleDir, 'capsule.json'), `${JSON.stringify(capsuleMetadata, null, 2)}\n`);
    await writeFile(join(capsuleDir, 'RECOVER.txt'), 'This capsule is encrypted. Keep PORTABASE_ENCRYPTION_PASSPHRASE outside the backup destination. Use Portabase restore without --execute to inspect the recovery plan.\n');
    if (trial) await writeTrialReport(capsuleDir, capsuleMetadata);
    await writeChecksums(capsuleDir);
    progress({ phase: 'transfer', item: config.provider.type });
    const transfer = await transferCapsule(config, capsuleDir);
    const state = {
      state: manifest.status,
      capsule: id,
      completedAt: new Date().toISOString(),
      destination: transfer.destination,
      verified: transfer.verified,
      errors: manifest.errors,
      durationMs: Date.now() - startedAt,
    };
    await writeStatus(config, state);
    await touchAgentRegistry(config, { type: 'backup.completed', capsule: id });
    await sendAlert(config, state);
    console.log(`\n${manifest.status}: ${capsuleDir}`);
    console.log(`VERIFIED DESTINATION: ${transfer.destination}`);
    if (manifest.contents.storage?.cacheHits != null) {
      console.log(`STORAGE: downloaded=${manifest.contents.storage.downloaded || 0} cache_hits=${manifest.contents.storage.cacheHits || 0} resumed=${manifest.contents.storage.skippedUnchanged || 0}`);
    }
    if (manifest.contents.functions?.redeployScripts) {
      console.log(`FUNCTIONS REDEPLOY: functions/REDEPLOY-ALL.ps1 · functions/redeploy-all.sh (CLI pin ${PINNED_SUPABASE_CLI})`);
    }
    if (trial) console.log(`TRIAL REPORT: ${join(capsuleDir, 'TRIAL-REPORT.html')}`);
    console.log('NEXT: prove recovery with  portabase replay --capsule <dir> --confirm-target <NEW_REF>');
    progress({ phase: 'done', status: manifest.status });
    if (hasFlag('json')) console.log(JSON.stringify({ ...state, contents: manifest.contents }));
    if (!['COMPLETE', 'TRIAL'].includes(manifest.status)) process.exitCode = 3;
  } catch (error) {
    const state = { state: 'FAILED', capsule: id, failedAt: new Date().toISOString(), error: error.message };
    await writeStatus(config, state);
    await touchAgentRegistry(config, { type: 'backup.failed', capsule: id });
    await sendAlert(config, state);
    progress({ phase: 'failed', item: error.message });
    if (hasFlag('json')) console.log(JSON.stringify(state));
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

/**
 * Offline capsule simulation — no Supabase target required.
 * Decrypts, unpacks, checks layers against outer capsule.json + inner manifest.json.
 */
async function simulate() {
  const capsuleArg = flag('capsule', argv[1] || '.');
  const materialized = await materializeCapsule(capsuleArg);
  const capsuleDir = materialized.capsuleDir;
  const lines = [];
  const checks = [];
  const pass = (name, detail = '') => {
    checks.push({ ok: true, name, detail });
    lines.push(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const fail = (name, detail = '') => {
    checks.push({ ok: false, name, detail });
    lines.push(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const warn = (name, detail = '') => {
    checks.push({ ok: true, name, detail, warn: true });
    lines.push(`WARN  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  console.log([
    'Portabase SIMULATE (offline)',
    'No destination Supabase project is used.',
    'Decrypt → unpack → match components to capture manifest.',
    '',
    `Capsule: ${capsuleDir}`,
    '',
  ].join('\n'));

  try {
    // 1 · Outer envelope checksums
    const checksumPath = join(capsuleDir, 'checksums.sha256');
    if (!existsSync(checksumPath)) fail('outer-checksums', 'checksums.sha256 missing');
    else {
      const results = await verifyChecksumFile(capsuleDir, checksumPath);
      const bad = results.filter(r => !r.ok);
      if (bad.length) fail('outer-checksums', bad.map(b => b.path).join(', '));
      else pass('outer-checksums', `${results.length} file(s)`);
    }

    // 2 · Outer capsule.json present
    const outerPath = join(capsuleDir, 'capsule.json');
    if (!existsSync(outerPath)) {
      fail('capsule.json', 'missing outer metadata');
      throw new Error('Cannot continue without capsule.json');
    }
    const outer = JSON.parse(await readFile(outerPath, 'utf8'));
    pass('capsule.json', `id=${outer.id} status=${outer.status} edition=${outer.edition || 'n/a'}`);

    if (!process.env.PORTABASE_ENCRYPTION_PASSPHRASE) {
      fail('passphrase', 'PORTABASE_ENCRYPTION_PASSPHRASE not set');
      throw new Error('Passphrase required to open capsule');
    }

    // 3 · Decrypt + extract (same path as restore plan)
    let opened;
    try {
      opened = await openCapsule(capsuleDir, process.env.PORTABASE_ENCRYPTION_PASSPHRASE);
      pass('decrypt+unpack', 'AES-256-GCM auth + tar extract');
    } catch (error) {
      fail('decrypt+unpack', error.message);
      throw error;
    }

    const { metadata, manifest, extracted, temp } = opened;
    try {
      // 4 · Outer vs inner identity
      if (metadata.id && manifest.projectRef && outer.projectRef && metadata.id !== outer.id) {
        fail('id-match', `outer id ${outer.id} ≠ encrypted metadata ${metadata.id}`);
      } else if (outer.id && metadata.id && outer.id !== metadata.id) {
        fail('id-match', `outer ${outer.id} ≠ meta ${metadata.id}`);
      } else {
        pass('id-match', outer.id || metadata.id);
      }

      if (outer.projectRef && manifest.projectRef && outer.projectRef !== manifest.projectRef) {
        fail('project-ref', `outer ${outer.projectRef} ≠ inner ${manifest.projectRef}`);
      } else {
        pass('project-ref', manifest.projectRef || outer.projectRef);
      }

      if (outer.status && manifest.status && outer.status !== manifest.status) {
        warn('status-sync', `outer=${outer.status} inner=${manifest.status}`);
      } else {
        pass('status', manifest.status || outer.status);
      }

      if (['PARTIAL', 'TRIAL'].includes(manifest.status) || ['PARTIAL', 'TRIAL'].includes(outer.status)) {
        warn(
          'capture-completeness',
          `${manifest.status || outer.status} — not a full production Escape; gaps expected`,
        );
      } else if (manifest.status === 'COMPLETE') {
        pass('capture-completeness', 'COMPLETE');
      }

      // 5 · Layer presence vs manifest
      const contents = manifest.contents || outer.contents || {};
      for (const layer of ['database', 'storage', 'functions', 'auth']) {
        const item = contents[layer];
        if (!item) {
          warn(`layer:${layer}`, 'not listed in manifest');
          continue;
        }
        if (item.skipped) {
          warn(`layer:${layer}`, item.reason || 'skipped');
          continue;
        }
        if (!item.complete) {
          fail(`layer:${layer}`, item.error || item.reason || 'incomplete');
          continue;
        }

        if (layer === 'database') {
          const expected = item.files?.length
            ? item.files
            : ['roles.sql', 'schema.sql', 'database-inventory.json'].filter(f => true);
          // data.sql may be absent for trial/schema-only
          let missing = [];
          for (const f of expected) {
            if (!existsSync(join(extracted, 'database', f))) missing.push(f);
          }
          // Always require inventory or schema for a "complete" db layer claim
          if (!existsSync(join(extracted, 'database', 'schema.sql')) && !existsSync(join(extracted, 'database', 'roles.sql'))) {
            missing.push('schema.sql|roles.sql');
          }
          if (missing.length) fail('layer:database', `missing ${missing.join(', ')}`);
          else {
            const extra = item.limited ? ` limited: ${item.limitation || 'yes'}` : '';
            const sum = item.summary
              ? ` tables≈${item.summary.tables} rows≈${item.summary.rows}`
              : '';
            pass('layer:database', `files OK${extra}${sum}`);
          }
        } else if (layer === 'storage') {
          const smPath = join(extracted, 'storage', 'storage-manifest.json');
          if (!existsSync(smPath)) {
            // trial may claim complete with empty objects
            if (item.limited && Number(item.objectCount || 0) === 0) {
              warn('layer:storage', 'limited trial with 0 captured objects (inventory-only)');
            } else {
              fail('layer:storage', 'storage-manifest.json missing');
            }
          } else {
            const storage = JSON.parse(await readFile(smPath, 'utf8'));
            let hashOk = 0;
            let hashFail = 0;
            let missingObj = 0;
            for (const bucket of storage.buckets || []) {
              for (const object of bucket.objects || []) {
                const source = join(
                  extracted,
                  'storage',
                  safeObjectPath(bucket.id),
                  safeObjectPath(object.name),
                );
                if (!existsSync(source)) {
                  missingObj += 1;
                  continue;
                }
                if (object.sha256) {
                  const actual = await hashFile(source);
                  if (actual === object.sha256) hashOk += 1;
                  else hashFail += 1;
                } else {
                  hashOk += 1;
                }
              }
            }
            const expectedCount = Number(storage.objectCount ?? item.objectCount ?? 0);
            const detail = `manifest objects=${expectedCount} on-disk hash_ok=${hashOk} hash_fail=${hashFail} missing=${missingObj}`;
            if (hashFail || missingObj) fail('layer:storage', detail);
            else if (item.limited) warn('layer:storage', `${detail} (limited sample)`);
            else pass('layer:storage', detail);

            // Inventory totals (source truth at capture) vs what is in the capsule
            if (item.inventory?.totalBytes != null && item.totalBytes != null
              && Number(item.inventory.totalBytes) > Number(item.totalBytes || 0)
              && item.limited) {
              warn(
                'storage-source-vs-capsule',
                `source inventory ${formatBytes(item.inventory.totalBytes)} · in capsule ${formatBytes(item.totalBytes || 0)} (trial/partial)`,
              );
            }
            // Recompute names fingerprint from capsule contents vs stored snapshot
            if (storage.capsuleNamesFingerprintMd5) {
              const recomputed = fingerprintSortedKeys(storageObjectKeysFromBuckets(storage.buckets), 'md5');
              if (fingerprintsMatch(storage.capsuleNamesFingerprintMd5, recomputed)) {
                pass(
                  'storage-names-fingerprint',
                  `MD5 ${recomputed.fingerprint} · ${recomputed.count} name+size rows`,
                );
              } else {
                fail(
                  'storage-names-fingerprint',
                  `stored=${storage.capsuleNamesFingerprintMd5.fingerprint} recomputed=${recomputed.fingerprint}`,
                );
              }
            }
            if (storage.sourceNamesFingerprintMd5 && item.limited) {
              warn(
                'storage-source-names-fingerprint',
                `source inventory MD5 ${storage.sourceNamesFingerprintMd5.fingerprint} `
                + `(${storage.sourceNamesFingerprintMd5.count} name+size rows) · capsule has sample only`,
              );
            }
          }
        } else if (layer === 'functions') {
          const fm = join(extracted, 'functions', 'functions-manifest.json');
          if (!existsSync(fm) && !(item.names?.length)) {
            if (item.limited || item.error) fail('layer:functions', item.error || item.reason || 'no functions payload');
            else warn('layer:functions', 'no functions-manifest.json');
          } else if (existsSync(fm)) {
            const functions = JSON.parse(await readFile(fm, 'utf8'));
            const entries = functions.functions || (functions.names || item.names || []).map(name => ({ name }));
            const { missing, skipped, present } = classifyFunctionDirs(
              entries,
              name => existsSync(join(extracted, 'functions', safeObjectPath(name))),
            );
            if (missing.length) {
              fail('layer:functions', `${missing.length}/${entries.length} function dirs missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
            } else if (skipped.length) {
              warn('layer:functions', `${present}/${entries.length} function(s) present · ${skipped.length} ghost name(s) skipped at capture (404 on source): ${skipped.join(', ')}`);
            } else {
              pass('layer:functions', `${entries.length} function(s) present`);
            }
          } else {
            pass('layer:functions', `${(item.names || []).length} name(s) in outer metadata`);
          }
        } else if (layer === 'auth') {
          const authDir = join(extracted, 'auth');
          if (!existsSync(authDir)) warn('layer:auth', 'no auth/ directory (may be embedded in database dump)');
          else pass('layer:auth', 'auth artifacts present');
        }
      }

      // 6 · Manual reconfig reminders (always — not failures)
      console.log('\n--- Manifest summary (what a new Supabase would need) ---');
      console.log(`Source project: ${manifest.projectRef}`);
      console.log(`Capture status: ${manifest.status} · edition: ${manifest.edition || outer.edition || 'community'}`);
      for (const layer of ['database', 'storage', 'functions', 'auth']) {
        const item = contents[layer];
        if (!item) continue;
        const flag = item.complete ? (item.limited ? 'LIMITED' : 'READY') : (item.skipped ? 'SKIP' : 'GAP');
        console.log(`  ${flag.padEnd(8)} ${layer}${item.limitation ? ` — ${item.limitation}` : ''}${item.error ? ` — ${item.error}` : ''}${item.reason && !item.limitation ? ` — ${item.reason}` : ''}`);
      }
      if (contents.functions?.secretNames?.length) {
        console.log(`\nSecrets to re-create on a new project (names only): ${contents.functions.secretNames.join(', ')}`);
      }
      // 7 · Restore-plan-scoped sampling — validate only the selected subset, offline
      const planPath = flag('restore-plan');
      if (planPath) {
        const plan = JSON.parse(await readFile(resolve(planPath), 'utf8'));
        try {
          validateRestorePlan(plan, { capsuleId: metadata.id });
          pass('restore-plan', `bound to capsule ${metadata.id}, ${formatBytes(restorePlanSelectedBytes(plan))} selected`);
        } catch (error) {
          fail('restore-plan', error.message);
        }
        const selectedTables = restorePlanSelectedTableKeys(plan);
        if (selectedTables.size) {
          const dataSqlPath = join(extracted, 'database', 'data.sql');
          if (!existsSync(dataSqlPath)) {
            fail('restore-plan:database', 'data.sql missing — cannot sample selected tables');
          } else {
            const measured = new Map((await measureDataSqlTables(dataSqlPath)).map(t => [`${t.schema}.${t.table}`, t.bytes]));
            const missing = [...selectedTables].filter(key => !measured.has(key));
            if (missing.length) warn('restore-plan:database', `${missing.length} selected table(s) have no data rows in capsule (empty table, or not in dump): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
            else pass('restore-plan:database', `${selectedTables.size} selected table(s) present in data.sql`);
          }
        }
        const selectedBucketIds = new Set((plan.buckets || []).filter(b => b.selected).map(b => b.id));
        if (selectedBucketIds.size) {
          const smPath = join(extracted, 'storage', 'storage-manifest.json');
          if (!existsSync(smPath)) {
            fail('restore-plan:storage', 'storage-manifest.json missing — cannot sample selected buckets');
          } else {
            const storage = JSON.parse(await readFile(smPath, 'utf8'));
            let hashOk = 0;
            let hashFail = 0;
            for (const bucket of (storage.buckets || []).filter(b => selectedBucketIds.has(b.id))) {
              for (const object of bucket.objects || []) {
                const source = join(extracted, 'storage', safeObjectPath(bucket.id), safeObjectPath(object.name));
                if (!existsSync(source)) { hashFail += 1; continue; }
                if (object.sha256 && await hashFile(source) !== object.sha256) hashFail += 1; else hashOk += 1;
              }
            }
            if (hashFail) fail('restore-plan:storage', `selected buckets: hash_ok=${hashOk} hash_fail_or_missing=${hashFail}`);
            else pass('restore-plan:storage', `selected buckets: ${hashOk} object(s) hash-verified`);
          }
        }
        const selectedFunctionNames = restorePlanSelectedFunctionNames(plan);
        if (selectedFunctionNames.size) {
          let missingSrc = 0;
          for (const name of selectedFunctionNames) {
            if (!existsSync(join(extracted, 'functions', safeObjectPath(name)))) missingSrc += 1;
          }
          if (missingSrc) fail('restore-plan:functions', `${missingSrc}/${selectedFunctionNames.size} selected function dir(s) missing`);
          else pass('restore-plan:functions', `${selectedFunctionNames.size} selected function(s) present`);
        }
      }

      console.log('\nNot simulated (requires live blank project): psql apply, Storage upload, Functions deploy, blank-target guards.');
      console.log('Next live proof: portabase replay --capsule <dir> --confirm-target <NEW_REF>');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  } finally {
    if (materialized.cleanup) await rm(materialized.cleanup, { recursive: true, force: true });
  }

  console.log(`\n--- Checks ---\n${lines.join('\n')}`);
  const failures = checks.filter(c => !c.ok).length;
  const warnings = checks.filter(c => c.warn).length;
  const report = {
    mode: 'simulate',
    capsule: capsuleDir,
    failures,
    warnings,
    checks,
  };
  if (hasFlag('json')) console.log(JSON.stringify(report, null, 2));
  console.log(`\n${failures ? 'SIMULATE FAILED' : 'SIMULATE OK'}: ${checks.length - failures}/${checks.length} checks passed${warnings ? ` · ${warnings} warning(s)` : ''}`);
  console.log('No Supabase destination was contacted.');
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

async function restoreDatabase(extracted, plan = null) {
  const psql = resolveTool('psql');
  const targetDb = process.env.PORTABASE_TARGET_DB_URL;
  if (!psql || !targetDb) throw new Error('psql and PORTABASE_TARGET_DB_URL are required for database restore.');
  const applied = [];
  // Dirty-target drills: continue past "already exists" / duplicate object errors.
  const stopOnError = hasFlag('allow-occupied-target') ? '0' : '1';
  let filteredDataDir = null;
  for (const file of ['roles.sql', 'schema.sql', 'data.sql']) {
    let path = join(extracted, 'database', file);
    if (file === 'data.sql' && plan && existsSync(path)) {
      // Schema always applies in full (structure is small and required); only DATA rows
      // are filtered to the plan's selected tables, so restore stays under the byte budget.
      filteredDataDir = await mkdtemp(join(tmpdir(), 'portabase-plan-'));
      const filteredPath = join(filteredDataDir, 'data.sql');
      await filterDataSqlByTables(path, filteredPath, restorePlanSelectedTableKeys(plan));
      path = filteredPath;
    }
    if (existsSync(path)) {
      await run(psql, [targetDb, '--set', `ON_ERROR_STOP=${stopOnError}`, '--file', path]);
      applied.push(file);
    }
  }
  if (filteredDataDir) await rm(filteredDataDir, { recursive: true, force: true });
  return { applied, plan: plan ? { selectedTables: [...restorePlanSelectedTableKeys(plan)] } : null };
}

async function restoreStorage(extracted, plan = null) {
  const manifestPath = join(extracted, 'storage', 'storage-manifest.json');
  if (!existsSync(manifestPath)) return { verified: false, reason: 'Storage manifest is missing.', bucketCount: 0, objectCount: 0, hashesVerified: 0 };
  const fullStorage = JSON.parse(await readFile(manifestPath, 'utf8'));
  const storage = plan ? filterStorageManifestByPlan(fullStorage, plan) : fullStorage;
  let hashesVerified = 0;
  const restoredKeys = [];
  for (const bucket of storage.buckets) {
    const created = await targetFetch('/storage/v1/bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket.id, name: bucket.name || bucket.id, public: bucket.public, file_size_limit: bucket.fileSizeLimit, allowed_mime_types: bucket.allowedMimeTypes }),
    });
    // 200/201 = created; 409/400 often means bucket already exists (dirty-target drill)
    if (!created.ok && created.status !== 409 && created.status !== 400) {
      throw new Error(`Unable to create blank-target bucket ${bucket.id}: HTTP ${created.status}`);
    }
    for (const object of bucket.objects) {
      const source = join(extracted, 'storage', safeObjectPath(bucket.id), safeObjectPath(object.name));
      const objectPath = object.name.split('/').map(encodeURIComponent).join('/');
      // Buffer body avoids Node/Windows spawn EINVAL with stream+fetch duplex on some builds
      const body = await readFile(source);
      const response = await targetFetch(`/storage/v1/object/${encodeURIComponent(bucket.id)}/${objectPath}`, {
        method: 'POST',
        headers: { 'Content-Type': object.contentType || 'application/octet-stream', 'x-upsert': 'true' },
        body,
      });
      if (!response.ok) throw new Error(`Unable to restore blank-target object ${bucket.id}/${object.name}: HTTP ${response.status}`);
      const readback = await targetFetch(`/storage/v1/object/authenticated/${encodeURIComponent(bucket.id)}/${objectPath}`);
      if (!readback.ok) throw new Error(`Unable to read back ${bucket.id}/${object.name}: HTTP ${readback.status}`);
      const remoteHash = createHash('sha256').update(Buffer.from(await readback.arrayBuffer())).digest('hex');
      const expectedHash = object.sha256 || createHash('sha256').update(body).digest('hex');
      if (remoteHash !== expectedHash) throw new Error(`Read-back hash mismatch for ${bucket.id}/${object.name}.`);
      hashesVerified += 1;
      restoredKeys.push(storageInventoryLine(bucket.id, object.name, object.size ?? body.length));
    }
  }
  // Name+size inventory fingerprint: destination restored set vs capsule snapshot (or, with a
  // plan, vs the plan's selected subset — a filtered restore is expected to differ from the
  // full capsule by design, same pattern as the trial/sample "limitation" fields).
  const expectedNames = plan
    ? fingerprintSortedKeys(storageObjectKeysFromBuckets(storage.buckets), 'md5')
    : (fullStorage.capsuleNamesFingerprintMd5 || fingerprintSortedKeys(storageObjectKeysFromBuckets(fullStorage.buckets), 'md5'));
  const actualNames = fingerprintSortedKeys(restoredKeys, expectedNames.algo || 'md5');
  const namesMatch = fingerprintsMatch(expectedNames, actualNames);
  if (!namesMatch) {
    console.warn(
      `WARNING: Storage name+size fingerprint mismatch — ${plan ? 'plan selection' : 'capsule'}=${expectedNames.fingerprint} `
      + `destination=${actualNames.fingerprint} (count ${expectedNames.count} vs ${actualNames.count})`,
    );
  } else {
    console.log(`Storage name+size fingerprint OK (MD5 ${actualNames.fingerprint} · ${actualNames.count} objects)`);
  }
  // Optional: live target listing fingerprint vs full source inventory (only meaningful after
  // a full, unfiltered restore — a plan restores a deliberate subset, so skip this comparison).
  let liveNamesMatch = null;
  let liveNamesFingerprint = null;
  if (!plan && fullStorage.sourceNamesFingerprintMd5 && !fullStorage.limitation) {
    try {
      liveNamesFingerprint = await fingerprintLiveTargetStorageNames();
      liveNamesMatch = fingerprintsMatch(storage.sourceNamesFingerprintMd5, liveNamesFingerprint);
      console.log(
        liveNamesMatch
          ? `Live target names match source inventory snapshot (MD5 ${liveNamesFingerprint.fingerprint})`
          : `Live target names differ from source snapshot — capsule=${storage.sourceNamesFingerprintMd5.fingerprint} live=${liveNamesFingerprint.fingerprint}`,
      );
    } catch (err) {
      console.warn(`WARNING: could not fingerprint live target Storage: ${err.message}`);
    }
  }
  return {
    verified: hashesVerified === Number(storage.objectCount || 0) && namesMatch,
    limited: Boolean(plan),
    bucketCount: storage.buckets.length,
    objectCount: storage.objectCount,
    hashesVerified,
    namesFingerprint: actualNames,
    expectedNamesFingerprint: expectedNames,
    namesMatch,
    liveNamesFingerprint,
    liveNamesMatch,
    sourceNamesFingerprint: fullStorage.sourceNamesFingerprintMd5 || null,
  };
}

/** List all object names on the restore target and fingerprint (same method as capture). */
async function fingerprintLiveTargetStorageNames() {
  const bucketsResponse = await targetFetch('/storage/v1/bucket', { signal: AbortSignal.timeout(15000) });
  if (!bucketsResponse.ok) throw new Error(`list buckets HTTP ${bucketsResponse.status}`);
  const buckets = await bucketsResponse.json();
  const keys = [];
  for (const bucket of buckets) {
    const id = bucket.id || bucket.name;
    if (!id) continue;
    const objects = await listTargetBucketObjects(id);
    for (const object of objects) {
      const name = object.fullName || object.name;
      if (!name) continue;
      keys.push(storageInventoryLine(id, name, object.size ?? object.metadata?.size ?? 0));
    }
  }
  return fingerprintSortedKeys(keys, 'md5');
}

async function listTargetBucketObjects(bucketId, prefix = '') {
  const objects = [];
  let offset = 0;
  for (;;) {
    const response = await targetFetch(`/storage/v1/object/list/${encodeURIComponent(bucketId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset }),
    });
    if (!response.ok) throw new Error(`list ${bucketId}: HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const entry of batch) {
      const name = entry.name;
      if (!name) continue;
      const path = prefix ? `${prefix}${name}` : name;
      // folders end with / in some listings
      if (entry.id == null && !entry.metadata) {
        const nested = await listTargetBucketObjects(bucketId, path.endsWith('/') ? path : `${path}/`);
        objects.push(...nested);
      } else {
        const size = Number(entry.metadata?.size ?? entry.metadata?.contentLength ?? 0) || 0;
        objects.push({ fullName: path, name: path, size, metadata: entry.metadata || {} });
      }
    }
    if (batch.length < 1000) break;
    offset += batch.length;
  }
  return objects;
}

async function restoreFunctions(extracted, manifest, targetRef, plan = null) {
  const functions = manifest.contents.functions;
  if (!functions?.complete) return { verified: false, reason: functions?.reason || functions?.error || 'Function capture was incomplete.', expected: [], active: [] };
  const selectedNames = plan ? restorePlanSelectedFunctionNames(plan) : null;
  const names = plan ? (functions.names || []).filter(name => selectedNames.has(name)) : (functions.names || []);
  if (!names.length) return { verified: true, limited: Boolean(plan), expected: [], active: [] };
  const supabase = resolveTool('supabase');
  if (!supabase || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Supabase CLI and SUPABASE_ACCESS_TOKEN are required to restore Edge Functions.');
  const workdir = join(extracted, 'functions');
  const verifyMap = functions.verifyJwt || {};
  for (const name of names) {
    const args = ['functions', 'deploy', name, '--project-ref', targetRef, '--workdir', workdir];
    if (verifyMap[name] === false) args.push('--no-verify-jwt');
    await run(supabase, args, { cwd: workdir, env: process.env });
  }
  const result = spawnSync(supabase, ['functions', 'list', '--project-ref', targetRef, '--output', 'json'], {
    encoding: 'utf8', env: process.env, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Unable to verify restored Edge Functions: ${(result.stderr || '').trim().slice(0, 300)}`);
  const active = JSON.parse(result.stdout || '[]').map(fn => fn.name || fn.slug);
  const missing = names.filter(name => !active.includes(name));
  return { verified: missing.length === 0, limited: Boolean(plan), expected: names, active, missing, redeployScripts: functions.redeployScripts || null };
}

async function verifyRestoredDatabase(extracted, limited = false, plan = null) {
  const expectedPath = join(extracted, 'database', 'database-inventory.json');
  if (!existsSync(expectedPath)) return { verified: false, reason: 'Source database inventory is missing.' };
  const expectedSource = JSON.parse(await readFile(expectedPath, 'utf8'));
  let expected = expectedSource;
  if (limited) {
    expected = { ...expected, tables: (expected.tables || []).map(table => ({ ...table, rows: 0 })), authUsers: 0 };
  }
  if (plan) expected = applyRestorePlanToExpectedInventory(expected, plan);
  const actual = await captureDatabaseInventory(process.env.PORTABASE_TARGET_DB_URL);
  return { ...compareDatabaseInventories(expected, actual), limited: limited || Boolean(plan), expected, actual };
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portabase recovery evidence</title><style>body{margin:0;background:#0d0e11;color:#f7f6f1;font-family:Segoe UI,sans-serif}.wrap{width:min(900px,calc(100% - 32px));margin:48px auto}.status{padding:24px;border:1px solid #34353a;background:#17181c}small{font:11px Consolas,monospace;color:#c9ff4a;letter-spacing:.1em}h1{font-size:42px;margin:12px 0}.meta{color:#92938f;line-height:1.7}.checks{display:grid;gap:1px;background:#34353a;margin:28px 0}.check{background:#17181c;padding:20px}.check b{display:block;font-size:18px}.pass{color:#c9ff4a}.fail{color:#ff4b3e}.manual{padding:24px;background:#f2f0e8;color:#17181c}.manual li{margin:10px 0;line-height:1.5}code{word-break:break-all}</style></head><body><main class="wrap"><section class="status"><small>PORTABASE RECOVERY EVIDENCE</small><h1 class="${report.status.includes('VERIFIED') || report.status.includes('PASSED') ? 'pass' : 'fail'}">${escape(report.status)}</h1><div class="meta">Capsule: <code>${escape(report.capsuleId)}</code><br>Source: ${escape(report.sourceProjectRef)}<br>Target: ${escape(report.targetProjectRef || 'Not selected')}<br>Started: ${escape(report.startedAt)}<br>Completed: ${escape(report.completedAt)}</div></section><section class="checks">${checks.map(([name, ok, note]) => `<div class="check"><b class="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'NOT VERIFIED'} · ${escape(name)}</b><span>${escape(note)}</span></div>`).join('')}</section><section class="manual"><h2>Manual work still required</h2><ol>${MANUAL_RECOVERY_ACTIONS.map(item => `<li>${escape(item)}</li>`).join('')}</ol></section></main></body></html>`;
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

async function readTargetInventory(targetRef, opts = {}) {
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
  let edgeFunctions = 0;
  const functionsResult = spawnSync(supabase, ['functions', 'list', '--project-ref', targetRef, '--output', 'json'], {
    encoding: 'utf8', windowsHide: true, env: process.env,
  });
  if (functionsResult.status !== 0) {
    const detail = `${functionsResult.stderr || ''}${functionsResult.stdout || ''}`.trim().slice(0, 240);
    if (opts.allowOccupied) {
      console.warn(`WARNING: target Function list failed (continuing with --allow-occupied-target): ${detail || 'no detail'}`);
      edgeFunctions = 0;
    } else {
      throw new Error(`Target Function inspection failed: ${detail || 'supabase functions list failed'}`);
    }
  } else {
    let functions;
    try { functions = JSON.parse(functionsResult.stdout || '[]'); } catch { throw new Error('Target Function inspection returned invalid JSON.'); }
    edgeFunctions = Array.isArray(functions) ? functions.length : 0;
  }
  const inventory = {
    applicationTables: tableCount,
    authUsers: Array.isArray(users?.users) ? users.users.length : 0,
    storageBuckets: Array.isArray(buckets) ? buckets.length : 0,
    edgeFunctions,
  };
  return inventory;
}

async function inspectRestoreTarget(targetRef, opts = {}) {
  return validateBlankRestoreInventory(await readTargetInventory(targetRef, opts), opts);
}

/**
 * Generate a restore plan for a capsule: every table, storage bucket, and Function, with
 * its measured byte size and `selected: true` by default. Edit `selected` per entry (and
 * optionally `maxBytes`) to fit a budget — the customer's own filter, no GUI required.
 * The capsule itself always contains everything; this only scopes what gets RESTORED.
 */
async function restorePlanCommand() {
  const materialized = await materializeCapsule(flag('capsule', argv[1] || '.'));
  const opened = await openCapsule(materialized.capsuleDir, process.env.PORTABASE_ENCRYPTION_PASSPHRASE);
  try {
    const { metadata, manifest, extracted } = opened;
    const dataSqlPath = join(extracted, 'database', 'data.sql');
    const tableSizes = existsSync(dataSqlPath) ? await measureDataSqlTables(dataSqlPath) : [];
    const storageManifestPath = join(extracted, 'storage', 'storage-manifest.json');
    const storageManifest = existsSync(storageManifestPath)
      ? JSON.parse(await readFile(storageManifestPath, 'utf8'))
      : null;
    const maxBytes = Number(flag('max-restore-bytes', DEFAULT_RESTORE_PLAN_MAX_BYTES));
    const plan = buildRestorePlan({ manifest, capsuleId: metadata.id, tableSizes, storageManifest, maxBytes });
    const outputPath = resolve(flag('output', `restore-plan-${metadata.id}.json`));
    if (existsSync(outputPath) && !hasFlag('force')) {
      throw new Error(`${outputPath} already exists. Add --force to overwrite.`);
    }
    await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
    const selectedBytes = restorePlanSelectedBytes(plan);
    console.log([
      `Restore plan written: ${outputPath}`,
      `Capsule: ${metadata.id}`,
      `Tables: ${plan.tables.length}  Buckets: ${plan.buckets.length}  Functions: ${plan.functions.length}`,
      `Selected (all, by default): ${formatBytes(selectedBytes)} of budget ${formatBytes(maxBytes)}`,
      selectedBytes > maxBytes
        ? '\nOVER BUDGET as generated (everything selected). Edit "selected": false on tables/buckets in the plan file to fit, then pass it to restore/replay/simulate with --restore-plan.'
        : '\nUnder budget with everything selected — edit "selected" per entry only if you want a smaller/targeted restore (e.g. sampling a few tables for validation).',
    ].join('\n'));
    if (hasFlag('json')) console.log(JSON.stringify({ path: outputPath, plan, selectedBytes }));
  } finally {
    await rm(opened.temp, { recursive: true, force: true });
    if (materialized.cleanup) await rm(materialized.cleanup, { recursive: true, force: true });
  }
}

/** Load and validate a --restore-plan file against the opened capsule's id. Returns null if no flag was given (unfiltered / full). */
async function loadRestorePlanFlag(capsuleId) {
  const planPath = flag('restore-plan');
  if (!planPath) return null;
  const plan = JSON.parse(await readFile(resolve(planPath), 'utf8'));
  const maxBytesOverride = hasFlag('max-restore-bytes') ? Number(flag('max-restore-bytes')) : undefined;
  const { selectedBytes, maxBytes } = validateRestorePlan(plan, { capsuleId, maxBytesOverride });
  console.log(`Restore plan OK: ${formatBytes(selectedBytes)} selected of ${formatBytes(maxBytes)} budget (${plan.tables.filter(t => t.selected).length}/${plan.tables.length} tables, ${plan.buckets.filter(b => b.selected).length}/${plan.buckets.length} buckets, ${plan.functions.filter(f => f.selected).length}/${plan.functions.length} functions).`);
  return plan;
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
    evidence.capsuleId = metadata.id;
    const restorePlan = await loadRestorePlanFlag(metadata.id);
    evidence = {
      ...evidence,
      capsuleId: metadata.id,
      edition: manifest.edition,
      captureStatus: manifest.status,
      sourceProjectRef: manifest.projectRef,
      targetProjectRef: process.env.PORTABASE_TARGET_PROJECT_REF || null,
      captureContents: manifest.contents,
      captureErrors: manifest.errors,
      restorePlan: restorePlan ? { maxBytes: restorePlan.maxBytes, selectedBytes: restorePlanSelectedBytes(restorePlan) } : null,
    };
    console.log(`Portabase guarded recovery plan\n\nSource: ${manifest.projectRef}\nCapsule: ${metadata.id}\nCapture status: ${manifest.status}\n`);
    if (manifest.edition === 'trial') console.log('TRIAL SAMPLE: database rows and most Storage objects/Functions are intentionally absent. This is not a complete recovery backup.\n');
    if (restorePlan) console.log(`RESTORE PLAN ACTIVE: only selected tables/buckets/functions will be written to the target (budget ${formatBytes(restorePlan.maxBytes)}).\n`);
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
    const allowOccupied = hasFlag('allow-occupied-target');
    const allowSourceTarget = hasFlag('allow-source-target');
    if (allowOccupied) {
      console.log('\nWARNING: --allow-occupied-target — restoring into a NON-BLANK project. Collisions and partial failures are expected.');
    }
    if (allowSourceTarget) {
      console.log('\nWARNING: --allow-source-target — target may be the same ref as the capsule source (disposable drill only).');
    }
    validateRestoreTarget(
      manifest.projectRef,
      targetRef,
      writesTarget ? flag('confirm-target') : targetRef,
      process.env.PORTABASE_TARGET_SUPABASE_URL,
      { allowSourceTarget },
    );
    const health = await targetFetch('/storage/v1/bucket', { signal: AbortSignal.timeout(10000) });
    if (!health.ok) throw new Error(`Target credential check failed: HTTP ${health.status}`);
    const inventory = await inspectRestoreTarget(targetRef, { allowOccupied });
    evidence.preflight = { verified: true, inventory, allowOccupied, allowSourceTarget };
    console.log(`\nTARGET PREFLIGHT PASSED: ${targetRef}${allowOccupied ? ' (occupied allowed)' : ' (blank)'}`);
    console.log(`Inventory: ${Object.entries(inventory).map(([name, count]) => `${name}=${count}`).join(', ')}`);
    if (!writesTarget) {
      console.log('\nNO-WRITE PREFLIGHT COMPLETE. The target was not changed. Type the exact target ref and execute only after reviewing this plan.');
      evidence.status = recoveryEvidenceStatus({ mode: 'preflight', captureStatus: manifest.status });
      await writeRecoveryEvidence(evidence);
      return;
    }
    console.log(`${drill ? 'LIMITED DRILL' : 'TARGET WRITE'} CONFIRMED: ${targetRef}`);
    const databaseApplied = await restoreDatabase(extracted, restorePlan);
    const storage = await restoreStorage(extracted, restorePlan);
    const functions = await restoreFunctions(extracted, manifest, targetRef, restorePlan);
    const database = await verifyRestoredDatabase(extracted, drill, restorePlan);
    evidence.database = { ...database, applied: databaseApplied.applied };
    evidence.storage = storage;
    evidence.functions = functions;
    evidence.status = recoveryEvidenceStatus({ mode, captureStatus: manifest.status, database, storage, functions, restorePlan });
    if (evidence.status === 'FAILED') throw new Error('Recovery verification failed. Review the generated evidence for mismatched or unverified layers.');
    if (drill) {
      const api = await targetFetch('/rest/v1/', { headers: { Accept: 'application/openapi+json' }, signal: AbortSignal.timeout(10000) });
      if (!api.ok) throw new Error(`Restored API surface verification failed: HTTP ${api.status}`);
      const proof = await readTargetInventory(targetRef);
      console.log(`\nREAD-BACK PROOF: ${Object.entries(proof).map(([name, count]) => `${name}=${count}`).join(', ')}`);
      console.log('LIMITED RESTORE DRILL COMPLETE. Database structure/API surface, hash-verified sample Storage objects, and sample Functions were written from the trial capsule. This validates the path; it is not a complete recovery.');
    } else if (restorePlan) {
      console.log('\nSELECTIVE RESTORE VERIFIED. Only the tables/buckets/functions selected in the restore plan were written — this proves the plan-restore path and the selected data, not a complete recovery. Finish and verify the listed manual configuration before cutover.');
    } else {
      console.log('\nRECOVERY DATA PATH VERIFIED. Finish and verify the listed manual configuration before cutover.');
    }
    await writeRecoveryEvidence(evidence);
    if (hasFlag('json')) console.log(JSON.stringify(evidence));
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
  const taskName = `Portabase Backup ${config.projectRef}`;
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
  const taskName = `Portabase Backup ${config.projectRef}`;
  if (!hasFlag('execute')) return console.log(`DRY RUN: would remove task "${taskName}". Add --execute to continue.`);
  const schtasks = resolveTool('schtasks');
  await run(schtasks, ['/Delete', '/TN', taskName, '/F']);
}

async function plan() {
  const { config } = await loadConfig();
  console.log(`Portabase recovery plan (open core)\n\nProject: ${config.projectRef}\nDestination: ${config.provider.type}\nEncrypted staging: ${resolve(config.backupDirectory)}\n`);
  for (const name of ['database', 'storage', 'functions']) console.log(`${config.capture?.[name] === false ? 'SKIP' : 'KEEP'}  ${name}`);
  console.log(`\nRetention: keep ${config.retention?.keepLast ?? 30}; pruning is guarded and dry-run by default.`);
  console.log('Credentials and encryption keys remain local. No Portabase API or telemetry endpoint is contacted.');
}

async function probeToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) return { ok: false, detail: 'SUPABASE_ACCESS_TOKEN is not set.' };
  try {
    const response = await fetch('https://api.supabase.com/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { ok: false, detail: `Supabase rejected the token (HTTP ${response.status}).` };
    const projects = await response.json();
    return { ok: true, detail: `Token accepted; ${Array.isArray(projects) ? projects.length : 0} project(s) visible.` };
  } catch (error) {
    return { ok: false, detail: `Could not reach the Supabase Management API: ${error.message}` };
  }
}

function probeDatabase() {
  if (!process.env.SUPABASE_DB_URL) return { ok: false, detail: 'SUPABASE_DB_URL is not set.' };
  if (!resolveTool('psql')) return { ok: false, detail: 'psql is not available for a live connection test.' };
  try {
    psqlValue(process.env.SUPABASE_DB_URL, 'SELECT 1;');
    return { ok: true, detail: 'Database connection and credentials work.' };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

async function probeStorage() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, detail: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set.' };
  }
  const health = await authenticatedHealth();
  return health.ok
    ? { ok: true, detail: 'Storage API accepted the service key.' }
    : { ok: false, detail: `Storage API check failed${health.status ? ` (HTTP ${health.status})` : ''}${health.error ? `: ${health.error}` : ''}.` };
}

function probeTools() {
  const required = ['tar', 'pg_dump', 'psql'];
  const missing = required.filter(name => !resolveTool(name));
  if (missing.includes('pg_dump') && resolveTool('supabase')) {
    return { ok: !missing.includes('tar'), detail: missing.includes('tar') ? 'Missing tools: tar.' : 'Postgres tools missing; the Supabase CLI fallback will be used.' };
  }
  return missing.length
    ? { ok: false, detail: `Missing tools: ${missing.join(', ')}.` }
    : { ok: true, detail: 'Capture tools are available.' };
}

async function probe() {
  const target = flag('target', 'all');
  const probes = { token: probeToken, db: probeDatabase, storage: probeStorage, tools: probeTools };
  const selected = target === 'all' ? Object.keys(probes) : [target];
  if (selected.some(name => !probes[name])) throw new Error(`Unknown probe target: ${target}. Use token, db, storage, tools, or all.`);
  const results = {};
  for (const name of selected) results[name] = await probes[name]();
  const ok = Object.values(results).every(result => result.ok);
  console.log(JSON.stringify({ ok, probes: results }));
  if (!ok) process.exitCode = 6;
}

function help() {
  console.log(`Portabase ${VERSION} (Apache-2.0 open core)

Encrypted, customer-owned Supabase recovery capsules.
Full capture is free. Credentials and encryption keys never leave your runner.
Cloud telemetry is opt-in only (see docs/TELEMETRY_SCHEMA.md).

Destinations:
  local               Local Starter vault — folder on this PC / USB / NAS
                      Capsules ≤ ${LOCAL_STARTER_MAX_LABEL} (override: --allow-large-local)
                      For operators with no S3/Dropbox yet. Not off-machine Escape.
  dropbox | google-drive | aws | rclone
                      Recommended when you can — recovery bytes leave this machine.

Commands:
  init                Create a non-secret configuration
  doctor              Test tools, credentials, destination, and live authorization
  plan                Show the capture and destination plan
  backup              Capture, encrypt, transfer, and verify a capsule
                      Default: full community capture (no license)
                      Add --trial for a deliberately limited demo sample
                      Add --storage-first-per-bucket for full DB/Functions/Auth
                        but only the first Storage object in each bucket
                      Local Starter: add --allow-large-local to bypass ${LOCAL_STARTER_MAX_LABEL} cap
  verify              Verify checksums; add --decrypt for authenticated decryption
  simulate            Offline validation: decrypt, unpack, match layers to manifest
                      No Supabase destination required. Optional --json
                      Add --restore-plan <file> to sample/validate only the plan's
                      selected tables/buckets/functions (no target project needed)
  status              Show the last durable backup result
  prune               Preview retention; add --execute to delete recognized capsules
  install-schedule    Preview a scheduled backup; add --execute to install
  remove-schedule     Preview task removal; add --execute to remove
  restore-plan        Generate an editable JSON plan listing every table/bucket/function
                      in a capsule with its byte size, for selective restore under a
                      budget (default ${formatBytes(DEFAULT_RESTORE_PLAN_MAX_BYTES)}, e.g. to fit a free-tier target project).
                      Edit "selected": false on entries to trim; --output <file>
                      --max-restore-bytes <n> --force (overwrite) --json
  restore             Decrypt and plan restore; execution requires two target guards
                      Add --restore-plan <file> to restore only the plan's selected
                      tables/buckets/functions (hard-stops if the plan is over budget
                      or was generated for a different capsule)
  replay              Validate a capsule by restoring into a NEW Supabase project
                      (never the source). Requires target env vars + --confirm-target.
                      Same guards as restore --execute; clearer validation report.
                      Dirty-target drill: --allow-occupied-target
                      Same-ref drill:     --allow-source-target (with --confirm-target)
                      Accepts --restore-plan <file> the same as restore

Optional Cloud:
  Set cloud.enabled=true and PORTABASE_CLOUD_URL / PORTABASE_CLOUD_TOKEN
  for health events only. Never required for backup or restore.

Required secrets stay in environment variables and are never written into a capsule.
`);
}

/**
 * Replay = prove the bundle works by writing into a blank, new Supabase project.
 * Refuses source == target. Never required to use Portabase Cloud.
 */
async function replay() {
  console.log([
    'Portabase REPLAY',
    'Validate a recovery capsule by moving it into a NEW Supabase project/account.',
    'Source project is never written. Target must be blank and explicitly confirmed.',
    '',
  ].join('\n'));

  if (!flag('confirm-target') && !flag('confirm-target', argv[2])) {
    // allow: portabase replay <capsuleDir> --confirm-target ref
  }
  const confirm = flag('confirm-target');
  if (!confirm) {
    throw new Error('replay requires --confirm-target <NEW_PROJECT_REF> (exact new project ref, never the source).');
  }
  if (!process.env.PORTABASE_TARGET_PROJECT_REF) {
    throw new Error('Set PORTABASE_TARGET_PROJECT_REF to the new project ref (must match --confirm-target).');
  }
  if (process.env.PORTABASE_TARGET_PROJECT_REF !== confirm) {
    throw new Error('PORTABASE_TARGET_PROJECT_REF must exactly match --confirm-target.');
  }
  if (!process.env.PORTABASE_TARGET_SUPABASE_URL || !(process.env.PORTABASE_TARGET_SERVICE_ROLE_KEY || process.env.PORTABASE_TARGET_SECRET_KEY) || !process.env.PORTABASE_TARGET_DB_URL) {
    throw new Error('Set PORTABASE_TARGET_SUPABASE_URL, PORTABASE_TARGET_SERVICE_ROLE_KEY (or SECRET_KEY), and PORTABASE_TARGET_DB_URL for the new project only.');
  }

  // Force write path used by restore() (unless user asked preflight-only).
  // Must mutate `argv` (the slice hasFlag reads), not only process.argv.
  if (!hasFlag('preflight') && !hasFlag('execute') && !hasFlag('drill')) {
    enableCliFlag(argv, 'execute');
  }

  console.log('REPLAY STEPS: open capsule → decrypt/verify → refuse source target → blank preflight → restore layers → read-back evidence\n');
  await restore();
  if (hasFlag('preflight') && !hasFlag('execute') && !hasFlag('drill')) {
    console.log('\nREPLAY PREFLIGHT ONLY — target not modified. Re-run without --preflight (defaults to --execute) to complete validation.');
  } else {
    console.log('\nREPLAY VALIDATION FINISHED. If evidence status is green, this capsule is proven restorable into a new account. Keep production DNS pointed at source until you deliberately cut over.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (command === 'init') await init();
    else if (command === 'doctor') await doctor();
    else if (command === 'plan') await plan();
    else if (command === 'backup') await backup();
    else if (command === 'verify') await verify();
    else if (command === 'simulate') await simulate();
    else if (command === 'status') await status();
    else if (command === 'prune') await prune();
    else if (command === 'install-schedule') await installSchedule();
    else if (command === 'remove-schedule') await removeSchedule();
    else if (command === 'restore-plan') await restorePlanCommand();
    else if (command === 'restore') await restore();
    else if (command === 'replay') await replay();
    else if (command === 'probe') await probe();
    else help();
  } catch (error) {
    console.error(`\nPortabase failed: ${error.message}`);
    process.exitCode = 1;
  }
}
