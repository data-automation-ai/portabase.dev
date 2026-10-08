import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedManifestSummary } from '../utility/shared-manifest-export.mjs';
import { projectSharedManifest } from '../utility/shared-manifest.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('real CLI exports only to an explicit new file and hashes the capsule bytes', async t => {
  const parent = resolve(tmpdir());
  const root = await mkdtemp(join(parent, 'portabase-sharing-test-'));
  t.after(async () => { if (dirname(resolve(root)) !== parent) throw new Error('unsafe_cleanup'); await rm(root, { recursive: true, force: true }); });
  const capsule = Buffer.from('synthetic-capsule-bytes');
  await writeFile(join(root, 'capsule.pbase'), capsule);
  await writeFile(join(root, 'capsule.json'), JSON.stringify({ projectRef: 'abcdefghijklmnopqrst', createdAt: '2026-10-04T12:00:00Z', status: 'PARTIAL', errors: ['private-error-sentinel'] }));
  const cli = fileURLToPath(new URL('../utility/portabase.mjs', import.meta.url));
  const args = [cli, 'export-manifest', '--capsule', root, '--for-sharing'];
  const run = promisify(execFile);
  await assert.rejects(run(process.execPath, args));
  const out = join(root, 'summary.json');
  const result = await run(process.execPath, [...args, '--out', out]);
  assert.match(result.stdout, /Nothing was uploaded/);
  const bytes = await readFile(out);
  assert.equal(JSON.parse(bytes).capsuleHash, createHash('sha256').update(capsule).digest('hex'));
  assert.ok(!bytes.includes('private-error-sentinel'));
  await assert.rejects(run(process.execPath, [...args, '--out', out]));
  assert.deepEqual(await readFile(out), bytes);
});

test('capsule metadata becomes an importable summary without private names or errors', () => {
  const metadata = { projectRef: 'abcdefghijklmnopqrst', createdAt: '2026-10-04T12:00:00Z', status: 'PARTIAL',
    errors: ['private-secret'], selection: { table: 'private-customers' },
    contents: { database: { summary: { tables: 3 }, error: 'private-password' }, storage: { bucketCount: 1, objectCount: 7, manifestPath: 'private-path' }, functions: { count: 2 } } };
  const result = sharedManifestSummary(metadata, 'a'.repeat(64));
  assert.deepEqual(result.counts, { tableCount: 3, bucketCount: 1, objectCount: 7, functionCount: 2 });
  assert.ok(!JSON.stringify(result).includes('private-'));
  assert.deepEqual(projectSharedManifest(result, { projectRef: metadata.projectRef }), result);
});
test('unknown counts remain absent and malformed metadata cannot become a sharing snapshot', () => {
  const metadata = { projectRef: 'abcdefghijklmnopqrst', createdAt: '2026-10-04T12:00:00Z', status: 'COMPLETE' };
  assert.deepEqual(sharedManifestSummary(metadata, 'b'.repeat(64)).counts, {});
  assert.throws(() => sharedManifestSummary({ ...metadata, projectRef: 'another-project' }, 'b'.repeat(64)));
  assert.throws(() => sharedManifestSummary(metadata, 'not-a-capsule-hash'));
});
