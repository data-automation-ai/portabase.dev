import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createPrivateCapsuleReview } from '../utility/ui/private-capsule-review.mjs';
import { startCapsuleReviewServer } from '../utility/ui/capsule-review-server.mjs';
import { projectSharedManifest, sharedManifestBytes } from '../utility/shared-manifest.mjs';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { packDirectoryTarGz } from '../utility/portabase-core.mjs';
import { encryptFile } from '../utility/capsule-crypto.mjs';

test('private summary uses authenticated capsule binding and existing strict dashboard import schema without names or private content', async () => {
  const f = await privateCapsuleFixture();
  // Outer optional content is not authenticated archive evidence.
  await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify({ ...f.metadata, contents: {
    database: { summary: { tables: 99999 } }, storage: { bucketCount: 99999, objectCount: 99999 }, functions: { count: 99999 },
  } }));
  const service = await createPrivateCapsuleReview(f.options);
  await assert.rejects(service.shareableSummary({ revision: 'none' }), { code: 'capsule_review_changed' });
  const review = await service.inspect({}), before = await readdir(f.directory);
  const exported = await service.shareableSummary({ revision: review.revision });
  assert.deepEqual(exported, { schemaVersion: 1, projectRef: f.options.projectRef, capturedAt: f.metadata.createdAt,
    capsuleHash: f.metadata.encryption.ciphertextSha256, status: 'COMPLETE', counts: { bucketCount: 1, objectCount: 1, functionCount: 1 } });
  assert.deepEqual(projectSharedManifest(exported, { projectRef: f.options.projectRef, inventoryConsent: false }), exported);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(sharedManifestBytes(exported, { projectRef: f.options.projectRef }))), exported);
  assert.doesNotMatch(JSON.stringify(exported), /99999|orders|public|empty|images|send-receipt|private-row|private-object|private-raw|passphrase|captureLog|runnerId|revision|metadataSha256/);
  assert.deepEqual(await readdir(f.directory), before); // No export/plan file or consent mutation.
  await assert.rejects(service.shareableSummary({ revision: review.revision, inventory: true }), { code: 'invalid_shared_summary_request' });
  await assert.rejects(service.shareableSummary({ revision: review.revision, capsulePath: 'another' }), { code: 'invalid_shared_summary_request' });
});

test('unavailable, skipped, partial and limited inventories remain absent; genuinely empty complete inventories export zero', async () => {
  for (const scenario of ['missing-storage', 'missing-functions', 'skipped', 'incomplete', 'limited', 'empty']) {
    const f = await privateCapsuleFixture();
    if (scenario === 'missing-storage') await unlink(join(f.raw, 'storage', 'storage-manifest.json'));
    if (scenario === 'missing-functions') delete f.manifest.contents.functions.names;
    if (scenario === 'skipped') {
      f.manifest.contents.storage = { skipped: true, complete: true };
      f.manifest.contents.functions = { skipped: true, complete: true, names: [] };
    }
    if (scenario === 'incomplete') {
      f.manifest.contents.storage.complete = false; f.manifest.contents.functions.complete = false;
    }
    if (scenario === 'limited') {
      f.manifest.contents.storage.limited = true; f.manifest.contents.functions.limited = true;
    }
    if (scenario === 'empty') {
      await writeFile(join(f.raw, 'storage', 'storage-manifest.json'), JSON.stringify({ buckets: [] }));
      f.manifest.contents.functions.names = [];
    }
    await writeFile(join(f.raw, 'manifest.json'), JSON.stringify(f.manifest));
    await packDirectoryTarGz(f.raw, f.archive);
    await unlink(join(f.capsule, 'capsule.pbase'));
    f.metadata.encryption = await encryptFile(f.archive, join(f.capsule, 'capsule.pbase'), f.options.passphrase, f.metadata.id);
    await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify(f.metadata));
    const service = await createPrivateCapsuleReview(f.options), review = await service.inspect({});
    const summary = await service.shareableSummary({ revision: review.revision });
    const expected = scenario === 'missing-storage' ? { functionCount: 1 }
      : scenario === 'missing-functions' ? { bucketCount: 1, objectCount: 1 }
        : scenario === 'empty' ? { bucketCount: 0, objectCount: 0, functionCount: 0 } : {};
    assert.deepEqual(summary.counts, expected, scenario);
    assert.deepEqual(review.inventoryAvailable, { storage: scenario !== 'missing-storage', functions: scenario !== 'missing-functions' }, scenario);
  }
});

test('changed capsule or failed/new inspection invalidates prior export revision', async () => {
  const f = await privateCapsuleFixture(), service = await createPrivateCapsuleReview(f.options);
  const first = await service.inspect({}), second = await service.inspect({});
  await assert.rejects(service.shareableSummary({ revision: first.revision }), { code: 'capsule_review_changed' });
  await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify({ ...f.metadata, status: 'PARTIAL' }));
  await assert.rejects(service.shareableSummary({ revision: second.revision }), { code: 'capsule_review_changed' });
  await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify(f.metadata));
  await assert.rejects(service.shareableSummary({ revision: second.revision }), { code: 'capsule_review_changed' });
  const fresh = await service.inspect({});
  await writeFile(join(f.capsule, 'capsule.pbase'), 'tampered-ciphertext');
  await assert.rejects(service.inspect({}));
  await assert.rejects(service.shareableSummary({ revision: fresh.revision }), { code: 'capsule_review_changed' });
});

test('summary export serializes with inspect/save and leaves restore selection available', async () => {
  const f = await privateCapsuleFixture(), service = await createPrivateCapsuleReview(f.options), review = await service.inspect({});
  const selection = { revision: review.revision, selectedTables: ['public.orders'], selectedBuckets: [], selectedFunctions: [], maxBytes: 1000000, confirmEmpty: false };
  const exportPromise = service.shareableSummary({ revision: review.revision });
  await assert.rejects(service.save(selection), { code: 'capsule_review_busy' });
  await assert.rejects(service.inspect({}), { code: 'capsule_review_busy' });
  await exportPromise;
  const saved = await service.save(selection);
  assert.equal(saved.saved, true);
  assert.equal(JSON.parse(await readFile(join(f.directory, saved.planPath))).tables.find(row => row.table === 'orders').selected, true);
  await assert.rejects(service.shareableSummary({ revision: review.revision }), { code: 'capsule_review_changed' });
});

test('summary endpoint uses session/origin/CSRF gates and only returns approved projection', async () => {
  const f = await privateCapsuleFixture(), session = await startCapsuleReviewServer({ privateReview: f.options });
  const origin = new URL(session.url).origin, endpoint = `${origin}/api/review/shareable-summary`;
  try {
    assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 401);
    const headers = { 'X-Portabase-Session': session.token };
    const bootstrap = await (await fetch(`${origin}/api/review`, { headers })).json();
    const secure = { ...headers, Origin: origin, 'Content-Type': 'application/json', 'X-Portabase-CSRF': bootstrap.csrf };
    const review = await (await fetch(`${origin}/api/review/inspect`, { method: 'POST', headers: secure, body: '{}' })).json();
    const body = JSON.stringify({ revision: review.revision });
    for (const denied of [headers, { ...secure, Origin: 'https://foreign.test' }, { ...secure, 'X-Portabase-CSRF': 'wrong' }]) {
      assert.equal((await fetch(endpoint, { method: 'POST', headers: denied, body })).status, 403);
    }
    assert.equal((await fetch(endpoint, { headers })).status, 405);
    const response = await fetch(endpoint, { method: 'POST', headers: secure, body });
    assert.equal(response.status, 200);
    const summary = await response.json(); assert.equal(Object.hasOwn(summary, 'inventory'), false);
    assert.deepEqual(projectSharedManifest(summary, { projectRef: f.options.projectRef }), summary);
  } finally { await session.close(); }
});
