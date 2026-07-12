#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { pathToFileURL } from 'node:url';

const VERSION = '0.1.0';
const CONFIG_NAME = 'portabase.config.json';
const args = process.argv.slice(2);
const command = args[0] || 'help';

export function safeObjectPath(value) {
  const cleaned = normalize(String(value).replaceAll('\\', '/')).replace(/^([/\\])+/, '');
  if (!cleaned || cleaned === '.' || cleaned.split(/[\\/]/).includes('..')) throw new Error(`Unsafe object path: ${value}`);
  return cleaned.split(/[\\/]/).join(sep);
}

export function providerCommand(config, capsuleDir) {
  const provider = config.provider || {};
  const prefix = provider.prefix ? `/${provider.prefix.replace(/^\/+|\/+$/g, '')}` : '';
  switch (provider.type) {
    case 'aws':
      if (!provider.bucket) throw new Error('AWS provider requires bucket.');
      return ['aws', ['s3', 'sync', capsuleDir, `s3://${provider.bucket}${prefix}/${basename(capsuleDir)}`, '--only-show-errors']];
    case 'gcp':
      if (!provider.bucket) throw new Error('GCP provider requires bucket.');
      return ['gcloud', ['storage', 'rsync', '--recursive', capsuleDir, `gs://${provider.bucket}${prefix}/${basename(capsuleDir)}`]];
    case 'azure':
      if (!provider.account || !provider.container) throw new Error('Azure provider requires account and container.');
      return ['az', ['storage', 'blob', 'upload-batch', '--account-name', provider.account, '--destination', `${provider.container}${prefix}`, '--source', capsuleDir, '--overwrite']];
    case 'dropbox':
      return ['rclone', ['copy', capsuleDir, `${provider.remote || 'dropbox'}:${provider.path || '/Portabase'}/${basename(capsuleDir)}`]];
    case 'local': return null;
    default: throw new Error(`Unsupported provider: ${provider.type}`);
  }
}

export function validateRestoreTarget(sourceRef, targetRef, confirmation) {
  if (!targetRef) throw new Error('PORTABASE_TARGET_PROJECT_REF is required.');
  if (sourceRef === targetRef) throw new Error('Restore refused: target project is the source project.');
  if (confirmation !== targetRef) throw new Error('Restore refused: --confirm-target must exactly match the new target project ref.');
  return true;
}

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
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
  return { path: fullPath, config: JSON.parse(await readFile(fullPath, 'utf8')) };
}

function hasCommand(name) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(lookup, [name], { stdio: 'ignore' }).status === 0;
}

function run(name, commandArgs, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(name, commandArgs, { stdio: 'inherit', shell: false, ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${name} exited with code ${code}`)));
  });
}

async function init() {
  const projectRef = flag('project-ref') || await ask('Supabase project ref');
  const providerType = flag('provider') || await ask('Recovery provider (aws, gcp, azure, dropbox, local)', 'aws');
  const config = {
    version: 1,
    projectRef,
    backupDirectory: flag('directory', './portabase-capsules'),
    provider: { type: providerType },
    capture: { database: true, storage: true, functions: true }
  };

  if (providerType === 'aws' || providerType === 'gcp') {
    config.provider.bucket = flag('bucket') || await ask(`${providerType.toUpperCase()} bucket name`);
    config.provider.prefix = flag('prefix', 'supabase/production');
    if (providerType === 'aws') config.provider.region = flag('region', 'us-east-1');
  } else if (providerType === 'azure') {
    config.provider.account = flag('account') || await ask('Azure storage account');
    config.provider.container = flag('container') || await ask('Azure blob container', 'portabase');
    config.provider.prefix = flag('prefix', 'supabase/production');
  } else if (providerType === 'dropbox') {
    config.provider.remote = flag('remote', 'dropbox');
    config.provider.path = flag('path', '/Portabase');
  }

  if (!projectRef) throw new Error('Project ref is required.');
  await writeFile(resolve(CONFIG_NAME), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  console.log(`\nCreated ${CONFIG_NAME}. No credentials were written.`);
  console.log('Set credentials only in your local environment:');
  console.log('  SUPABASE_DB_URL');
  console.log('  SUPABASE_URL');
  console.log('  SUPABASE_SERVICE_ROLE_KEY');
  console.log('  SUPABASE_ACCESS_TOKEN (optional, for Edge Functions)');
}

async function doctor() {
  const { config } = await loadConfig();
  const providerTool = { aws: 'aws', gcp: 'gcloud', azure: 'az', dropbox: 'rclone', local: null }[config.provider?.type];
  const checks = [
    ['Supabase CLI', hasCommand('supabase'), 'required for filtered database exports and Functions'],
    ['SUPABASE_DB_URL', Boolean(process.env.SUPABASE_DB_URL), 'required for database capture'],
    ['SUPABASE_URL', Boolean(process.env.SUPABASE_URL), 'required for Storage capture'],
    ['SUPABASE_SERVICE_ROLE_KEY', Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), 'required for Storage capture'],
    ['SUPABASE_ACCESS_TOKEN', Boolean(process.env.SUPABASE_ACCESS_TOKEN), 'optional; enables Function capture'],
    [providerTool ? `${providerTool} CLI` : 'Local destination', providerTool ? hasCommand(providerTool) : true, 'required for destination upload']
  ];
  console.log(`Portabase ${VERSION} · ${config.provider.type} destination\n`);
  for (const [name, ok, note] of checks) console.log(`${ok ? 'PASS' : 'MISS'}  ${name.padEnd(28)} ${note}`);
  const requiredOk = checks.filter(([name]) => name !== 'SUPABASE_ACCESS_TOKEN').every(([, ok]) => ok);
  if (!requiredOk) process.exitCode = 2;
}

async function captureDatabase(capsuleDir) {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is missing.');
  if (!hasCommand('supabase')) throw new Error('Supabase CLI is required for a hosted-compatible filtered dump.');
  const dbDir = join(capsuleDir, 'database');
  await mkdir(dbDir, { recursive: true });
  const common = ['db', 'dump', '--db-url', process.env.SUPABASE_DB_URL];
  await run('supabase', [...common, '--file', join(dbDir, 'roles.sql'), '--role-only']);
  await run('supabase', [...common, '--file', join(dbDir, 'schema.sql')]);
  await run('supabase', [...common, '--file', join(dbDir, 'data.sql'), '--use-copy', '--data-only']);
  return { complete: true, files: ['roles.sql', 'schema.sql', 'data.sql'] };
}

async function supabaseFetch(path, options = {}) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Supabase Storage ${response.status}: ${await response.text()}`);
  return response;
}

async function captureStorage(capsuleDir) {
  const storageDir = join(capsuleDir, 'storage');
  await mkdir(storageDir, { recursive: true });
  const buckets = await (await supabaseFetch('/storage/v1/bucket')).json();
  const manifest = { capturedAt: new Date().toISOString(), buckets: [], objectCount: 0, totalBytes: 0 };

  for (const bucket of buckets) {
    const bucketRecord = { id: bucket.id, name: bucket.name, public: bucket.public, objects: [] };
    let offset = 0;
    while (true) {
      const page = await (await supabaseFetch(`/storage/v1/object/list/${encodeURIComponent(bucket.id)}`, {
        method: 'POST', body: JSON.stringify({ prefix: '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
      })).json();
      for (const object of page) {
        const target = join(storageDir, safeObjectPath(bucket.id), safeObjectPath(object.name));
        await mkdir(dirname(target), { recursive: true });
        const response = await supabaseFetch(`/storage/v1/object/authenticated/${encodeURIComponent(bucket.id)}/${object.name.split('/').map(encodeURIComponent).join('/')}`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
        const info = await stat(target);
        bucketRecord.objects.push({ name: object.name, size: info.size, updatedAt: object.updated_at || null });
        manifest.objectCount += 1;
        manifest.totalBytes += info.size;
      }
      if (page.length < 1000) break;
      offset += page.length;
    }
    manifest.buckets.push(bucketRecord);
  }
  await writeFile(join(storageDir, 'storage-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { complete: true, bucketCount: manifest.buckets.length, objectCount: manifest.objectCount, totalBytes: manifest.totalBytes };
}

async function captureFunctions(config, capsuleDir) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) return { complete: false, skipped: true, reason: 'SUPABASE_ACCESS_TOKEN not provided' };
  if (!hasCommand('supabase')) throw new Error('Supabase CLI is required for Function capture.');
  const functionsDir = join(capsuleDir, 'functions');
  await mkdir(functionsDir, { recursive: true });
  const result = spawnSync('supabase', ['functions', 'list', '--project-ref', config.projectRef, '--output', 'json'], { encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || 'Unable to list Edge Functions.');
  const functions = JSON.parse(result.stdout || '[]');
  for (const fn of functions) await run('supabase', ['functions', 'download', fn.name, '--project-ref', config.projectRef], { cwd: functionsDir, env: process.env });
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

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function writeChecksums(capsuleDir) {
  const files = (await listFiles(capsuleDir)).filter(path => basename(path) !== 'checksums.sha256').sort();
  const lines = [];
  for (const path of files) lines.push(`${await hashFile(path)}  ${relative(capsuleDir, path).split(sep).join('/')}`);
  await writeFile(join(capsuleDir, 'checksums.sha256'), `${lines.join('\n')}\n`);
  return lines.length;
}

async function writeRecoveryNotes(capsuleDir, manifest) {
  const text = `# Portabase Recovery Capsule\n\nCreated: ${manifest.createdAt}\nStatus: ${manifest.status}\nSource project ref: ${manifest.projectRef}\n\n## Safety\n\nNever restore into the source production database. Create a new Supabase account/project and confirm its new project ref explicitly.\n\n## Contents\n\n- database/roles.sql, schema.sql, data.sql\n- storage/ object bytes and storage-manifest.json\n- functions/ downloaded Edge Function source when authorized\n- checksums.sha256\n\n## Restore outline\n\n1. Create a fresh authorized Supabase account and empty project.\n2. Match required Postgres extensions and service settings.\n3. Set the PORTABASE_TARGET_* environment variables locally.\n4. Run portabase restore --capsule <path> to preview the plan.\n5. Run again with --execute --confirm-target <NEW_PROJECT_REF>.\n6. Re-enter external provider secrets that cannot be exported.\n7. Verify RLS, Auth, Storage and application endpoints before cutover.\n`;
  await writeFile(join(capsuleDir, 'RECOVER.md'), text);
}

async function backup() {
  const { config } = await loadConfig();
  const stamp = new Date().toISOString().replaceAll(':', '-').replace('.000Z', 'Z');
  const capsuleDir = resolve(config.backupDirectory || './portabase-capsules', `${config.projectRef}-${stamp}`);
  await mkdir(capsuleDir, { recursive: true });
  const manifest = { version: 1, portabaseVersion: VERSION, projectRef: config.projectRef, createdAt: new Date().toISOString(), status: 'RUNNING', destination: config.provider.type, contents: {}, errors: [] };
  console.log(`Creating capsule ${capsuleDir}\n`);

  for (const [name, enabled, capture] of [
    ['database', config.capture?.database !== false, captureDatabase],
    ['storage', config.capture?.storage !== false, captureStorage],
    ['functions', config.capture?.functions !== false, captureFunctions]
  ]) {
    if (!enabled) { manifest.contents[name] = { complete: false, skipped: true, reason: 'disabled in config' }; continue; }
    try {
      console.log(`Capturing ${name}...`);
      manifest.contents[name] = name === 'functions' ? await capture(config, capsuleDir) : await capture(capsuleDir);
    } catch (error) {
      manifest.contents[name] = { complete: false, error: error.message };
      manifest.errors.push(`${name}: ${error.message}`);
      console.error(`PARTIAL ${name}: ${error.message}`);
    }
  }

  manifest.status = manifest.errors.length || Object.values(manifest.contents).some(item => !item.complete) ? 'PARTIAL' : 'COMPLETE';
  await writeRecoveryNotes(capsuleDir, manifest);
  await writeFile(join(capsuleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.checksumFileCount = await writeChecksums(capsuleDir);
  await writeFile(join(capsuleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeChecksums(capsuleDir);

  const upload = providerCommand(config, capsuleDir);
  if (upload) {
    console.log(`\nUploading to customer-owned ${config.provider.type} destination...`);
    await run(upload[0], upload[1]);
  }
  console.log(`\n${manifest.status}: ${capsuleDir}`);
  if (manifest.status !== 'COMPLETE') process.exitCode = 3;
}

async function verify() {
  const capsuleDir = resolve(flag('capsule', args[1] || '.'));
  const checksumFile = join(capsuleDir, 'checksums.sha256');
  const lines = (await readFile(checksumFile, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  let failures = 0;
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) { failures += 1; continue; }
    const path = join(capsuleDir, safeObjectPath(match[2]));
    const ok = existsSync(path) && await hashFile(path) === match[1];
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${match[2]}`);
    if (!ok) failures += 1;
  }
  console.log(`\n${failures ? 'FAILED' : 'VERIFIED'}: ${lines.length - failures}/${lines.length} files`);
  if (failures) process.exitCode = 4;
}

async function plan() {
  const { config } = await loadConfig();
  console.log(`Portabase recovery plan\n\nProject: ${config.projectRef}\nDestination: ${config.provider.type}\nLocal staging: ${resolve(config.backupDirectory)}\n`);
  console.log('Capture:');
  for (const name of ['database', 'storage', 'functions']) console.log(`  ${config.capture?.[name] === false ? 'SKIP' : 'KEEP'}  ${name}`);
  console.log('\nCredentials remain environment-only. No Portabase API or telemetry endpoint is contacted.');
  console.log('Run "portabase doctor" before "portabase backup".');
}

function help() {
  console.log(`Portabase ${VERSION}\n\nCustomer-owned Supabase recovery capsules. No telemetry. No credential custody.\n\nCommands:\n  init       Create a non-secret provider configuration\n  doctor     Check local tools and environment variables\n  plan       Show the exact capture/destination plan\n  backup     Create, checksum and upload a recovery capsule\n  verify     Verify a capsule: portabase verify --capsule <path>\n\nEnvironment-only secrets:\n  SUPABASE_DB_URL\n  SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY\n  SUPABASE_ACCESS_TOKEN (optional)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (command === 'init') await init();
    else if (command === 'doctor') await doctor();
    else if (command === 'plan') await plan();
    else if (command === 'backup') await backup();
    else if (command === 'verify') await verify();
    else help();
  } catch (error) {
    console.error(`\nPortabase failed: ${error.message}`);
    process.exitCode = 1;
  }
}
