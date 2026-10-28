import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STORAGE_SHARD_COUNT,
  STORAGE_SHARD_LABELS,
  storageObjectMd5Hex,
  storageShardIndex,
  partitionInto8Shards,
  run8ShardStorageCapture,
  run8ShardStorageRestore,
} from './storage-shards.mjs';

test('8-shard MD5 partitioning maps first hex char into 8 two-char shards (01..ef) with balanced distribution', () => {
  assert.equal(STORAGE_SHARD_COUNT, 8);
  assert.deepEqual(STORAGE_SHARD_LABELS, ['01', '23', '45', '67', '89', 'ab', 'cd', 'ef']);

  const items = Array.from({ length: 1600 }, (_, i) => `bucket-a/folder/object-${i}.bin`);
  const shards = partitionInto8Shards(items, x => x);
  assert.equal(shards.length, 8);
  let total = 0;
  for (const shard of shards) {
    total += shard.items.length;
    assert.ok(shard.items.length > 140 && shard.items.length < 260, `Shard ${shard.hexPair} count=${shard.items.length}`);
    for (const entry of shard.items) {
      const firstHex = entry.md5Hex[0];
      assert.ok(shard.hexPair.includes(firstHex), `MD5 ${entry.md5Hex} should belong to ${shard.hexPair}`);
      assert.equal(storageShardIndex(entry.key), shard.shardIndex);
    }
  }
  assert.equal(total, 1600);
});

test('run8ShardStorageCapture and run8ShardStorageRestore execute across 8 child processes and verify SHA-256', async () => {
  const store = new Map();
  const restoredStore = new Map();
  for (let i = 0; i < 32; i += 1) {
    store.set(`media/file-${i}.txt`, Buffer.from(`payload-content-for-object-${i}-${'x'.repeat(i * 10)}`));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname.startsWith('/storage/v1/object/authenticated/')) {
      const rest = url.pathname.slice('/storage/v1/object/authenticated/'.length);
      const body = restoredStore.get(rest) || store.get(rest);
      if (!body) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(body);
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/')) {
      const rest = url.pathname.slice('/storage/v1/object/'.length);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      restoredStore.set(rest, Buffer.concat(chunks));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ Key: rest }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const root = await mkdtemp(join(tmpdir(), 'portabase-8shard-test-'));

  try {
    const storageDir = join(root, 'storage');
    const tasks = [...store.entries()].map(([key, buf]) => {
      const [bucketId, ...rest] = key.split('/');
      const fullName = rest.join('/');
      return {
        bucketId,
        fullName,
        identity: { size: buf.length, etag: `"etag-${fullName}"`, updatedAt: '2026-10-28T00:00:00Z', contentType: 'text/plain' },
      };
    });

    const progressEvents = [];
    const captured = await run8ShardStorageCapture({
      tasks,
      storageDir,
      sourceUrl: baseUrl,
      serviceRoleKey: 'test-service-role-key',
      concurrencyPerShard: 2,
      onProgress: p => progressEvents.push(p),
    });

    assert.equal(captured.results.length, 32);
    assert.equal(captured.shards.length, 8);
    assert.ok(captured.durationMs >= 0);
    assert.ok(progressEvents.length > 0);

    const restoreTasks = captured.results.map(r => ({
      bucketId: r.bucketId,
      object: r.entry,
    }));

    const restored = await run8ShardStorageRestore({
      tasks: restoreTasks,
      extracted: root,
      targetUrl: baseUrl,
      serviceRoleKey: 'test-service-role-key',
      concurrencyPerShard: 2,
    });

    assert.equal(restored.hashesVerified, 32);
    assert.equal(restored.restoredKeys.length, 32);
    assert.equal(restoredStore.size, 32);
    for (const [key, buf] of store.entries()) {
      assert.deepEqual(restoredStore.get(key), buf);
    }
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
