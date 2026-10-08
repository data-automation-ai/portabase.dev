import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CAPTURE_LOG_PATH, createCaptureLog } from '../utility/capture-log.mjs';
import { decryptFile, encryptFile, packDirectoryTarGz } from '../utility/portabase-core.mjs';

async function fixture(t) {
  const parent = resolve(tmpdir());
  const root = resolve(await mkdtemp(join(parent, 'portabase-capture-log-test-')));
  t.after(async () => {
    if (dirname(root) !== parent) throw new Error('unsafe_test_cleanup');
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('private capture log records outcomes and counts without raw errors, credentials, or inventory names', async t => {
  const root = await fixture(t);
  let now = Date.parse('2026-10-05T12:00:00Z');
  const log = createCaptureLog({ now: () => now });
  log.start('database');
  now += 1000;
  log.complete('database', { complete: true, summary: { tables: 4, rows: 80, approximateRows: true, privateTable: 'customer-secrets' }, password: 'private-credential' });
  log.start('storage');
  log.complete('storage', { complete: false, objectCount: 3, totalBytes: 10, manifestPath: 'private-object/path', error: 'postgresql://user:private-credential@host/database' });
  log.start('functions');
  log.fail('functions', new Error('private-error-with-secret'));
  log.skip('auth');
  const descriptor = await log.write(root, 'PARTIAL');
  const bytes = await readFile(join(root, CAPTURE_LOG_PATH));
  assert.equal(descriptor.sha256, hash(bytes));
  const data = JSON.parse(bytes);
  assert.equal(data.scope, 'capture-before-archive');
  assert.equal(data.truncated, false);
  assert.deepEqual(data.records.map(row => row.event), ['capture.started', 'component.started', 'component.finished', 'component.started', 'component.finished', 'component.started', 'component.failed', 'component.skipped', 'capture.finished']);
  assert.equal(data.records[2].durationMs, 1000);
  assert.deepEqual(data.records[2].summary, { tables: 4, rows: 80 });
  assert.equal(data.records[2].approximateRows, true);
  assert.equal(data.records[4].outcome, 'partial');
  assert.equal(data.records[6].errorCode, 'capture_failed');
  assert.equal(data.records.at(-1).status, 'PARTIAL');
  for (const forbidden of ['private-', 'customer-secrets', 'postgresql://', 'password', 'manifestPath']) assert.equal(bytes.includes(forbidden), false);
});

test('capture log is bounded, reserves the final outcome, and rejects names and later writes', async t => {
  const root = await fixture(t);
  const log = createCaptureLog({ maxRecords: 4, now: () => Date.parse('2026-10-05T12:00:00Z') });
  assert.throws(() => log.start('private-table-name'), /invalid_capture_log_component/);
  for (let i = 0; i < 1000; i++) log.start('storage');
  await log.write(root, 'COMPLETE');
  const data = JSON.parse(await readFile(join(root, CAPTURE_LOG_PATH)));
  assert.equal(data.records.length, 4);
  assert.equal(data.droppedRecords, 998);
  assert.equal(data.truncated, true);
  assert.equal(data.records.at(-1).event, 'capture.finished');
  assert.throws(() => log.start('storage'), /already_finished/);
  await assert.rejects(log.write(root, 'COMPLETE'), /already_finished/);
  assert.throws(() => createCaptureLog({ maxRecords: Infinity }), /invalid_capture_log_limit/);
});

// Read the bounded synthetic ustar fixture without invoking a shell or extracting arbitrary paths.
function archiveFiles(gzip) {
  const tar = gunzipSync(gzip);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

test('log and manifest reference survive real archive encryption and require the customer passphrase', async t => {
  const root = await fixture(t);
  const raw = join(root, 'raw');
  await mkdir(raw);
  const log = createCaptureLog({ now: () => Date.parse('2026-10-05T12:00:00Z') });
  log.start('database');
  log.complete('database', { complete: true, summary: { tables: 1, rows: 0 } });
  const descriptor = await log.write(raw, 'SELECTIVE');
  await writeFile(join(raw, 'manifest.json'), JSON.stringify({ formatVersion: 1, status: 'SELECTIVE', captureLog: descriptor }));
  const archive = join(root, 'capsule.tar.gz');
  const sealed = join(root, 'capsule.pbase');
  await packDirectoryTarGz(raw, archive);
  const encryption = await encryptFile(archive, sealed, 'synthetic-customer-passphrase', 'synthetic-log-fixture');
  assert.equal((await readFile(sealed)).includes('component.finished'), false);
  await assert.rejects(decryptFile(sealed, join(root, 'wrong-key.tar.gz'), 'wrong-customer-passphrase', encryption));
  const opened = join(root, 'opened.tar.gz');
  await decryptFile(sealed, opened, 'synthetic-customer-passphrase', encryption);
  const files = archiveFiles(await readFile(opened));
  assert.ok(files.has(CAPTURE_LOG_PATH));
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.captureLog.sha256, hash(files.get(CAPTURE_LOG_PATH)));
  const data = JSON.parse(files.get(CAPTURE_LOG_PATH));
  assert.equal(data.records.at(-1).status, 'SELECTIVE');
  assert.deepEqual(data.excludes, ['archive-packaging', 'encryption', 'upload', 'destination-verification']);
  assert.equal(data.records.some(row => /upload|encrypt|verified/.test(row.event)), false);
});
