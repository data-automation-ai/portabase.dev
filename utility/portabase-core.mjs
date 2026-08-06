import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, normalize, relative, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

/** Open-source capsule key protection — see utility/capsule-crypto.mjs */
import {
  CAPSULE_CIPHER,
  CAPSULE_CRYPTO_FORMAT,
  CAPSULE_PASSPHRASE_MIN_LENGTH,
  CAPSULE_SCRYPT,
  capsuleCryptoPublicDescription,
  decryptFile,
  encryptFile,
  hashFile,
  requirePassphrase,
} from './capsule-crypto.mjs';

export {
  CAPSULE_CIPHER,
  CAPSULE_CRYPTO_FORMAT,
  CAPSULE_PASSPHRASE_MIN_LENGTH,
  CAPSULE_SCRYPT,
  capsuleCryptoPublicDescription,
  decryptFile,
  encryptFile,
  hashFile,
  requirePassphrase,
};

export const TRIAL_LIMITS = Object.freeze({
  databaseSchemaOnly: true,
  maxStorageBuckets: 2,
  maxStorageObjects: 5,
  maxFunctions: 2,
});

/**
 * Full DB / Functions / Auth; Storage = first object only in every bucket.
 * Keeps multi-bucket path validated while staying under multi‑GB budgets.
 */
export const FIRST_PER_BUCKET_STORAGE = Object.freeze({
  databaseSchemaOnly: false,
  firstObjectPerBucket: true,
  maxFunctions: null,
});

export function editionFor({ trialFlag = false, environment = process.env.PORTABASE_EDITION } = {}) {
  // Open-core: full capture is the default. Only explicit demo/trial limits payload.
  return trialFlag || environment === 'trial' ? 'trial' : 'community';
}

export function safeObjectPath(value) {
  const cleaned = normalize(String(value).replaceAll('\\', '/')).replace(/^([/\\])+/, '');
  if (!cleaned || cleaned === '.' || cleaned.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe object path: ${value}`);
  }
  return cleaned.split(/[\\/]/).join(sep);
}

/**
 * Stable inventory fingerprint: concatenate sorted keys, hash.
 * Used as a snapshot at capture start (full source listing) and again on destination after restore.
 * Names-only is cheap and independent of downloading every object byte.
 *
 * @param {string[]} keys  e.g. ["bucket/path/to/file.png", ...]
 * @param {'md5'|'sha256'} algo
 * @returns {{ algo: string, count: number, fingerprint: string, method: string }}
 */
export function fingerprintSortedKeys(keys = [], algo = 'md5') {
  const list = (Array.isArray(keys) ? keys : [])
    .map(k => String(k || '').replaceAll('\\', '/').replace(/^\/+/, '').trim())
    .filter(Boolean)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const payload = list.join('\n');
  const hashAlgo = algo === 'sha256' ? 'sha256' : 'md5';
  const fingerprint = createHash(hashAlgo).update(payload, 'utf8').digest('hex');
  return {
    method: 'sorted-names-concat',
    algo: hashAlgo,
    count: list.length,
    fingerprint,
  };
}

/**
 * Build storage object keys from inventory-style structures.
 * Accepts:
 *  - [{ id, objects: [{ fullName|name }] }]
 *  - inventory.buckets from capture
 *  - storage-manifest buckets
 */
export function storageObjectKeysFromBuckets(buckets = []) {
  const keys = [];
  for (const bucket of buckets || []) {
    const bid = bucket.id || bucket.name;
    if (!bid) continue;
    const objects = bucket.objects || [];
    if (objects.length === 0 && Number(bucket.objectCount) >= 0 && !objects.length) {
      // listing-only inventory rows may only have counts — skip keys
      continue;
    }
    for (const object of objects) {
      const name = object.fullName || object.name || object.path;
      if (!name) continue;
      keys.push(`${bid}/${String(name).replaceAll('\\', '/')}`);
    }
  }
  return keys;
}

/** Compare two fingerprint records from fingerprintSortedKeys. */
export function fingerprintsMatch(a, b) {
  if (!a?.fingerprint || !b?.fingerprint) return false;
  return a.algo === b.algo && a.fingerprint === b.fingerprint && Number(a.count) === Number(b.count);
}

/** Normalize Storage list entry metadata (from supabase-backup DR sync patterns). */
export function storageObjectIdentity(object = {}) {
  const meta = object.metadata || {};
  return {
    size: Number(meta.size ?? meta.contentLength ?? object.size ?? 0) || 0,
    updatedAt: object.updated_at || object.created_at || meta.lastModified || null,
    etag: String(meta.eTag || meta.etag || meta.ETag || '').trim() || null,
    contentType: meta.mimetype || meta.contentType || meta.type || null,
  };
}

/**
 * Resume helper: skip re-download when a local object already matches listing identity.
 * Requires size match; prefers updatedAt/etag when present on both sides.
 */
export function shouldSkipStorageDownload(localStat, listingIdentity, previousRecord = null) {
  if (!localStat || !listingIdentity) return false;
  if (Number(localStat.size) !== Number(listingIdentity.size || 0)) return false;
  if (previousRecord?.sha256 && previousRecord.size === listingIdentity.size) {
    if (listingIdentity.updatedAt && previousRecord.updatedAt && previousRecord.updatedAt === listingIdentity.updatedAt) return true;
    if (listingIdentity.etag && previousRecord.etag && previousRecord.etag === listingIdentity.etag) return true;
    // Same size + prior successful capture of this path in this run's temp is enough only when etag/updated present and match
  }
  if (listingIdentity.updatedAt && previousRecord?.updatedAt && previousRecord.updatedAt === listingIdentity.updatedAt
    && Number(previousRecord.size) === Number(listingIdentity.size)) {
    return true;
  }
  if (listingIdentity.etag && previousRecord?.etag && previousRecord.etag === listingIdentity.etag
    && Number(previousRecord.size) === Number(listingIdentity.size)) {
    return true;
  }
  // Local file same size as listing; no prior record — only skip if size known and > 0 and mtime not newer than listing? Conservative: don't skip without priorRecord
  return false;
}

/**
 * Generate human redeploy scripts for Edge Functions (ported from supabase-backup patterns).
 * @param {Array<{ name: string, verifyJwt?: boolean }>} functions
 * @param {{ projectRef?: string, generatedAt?: string }} options
 */
export function generateFunctionRedeployScripts(functions = [], options = {}) {
  const list = functions.map(fn => ({
    name: String(fn.name || fn.slug || '').trim(),
    verifyJwt: fn.verifyJwt !== false && fn.verify_jwt !== false,
  })).filter(fn => fn.name);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const projectRef = options.projectRef || 'YOUR_NEW_PROJECT_REF';

  const ps1 = [
    '# Portabase Edge Function redeploy (generated from capsule)',
    `# Generated: ${generatedAt}`,
    `# Source project: ${projectRef}`,
    `# Functions: ${list.length}`,
    '# USAGE: .\\REDEPLOY-ALL.ps1 -ProjectRef "new-project-ref"',
    '# Requires: Supabase CLI + SUPABASE_ACCESS_TOKEN. Secret values are never in the capsule.',
    'param([Parameter(Mandatory=$true)][string]$ProjectRef)',
    '$ErrorActionPreference = "Stop"',
    '$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$Workspace = Join-Path ([System.IO.Path]::GetTempPath()) ("portabase-fn-restore-" + [guid]::NewGuid().ToString("N"))',
    'New-Item -ItemType Directory -Path (Join-Path $Workspace "supabase\\functions") -Force | Out-Null',
    '$ok = 0; $fail = 0',
    '',
  ];
  for (const fn of list) {
    const noJwt = fn.verifyJwt ? '' : ' --no-verify-jwt';
    ps1.push(`Write-Host "Deploying ${fn.name}..." -ForegroundColor Yellow`);
    ps1.push('try {');
    ps1.push(`  $src = Join-Path $ScriptDir "${fn.name}"`);
    ps1.push(`  $dst = Join-Path $Workspace "supabase\\functions\\${fn.name}"`);
    ps1.push('  Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force');
    ps1.push('  Push-Location $Workspace');
    ps1.push('  try {');
    ps1.push(`    npx --yes supabase@${options.supabaseCliVersion || PINNED_SUPABASE_CLI} functions deploy ${fn.name} --project-ref $ProjectRef${noJwt}`);
    ps1.push('    if ($LASTEXITCODE -ne 0) { throw "CLI exit $LASTEXITCODE" }');
    ps1.push('  } finally { Pop-Location }');
    ps1.push(`  Write-Host "  OK ${fn.name}" -ForegroundColor Green; $ok++`);
    ps1.push('} catch { Write-Host "  FAIL ${fn.name}: $_" -ForegroundColor Red; $fail++ }');
    ps1.push('');
  }
  ps1.push('Remove-Item -LiteralPath $Workspace -Recurse -Force -ErrorAction SilentlyContinue');
  ps1.push('Write-Host "Redeploy done. ok=$ok fail=$fail"');
  ps1.push('if ($fail -gt 0) { throw "One or more function deploys failed." }');
  ps1.push('');

  const bash = [
    '#!/usr/bin/env bash',
    '# Portabase Edge Function redeploy (generated from capsule)',
    `# Generated: ${generatedAt}`,
    `# Source project: ${projectRef}`,
    'set -euo pipefail',
    'PROJECT_REF="${1:-}"',
    'if [[ -z "$PROJECT_REF" ]]; then echo "Usage: ./redeploy-all.sh <new-project-ref>"; exit 1; fi',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'WORKSPACE="$(mktemp -d)"',
    'mkdir -p "$WORKSPACE/supabase/functions"',
    'OK=0; FAIL=0',
    'cleanup() { rm -rf "$WORKSPACE"; }',
    'trap cleanup EXIT',
    '',
  ];
  for (const fn of list) {
    const noJwt = fn.verifyJwt ? '' : ' --no-verify-jwt';
    bash.push(`echo "Deploying ${fn.name}..."`);
    bash.push(`cp -R "$SCRIPT_DIR/${fn.name}" "$WORKSPACE/supabase/functions/${fn.name}"`);
    bash.push('(');
    bash.push('  cd "$WORKSPACE"');
    bash.push(`  if npx --yes supabase@${options.supabaseCliVersion || PINNED_SUPABASE_CLI} functions deploy ${fn.name} --project-ref "$PROJECT_REF"${noJwt}; then`);
    bash.push('    OK=$((OK+1)); echo "  OK"');
    bash.push('  else');
    bash.push('    FAIL=$((FAIL+1)); echo "  FAIL"');
    bash.push('  fi');
    bash.push(')');
    bash.push('');
  }
  bash.push('echo "Redeploy done. ok=$OK fail=$FAIL"');
  bash.push('[[ "$FAIL" -eq 0 ]]');
  bash.push('');

  const cliPin = options.supabaseCliVersion || PINNED_SUPABASE_CLI;
  return {
    functions: list,
    ps1: ps1.join('\n'),
    bash: bash.join('\n'),
    manifest: {
      formatVersion: 1,
      generatedAt,
      sourceProjectRef: projectRef,
      totalFunctions: list.length,
      supabaseCliVersion: cliPin,
      functions: list.map(fn => ({ name: fn.name, verifyJwt: fn.verifyJwt })),
      secretsNote: 'Secret values are never exported. Recreate secrets on the target before cutover.',
    },
  };
}

/**
 * Content-addressed storage cache key (W1 — avoid re-downloading identical object bytes).
 */
export function storageCacheKey(identity = {}, sha256 = '') {
  if (sha256 && /^[a-f0-9]{64}$/i.test(sha256)) return sha256.toLowerCase();
  const size = Number(identity.size || 0);
  const updated = identity.updatedAt || '';
  const etag = identity.etag || '';
  if (!size && !updated && !etag) return null;
  return createHash('sha256').update(`${size}|${updated}|${etag}`).digest('hex');
}

/**
 * Run async work over items with a fixed concurrency pool.
 * Preserves result order. Used for Storage object downloads (and similar IO-bound fan-out).
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(1, Math.min(Number(concurrency) || 1, 64));
  const results = new Array(list.length);
  let next = 0;
  async function runWorker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= list.length) return;
      results[i] = await worker(list[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(n, list.length || 1) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

/** Default parallel Storage object downloads (override via PORTABASE_STORAGE_CONCURRENCY or config.capture.storageConcurrency). */
export const DEFAULT_STORAGE_CONCURRENCY = 8;

export function resolveStorageConcurrency(config = {}) {
  const fromEnv = Number(process.env.PORTABASE_STORAGE_CONCURRENCY);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.min(64, Math.floor(fromEnv));
  const fromConfig = Number(config.capture?.storageConcurrency);
  if (Number.isFinite(fromConfig) && fromConfig >= 1) return Math.min(64, Math.floor(fromConfig));
  return DEFAULT_STORAGE_CONCURRENCY;
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
  const root = String(provider.path || '/Portabase').replace(/^\/+|\/+$/g, '');
  return `${remote}:${root}/${basename(capsuleDir)}`;
}

/** Pinned Supabase CLI for generated redeploy scripts (avoid @latest drift). */
export const PINNED_SUPABASE_CLI = '2.12.1';

/**
 * Platform Postgres schemas excluded from application dumps (W10 — single source of truth).
 * Bump SCHEMA_EXCLUDE_VERSION when Supabase adds platform schemas.
 */
export const SCHEMA_EXCLUDE_VERSION = 2;
export const PLATFORM_SCHEMA_EXCLUDES = Object.freeze([
  'information_schema', 'pg_*', '_analytics', '_realtime', '_supavisor', 'auth', 'etl',
  'extensions', 'pgbouncer', 'realtime', 'storage', 'supabase_functions', 'supabase_migrations',
  'cron', 'dbdev', 'graphql', 'graphql_public', 'net', 'pgmq', 'pgsodium', 'pgsodium_masks',
  'pgtle', 'repack', 'tiger', 'tiger_data', 'timescaledb_*', '_timescaledb_*', 'topology', 'vault',
]);

export function schemaExcludePattern(list = PLATFORM_SCHEMA_EXCLUDES) {
  return list.join('|');
}

/** Data dump excludes (includes auth data tables handled separately if ever expanded). */
export const DATA_SCHEMA_EXCLUDES = Object.freeze([
  'information_schema', 'pg_*', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks', 'pgtle',
  'repack', 'tiger', 'tiger_data', 'timescaledb_*', '_timescaledb_*', 'topology', 'vault', 'etl',
  'extensions', 'pgbouncer', 'realtime', 'storage', 'supabase_functions', 'supabase_migrations',
  '_analytics', '_realtime', '_supavisor',
]);

export function providerCommand(config, capsuleDir) {
  const provider = config.provider || {};
  const prefix = String(provider.prefix || '').replace(/^\/+|\/+$/g, '');
  switch (provider.type) {
    case 'aws': {
      if (!provider.bucket) throw new Error('AWS provider requires bucket.');
      const target = `s3://${provider.bucket}/${prefix ? `${prefix}/` : ''}${basename(capsuleDir)}`;
      // Prefer sync for fewer re-uploads when re-pushing an identical local tree (W1 destination efficiency)
      const useSync = provider.sync !== false;
      if (useSync) {
        return ['aws', ['s3', 'sync', capsuleDir, target, '--only-show-errors', '--checksum-algorithm', 'SHA256']];
      }
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

/**
 * Local Starter vault — for operators with no S3/Dropbox yet.
 * Capsules stay on a folder you own (this PC, USB, NAS path). Soft product limit
 * keeps “Escape on the same laptop only” from becoming the default for multi‑GB projects.
 */
export const LOCAL_STARTER_MAX_BYTES = 100 * 1024 * 1024; // 100 MiB
export const LOCAL_STARTER_MAX_LABEL = '100 MB';

export function isLocalProvider(config) {
  return (config?.provider?.type || config?.type) === 'local';
}

/** Recursively sum file sizes under a directory (encrypted capsule folder). */
export async function directoryByteSize(root) {
  if (!root || !existsSync(root)) return 0;
  let total = 0;
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const s = await stat(full);
        total += Number(s.size) || 0;
      }
    }
  }
  const top = await stat(root);
  if (top.isFile()) return Number(top.size) || 0;
  await walk(root);
  return total;
}

/**
 * Enforce Local Starter size policy.
 * @param {number} bytes - capsule directory size after encrypt
 * @param {{ allowLargeLocal?: boolean, maxBytes?: number }} opts
 * @returns {{ ok: true, bytes: number, maxBytes: number } | never}
 */
export function assertLocalStarterSize(bytes, opts = {}) {
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : LOCAL_STARTER_MAX_BYTES;
  const size = Math.max(0, Number(bytes) || 0);
  const allow = Boolean(opts.allowLargeLocal);
  if (size <= maxBytes || allow) {
    return { ok: true, bytes: size, maxBytes, oversized: size > maxBytes, allowedByOverride: allow && size > maxBytes };
  }
  throw new Error(
    `Local Starter vault refuses capsules over ${formatBytes(maxBytes)} `
    + `(this capsule is ${formatBytes(size)}). `
    + 'Local-only storage is for small projects with no S3/Dropbox yet — '
    + 'the same disk can die with the laptop. '
    + 'Point provider.type at dropbox, google-drive, or aws (recommended Escape), '
    + 'or re-run with --allow-large-local / provider.allowLargeLocal=true if you accept that risk.',
  );
}

export function localStarterPolicyNote() {
  return `Local Starter: encrypted capsules may live on this computer (or USB/NAS path) when ≤ ${LOCAL_STARTER_MAX_LABEL}. `
    + 'Not a substitute for off-machine storage for production Escape.';
}

export function validateRestoreTarget(sourceRef, targetRef, confirmation, targetUrl = '', opts = {}) {
  if (!targetRef) throw new Error('PORTABASE_TARGET_PROJECT_REF is required.');
  if (sourceRef === targetRef && !opts.allowSourceTarget) {
    throw new Error(
      'Restore refused: target project is the source project. '
      + 'For a disposable drill only, pass --allow-source-target.',
    );
  }
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

export function validateBlankRestoreInventory(inventory, opts = {}) {
  const occupied = Object.entries(inventory || {}).filter(([, count]) => Number(count) > 0);
  if (occupied.length && !opts.allowOccupied) {
    throw new Error(
      `Restore refused: target is not blank (${occupied.map(([name, count]) => `${name}=${count}`).join(', ')}). `
      + 'Create a fresh project, clear the disposable target outside Portabase, '
      + 'or pass --allow-occupied-target for an explicit dirty-target drill.',
    );
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

/**
 * Pure-Node tar.gz of a directory (POSIX ustar). Used when system tar fails
 * (Windows path issues, missing drive, etc.). Paths are relative with `/`.
 */
export async function packDirectoryTarGz(sourceDir, archivePath) {
  async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walk(full));
      else if (entry.isFile()) out.push(full);
    }
    return out;
  }

  function checksum(buf) {
    let sum = 8 * 32; // eight spaces in checksum field
    for (let i = 0; i < 512; i += 1) {
      if (i >= 148 && i < 156) continue;
      sum += buf[i];
    }
    return sum;
  }

  function header(name, size, type = '0') {
    const block = Buffer.alloc(512, 0);
    const nameUtf8 = Buffer.from(name, 'utf8');
    if (nameUtf8.length > 100) {
      // ustar prefix split
      const slash = name.lastIndexOf('/', 155);
      if (slash <= 0 || name.length - slash - 1 > 100) {
        throw new Error(`Path too long for ustar: ${name}`);
      }
      const prefix = name.slice(0, slash);
      const base = name.slice(slash + 1);
      Buffer.from(base, 'utf8').copy(block, 0);
      Buffer.from(prefix, 'utf8').copy(block, 345);
    } else {
      nameUtf8.copy(block, 0);
    }
    Buffer.from('0000644\0', 'utf8').copy(block, 100); // mode
    Buffer.from('0000000\0', 'utf8').copy(block, 108); // uid
    Buffer.from('0000000\0', 'utf8').copy(block, 116); // gid
    Buffer.from(`${size.toString(8).padStart(11, '0')}\0`, 'utf8').copy(block, 124);
    Buffer.from(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 'utf8').copy(block, 136);
    Buffer.from('        ', 'utf8').copy(block, 148); // checksum placeholder
    block[156] = type.charCodeAt(0);
    Buffer.from('ustar\0', 'utf8').copy(block, 257);
    Buffer.from('00', 'utf8').copy(block, 263);
    const sum = checksum(block);
    Buffer.from(`${sum.toString(8).padStart(6, '0')}\0 `, 'utf8').copy(block, 148);
    return block;
  }

  const files = (await walk(sourceDir)).sort();
  const gzip = createGzip({ level: 6 });
  const output = createWriteStream(archivePath);
  const done = pipeline(gzip, output);

  for (const full of files) {
    const rel = relative(sourceDir, full).split(sep).join('/');
    if (!rel || rel.startsWith('..')) continue;
    const info = await stat(full);
    const size = info.size;
    gzip.write(header(rel, size, '0'));
    if (size > 0) {
      await new Promise((resolveWrite, reject) => {
        const stream = createReadStream(full);
        stream.on('error', reject);
        stream.on('data', chunk => {
          if (!gzip.write(chunk)) stream.pause();
        });
        gzip.on('drain', () => stream.resume());
        stream.on('end', resolveWrite);
      });
      const pad = (512 - (size % 512)) % 512;
      if (pad) gzip.write(Buffer.alloc(pad, 0));
    }
  }
  gzip.write(Buffer.alloc(1024, 0)); // two zero blocks
  gzip.end();
  await done;
  return { fileCount: files.length, archivePath };
}
