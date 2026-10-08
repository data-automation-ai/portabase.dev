import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { privateCapsuleFixture } from './fixtures/private-capsule.mjs';
import { readPrivateCapsule, withAuthenticatedPrivateCapsule } from '../utility/capsule-review-reader.mjs';
import { createPrivateCapsuleReview } from '../utility/ui/private-capsule-review.mjs';
import { startUiServer } from '../utility/ui/server.mjs';
import { validateRestorePlan } from '../utility/portabase-core.mjs';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';

function archive(entries) {
  const blocks = [];
  for (const item of entries) {
    const bytes = Buffer.from(item.body || ''), header = new Header({ path: item.path, type: item.type || 'File', size: bytes.length, mode: 0o600, uid: 0, gid: 0, linkpath: item.linkpath || '' });
    header.encode(); blocks.push(header.block, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
const selection = review => ({ revision: review.revision, selectedTables: ['public.orders'], selectedBuckets: [], selectedFunctions: [], maxBytes: 1000000, confirmEmpty: false });

test('real encrypted CLI archive yields private projection and capture log without SQL rows or raw errors', async () => {
  const f = await privateCapsuleFixture(); const result = await readPrivateCapsule(f.options);
  assert.equal(result.capsuleId, f.metadata.id); assert.equal(result.captureLog.scope, 'capture-before-archive');
  assert.deepEqual(result.tables.map(row => row.table), ['orders', 'empty']);
  assert.equal(result.buckets[0].bytes, 100); assert.equal(result.functions[0].name, 'send-receipt');
  assert.doesNotMatch(JSON.stringify(result), /private-row-value|private-object.jpg|private-raw-diagnostic|synthetic-private-customer-passphrase/);
  assert.deepEqual(await readdir(join(f.directory, '.capsule-review')), []);
});

test('private callback uses the authenticated archive snapshot and fixed scratch is cleaned after success or failure', async () => {
  const f = await privateCapsuleFixture(); let privatePath;
  const returned = await withAuthenticatedPrivateCapsule(f.options, async ({ review, archivePath, metadata }) => {
    privatePath = archivePath;
    assert.equal(metadata.id, review.capsuleId);
    assert.deepEqual(await readFile(archivePath), await readFile(f.archive));
    await writeFile(join(f.capsule, 'capsule.pbase'), 'changed source after authentication');
    assert.deepEqual(await readFile(archivePath), await readFile(f.archive));
    return review.capsuleId;
  });
  assert.equal(returned, f.metadata.id); await assert.rejects(readFile(privatePath), { code: 'ENOENT' });
  const g = await privateCapsuleFixture();
  await assert.rejects(withAuthenticatedPrivateCapsule(g.options, async () => { throw Error('synthetic callback failure'); }), /synthetic callback failure/);
  assert.deepEqual(await readdir(join(g.directory, '.capsule-review')), []);
});

test('wrong keys, modified envelope or ciphertext never release a review and scratch is removed', async () => {
  const f = await privateCapsuleFixture();
  await assert.rejects(readPrivateCapsule({ ...f.options, passphrase: 'synthetic-wrong-passphrase' }), { code: 'capsule_authentication_failed' });
  assert.deepEqual(await readdir(join(f.directory, '.capsule-review')), []);
  for (const patch of [{ id: 'changed-id' }, { projectRef: 'bcdefghijklmnopqrstu0' }, { status: 'PARTIAL' }, { createdAt: '2026-10-03T12:00:00.000Z' },
    { encryption: { ...f.metadata.encryption, cipher: 'aes-128-gcm' } }, { encryption: { ...f.metadata.encryption, iv: 'bad' } }]) {
    await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify({ ...f.metadata, ...patch }));
    await assert.rejects(readPrivateCapsule(f.options));
  }
  await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify(f.metadata));
  await writeFile(join(f.capsule, 'capsule.pbase'), 'tampered');
  await assert.rejects(readPrivateCapsule(f.options), { code: 'capsule_changed' });
});

test('ciphertext and expanded sizes are independently bounded, including nested compression', async () => {
  const f = await privateCapsuleFixture();
  await assert.rejects(readPrivateCapsule({ ...f.options, maxCipherBytes: 1 }), { code: 'capsule_file_refused' });
  await assert.rejects(readPrivateCapsule({ ...f.options, maxExpandedBytes: 1024 }), { code: 'capsule_review_limit' });
  const nested = await privateCapsuleFixture({ rawArchive: gzipSync(gzipSync(Buffer.alloc(200000))) });
  await assert.rejects(readPrivateCapsule(nested.options), { code: 'unsupported_capsule_archive' });
});

test('archive traversal, links, duplicates, extensions and malformed headers fail without filesystem extraction', async () => {
  for (const entries of [
    [{ path: '../escape' }], [{ path: '/absolute' }], [{ path: 'C:/drive' }], [{ path: 'a\\b' }],
    [{ path: 'link', type: 'SymbolicLink', linkpath: '../outside' }], [{ path: 'hard', type: 'Link', linkpath: 'manifest.json' }],
    [{ path: 'manifest.json', body: '{}' }, { path: './manifest.json', body: '{}' }],
    [{ path: 'meta', type: 'ExtendedHeader', body: '21 path=manifest.json\n' }],
    [{ path: 'meta', type: 'ExtendedHeader', body: 'x'.repeat(65537) }],
  ]) {
    const f = await privateCapsuleFixture({ rawArchive: archive(entries) });
    await assert.rejects(readPrivateCapsule(f.options), { code: 'unsupported_capsule_archive' }, JSON.stringify(entries.map(row => ({ path: row.path, type: row.type }))));
    assert.deepEqual(await readdir(join(f.directory, '.capsule-review')), []);
  }
  const bad = await privateCapsuleFixture({ rawArchive: gzipSync(Buffer.from('not a tar file')) });
  await assert.rejects(readPrivateCapsule(bad.options), { code: 'unsupported_capsule_archive' });
});

test('runner directory/capsule links, traversal and forbidden drives are refused', async () => {
  const f = await privateCapsuleFixture(); const g = await privateCapsuleFixture();
  const alias = join(f.directory, 'alias'); await symlink(g.capsule, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const capsulePath of ['alias', '../outside', 'F:/capsule', '\\\\server\\share', f.directory]) await assert.rejects(readPrivateCapsule({ ...f.options, capsulePath }));
  await symlink(g.directory, join(f.directory, '.capsule-review'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readPrivateCapsule(f.options), { code: 'private_config_path_refused' });
});

test('SQL inspection shares strict selective-restore grammar and rejects unsupported statements or truncated COPY', async () => {
  for (const sql of ['INSERT INTO public.orders VALUES (1);\n', 'COPY public.orders TO PROGRAM \'unsafe\';\n',
    'COPY public.orders (id) FROM stdin;\nmissing terminator\n', '\\! echo unsafe\n', '--' + 'x'.repeat(65536) + '\n']) {
    const reference = await privateCapsuleFixture({ noLog: true });
    const f = await privateCapsuleFixture({ rawArchive: archive([{ path: 'manifest.json', body: JSON.stringify(reference.manifest) }, { path: 'database/data.sql', body: sql }]) });
    await assert.rejects(readPrivateCapsule(f.options), { code: 'unsupported_capsule_sql' });
  }
});

test('missing legacy capture logs are explicit; delta and mismatched inner manifest fail', async () => {
  const legacy = await privateCapsuleFixture({ noLog: true }); assert.equal((await readPrivateCapsule(legacy.options)).captureLog, null);
  const delta = await privateCapsuleFixture({ manifestPatch: { kind: 'delta' } });
  await assert.rejects(readPrivateCapsule(delta.options), { code: 'capsule_baseline_required' });
  const mismatch = await privateCapsuleFixture({ manifestPatch: { projectRef: 'bcdefghijklmnopqrstu0' } });
  await assert.rejects(readPrivateCapsule(mismatch.options), { code: 'capsule_binding_mismatch' });
});

test('plan selection is inventory-bound, immutable, budgeted, and contains a capsule digest binding', async () => {
  const f = await privateCapsuleFixture(), service = await createPrivateCapsuleReview(f.options), review = await service.inspect({});
  const body = selection(review);
  for (const patch of [{ selectedTables: ['public.unknown'] }, { selectedTables: ['public.orders', 'public.orders'] }, { maxBytes: -1 }, { sourceKey: 'no' }, { revision: 'stale' }]) await assert.rejects(service.save({ ...body, ...patch }));
  const saved = await service.save(body);
  assert.equal(saved.execution, 'not_started');
  const planBytes = await readFile(join(f.directory, saved.planPath)); const plan = JSON.parse(planBytes);
  assert.equal(validateRestorePlan(plan, { capsuleId: f.metadata.id }).selectedBytes, review.tables[0].bytes);
  assert.equal(plan.buckets[0].selected, false); assert.equal(plan.functions[0].selected, false);
  const bindingBytes = await readFile(join(f.directory, '.restore-plans', saved.planRef, 'binding.json'));
  const binding = JSON.parse(bindingBytes);
  assert.equal(saved.bindingSha256, createHash('sha256').update(bindingBytes).digest('hex'));
  assert.equal(binding.ciphertextSha256, f.metadata.encryption.ciphertextSha256);
  assert.equal(binding.planSha256, createHash('sha256').update(planBytes).digest('hex'));
  await assert.rejects(service.save(body), { code: 'capsule_review_changed' });
});

test('failed refresh and changed capsule invalidate saves; empty selections require explicit intent', async () => {
  const f = await privateCapsuleFixture(), service = await createPrivateCapsuleReview(f.options);
  const initial = await service.inspect({});
  await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify({ ...f.metadata, status: 'PARTIAL' }));
  await assert.rejects(service.save(selection(initial)), { code: 'capsule_review_changed' });
  await writeFile(join(f.capsule, 'capsule.json'), JSON.stringify(f.metadata));
  const fresh = await service.inspect({});
  await assert.rejects(service.save({ ...selection(fresh), selectedTables: [] }), { code: 'empty_restore_selection' });
  const saved = await service.save({ ...selection(fresh), selectedTables: [], confirmEmpty: true }); assert.equal(saved.selectedBytes, 0);
  const next = await service.inspect({}); await writeFile(join(f.capsule, 'capsule.pbase'), 'broken');
  await assert.rejects(service.inspect({})); await assert.rejects(service.save(selection(next)), { code: 'capsule_review_changed' });
});

test('budget overflow and concurrent saves cannot create an unapproved second plan', async () => {
  const f = await privateCapsuleFixture(), service = await createPrivateCapsuleReview(f.options);
  const review = await service.inspect({}); await assert.rejects(service.save({ ...selection(review), maxBytes: 1 }), { code: 'restore_plan_over_budget' });
  const next = await service.inspect({}); const results = await Promise.allSettled([service.save(selection(next)), service.save(selection(next))]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal((await readdir(join(f.directory, '.restore-plans'))).length, 1);
});

test('loopback review API requires session, same origin and CSRF; rejects paths, raw keys and oversized bodies', async () => {
  const f = await privateCapsuleFixture(); let collected = false;
  const server = await startUiServer({ privateReview: f.options, collect: () => { collected = true; throw Error('must not contact source'); } });
  const origin = new URL(server.url).origin;
  try {
    const page = await fetch(origin); assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.equal((await fetch(`${origin}/api/review`)).status, 401);
    const headers = { 'X-Portabase-Session': server.token };
    const bootstrap = await (await fetch(`${origin}/api/review`, { headers })).json();
    const secure = { ...headers, Origin: origin, 'X-Portabase-CSRF': bootstrap.csrf, 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${origin}/api/review/inspect`, { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await fetch(`${origin}/api/review/inspect`, { method: 'POST', headers: { ...secure, Origin: 'https://foreign.test' }, body: '{}' })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => { const req = httpRequest(`${origin}/api/review`, { headers: { ...headers, Host: 'foreign.test' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(hostStatus, 421);
    for (const body of [{ capsulePath: '../escape' }, { passphrase: 'raw' }]) assert.equal((await fetch(`${origin}/api/review/inspect`, { method: 'POST', headers: secure, body: JSON.stringify(body) })).status, 409);
    assert.equal((await fetch(`${origin}/api/review/inspect`, { method: 'POST', headers: secure, body: ' '.repeat(256 * 1024 + 1) })).status, 413);
    const response = await fetch(`${origin}/api/review/inspect`, { method: 'POST', headers: secure, body: '{}' }); assert.equal(response.status, 200);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private-row-value|private-raw-diagnostic|synthetic-private-customer-passphrase/);
    assert.equal(collected, false);
  } finally { await server.close(); }
});
