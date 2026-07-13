#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { signLicense } from '../utility/license-format.mjs';

const SOURCE_REF = String(process.env.PORTABASE_DRILL_SOURCE_REF || '');
const ORGANIZATION_SLUG = String(process.env.PORTABASE_DRILL_ORGANIZATION_SLUG || '');
const REGION = String(process.env.PORTABASE_DRILL_REGION || 'eu-west-1');
const POOLER_HOST = String(process.env.PORTABASE_DRILL_POOLER_HOST || `aws-0-${REGION}.pooler.supabase.com`);
const ENV_FILE = resolve(process.env.PORTABASE_DRILL_ENV_FILE || '.env.restore.local');
const PRIVATE_KEY_FILE = resolve(process.env.PORTABASE_LICENSE_PRIVATE_KEY_FILE || 'private/portabase-license-private.pem');
const cli = resolve('utility/portabase.mjs');
const toolsDir = resolve('desktop/vendor');
const runRoot = resolve('.portabase', 'restore-drill', new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'));
const destination = join(runRoot, 'destination');
const evidenceDirectory = join(runRoot, 'evidence');

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const name = line.slice(0, equals);
    let value = line.slice(equals + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
    values[name] = value;
  }
  return values;
}

function runPortaBase(args, env) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: resolve('.'), env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`PortaBase ${args[0]} exited with code ${result.status}.`);
}

function runTool(file, args, env, label) {
  const result = spawnSync(file, args, { cwd: resolve('.'), env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`${label} exited with code ${result.status}.`);
}

async function management(path, token, options = {}, accepted = [200, 201]) {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = path === '/projects' && method === 'POST' ? 1 : 6;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`https://api.supabase.com/v1${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
        signal: options.signal || AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      if (accepted.includes(response.status)) return body;
      const error = new Error(`Supabase Management API ${path} failed with HTTP ${response.status}: ${String(body.message || body.error || body.msg || '').slice(0, 180)}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (/HTTP 4\d\d/.test(error.message) && !/HTTP 429/.test(error.message))) throw error;
    }
    console.log(`RETRY  Supabase Management API ${path} (${attempt}/${attempts})`);
    await new Promise(resolveWait => setTimeout(resolveWait, attempt * 3000));
  }
  throw lastError;
}

async function waitForProject(ref, token, predicate, description, timeoutMs = 12 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const project = await management(`/projects/${ref}`, token);
    const status = String(project.status || 'UNKNOWN');
    if (predicate(status)) return project;
    console.log(`WAIT  ${description}: ${status}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 10000));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function pauseProject(ref, token) {
  await management(`/projects/${ref}/pause`, token, { method: 'POST', body: '{}' });
  await waitForProject(ref, token, status => ['INACTIVE', 'PAUSED'].includes(status), `${ref} to pause`);
}

async function restoreProject(ref, token) {
  const current = await management(`/projects/${ref}`, token);
  if (String(current.status) === 'ACTIVE_HEALTHY') return current;
  await management(`/projects/${ref}/restore`, token, { method: 'POST', body: '{}' });
  return waitForProject(ref, token, status => status === 'ACTIVE_HEALTHY', `${ref} to resume`);
}

async function createTarget(token, dbPassword) {
  const targetName = `portabase-live-drill-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
  const body = JSON.stringify({ name: targetName, organization_slug: ORGANIZATION_SLUG, db_pass: dbPassword, region: REGION });
  const started = Date.now();
  while (Date.now() - started < 6 * 60 * 1000) {
    try {
      return await management('/projects', token, { method: 'POST', body });
    } catch (error) {
      if (!/HTTP 400|HTTP 409|project limit|quota/i.test(error.message)) throw error;
      console.log(`WAIT  target creation rejected temporarily: ${error.message.replace(/:.*/, '')}`);
      await new Promise(resolveWait => setTimeout(resolveWait, 15000));
    }
  }
  throw new Error('Timed out waiting for a free Supabase project slot.');
}

function selectAdminKey(keys) {
  const record = Array.isArray(keys) && (keys.find(item => item.name === 'service_role') || keys.find(item => item.type === 'secret') || keys.find(item => item.name === 'secret'));
  return String(record?.api_key || '');
}

async function main() {
  if (!/^[a-z0-9]{20}$/.test(SOURCE_REF)) throw new Error('Set PORTABASE_DRILL_SOURCE_REF to the synthetic 20-character source ref.');
  if (!/^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/i.test(ORGANIZATION_SLUG)) throw new Error('Set PORTABASE_DRILL_ORGANIZATION_SLUG.');
  if (!existsSync(ENV_FILE) || !existsSync(PRIVATE_KEY_FILE)) throw new Error('The ignored drill env file and private signing key are required.');
  const secrets = parseEnv(await readFile(ENV_FILE, 'utf8'));
  if (secrets.SUPABASE_PROJECT_REF !== SOURCE_REF) throw new Error('The materialized source ref does not match the explicit drill source.');
  const token = secrets.SUPABASE_ACCESS_TOKEN;
  if (!token || !secrets.SUPABASE_DB_PASSWORD || !secrets.SUPABASE_SERVICE_ROLE_KEY || !secrets.SUPABASE_URL) throw new Error('The drill env file is missing required source credentials.');

  const passphrase = randomBytes(32).toString('base64url');
  const targetPassword = randomBytes(32).toString('base64url');
  const privateKey = await readFile(PRIVATE_KEY_FILE, 'utf8');
  const license = signLicense({ licenseVersion: 1, licenseId: randomUUID(), orderId: 'internal-live-restore-drill', edition: 'essentials', platform: process.platform, issuedAt: new Date().toISOString(), updates: 'lifetime', projectAllowance: 1 }, privateKey);
  const sourceDbUrl = `postgresql://postgres.${SOURCE_REF}:${encodeURIComponent(secrets.SUPABASE_DB_PASSWORD)}@${POOLER_HOST}:5432/postgres?sslmode=require`;
  const runtimeConfig = {
    version: 1,
    projectRef: SOURCE_REF,
    backupDirectory: join(runRoot, 'staging'),
    statusDirectory: join(runRoot, 'status'),
    provider: { type: 'local', path: destination },
    capture: { database: true, storage: true, functions: true },
    retention: { keepLast: 2, pruneAfterBackup: false },
    schedule: { everyHours: 6 },
  };
  const env = {
    ...process.env,
    ...secrets,
    SUPABASE_DB_URL: sourceDbUrl,
    PORTABASE_TOOLS_DIR: toolsDir,
    PORTABASE_RUNTIME_CONFIG: JSON.stringify(runtimeConfig),
    PORTABASE_ENCRYPTION_PASSPHRASE: passphrase,
    PORTABASE_LICENSE_ENVELOPE_BASE64: Buffer.from(JSON.stringify(license)).toString('base64'),
    PORTABASE_EVIDENCE_DIRECTORY: evidenceDirectory,
  };

  await mkdir(runRoot, { recursive: true });
  let sourcePaused = false;
  let targetRef = '';
  let targetPaused = false;
  let succeeded = false;
  try {
    console.log('STEP 1/8  Capture a complete, encrypted source capsule');
    runPortaBase(['backup'], env);
    const capsuleNames = (await readdir(destination, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    if (capsuleNames.length !== 1) throw new Error(`Expected exactly one fresh capsule, found ${capsuleNames.length}.`);
    const capsule = join(destination, capsuleNames[0]);
    runPortaBase(['verify', '--capsule', capsule, '--decrypt'], env);

    console.log('STEP 2/8  Pause only the synthetic source to release one free slot');
    await pauseProject(SOURCE_REF, token);
    sourcePaused = true;

    console.log('STEP 3/8  Create a new blank Supabase project');
    const created = await createTarget(token, targetPassword);
    targetRef = String(created.ref || created.id || '');
    if (!/^[a-z0-9]{20}$/.test(targetRef) || targetRef === SOURCE_REF) throw new Error('Supabase did not return a safe distinct target ref.');
    await waitForProject(targetRef, token, status => status === 'ACTIVE_HEALTHY', `${targetRef} to become healthy`);

    console.log('STEP 4/8  Obtain target credentials directly from Supabase');
    const keys = await management(`/projects/${targetRef}/api-keys?reveal=true`, token);
    const adminKey = selectAdminKey(keys);
    if (!adminKey) throw new Error('Target administrator key is not ready.');
    const targetUrl = `https://${targetRef}.supabase.co`;
    const targetDbUrl = `postgresql://postgres.${targetRef}:${encodeURIComponent(targetPassword)}@${POOLER_HOST}:5432/postgres?sslmode=require`;
    const targetEnv = {
      ...env,
      PORTABASE_TARGET_PROJECT_REF: targetRef,
      PORTABASE_TARGET_SUPABASE_URL: targetUrl,
      PORTABASE_TARGET_SERVICE_ROLE_KEY: adminKey,
      PORTABASE_TARGET_DB_URL: targetDbUrl,
    };

    console.log('STEP 5/8  Generate the dry-run plan and no-write blank-target preflight');
    runPortaBase(['restore', '--capsule', capsule], targetEnv);
    runPortaBase(['restore', '--capsule', capsule, '--preflight'], targetEnv);

    console.log('STEP 6/8  Execute the guarded restore into the confirmed new ref');
    runPortaBase(['restore', '--capsule', capsule, '--execute', '--confirm-target', targetRef], targetEnv);

    console.log('STEP 7/8  Run fixture SQL and live Function acceptance checks');
    const psql = process.platform === 'win32' ? join(toolsDir, 'postgres', 'bin', 'psql.exe') : join(toolsDir, 'postgres', 'bin', 'psql');
    const pgEnv = { ...targetEnv, PGHOST: POOLER_HOST, PGPORT: '5432', PGDATABASE: 'postgres', PGUSER: `postgres.${targetRef}`, PGPASSWORD: targetPassword, PGSSLMODE: 'require' };
    runTool(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve('scripts/validate-restore-drill.sql')], pgEnv, 'Target SQL acceptance');
    for (const name of ['drill-health', 'drill-order-total']) {
      const response = await fetch(`${targetUrl}/functions/v1/${name}`, { headers: { apikey: adminKey, Authorization: `Bearer ${adminKey}` }, signal: AbortSignal.timeout(30000) });
      const text = await response.text();
      let body = {};
      try { body = JSON.parse(text); } catch { body = {}; }
      if (!response.ok || body.ok !== true) throw new Error(`Target Function ${name} failed with HTTP ${response.status}: ${text.slice(0, 160)}`);
      console.log(`PASS  ${name} HTTP ${response.status}`);
    }
    succeeded = true;
  } finally {
    console.log('STEP 8/8  Leave the disposable target paused and restore the original source');
    if (targetRef && !targetPaused) {
      try { await pauseProject(targetRef, token); targetPaused = true; } catch (error) { console.error(`Unable to pause disposable target ${targetRef}: ${error.message}`); }
    }
    if (sourcePaused) {
      try { await restoreProject(SOURCE_REF, token); sourcePaused = false; } catch (error) { console.error(`Unable to resume source ${SOURCE_REF}: ${error.message}`); }
    }
    console.log(JSON.stringify({ succeeded, targetRef: targetRef || null, targetPaused, sourceRestored: !sourcePaused, evidenceDirectory }, null, 2));
  }
  if (!succeeded) throw new Error('Live restore drill did not complete.');
}

main().catch(error => {
  console.error(`LIVE RESTORE DRILL FAILED: ${error.message}`);
  process.exitCode = 1;
});
