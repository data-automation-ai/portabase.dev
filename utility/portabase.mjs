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
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import {
  capsuleName,
  decryptFile,
  encryptFile,
  hashFile,
  isCapsuleName,
  projectBaseUrl,
  providerCommand,
  providerRemote,
  providerVerifyCommand,
  safeObjectPath,
  supabaseHeaders,
  validateRestoreTarget,
  verifyChecksumFile,
} from './portabase-core.mjs';

export { providerCommand, safeObjectPath, validateRestoreTarget } from './portabase-core.mjs';

const VERSION = '0.2.0';
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
  if (!existsSync(fullPath)) throw new Error(`Config not found: ${fullPath}. Run "portabase init" first.`);
  const config = JSON.parse(await readFile(fullPath, 'utf8'));
  if (!config.projectRef) throw new Error('Config is missing projectRef.');
  if (!config.provider?.type) throw new Error('Config is missing provider.type.');
  return { path: fullPath, config };
}

function resolveTool(name) {
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

async function captureDatabase(rawDir) {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL is missing.');
  const dbDir = join(rawDir, 'database');
  await mkdir(dbDir, { recursive: true });
  if (resolveTool('pg_dump') && resolveTool('pg_dumpall')) {
    return captureDatabaseNative(dbUrl, dbDir);
  }
  const supabase = resolveTool('supabase');
  if (!supabase) throw new Error('Install PostgreSQL client tools or the Supabase CLI for database capture.');
  const common = ['db', 'dump', '--db-url', dbUrl];
  await run(supabase, [...common, '--file', join(dbDir, 'roles.sql'), '--role-only']);
  await run(supabase, [...common, '--file', join(dbDir, 'schema.sql')]);
  await run(supabase, [...common, '--file', join(dbDir, 'data.sql'), '--use-copy', '--data-only']);
  return { complete: true, files: ['roles.sql', 'schema.sql', 'data.sql'] };
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
const DATA_EXCLUDES = 'information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor';
const RESERVED_ROLES = '(anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin)';

function cleanSchemaLine(line) {
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
  if (new RegExp(`^(GRANT|REVOKE) .+ ON .+ "${SCHEMA_EXCLUDES}"`).test(line)) return `-- ${line}`;
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

async function captureDatabaseNative(dbUrl, dbDir) {
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
    await runToFile(pgDump, ['--data-only', '--quote-all-identifiers', '--role', 'postgres', '--exclude-schema', DATA_EXCLUDES, '--exclude-table', 'auth.schema_migrations', '--exclude-table', 'storage.migrations', '--exclude-table', 'supabase_functions.migrations', '--schema', '*'], rawData, { env });
    await transformSql(rawData, join(dbDir, 'data.sql'), line => /^\\(un)?restrict /.test(line) ? `-- ${line}` : line, 'SET session_replication_role = replica;\n', 'RESET ALL;\n');
  } finally {
    await rm(rawRoles, { force: true });
    await rm(rawSchema, { force: true });
    await rm(rawData, { force: true });
  }
  return { complete: true, engine: 'native-postgresql-client', files: ['roles.sql', 'schema.sql', 'data.sql'] };
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

async function captureStorage(rawDir) {
  const storageDir = join(rawDir, 'storage');
  await mkdir(storageDir, { recursive: true });
  const buckets = await (await checkedSourceFetch('/storage/v1/bucket')).json();
  const manifest = { capturedAt: new Date().toISOString(), buckets: [], objectCount: 0, totalBytes: 0 };
  for (const bucket of buckets) {
    const record = {
      id: bucket.id,
      name: bucket.name,
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit ?? null,
      allowedMimeTypes: bucket.allowed_mime_types ?? null,
      objects: [],
    };
    for (const object of await listBucketObjects(bucket.id)) {
      const target = join(storageDir, safeObjectPath(bucket.id), safeObjectPath(object.fullName));
      await mkdir(dirname(target), { recursive: true });
      const objectPath = object.fullName.split('/').map(encodeURIComponent).join('/');
      const response = await checkedSourceFetch(`/storage/v1/object/authenticated/${encodeURIComponent(bucket.id)}/${objectPath}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: 'wx' }));
      const info = await stat(target);
      record.objects.push({ name: object.fullName, size: info.size, updatedAt: object.updated_at || null, contentType: object.metadata?.mimetype || null });
      manifest.objectCount += 1;
      manifest.totalBytes += info.size;
    }
    manifest.buckets.push(record);
  }
  await writeFile(join(storageDir, 'storage-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { complete: true, bucketCount: manifest.buckets.length, objectCount: manifest.objectCount, totalBytes: manifest.totalBytes };
}

async function captureFunctions(config, rawDir) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) return { complete: false, skipped: true, reason: 'SUPABASE_ACCESS_TOKEN not provided' };
  const supabase = resolveTool('supabase');
  if (!supabase) throw new Error('Supabase CLI is required for Edge Function capture.');
  const functionsDir = join(rawDir, 'functions');
  await mkdir(functionsDir, { recursive: true });
  const result = spawnSync(supabase, ['functions', 'list', '--project-ref', config.projectRef, '--output', 'json', '--workdir', functionsDir], {
    encoding: 'utf8', env: process.env, windowsHide: true, cwd: functionsDir,
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Unable to list Edge Functions.');
  const functions = JSON.parse(result.stdout || '[]');
  for (const fn of functions) {
    await run(supabase, ['functions', 'download', fn.name, '--project-ref', config.projectRef, '--workdir', functionsDir], { cwd: functionsDir, env: process.env });
  }
  return { complete: true, count: functions.length, names: functions.map(fn => fn.name) };
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
  if (verifyRemote) await run(resolveTool(verifyRemote[0]), verifyRemote[1]);
  return { destination: providerRemote(config, capsuleDir), verified: Boolean(verifyRemote) };
}

async function backup() {
  const { config } = await loadConfig();
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
    projectRef: config.projectRef,
    createdAt: new Date().toISOString(),
    status: 'RUNNING',
    contents: {},
    errors: [],
  };
  try {
    for (const [name, enabled, capture] of [
      ['database', config.capture?.database !== false, () => captureDatabase(rawDir)],
      ['storage', config.capture?.storage !== false, () => captureStorage(rawDir)],
      ['functions', config.capture?.functions !== false, () => captureFunctions(config, rawDir)],
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
    manifest.status = manifest.errors.length || Object.values(manifest.contents).some(item => !item.complete) ? 'PARTIAL' : 'COMPLETE';
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
      projectRef: config.projectRef,
      createdAt: manifest.createdAt,
      status: manifest.status,
      contents: manifest.contents,
      errors: manifest.errors,
      encryption,
    };
    await writeFile(join(capsuleDir, 'capsule.json'), `${JSON.stringify(capsuleMetadata, null, 2)}\n`);
    await writeFile(join(capsuleDir, 'RECOVER.txt'), 'This capsule is encrypted. Keep PORTABASE_ENCRYPTION_PASSPHRASE outside the backup destination. Use PortaBase restore without --execute to inspect the recovery plan.\n');
    await writeChecksums(capsuleDir);
    const transfer = await transferCapsule(config, capsuleDir);
    const state = { state: manifest.status, capsule: id, completedAt: new Date().toISOString(), destination: transfer.destination, verified: transfer.verified, errors: manifest.errors };
    await writeStatus(config, state);
    await sendAlert(config, state);
    console.log(`\n${manifest.status}: ${capsuleDir}`);
    console.log(`VERIFIED DESTINATION: ${transfer.destination}`);
    if (manifest.status !== 'COMPLETE') process.exitCode = 3;
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
  for (const file of ['roles.sql', 'schema.sql', 'data.sql']) {
    const path = join(extracted, 'database', file);
    if (existsSync(path)) await run(psql, [targetDb, '--set', 'ON_ERROR_STOP=1', '--file', path]);
  }
}

async function restoreStorage(extracted) {
  const manifestPath = join(extracted, 'storage', 'storage-manifest.json');
  if (!existsSync(manifestPath)) return;
  const storage = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const bucket of storage.buckets) {
    const created = await targetFetch('/storage/v1/bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket.id, name: bucket.name, public: bucket.public, file_size_limit: bucket.fileSizeLimit, allowed_mime_types: bucket.allowedMimeTypes }),
    });
    if (!created.ok && created.status !== 409) throw new Error(`Unable to create bucket ${bucket.id}: HTTP ${created.status}`);
    for (const object of bucket.objects) {
      const source = join(extracted, 'storage', safeObjectPath(bucket.id), safeObjectPath(object.name));
      const objectPath = object.name.split('/').map(encodeURIComponent).join('/');
      const response = await targetFetch(`/storage/v1/object/${encodeURIComponent(bucket.id)}/${objectPath}`, {
        method: 'POST',
        headers: { 'Content-Type': object.contentType || 'application/octet-stream', 'x-upsert': 'false' },
        body: createReadStream(source),
        duplex: 'half',
      });
      if (!response.ok && response.status !== 409) throw new Error(`Unable to restore ${bucket.id}/${object.name}: HTTP ${response.status}`);
    }
  }
}

async function restoreFunctions(extracted, manifest, targetRef) {
  const functions = manifest.contents.functions;
  if (!functions?.complete || !functions.names?.length) return;
  const supabase = resolveTool('supabase');
  if (!supabase || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Supabase CLI and SUPABASE_ACCESS_TOKEN are required to restore Edge Functions.');
  for (const name of functions.names) {
    const workdir = join(extracted, 'functions');
    await run(supabase, ['functions', 'deploy', name, '--project-ref', targetRef, '--workdir', workdir], { cwd: workdir, env: process.env });
  }
}

async function restore() {
  const capsuleDir = resolve(flag('capsule', argv[1] || '.'));
  const opened = await openCapsule(capsuleDir, process.env.PORTABASE_ENCRYPTION_PASSPHRASE);
  try {
    const { manifest, metadata, extracted } = opened;
    console.log(`PortaBase guarded recovery plan\n\nSource: ${manifest.projectRef}\nCapsule: ${metadata.id}\nCapture status: ${manifest.status}\n`);
    for (const name of ['database', 'storage', 'functions']) {
      const item = manifest.contents[name];
      console.log(`${item?.complete ? 'READY' : 'GAP  '}  ${name}${item?.reason ? ` — ${item.reason}` : ''}${item?.error ? ` — ${item.error}` : ''}`);
    }
    console.log('\nManual reconfiguration remains: Auth providers/templates, project API keys, Realtime settings, external secrets, custom domains, and DNS cutover.');
    if (!hasFlag('execute')) {
      console.log('\nDRY RUN ONLY. No target was changed. Add --execute --confirm-target <NEW_REF> after reviewing this plan.');
      return;
    }
    const targetRef = process.env.PORTABASE_TARGET_PROJECT_REF;
    validateRestoreTarget(manifest.projectRef, targetRef, flag('confirm-target'), process.env.PORTABASE_TARGET_SUPABASE_URL);
    const health = await targetFetch('/storage/v1/bucket', { signal: AbortSignal.timeout(10000) });
    if (!health.ok) throw new Error(`Target credential check failed: HTTP ${health.status}`);
    console.log(`\nTARGET CONFIRMED: ${targetRef}`);
    await restoreDatabase(extracted);
    await restoreStorage(extracted);
    await restoreFunctions(extracted, manifest, targetRef);
    console.log('\nRESTORE DATA PATH COMPLETE. Finish and verify the listed manual configuration before cutover.');
  } finally {
    await rm(opened.temp, { recursive: true, force: true });
  }
}

async function status() {
  const { config } = await loadConfig();
  const path = join(resolve(config.statusDirectory || './portabase-status'), 'latest.json');
  if (!existsSync(path)) throw new Error('No backup status exists yet.');
  const current = JSON.parse(await readFile(path, 'utf8'));
  console.log(JSON.stringify(current, null, 2));
  if (!['COMPLETE', 'RUNNING'].includes(current.state)) process.exitCode = 5;
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
  console.log(`PortaBase ${VERSION}\n\nEncrypted, customer-owned Supabase recovery capsules. No telemetry. No credential custody.\n\nCommands:\n  init                Create a non-secret Essentials configuration\n  doctor              Test tools, credentials, destination, and live authorization\n  plan                Show the capture and destination plan\n  backup              Capture, encrypt, transfer, and verify a capsule\n  verify              Verify checksums; add --decrypt for authenticated decryption\n  status              Show the last durable backup result\n  prune               Preview retention; add --execute to delete recognized capsules\n  install-schedule    Preview a scheduled backup; add --execute to install\n  remove-schedule     Preview task removal; add --execute to remove\n  restore             Decrypt and plan restore; execution requires two target guards\n\nRequired secrets stay in environment variables and are never written into a capsule.\n`);
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
