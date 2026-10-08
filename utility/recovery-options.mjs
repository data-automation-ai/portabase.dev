import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { hashFile } from './capsule-crypto.mjs';

export function captureOptions(config = {}, args = []) {
  const ddlOnly = args.includes('--ddl-only') || config.capture?.ddlOnly === true;
  const storageInventoryOnly = args.includes('--storage-inventory-only') || config.capture?.storageInventoryOnly === true;
  if (ddlOnly && (args.includes('--include-table-data') || config.capture?.includeTableData?.length)) {
    throw new Error('--ddl-only cannot be combined with --include-table-data.');
  }
  if (storageInventoryOnly && (args.includes('--storage-first-per-bucket') || args.includes('--trial') || config.capture?.storageSample)) {
    throw new Error('--storage-inventory-only requires an unsampled listing.');
  }
  return { ddlOnly, storageInventoryOnly };
}

export function validateRecoveryArgs(command, args) {
  const captureBooleans = 'trial storage-first-per-bucket ddl-only storage-inventory-only delta progress json allow-large-local incremental-binary'.split(' ');
  const captureValues = 'config license exclude-table-data include-table-data exclude-buckets include-buckets baseline'.split(' ');
  const restoreBooleans = 'execute preflight drill json overwrite-target allow-occupied-target allow-source-target'.split(' ');
  const restoreValues = 'capsule baseline restore-plan max-restore-bytes target-db-name confirm-target-db confirm-target storage-to-s3 s3-expected-owner overwrite-scope confirm-overwrite rollback-capsule rollback-evidence'.split(' ');
  const booleans = new Set(command === 'backup' ? captureBooleans : restoreBooleans);
  const values = new Set(command === 'backup' ? captureValues : restoreValues);
  for (let i = 1; i < args.length; i++) {
    if (!args[i].startsWith('-')) {
      if (i === 1 && command !== 'backup') continue; // legacy positional capsule
      throw new Error(`Unexpected argument for ${command}. Use --option value syntax.`);
    }
    const name = args[i].slice(2);
    if (booleans.has(name)) continue;
    if (!values.has(name)) throw new Error(`Unknown or unsupported ${command} option: ${args[i]}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${args[i]} requires a value.`);
    i++;
  }
}

export function inventoryObject(name, identity) {
  return { name, ...identity, presentAtSource: true, includedInCapsule: false,
    payloadLocation: 'not-captured', omissionReason: 'storage-inventory-only', downloaded: false, sha256: null };
}

export function payloadStorage(storage) {
  const buckets = (storage.buckets || []).map(bucket => ({ ...bucket,
    objects: (bucket.objects || []).filter(object => object.includedInCapsule !== false || object.payloadLocation === 'baseline'),
  }));
  const objects = buckets.flatMap(bucket => bucket.objects);
  return { ...storage, buckets, objectCount: objects.length, totalBytes: objects.reduce((sum, object) => sum + Number(object.size || 0), 0) };
}

export function targetDatabaseUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error('PORTABASE_TARGET_DB_URL must be a PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Target must use a PostgreSQL connection URL.');
  if (name !== undefined) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(name)) throw new Error('--target-db-name must be a simple database name (1–63 characters).');
    url.pathname = `/${encodeURIComponent(name)}`;
  }
  return url.toString();
}

export function databaseIdentity(value) {
  const url = new URL(targetDatabaseUrl(value));
  return `${url.hostname}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1) || 'postgres')}`;
}

export function assertDatabaseTarget({ sourceUrl, targetUrl, targetRef, confirmation, overwrite = false }) {
  const identity = databaseIdentity(targetUrl);
  if (sourceUrl && databaseIdentity(sourceUrl) === identity) throw new Error('Target database is the source database.');
  const url = new URL(targetUrl);
  const hosted = url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.com');
  if (hosted && !url.hostname.split('.').includes(targetRef) && decodeURIComponent(url.username) !== `postgres.${targetRef}`) {
    throw new Error('Target database connection does not match the confirmed target project.');
  }
  if ((overwrite || !hosted) && confirmation !== identity) {
    throw new Error(`Confirm the exact target database with --confirm-target-db ${identity}`);
  }
  return identity;
}

export function assertDeltaBaseline(delta, baseline, baselineId) {
  if (baseline.kind === 'delta') throw new Error('Delta baseline must be a full capsule.');
  if (baseline.projectRef !== delta.projectRef) throw new Error('Delta baseline project does not match.');
  if (!delta.baseline?.capsuleId || delta.baseline.capsuleId !== baselineId) throw new Error('Wrong baseline capsule ID.');
  const digest = createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  if (digest !== delta.baseline.manifestSha256) throw new Error('Wrong baseline manifest checksum.');
}

// Reuse requires the exact prior object's authenticated bytes, never an identity-only
// cache key shared by unrelated paths. A corrupted or missing cache is a cache miss.
export async function verifiedCachePath(root, prior, identity, allowTimestampReuse = false) {
  if (!/^[a-f0-9]{64}$/i.test(prior?.sha256 || '')) return null;
  const unchanged = Number(prior.size) === Number(identity.size)
    && (identity.updatedAt || identity.etag)
    && (!identity.updatedAt || identity.updatedAt === prior.updatedAt)
    && (!identity.etag || identity.etag === prior.etag);
  if (!allowTimestampReuse && !unchanged) return null;
  const path = join(root, prior.sha256.slice(0, 2), prior.sha256);
  try {
    if ((await stat(path)).size !== Number(prior.size) || await hashFile(path) !== prior.sha256) return null;
    return path;
  } catch { return null; }
}

export function containedPath(root, relativePath) {
  const value = String(relativePath);
  if (!value || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..') || value.includes(':')) {
    throw new Error('Unsafe capsule relative path.');
  }
  const path = resolve(root, ...value.split('/'));
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error('Capsule path escapes its layer.');
  return path;
}

export async function verifyReferencedFiles(root, references = []) {
  for (const { path, sha256 } of references) {
    if (!/^[a-f0-9]{64}$/i.test(sha256 || '') || await hashFile(containedPath(root, path)) !== sha256) {
      throw new Error('Delta referenced file checksum mismatch.');
    }
  }
}

export async function verifyStoragePayloads(extracted, storage) {
  for (const bucket of payloadStorage(storage).buckets) {
    for (const object of bucket.objects) {
      const path = containedPath(join(extracted, 'storage'), `${bucket.id}/${object.name}`);
      if (!/^[a-f0-9]{64}$/i.test(object.sha256 || '') || (await stat(path)).size !== Number(object.size) || await hashFile(path) !== object.sha256) {
        throw new Error('Storage payload is missing or does not match its manifest.');
      }
    }
  }
}

export async function readStorageManifest(extracted) {
  return JSON.parse(await readFile(join(extracted, 'storage', 'storage-manifest.json'), 'utf8'));
}

export async function assembleDeltaPayload({ deltaRoot, baselineRoot, destination, delta, baseline, baselineId }) {
  assertDeltaBaseline(delta, baseline, baselineId);
  for (const layer of ['database', 'functions']) await verifyReferencedFiles(join(baselineRoot, layer), delta.delta?.[layer]?.reused);
  await mkdir(destination, { recursive: false });
  await cp(baselineRoot, destination, { recursive: true });
  await cp(deltaRoot, destination, { recursive: true, force: true });
  for (const layer of ['database', 'functions']) {
    for (const missing of delta.delta?.[layer]?.missing || []) await rm(containedPath(join(destination, layer), missing), { force: true });
  }
  for (const key of delta.delta?.storage?.tombstones || []) await rm(containedPath(join(destination, 'storage'), key), { force: true });
  await verifyReferencedFiles(join(destination, 'database'), Object.entries(delta.deltaHashes?.database || {}).map(([path, sha256]) => ({ path, sha256 })));
  // Each delta carries a full current inventory; never union it with old inventories.
  const functions = JSON.parse(await readFile(join(deltaRoot, 'functions', 'functions-manifest.json'), 'utf8'));
  for (const fn of functions.functions || functions) await verifyReferencedFiles(join(destination, 'functions', fn.name), fn.files);
  await verifyStoragePayloads(destination, await readStorageManifest(deltaRoot));
  return destination;
}
