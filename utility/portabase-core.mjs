import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export const TRIAL_LIMITS = Object.freeze({
  databaseSchemaOnly: true,
  maxStorageBuckets: 2,
  maxStorageObjects: 5,
  maxFunctions: 2,
});

export function editionFor({ trialFlag = false, environment = process.env.PORTABASE_EDITION } = {}) {
  return trialFlag || environment === 'trial' ? 'trial' : 'essentials';
}

export function safeObjectPath(value) {
  const cleaned = normalize(String(value).replaceAll('\\', '/')).replace(/^([/\\])+/, '');
  if (!cleaned || cleaned === '.' || cleaned.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe object path: ${value}`);
  }
  return cleaned.split(/[\\/]/).join(sep);
}

export function isModernApiKey(key = '') {
  return key.startsWith('sb_secret_') || key.startsWith('sb_publishable_');
}

export function supabaseHeaders(key, extra = {}) {
  if (!key) throw new Error('A Supabase API key is required.');
  return {
    apikey: key,
    ...(!isModernApiKey(key) ? { Authorization: `Bearer ${key}` } : {}),
    ...extra,
  };
}

export function projectBaseUrl(value) {
  if (!value) throw new Error('A Supabase project URL is required.');
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/(?:rest|storage)\/v1\/?$/i, '/');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function providerRemote(config, capsuleDir) {
  const provider = config.provider || {};
  if (provider.type === 'aws') {
    const prefix = String(provider.prefix || '').replace(/^\/+|\/+$/g, '');
    return `s3://${provider.bucket}/${prefix ? `${prefix}/` : ''}${basename(capsuleDir)}`;
  }
  const remote = provider.remote || (provider.type === 'google-drive' ? 'gdrive' : 'dropbox');
  const root = String(provider.path || '/PortaBase').replace(/^\/+|\/+$/g, '');
  return `${remote}:${root}/${basename(capsuleDir)}`;
}

export function providerCommand(config, capsuleDir) {
  const provider = config.provider || {};
  const prefix = String(provider.prefix || '').replace(/^\/+|\/+$/g, '');
  switch (provider.type) {
    case 'aws': {
      if (!provider.bucket) throw new Error('AWS provider requires bucket.');
      const target = `s3://${provider.bucket}/${prefix ? `${prefix}/` : ''}${basename(capsuleDir)}`;
      return ['aws', ['s3', 'cp', capsuleDir, target, '--recursive', '--only-show-errors', '--checksum-algorithm', 'SHA256']];
    }
    case 'dropbox':
    case 'google-drive':
    case 'rclone':
      return ['rclone', ['copy', capsuleDir, providerRemote(config, capsuleDir), '--immutable', '--checksum']];
    case 'local':
      return null;
    default:
      throw new Error(`Unsupported provider: ${provider.type}`);
  }
}

export function providerVerifyCommand(config, capsuleDir) {
  if (config.provider?.type === 'aws') {
    // --checksum-mode is download-only in the AWS CLI; upload integrity is already
    // end-to-end verified by --checksum-algorithm SHA256 on the cp. This dry run
    // confirms every capsule file exists at the destination at the right size.
    return ['aws', ['s3', 'sync', capsuleDir, providerRemote(config, capsuleDir), '--dryrun', '--size-only']];
  }
  if (['dropbox', 'google-drive', 'rclone'].includes(config.provider?.type)) {
    return ['rclone', ['check', capsuleDir, providerRemote(config, capsuleDir), '--one-way', '--checksum']];
  }
  return null;
}

export function validateRestoreTarget(sourceRef, targetRef, confirmation, targetUrl = '') {
  if (!targetRef) throw new Error('PORTABASE_TARGET_PROJECT_REF is required.');
  if (sourceRef === targetRef) throw new Error('Restore refused: target project is the source project.');
  if (confirmation !== targetRef) {
    throw new Error('Restore refused: --confirm-target must exactly match the new target project ref.');
  }
  if (targetUrl) {
    const host = new URL(projectBaseUrl(targetUrl)).hostname;
    if (!host.startsWith(`${targetRef}.`) && !host.includes(`.${targetRef}.`)) {
      throw new Error('Restore refused: target URL does not match PORTABASE_TARGET_PROJECT_REF.');
    }
  }
  return true;
}

export function validateBlankRestoreInventory(inventory) {
  const occupied = Object.entries(inventory || {}).filter(([, count]) => Number(count) > 0);
  if (occupied.length) {
    throw new Error(`Restore refused: target is not blank (${occupied.map(([name, count]) => `${name}=${count}`).join(', ')}). Create a fresh project or explicitly clear the disposable target outside PortaBase.`);
  }
  return inventory;
}

export function validateDrillCapsule(edition) {
  if (edition !== 'trial') throw new Error('Limited restore drill requires a current trial capsule.');
  return true;
}

function tableKey(table) {
  return `${table.schema}.${table.name}`;
}

export function compareDatabaseInventories(expected = {}, actual = {}) {
  const expectedTables = new Map((expected.tables || []).map(table => [tableKey(table), Number(table.rows)]));
  const actualTables = new Map((actual.tables || []).map(table => [tableKey(table), Number(table.rows)]));
  const missingTables = [...expectedTables.keys()].filter(key => !actualTables.has(key));
  const unexpectedTables = [...actualTables.keys()].filter(key => !expectedTables.has(key));
  const rowMismatches = [...expectedTables.entries()]
    .filter(([key, rows]) => actualTables.has(key) && actualTables.get(key) !== rows)
    .map(([table, expectedRows]) => ({ table, expected: expectedRows, actual: actualTables.get(table) }));
  const metrics = ['authUsers', 'policies', 'databaseFunctions', 'triggers'].map(name => ({
    name,
    expected: Number(expected[name] || 0),
    actual: Number(actual[name] || 0),
  }));
  const metricMismatches = metrics.filter(metric => metric.expected !== metric.actual);
  return {
    verified: missingTables.length === 0 && unexpectedTables.length === 0 && rowMismatches.length === 0 && metricMismatches.length === 0,
    expectedTableCount: expectedTables.size,
    actualTableCount: actualTables.size,
    expectedRows: [...expectedTables.values()].reduce((total, rows) => total + rows, 0),
    actualRows: [...actualTables.values()].reduce((total, rows) => total + rows, 0),
    missingTables,
    unexpectedTables,
    rowMismatches,
    metricMismatches,
  };
}

export function recoveryEvidenceStatus({ mode, captureStatus, database, storage, functions, error } = {}) {
  if (error) return 'FAILED';
  if (mode === 'plan') return 'PLAN_ONLY';
  if (mode === 'preflight') return 'PREFLIGHT_PASSED';
  const verified = Boolean(database?.verified) && Boolean(storage?.verified) && Boolean(functions?.verified);
  if (!verified) return 'FAILED';
  if (mode === 'limited-drill') return 'LIMITED_DRILL_PASSED';
  return captureStatus === 'COMPLETE' ? 'RECOVERY_DATA_PATH_VERIFIED' : 'FAILED';
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value;
  let unit = -1;
  do { scaled /= 1024; unit += 1; } while (scaled >= 1024 && unit < units.length - 1);
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
}

export function trialProtectionLedger(contents = {}) {
  const database = contents.database || {};
  const storage = contents.storage || {};
  const functions = contents.functions || {};
  const summary = database.summary || null;
  const inventory = storage.inventory || null;
  const schemaOnly = Boolean(database.limited);
  const rows = [];
  rows.push({
    layer: 'Database structure',
    found: summary ? summary.tables : null,
    protected: database.complete || database.files?.includes('schema.sql') ? (summary ? summary.tables : null) : 0,
    unit: 'tables',
    note: 'Schema, policies, triggers, and database functions',
  });
  rows.push({
    layer: 'Database rows',
    found: summary ? summary.rows : null,
    protected: schemaOnly ? 0 : (summary ? summary.rows : null),
    unit: 'rows',
    approximate: Boolean(summary?.approximateRows),
    note: schemaOnly ? 'Trial captures structure only' : null,
  });
  rows.push({
    layer: 'Auth users',
    found: summary ? summary.authUsers : null,
    protected: schemaOnly ? 0 : (summary ? summary.authUsers : null),
    unit: 'users',
    note: schemaOnly ? 'User records are table rows; the trial does not include them' : null,
  });
  rows.push({
    layer: 'Storage files',
    found: inventory ? inventory.objectCount : null,
    protected: Number(storage.objectCount) || 0,
    unit: 'files',
    foundBytes: inventory ? inventory.totalBytes : null,
    protectedBytes: Number(storage.totalBytes) || 0,
  });
  rows.push({
    layer: 'Edge Functions',
    found: Number.isInteger(functions.availableCount) ? functions.availableCount : (functions.skipped ? null : Number(functions.count) || 0),
    protected: functions.skipped ? 0 : Number(functions.count) || 0,
    unit: 'functions',
    note: functions.skipped ? 'Skipped: no access token was provided' : null,
  });
  const secretCount = Array.isArray(functions.secretNames) ? functions.secretNames.length : null;
  rows.push({
    layer: 'Secret values',
    found: secretCount,
    protected: 0,
    unit: 'secrets',
    byDesign: true,
    note: 'Never captured, by design. Capsules stay safe to store anywhere; secret NAMES are inventoried so recovery day has a checklist.',
  });
  const unprotected = rows.filter(row => !row.byDesign && Number(row.found) > Number(row.protected));
  return { rows, unprotectedLayers: unprotected.map(row => row.layer) };
}

export function capsuleName(projectRef, date = new Date()) {
  const stamp = date.toISOString().replaceAll(':', '-').replace('.000Z', 'Z');
  return `${projectRef}-${stamp}`;
}

export function isCapsuleName(projectRef, name) {
  const escaped = String(projectRef).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}(?:\\.\\d{3})?Z$`).test(name);
}

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function requirePassphrase(passphrase) {
  if (!passphrase || passphrase.length < 16) {
    throw new Error('PORTABASE_ENCRYPTION_PASSPHRASE must contain at least 16 characters.');
  }
}

export async function encryptFile(inputPath, outputPath, passphrase, aadText) {
  requirePassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const aad = Buffer.from(aadText, 'utf8');
  cipher.setAAD(aad);
  const plaintextSha256 = await hashFile(inputPath);
  await pipeline(createReadStream(inputPath), cipher, createWriteStream(outputPath, { flags: 'wx' }));
  return {
    format: 'portabase-aes256gcm-v1',
    cipher: 'aes-256-gcm',
    kdf: { name: 'scrypt', N: 32768, r: 8, p: 1, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    aad: Buffer.from(aad).toString('base64'),
    plaintextSha256,
    ciphertextSha256: await hashFile(outputPath),
  };
}

export async function decryptFile(inputPath, outputPath, passphrase, encryption) {
  requirePassphrase(passphrase);
  if (!existsSync(inputPath)) throw new Error(`Encrypted capsule not found: ${inputPath}`);
  if (await hashFile(inputPath) !== encryption.ciphertextSha256) {
    throw new Error('Encrypted capsule checksum does not match capsule metadata.');
  }
  const salt = Buffer.from(encryption.kdf.salt, 'base64');
  const key = await scrypt(passphrase, salt, 32, {
    N: encryption.kdf.N,
    r: encryption.kdf.r,
    p: encryption.kdf.p,
    maxmem: 64 * 1024 * 1024,
  });
  const decipher = createDecipheriv(encryption.cipher, key, Buffer.from(encryption.iv, 'base64'));
  decipher.setAAD(Buffer.from(encryption.aad, 'base64'));
  decipher.setAuthTag(Buffer.from(encryption.authTag, 'base64'));
  await pipeline(createReadStream(inputPath), decipher, createWriteStream(outputPath, { flags: 'wx' }));
  if (await hashFile(outputPath) !== encryption.plaintextSha256) {
    throw new Error('Decrypted capsule checksum does not match capsule metadata.');
  }
}

export async function verifyChecksumFile(root, checksumPath) {
  const lines = (await readFile(checksumPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) {
      results.push({ path: line, ok: false });
      continue;
    }
    const localPath = join(root, safeObjectPath(match[2]));
    results.push({ path: match[2], ok: existsSync(localPath) && await hashFile(localPath) === match[1] });
  }
  return results;
}
