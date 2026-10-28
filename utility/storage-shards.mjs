import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashFile } from './capsule-crypto.mjs';
import { mapPool, projectBaseUrl, safeObjectPath, storageInventoryLine, supabaseHeaders } from './portabase-core.mjs';

export const STORAGE_SHARD_COUNT = 8;
export const STORAGE_SHARD_LABELS = Object.freeze(['01', '23', '45', '67', '89', 'ab', 'cd', 'ef']);

export function storageObjectMd5Hex(key) {
  return createHash('md5').update(String(key)).digest('hex');
}

export function storageShardIndex(key) {
  const firstHex = storageObjectMd5Hex(key)[0];
  const nibble = Number.parseInt(firstHex, 16);
  return Number.isInteger(nibble) && nibble >= 0 && nibble <= 15 ? (nibble >> 1) : 0;
}

export function partitionInto8Shards(items, getKey = item => String(item?.key ?? item)) {
  const shards = Array.from({ length: STORAGE_SHARD_COUNT }, (_, shardIndex) => ({
    shardIndex,
    hexPair: STORAGE_SHARD_LABELS[shardIndex],
    items: [],
  }));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const key = getKey(item, index);
    const md5Hex = storageObjectMd5Hex(key);
    const shardIndex = Number.parseInt(md5Hex[0], 16) >> 1;
    shards[shardIndex].items.push({ index, key, md5Hex, item });
  }
  return shards;
}

async function fetchWithRetry(url, options = {}, { retries = 4, timeoutMs = 180000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 250 * (2 ** (attempt - 1))));
          continue;
        }
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 250 * (2 ** (attempt - 1))));
      }
    }
  }
  throw lastError || new Error(`Fetch failed after ${retries} attempts: ${url}`);
}

async function runCaptureWorker(inputPath, outputPath) {
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const { shardIndex, hexPair, storageDir, sourceUrl, serviceRoleKey, concurrencyPerShard = 2, tasks } = payload;
  const baseUrl = projectBaseUrl(sourceUrl);
  const headers = supabaseHeaders(serviceRoleKey);
  const startedAt = Date.now();
  let completed = 0;
  let totalBytes = 0;

  const results = await mapPool(tasks, concurrencyPerShard, async task => {
    const { index, bucketId, fullName, identity, skippedPrecheck } = task;
    const target = join(storageDir, safeObjectPath(bucketId), safeObjectPath(fullName));
    await mkdir(dirname(target), { recursive: true });
    let skipped = Boolean(skippedPrecheck);
    if (!skipped) {
      const objectPath = fullName.split('/').map(encodeURIComponent).join('/');
      let response = await fetchWithRetry(`${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucketId)}/${objectPath}`, { headers });
      if (!response.ok) {
        response = await fetchWithRetry(`${baseUrl}/storage/v1/object/${encodeURIComponent(bucketId)}/${objectPath}`, { headers });
      }
      if (!response.ok) {
        throw new Error(`Shard ${shardIndex} (${hexPair}) unable to download ${bucketId}/${fullName}: HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: 'w' }));
    }
    const info = await stat(target);
    const sha256 = await hashFile(target);
    totalBytes += info.size;
    completed += 1;
    if (completed % 10 === 0 || completed === tasks.length) {
      process.stdout.write(`@portabase-shard ${JSON.stringify({ shardIndex, completed, total: tasks.length, bytes: totalBytes })}\n`);
    }
    return {
      index,
      bucketId,
      entry: {
        name: fullName,
        size: info.size,
        sha256,
        updatedAt: identity.updatedAt,
        etag: identity.etag,
        contentType: identity.contentType || null,
        resumed: skipped,
        cacheHit: false,
        downloaded: !skipped,
        incremental: task.incrementalReason || 'full',
        wholeFile: task.wholeFile === true,
        includedInCapsule: true,
        payloadLocation: 'capsule',
      },
    };
  });

  const output = {
    shardIndex,
    hexPair,
    objectCount: results.length,
    totalBytes,
    durationMs: Date.now() - startedAt,
    results,
  };
  await writeFile(outputPath, JSON.stringify(output));
}

async function runRestoreWorker(inputPath, outputPath) {
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const { shardIndex, hexPair, extracted, targetUrl, serviceRoleKey, concurrencyPerShard = 2, tasks } = payload;
  const baseUrl = projectBaseUrl(targetUrl);
  const startedAt = Date.now();
  let hashesVerified = 0;
  let totalBytes = 0;
  const restoredKeys = [];

  await mapPool(tasks, concurrencyPerShard, async task => {
    const { bucketId, object } = task;
    const source = join(extracted, 'storage', safeObjectPath(bucketId), safeObjectPath(object.name));
    const objectPath = object.name.split('/').map(encodeURIComponent).join('/');
    const body = await readFile(source);
    const uploadHeaders = supabaseHeaders(serviceRoleKey, {
      'Content-Type': object.contentType || 'application/octet-stream',
      'x-upsert': 'true',
    });
    const response = await fetchWithRetry(`${baseUrl}/storage/v1/object/${encodeURIComponent(bucketId)}/${objectPath}`, {
      method: 'POST',
      headers: uploadHeaders,
      body,
    });
    if (!response.ok) {
      throw new Error(`Shard ${shardIndex} (${hexPair}) unable to restore ${bucketId}/${object.name}: HTTP ${response.status}`);
    }
    const readback = await fetchWithRetry(`${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucketId)}/${objectPath}`, {
      headers: supabaseHeaders(serviceRoleKey),
    });
    if (!readback.ok) {
      throw new Error(`Shard ${shardIndex} (${hexPair}) unable to read back ${bucketId}/${object.name}: HTTP ${readback.status}`);
    }
    const hash = createHash('sha256');
    for await (const chunk of Readable.fromWeb(readback.body)) hash.update(chunk);
    const remoteHash = hash.digest('hex');
    const expectedHash = object.sha256 || createHash('sha256').update(body).digest('hex');
    if (remoteHash !== expectedHash) {
      throw new Error(`Shard ${shardIndex} (${hexPair}) read-back hash mismatch for ${bucketId}/${object.name}.`);
    }
    hashesVerified += 1;
    totalBytes += body.length;
    restoredKeys.push(storageInventoryLine(bucketId, object.name, object.size ?? body.length));
  });

  const output = {
    shardIndex,
    hexPair,
    hashesVerified,
    totalBytes,
    durationMs: Date.now() - startedAt,
    restoredKeys,
  };
  await writeFile(outputPath, JSON.stringify(output));
}

function spawnShardProcess(mode, inputPath, outputPath, onShardProgress) {
  const scriptPath = fileURLToPath(import.meta.url);
  return new Promise((resolveShard, rejectShard) => {
    const child = spawn(process.execPath, [scriptPath, '--worker', mode, inputPath, outputPath], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let pending = '';
    let stderrText = '';
    child.stdout.on('data', chunk => {
      pending = (pending + chunk.toString()).slice(-8192);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('@portabase-shard ')) continue;
        try {
          onShardProgress?.(JSON.parse(line.slice(17)));
        } catch { /* ignore malformed progress */ }
      }
    });
    child.stderr.on('data', chunk => {
      stderrText = (stderrText + chunk.toString()).slice(-4096);
    });
    child.on('error', rejectShard);
    child.on('close', code => {
      if (code !== 0) rejectShard(new Error(`Storage shard worker (${mode}) exited with code ${code}: ${stderrText.trim()}`));
      else resolveShard();
    });
  });
}

export async function run8ShardStorageCapture({ tasks, storageDir, sourceUrl, serviceRoleKey, concurrencyPerShard = 2, onProgress }) {
  const startedAt = Date.now();
  const shards = partitionInto8Shards(tasks, t => `${t.bucketId}/${t.fullName}`);
  const scratch = await mkdtemp(join(tmpdir(), 'portabase-shards-cap-'));
  const shardProgress = new Array(STORAGE_SHARD_COUNT).fill(0);
  try {
    const activeShards = shards.filter(s => s.items.length > 0);
    await Promise.all(activeShards.map(async shard => {
      const inFile = join(scratch, `shard-${shard.shardIndex}-in.json`);
      const outFile = join(scratch, `shard-${shard.shardIndex}-out.json`);
      await writeFile(inFile, JSON.stringify({
        shardIndex: shard.shardIndex,
        hexPair: shard.hexPair,
        storageDir,
        sourceUrl,
        serviceRoleKey,
        concurrencyPerShard,
        tasks: shard.items.map(entry => ({ ...entry.item, index: entry.index })),
      }));
      await spawnShardProcess('capture', inFile, outFile, msg => {
        shardProgress[shard.shardIndex] = msg.completed || 0;
        const totalCompleted = shardProgress.reduce((a, b) => a + b, 0);
        onProgress?.({ completed: totalCompleted, total: tasks.length });
      });
    }));

    const orderedResults = new Array(tasks.length);
    const shardSummaries = [];
    for (const shard of shards) {
      const outFile = join(scratch, `shard-${shard.shardIndex}-out.json`);
      if (!existsSync(outFile)) {
        shardSummaries.push({ shardIndex: shard.shardIndex, hexPair: shard.hexPair, objectCount: 0, totalBytes: 0, durationMs: 0 });
        continue;
      }
      const data = JSON.parse(await readFile(outFile, 'utf8'));
      for (const r of data.results) orderedResults[r.index] = { bucketId: r.bucketId, entry: r.entry };
      shardSummaries.push({
        shardIndex: data.shardIndex,
        hexPair: data.hexPair,
        objectCount: data.objectCount,
        totalBytes: data.totalBytes,
        durationMs: data.durationMs,
      });
    }
    return {
      results: orderedResults,
      durationMs: Date.now() - startedAt,
      shards: shardSummaries,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function run8ShardStorageRestore({ tasks, extracted, targetUrl, serviceRoleKey, concurrencyPerShard = 2 }) {
  const startedAt = Date.now();
  const shards = partitionInto8Shards(tasks, t => `${t.bucketId}/${t.object.name}`);
  const scratch = await mkdtemp(join(tmpdir(), 'portabase-shards-res-'));
  try {
    const activeShards = shards.filter(s => s.items.length > 0);
    await Promise.all(activeShards.map(async shard => {
      const inFile = join(scratch, `shard-${shard.shardIndex}-in.json`);
      const outFile = join(scratch, `shard-${shard.shardIndex}-out.json`);
      await writeFile(inFile, JSON.stringify({
        shardIndex: shard.shardIndex,
        hexPair: shard.hexPair,
        extracted,
        targetUrl,
        serviceRoleKey,
        concurrencyPerShard,
        tasks: shard.items.map(entry => entry.item),
      }));
      await spawnShardProcess('restore', inFile, outFile);
    }));

    let hashesVerified = 0;
    const restoredKeys = [];
    const shardSummaries = [];
    for (const shard of shards) {
      const outFile = join(scratch, `shard-${shard.shardIndex}-out.json`);
      if (!existsSync(outFile)) {
        shardSummaries.push({ shardIndex: shard.shardIndex, hexPair: shard.hexPair, hashesVerified: 0, totalBytes: 0, durationMs: 0 });
        continue;
      }
      const data = JSON.parse(await readFile(outFile, 'utf8'));
      hashesVerified += data.hashesVerified;
      restoredKeys.push(...data.restoredKeys);
      shardSummaries.push({
        shardIndex: data.shardIndex,
        hexPair: data.hexPair,
        hashesVerified: data.hashesVerified,
        totalBytes: data.totalBytes,
        durationMs: data.durationMs,
      });
    }
    return {
      hashesVerified,
      restoredKeys,
      durationMs: Date.now() - startedAt,
      shards: shardSummaries,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--worker') {
  const mode = process.argv[3];
  const inputPath = process.argv[4];
  const outputPath = process.argv[5];
  const runner = mode === 'capture' ? runCaptureWorker : runRestoreWorker;
  runner(inputPath, outputPath).catch(err => {
    process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
    process.exitCode = 1;
  });
}
