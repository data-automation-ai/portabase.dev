#!/usr/bin/env node
/**
 * One-shot: promote leftover work-dir storage files into the content cache
 * and write last-storage-manifest.json so the next backup can resume.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const workStorage = resolve(process.argv[2] || 'portabase-capsules/.work-ekklokrukxmqlahtonnc-2026-08-04T01-40-00.290Z/raw/storage');
const cacheRoot = resolve('portabase-capsules/.storage-object-cache');
const statusDir = resolve('portabase-status');
const url = (process.env.SUPABASE_URL || '').replace(/\/(?:rest|storage)\/v1\/?$/i, '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!existsSync(workStorage)) {
  console.error(`Work storage not found: ${workStorage}`);
  process.exit(1);
}
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

function headers() {
  const h = { apikey: key };
  if (!key.startsWith('sb_secret_') && !key.startsWith('sb_publishable_')) {
    h.Authorization = `Bearer ${key}`;
  } else if (!key.startsWith('sb_')) {
    h.Authorization = `Bearer ${key}`;
  }
  // JWT service_role needs bearer
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

async function listBucketObjects(bucketId, prefix = '') {
  const objects = [];
  let offset = 0;
  for (;;) {
    const response = await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(bucketId)}`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!response.ok) throw new Error(`list ${bucketId}: HTTP ${response.status}`);
    const page = await response.json();
    for (const item of page) {
      const fullName = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.metadata === null || item.id === null) {
        objects.push(...await listBucketObjects(bucketId, fullName));
      } else {
        objects.push({ ...item, fullName });
      }
    }
    if (page.length < 1000) break;
    offset += page.length;
  }
  return objects;
}

function identityKey(object) {
  const size = Number(object.metadata?.size || 0);
  const updated = object.updated_at || object.created_at || '';
  const etag = String(object.metadata?.eTag || object.metadata?.etag || '').trim();
  if (!size && !updated && !etag) return null;
  return createHash('sha256').update(`${size}|${updated}|${etag}`).digest('hex');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolveP, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolveP);
  });
  return hash.digest('hex');
}

const bucketsRes = await fetch(`${url}/storage/v1/bucket`, { headers: headers() });
if (!bucketsRes.ok) throw new Error(`buckets HTTP ${bucketsRes.status}`);
const buckets = await bucketsRes.json();

let totalRemote = 0;
let totalBytes = 0;
let promoted = 0;
let already = 0;
let missing = 0;
const prior = { buckets: [], objectCount: 0, totalBytes: 0, formatVersion: 3 };

for (const bucket of buckets) {
  process.stdout.write(`list ${bucket.id}...\n`);
  const objects = await listBucketObjects(bucket.id);
  totalRemote += objects.length;
  const rec = { id: bucket.id, objects: [] };
  for (const object of objects) {
    const size = Number(object.metadata?.size || 0);
    totalBytes += size;
    const local = join(workStorage, bucket.id, ...object.fullName.split('/'));
    if (!existsSync(local)) {
      missing += 1;
      continue;
    }
    let sha;
    try {
      sha = await sha256File(local);
    } catch {
      missing += 1;
      continue;
    }
    const idKey = identityKey(object);
    const keys = [...new Set([sha, idKey].filter(Boolean))];
    let wrote = false;
    for (const k of keys) {
      const dest = join(cacheRoot, k.slice(0, 2), k);
      if (existsSync(dest)) {
        already += 1;
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      await cp(local, dest, { force: true });
      wrote = true;
    }
    if (wrote) promoted += 1;
    rec.objects.push({
      name: object.fullName,
      size,
      sha256: sha,
      updatedAt: object.updated_at || null,
      etag: object.metadata?.eTag || object.metadata?.etag || null,
      contentType: object.metadata?.mimetype || null,
    });
    prior.objectCount += 1;
    prior.totalBytes += size;
  }
  prior.buckets.push(rec);
  process.stdout.write(`  remote=${objects.length} cached_local=${rec.objects.length}\n`);
}

await mkdir(statusDir, { recursive: true });
await writeFile(join(statusDir, 'last-storage-manifest.json'), `${JSON.stringify(prior, null, 2)}\n`);

const summary = {
  buckets: buckets.length,
  totalRemote,
  totalBytes,
  totalGB: Math.round((totalBytes / 1e9) * 100) / 100,
  promoted,
  already,
  missing,
  priorObjects: prior.objectCount,
  priorGB: Math.round((prior.totalBytes / 1e9) * 100) / 100,
};
console.log(JSON.stringify(summary, null, 2));
console.log(
  `PREFLIGHT remote_objects=${totalRemote} remote_GB=${(totalBytes / 1e9).toFixed(2)} `
  + `resume_ready=${prior.objectCount} still_to_download≈${missing}`,
);
