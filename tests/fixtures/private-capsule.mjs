import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptFile } from '../../utility/capsule-crypto.mjs';
import { packDirectoryTarGz } from '../../utility/portabase-core.mjs';
import { createCaptureLog } from '../../utility/capture-log.mjs';

export async function privateCapsuleFixture({ rawArchive, manifestPatch = {}, noLog = false } = {}) {
  if (/^[fF]:/.test(tmpdir())) throw new Error('forbidden_test_directory');
  const directory = await mkdtemp(join(tmpdir(), 'portabase-capsule-review-test-'));
  const raw = join(directory, 'raw'), capsule = join(directory, 'capsule'), archive = join(directory, 'fixture.tar.gz');
  await mkdir(raw); await mkdir(capsule); await mkdir(join(raw, 'database')); await mkdir(join(raw, 'storage'));
  const projectRef = 'abcdefghijklmnopqrst', capsuleId = 'synthetic-capsule-1', createdAt = '2026-10-04T12:00:00.000Z';
  const passphrase = 'synthetic-private-customer-passphrase';
  let descriptor;
  if (!noLog) {
    const log = createCaptureLog({ now: () => Date.parse(createdAt) });
    log.start('database'); log.complete('database', { complete: true }); descriptor = await log.write(raw, 'COMPLETE');
  }
  const manifest = { formatVersion: 1, projectRef, createdAt, status: 'COMPLETE',
    contents: { database: { complete: true }, storage: { complete: true }, functions: { complete: true, names: ['send-receipt'] }, auth: { complete: true } },
    errors: ['private-raw-diagnostic'], ...(descriptor ? { captureLog: descriptor } : {}), ...manifestPatch };
  await writeFile(join(raw, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(raw, 'database', 'data.sql'), 'COPY public.orders (id) FROM stdin;\nprivate-row-value\n\\.\nCOPY "public"."empty" (id) FROM stdin;\n\\.\n');
  await writeFile(join(raw, 'storage', 'storage-manifest.json'), JSON.stringify({ buckets: [{ id: 'images', objects: [{ name: 'private-object.jpg', size: 100 }] }] }));
  if (rawArchive) await writeFile(archive, rawArchive); else await packDirectoryTarGz(raw, archive);
  const encryption = await encryptFile(archive, join(capsule, 'capsule.pbase'), passphrase, capsuleId);
  const metadata = { formatVersion: 1, id: capsuleId, projectRef, createdAt, status: 'COMPLETE', kind: 'full', encryption };
  await writeFile(join(capsule, 'capsule.json'), JSON.stringify(metadata));
  const options = { directory, capsulePath: 'capsule', projectRef, runnerId: '11111111-1111-4111-8111-111111111111', passphrase,
    maxCipherBytes: 1024 * 1024, maxExpandedBytes: 8 * 1024 * 1024 };
  return { directory, raw, capsule, archive, metadata, manifest, options };
}
