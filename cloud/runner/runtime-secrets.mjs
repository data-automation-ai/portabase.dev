import { randomBytes } from 'node:crypto';
import { chmod, lstat, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePrivateDirectory } from './private-config.mjs';

const FILE_NAME = 'runtime-secrets.json';
const MAX_BYTES = 64 * 1024;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const ENV_KEYS = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_DB_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'PORTABASE_ENCRYPTION_PASSPHRASE',
  'PORTABASE_TARGET_PROJECT_REF',
  'PORTABASE_TARGET_SUPABASE_URL',
  'PORTABASE_TARGET_SERVICE_ROLE_KEY',
  'PORTABASE_TARGET_DB_URL',
]);

const fail = code => { throw Object.assign(new Error(code), { code }); };
const bounded = (value, max = 8192) => typeof value === 'string' && value.length <= max
  && !/[\0\r\n]/.test(value);

function httpsUrl(value, code) {
  if (!bounded(value, 2048)) fail(code);
  let parsed;
  try { parsed = new URL(value); } catch { fail(code); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail(code);
  return parsed.toString().replace(/\/$/, '');
}

function postgresUrl(value, code) {
  if (!bounded(value, 8192)) fail(code);
  let parsed;
  try { parsed = new URL(value); } catch { fail(code); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) fail(code);
  return value;
}

function secret(value, code, min = 16) {
  if (!bounded(value) || value.length < min) fail(code);
  return value;
}

function hostedSupabaseUrl(projectRef) {
  if (!PROJECT_REF.test(projectRef || '')) fail('invalid_runtime_secrets');
  return `https://${projectRef}.supabase.co`;
}

function hostedDatabaseUrl(projectRef, password, code) {
  const validatedPassword = secret(password, code, 1);
  if (!PROJECT_REF.test(projectRef || '')) fail('invalid_runtime_secrets');
  const url = new URL(`postgresql://postgres@db.${projectRef}.supabase.co:5432/postgres`);
  url.password = validatedPassword;
  return url.toString();
}

function validatedEnvironment(value, expectedProjectRef) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !ENV_KEYS.includes(key))) fail('invalid_runtime_secrets');
  const env = {};
  if (value.SUPABASE_URL !== undefined) env.SUPABASE_URL = httpsUrl(value.SUPABASE_URL, 'invalid_source_url');
  if (value.SUPABASE_DB_URL !== undefined) env.SUPABASE_DB_URL = postgresUrl(value.SUPABASE_DB_URL, 'invalid_source_database_url');
  if (value.SUPABASE_SERVICE_ROLE_KEY !== undefined) env.SUPABASE_SERVICE_ROLE_KEY = secret(value.SUPABASE_SERVICE_ROLE_KEY, 'invalid_source_service_key');
  if (value.SUPABASE_ACCESS_TOKEN !== undefined) env.SUPABASE_ACCESS_TOKEN = secret(value.SUPABASE_ACCESS_TOKEN, 'invalid_source_access_token', 8);
  if (value.PORTABASE_ENCRYPTION_PASSPHRASE !== undefined) {
    env.PORTABASE_ENCRYPTION_PASSPHRASE = secret(value.PORTABASE_ENCRYPTION_PASSPHRASE, 'invalid_capsule_passphrase');
  }
  if (value.PORTABASE_TARGET_PROJECT_REF !== undefined) {
    if (!PROJECT_REF.test(value.PORTABASE_TARGET_PROJECT_REF)
      || value.PORTABASE_TARGET_PROJECT_REF === expectedProjectRef) fail('invalid_target_project');
    env.PORTABASE_TARGET_PROJECT_REF = value.PORTABASE_TARGET_PROJECT_REF;
  }
  if (value.PORTABASE_TARGET_SUPABASE_URL !== undefined) {
    env.PORTABASE_TARGET_SUPABASE_URL = httpsUrl(value.PORTABASE_TARGET_SUPABASE_URL, 'invalid_target_url');
  }
  if (value.PORTABASE_TARGET_SERVICE_ROLE_KEY !== undefined) {
    env.PORTABASE_TARGET_SERVICE_ROLE_KEY = secret(value.PORTABASE_TARGET_SERVICE_ROLE_KEY, 'invalid_target_service_key');
  }
  if (value.PORTABASE_TARGET_DB_URL !== undefined) {
    env.PORTABASE_TARGET_DB_URL = postgresUrl(value.PORTABASE_TARGET_DB_URL, 'invalid_target_database_url');
  }
  return env;
}

function statusFor(env, updatedAt = null) {
  const source = Boolean(env.SUPABASE_URL && env.SUPABASE_DB_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_ACCESS_TOKEN);
  const target = Boolean(env.PORTABASE_TARGET_PROJECT_REF && env.PORTABASE_TARGET_SUPABASE_URL
    && env.PORTABASE_TARGET_SERVICE_ROLE_KEY && env.PORTABASE_TARGET_DB_URL);
  return {
    sourceConfigured: source,
    sourceManagementAccess: Boolean(env.SUPABASE_ACCESS_TOKEN),
    passphraseConfigured: Boolean(env.PORTABASE_ENCRYPTION_PASSPHRASE),
    targetConfigured: target,
    targetRef: target ? env.PORTABASE_TARGET_PROJECT_REF : null,
    updatedAt,
  };
}

export function privateRuntimeSecretStatus(env = {}, updatedAt = null) {
  return statusFor(env, updatedAt);
}

async function readFileStrict(path, expectedProjectRef) {
  let before;
  try { before = await lstat(path); } catch (error) {
    if (error.code === 'ENOENT') return { env: {}, status: statusFor({}) };
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_BYTES) fail('invalid_runtime_secrets');
  const file = await open(path, 'r');
  try {
    const opened = await file.stat(), bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const after = await file.stat();
    if (bytesRead > MAX_BYTES || bytesRead !== opened.size || opened.size !== after.size
      || opened.mtimeMs !== after.mtimeMs) fail('invalid_runtime_secrets');
    const record = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    if (!record || record.version !== 1 || record.projectRef !== expectedProjectRef
      || typeof record.updatedAt !== 'string' || Object.keys(record).some(key => !['version', 'projectRef', 'updatedAt', 'environment'].includes(key))) {
      fail('invalid_runtime_secrets');
    }
    const env = validatedEnvironment(record.environment, expectedProjectRef);
    return { env, status: statusFor(env, record.updatedAt) };
  } finally { await file.close(); }
}

export async function loadPrivateRuntimeSecrets({ directory, projectRef }) {
  if (!PROJECT_REF.test(projectRef || '')) fail('invalid_runtime_secrets');
  const root = await validatePrivateDirectory(directory);
  return readFileStrict(join(root, FILE_NAME), projectRef);
}

export async function savePrivateRuntimeSecrets({ directory, projectRef }, updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)
    || Object.keys(updates).some(key => !ENV_KEYS.includes(key))) fail('invalid_runtime_secrets');
  const root = await validatePrivateDirectory(directory);
  const path = join(root, FILE_NAME);
  const current = await readFileStrict(path, projectRef);
  const next = validatedEnvironment({ ...current.env, ...updates }, projectRef);
  const targetFields = ['PORTABASE_TARGET_PROJECT_REF', 'PORTABASE_TARGET_SUPABASE_URL',
    'PORTABASE_TARGET_SERVICE_ROLE_KEY', 'PORTABASE_TARGET_DB_URL'];
  const presentTargetFields = targetFields.filter(key => Boolean(next[key]));
  if (presentTargetFields.length && presentTargetFields.length !== targetFields.length) fail('incomplete_target_configuration');
  const updatedAt = new Date().toISOString();
  const bytes = Buffer.from(`${JSON.stringify({ version: 1, projectRef, updatedAt, environment: next }, null, 2)}\n`);
  if (bytes.length > MAX_BYTES) fail('runtime_secrets_too_large');
  const temporary = join(root, `.${FILE_NAME}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  try {
    await lstat(path).then(info => {
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('invalid_runtime_secrets');
    }).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    try { await (await open(temporary, 'r')).close(); } catch { /* rename may have completed */ }
    throw error;
  }
  return { env: next, status: statusFor(next, updatedAt) };
}

export function runtimeSecretUpdates(body, sourceProjectRef) {
  const allowed = {
    sourceServiceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY',
    sourceAccessToken: 'SUPABASE_ACCESS_TOKEN', capsulePassphrase: 'PORTABASE_ENCRYPTION_PASSPHRASE',
    targetRef: 'PORTABASE_TARGET_PROJECT_REF', targetServiceRoleKey: 'PORTABASE_TARGET_SERVICE_ROLE_KEY',
  };
  const accepted = new Set([...Object.keys(allowed), 'sourceDatabasePassword', 'targetDatabasePassword']);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !accepted.has(key))) fail('invalid_runtime_secrets');
  const updates = {};
  for (const [key, envKey] of Object.entries(allowed)) {
    if (body[key] !== undefined && body[key] !== '') updates[envKey] = body[key];
  }
  if (body.sourceDatabasePassword !== undefined && body.sourceDatabasePassword !== '') {
    updates.SUPABASE_URL = hostedSupabaseUrl(sourceProjectRef);
    updates.SUPABASE_DB_URL = hostedDatabaseUrl(sourceProjectRef, body.sourceDatabasePassword, 'invalid_source_database_password');
  }
  if (body.targetDatabasePassword !== undefined && body.targetDatabasePassword !== '') {
    if (!PROJECT_REF.test(body.targetRef || '') || body.targetRef === sourceProjectRef) fail('invalid_target_project');
    updates.PORTABASE_TARGET_SUPABASE_URL = hostedSupabaseUrl(body.targetRef);
    updates.PORTABASE_TARGET_DB_URL = hostedDatabaseUrl(body.targetRef, body.targetDatabasePassword, 'invalid_target_database_password');
  }
  if (!Object.keys(updates).length) fail('invalid_runtime_secrets');
  return updates;
}
