import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, readdir, link, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { createPrivateCapsuleReview } from '../utility/ui/private-capsule-review.mjs';
import { preparePrivateReplay, assertPreparedPrivateReplay } from '../utility/private-replay-prepare.mjs';
import { encryptFile } from '../utility/capsule-crypto.mjs';
import { packDirectoryTarGz } from '../utility/portabase-core.mjs';

async function fixture(t, { extraFiles = [], capsuleName } = {}) {
  const f = await privateCapsuleFixture();
  t.after(async () => {
    const root = resolve(f.directory), parent = resolve(tmpdir());
    assert.ok(root.startsWith(`${parent}${sep}`) && basename(root).startsWith('portabase-capsule-review-test-'));
    await rm(root, { recursive: true, force: true });
  });
  if (extraFiles.length) {
    for (const [name, contents] of extraFiles) {
      await mkdir(dirname(join(f.raw, name)), { recursive: true });
      await writeFile(join(f.raw, name), contents);
    }
    await packDirectoryTarGz(f.raw, f.archive);
    await rm(join(f.capsule, 'capsule.pbase'));
    f.metadata.encryption = await encryptFile(f.archive, join(f.capsule, 'capsule.pbase'), f.options.passphrase, f.metadata.id);
    await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify(f.metadata));
  }
  if (capsuleName) {
    const named = join(f.directory, capsuleName);
    await rename(f.capsule, named); f.capsule = named; f.options.capsulePath = capsuleName;
  }
  const service = await createPrivateCapsuleReview(f.options), review = await service.inspect({});
  const saved = await service.save({ revision: review.revision, selectedTables: ['public.orders'], selectedBuckets: [], selectedFunctions: [], maxBytes: 1000000, confirmEmpty: false });
  return { ...f, saved, review, options: { ...f.options, planRef: saved.planRef, expectedBindingSha256: saved.bindingSha256 } };
}
const runs = f => readdir(join(f.directory, '.replay-runs'));

test('preparation returns a branded frozen selection and private extracted snapshot with explicit cleanup', async t => {
  const f = await fixture(t), prepared = await preparePrivateReplay(f.options);
  assert.equal(assertPreparedPrivateReplay(prepared), prepared);
  assert.equal(dirname(prepared.temp), join(f.directory, '.replay-runs'));
  assert.equal(prepared.scratchRoot, prepared.temp);
  assert.ok(relative(prepared.temp, prepared.extracted) && !relative(prepared.temp, prepared.extracted).startsWith('..'));
  assert.notEqual(prepared.capsulePath, f.capsule);
  assert.equal(prepared.capsuleSha256, f.metadata.encryption.ciphertextSha256);
  assert.equal(prepared.plan.tables.find(row => row.table === 'orders').selected, true);
  assert.equal(prepared.plan.tables.find(row => row.table === 'empty').selected, false);
  assert.match(await readFile(join(prepared.extracted, 'database', 'data.sql'), 'utf8'), /private-row-value/);
  assert.deepEqual(prepared.manifest, f.manifest);
  assert.throws(() => { prepared.plan.tables[0].selected = false; }, TypeError);
  assert.throws(() => { prepared.extracted = f.directory; }, TypeError);
  assert.throws(() => assertPreparedPrivateReplay({ ...prepared }), { code: 'restore_plan_preparation_required' });
  await prepared.cleanup();await prepared.cleanup();
  assert.deepEqual(await runs(f), []);
  assert.throws(() => assertPreparedPrivateReplay(prepared), { code: 'restore_plan_preparation_required' });
});

test('changing original capsule, metadata, binding and plan after snapshot cannot substitute replay bytes', async t => {
  const f = await fixture(t);
  const prepared = await preparePrivateReplay(f.options, { afterSnapshot: async () => {
    for (const name of ['capsule.json', 'capsule.pbase']) await writeFile(join(f.capsule, name), 'changed source');
    const planDir = join(f.directory, '.restore-plans', f.saved.planRef);
    await writeFile(join(planDir, 'plan.json'), JSON.stringify({ changed: true }));
    await writeFile(join(planDir, 'binding.json'), 'changed binding');
  } });
  assert.match(await readFile(join(prepared.extracted, 'database', 'data.sql'), 'utf8'), /private-row-value/);
  assert.equal(prepared.metadata.id, f.metadata.id);
  assert.equal(prepared.plan.tables.length, 2);
  await prepared.cleanup();assert.deepEqual(await runs(f), []);
});

test('changed input before snapshot, missing passphrase, wrong passphrase and budget failures leave no prepared tree', async t => {
  const f = await fixture(t);
  for (const options of [
    { ...f.options, passphrase: 'synthetic-wrong-passphrase' }, { ...f.options, passphrase: undefined },
    { ...f.options, admissionMaxBytes: 1 }, { ...f.options, maxExpandedBytes: 1024 },
    { ...f.options, expectedBindingSha256: '0'.repeat(64) },
  ]) {
    await assert.rejects(preparePrivateReplay(options)); assert.deepEqual(await runs(f), []);
  }
  await writeFile(join(f.capsule, 'capsule.pbase'), 'replaced before snapshot');
  await assert.rejects(preparePrivateReplay(f.options), { code: 'restore_plan_binding_mismatch' });
  assert.deepEqual(await runs(f), []);
});

test('hard-linked private inputs are refused and failure hooks clean their isolated run', async t => {
  const f = await fixture(t);
  await link(join(f.capsule, 'capsule.pbase'), join(f.directory, 'linked-capsule'));
  await assert.rejects(preparePrivateReplay(f.options), { code: 'restore_plan_path_refused' });
  assert.deepEqual(await runs(f), []);
  await rm(join(f.directory, 'linked-capsule'));
  await assert.rejects(preparePrivateReplay(f.options, { afterSnapshot: async () => { throw new Error('private diagnostic'); } }),
    error => error.code === 'restore_plan_unavailable' && !error.message.includes('private diagnostic'));
  assert.deepEqual(await runs(f), []);
});

test('ordinary source capsule named extracted cannot collide with private staging output', async t => {
  const f = await fixture(t, { capsuleName: 'extracted' });
  const prepared = await preparePrivateReplay(f.options);
  assert.notEqual(prepared.extracted, prepared.capsulePath);
  assert.match(await readFile(join(prepared.extracted, 'database', 'data.sql'), 'utf8'), /private-row-value/);
  await prepared.cleanup();assert.deepEqual(await runs(f), []);
});

test('portable preparation rejects case/Unicode aliases, Windows special paths and ancestor collisions', async t => {
  const f = await fixture(t, { extraFiles: [['extra/first.txt', 'one'], ['extra/second.txt', 'two']] });
  const { gunzipSync, gzipSync } = await import('node:zlib');
  const original = gunzipSync(await readFile(f.archive));
  const bindingPath = join(f.directory, '.restore-plans', f.saved.planRef, 'binding.json');
  const originalBinding = JSON.parse(await readFile(bindingPath));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const [first, second] of [
    ['extra/first.txt', 'extra/FIRST.txt'], ['extra/café.txt', 'extra/cafe\u0301.txt'],
    ['extra/CON.txt', 'extra/second.txt'], ['extra/name:stream', 'extra/second.txt'],
    ['extra/name.', 'extra/second.txt'], ['extra/name ', 'extra/second.txt'],
    ['extra/first.txt', 'extra/first.txt/child'], ['extra/first.txt', 'extra/LPT1'],
  ]) {
    // Raw header mutation permits testing forbidden Windows names without ever
    // creating those names in the source fixture filesystem.
    const raw = Buffer.from(original);
    for (let offset = 0; offset + 512 <= raw.length;) {
      const header = raw.subarray(offset, offset + 512);
      const name = header.subarray(0, 100).toString().replace(/\0.*/, '');
      const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*/, ''), 8) || 0;
      const replacement = name === 'extra/first.txt' ? first : name === 'extra/second.txt' ? second : null;
      if (replacement) {
        header.fill(0, 0, 100); header.write(replacement); header.fill(32, 148, 156);
        const checksum = header.reduce((sum, value) => sum + value, 0);
        header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    await writeFile(f.archive, gzipSync(raw));await rm(join(f.capsule, 'capsule.pbase'));
    f.metadata.encryption = await encryptFile(f.archive, join(f.capsule, 'capsule.pbase'), f.options.passphrase, f.metadata.id);
    const metadataBytes = JSON.stringify(f.metadata);
    await writeFile(join(f.capsule, 'capsule.json'), metadataBytes);
    const bindingBytes = JSON.stringify({ ...originalBinding, metadataSha256: digest(metadataBytes), ciphertextSha256: f.metadata.encryption.ciphertextSha256 });
    await writeFile(bindingPath, bindingBytes);
    // Keep the original table/bucket/function plan, pin the new hostile archive.
    // Rejection may occur in the listing policy or stricter extraction policy.
    await assert.rejects(preparePrivateReplay({ ...f.options, expectedBindingSha256: digest(bindingBytes) }),
      error => ['unsupported_capsule_archive', 'restore_plan_archive_refused', 'restore_plan_path_refused', 'restore_plan_unavailable'].includes(error.code), `${first}, ${second}`);
    assert.deepEqual(await runs(f), []);
  }
});
