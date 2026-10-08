// Authenticated, bounded private inspection. No archive entry is extracted to disk.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, open, mkdir, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Parser } from 'tar';
import { decryptFile, CAPSULE_CRYPTO_FORMAT, CAPSULE_CIPHER } from './capsule-crypto.mjs';
import { validatePrivateDirectory } from '../cloud/runner/private-config.mjs';
import { createDataSqlPolicy, DATA_SQL_HEADER_BYTES } from './data-sql-policy.mjs';

export const REVIEW_JSON_BYTES = 1024 * 1024;
export const REVIEW_MAX_ENTRIES = 100000;
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = code => Object.assign(new Error(code), { code });
const fail = code => { throw failure(code); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const componentNames = ['database', 'storage', 'functions', 'auth'];
const states = ['COMPLETE', 'PARTIAL', 'SELECTIVE', 'TRIAL'];
const jsonFiles = new Set(['manifest.json', 'storage/storage-manifest.json', 'logs/capture.json']);
function bound(max) { let size = 0; return new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > max ? failure('capsule_review_limit') : null, chunk); } }); }
function within(root, path) {
  if (typeof path !== 'string' || !path || /^[fF]:|^\\\\|^\/\//.test(path)) fail('capsule_path_refused');
  const result = resolve(root, path), rel = relative(root, result);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) fail('capsule_path_refused');
  return result;
}
async function fileHandle(path, max) {
  await validatePrivateDirectory(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !integer(before.size) || before.size > max) fail('capsule_file_refused');
  const file = await open(path, 'r');
  const after = await file.stat();
  if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size) { await file.close(); fail('capsule_changed'); }
  return file;
}
async function boundedFile(path, max) {
  const file = await fileHandle(path, max);
  try {
    const before = await file.stat();
    const bytes = Buffer.alloc(max + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > max) fail('capsule_review_limit');
    const after = await file.stat();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs) fail('capsule_changed');
    return bytes.subarray(0, size);
  } finally { await file.close(); }
}

export async function capsuleReviewBinding({ directory, capsulePath, projectRef, maxCipherBytes, maxExpandedBytes }) {
  if (!integer(maxCipherBytes) || maxCipherBytes < 1 || !integer(maxExpandedBytes) || maxExpandedBytes < 1024
    || !/^[a-z0-9]{20}$/.test(projectRef || '')) fail('capsule_review_setup_required');
  const root = await validatePrivateDirectory(directory), capsule = within(root, capsulePath);
  await validatePrivateDirectory(capsule);
  const bytes = await boundedFile(join(capsule, 'capsule.json'), REVIEW_JSON_BYTES);
  let metadata;
  try { metadata = JSON.parse(bytes); } catch { fail('invalid_capsule_metadata'); }
  const enc = metadata?.encryption;
  if (metadata?.formatVersion !== 1 || !/^[A-Za-z0-9_-]{1,160}$/.test(metadata.id || '') || metadata.projectRef !== projectRef
    || enc?.format !== CAPSULE_CRYPTO_FORMAT || enc.cipher !== CAPSULE_CIPHER || enc.kdf?.name !== 'scrypt'
    || !/^[a-f0-9]{64}$/.test(enc.ciphertextSha256 || '') || !/^[a-f0-9]{64}$/.test(enc.plaintextSha256 || '')
    || enc.aad !== Buffer.from(metadata.id).toString('base64')) fail('invalid_capsule_metadata');
  for (const [value, length] of [[enc.kdf.salt, 16], [enc.iv, 12], [enc.authTag, 16]]) {
    if (typeof value !== 'string' || Buffer.from(value, 'base64').length !== length || Buffer.from(value, 'base64').toString('base64') !== value) fail('invalid_capsule_metadata');
  }
  const file = await fileHandle(join(capsule, 'capsule.pbase'), maxCipherBytes);
  const digest = createHash('sha256'); let size = 0;
  try { for await (const chunk of file.createReadStream({ autoClose: false })) { size += chunk.length; if (size > maxCipherBytes) fail('capsule_review_limit'); digest.update(chunk); } }
  finally { await file.close(); }
  const ciphertextSha256 = digest.digest('hex');
  if (ciphertextSha256 !== enc.ciphertextSha256) fail('capsule_changed');
  return { root, capsule, metadata, digest: hash(bytes), ciphertextSha256, size };
}

// Retain header identifiers and byte counts only. COPY row data is discarded.
function copyMeasurement() {
  let current = null, total = 0, lineBytes = 0, head = Buffer.alloc(0);
  const rows = [], policy = createDataSqlPolicy();
  function line() {
    const text = head.toString('utf8').replace(/\r$/, '');
    if (!current && lineBytes > DATA_SQL_HEADER_BYTES + 2) fail('unsupported_capsule_sql');
    const parsed = policy.line(current ? lineBytes <= 4 && text === '\\.' ? '\\.' : '' : text);
    if (current) {
      total += lineBytes;
      if (!integer(total)) fail('capsule_review_limit');
      if (parsed.kind === 'terminator') { rows.push({ ...current, bytes: total }); current = null; total = 0; }
    } else if (parsed.kind === 'copy') {
      if (rows.length >= 5000) fail('capsule_review_limit');
      current = parsed.table; total = lineBytes;
    }
    lineBytes = 0; head = Buffer.alloc(0);
  }
  return {
    write(chunk) {
      for (let offset = 0; offset < chunk.length;) {
        const next = chunk.indexOf(10, offset), end = next < 0 ? chunk.length : next;
        const limit = current ? 3 : DATA_SQL_HEADER_BYTES + 1;
        if (head.length < limit) head = Buffer.concat([head, chunk.subarray(offset, Math.min(end, offset + limit - head.length))]);
        lineBytes += end - offset + (next < 0 ? 0 : 1);
        if (next >= 0) line(); offset = next < 0 ? chunk.length : next + 1;
      }
    },
    finish() { if (lineBytes) line(); policy.finish(); return rows; },
  };
}

async function scanArchive(path, maxExpandedBytes) {
  const files = new Map(), seen = new Set(); let entryCount = 0, tableSizes = [], hasData = false;
  const parser = new Parser({ strict: true, maxMetaEntrySize: 64 * 1024 });
  let parserError;
  const reject = error => { parserError ||= error; parser.abort(error); };
  // Conservatively refuse PAX/GNU extensions: the parser can silently skip a
  // malformed record. The CLI's default ustar needs none; fallback variants
  // needing extensions receive an explicit unsupported-archive error.
  parser.on('meta', () => reject(failure('unsupported_capsule_archive')));
  parser.on('ignoredEntry', () => reject(failure('unsupported_capsule_archive')));
  parser.on('entry', entry => {
    try {
      let name = entry.path;
      if (typeof name !== 'string' || name.length > 1024 || /[\\\x00-\x1f:]/.test(name)
        || /[\\\x00-\x1f:]/.test(entry.header.path) || name.startsWith('/')) fail('unsupported_capsule_archive');
      if (name.startsWith('./')) name = name.slice(2);
      if (name.endsWith('/') && entry.type === 'Directory') name = name.slice(0, -1);
      if (++entryCount > REVIEW_MAX_ENTRIES) fail('capsule_review_limit');
      if (name === '.' || name === '') { if (entry.type !== 'Directory' || entry.size !== 0) fail('unsupported_capsule_archive'); entry.resume(); return; }
      if (name.split('/').some(part => !part || part === '..' || part === '.') || seen.has(name.toLowerCase())
        || !['File', 'Directory'].includes(entry.type) || entry.linkpath || !integer(entry.size)
        || entry.header.size !== entry.size) fail('unsupported_capsule_archive');
      seen.add(name.toLowerCase());
      const chunks = []; const measure = name === 'database/data.sql' ? copyMeasurement() : null;
      if (measure && entry.type !== 'File') fail('unsupported_capsule_archive');
      if (jsonFiles.has(name) && entry.size > REVIEW_JSON_BYTES) fail('capsule_review_limit');
      if (jsonFiles.has(name) && entry.type !== 'File') fail('unsupported_capsule_archive');
      let size = 0;
      entry.on('data', chunk => {
        try {
          size += chunk.length;
          if (size > entry.size) fail('unsupported_capsule_archive');
          if (jsonFiles.has(name)) chunks.push(chunk);
          if (measure) measure.write(chunk);
        } catch (error) { reject(error); }
      });
      entry.on('end', () => {
        try {
          if (size !== entry.size) fail('unsupported_capsule_archive');
          if (jsonFiles.has(name)) files.set(name, Buffer.concat(chunks));
          if (measure) { tableSizes = measure.finish(); hasData = true; }
        } catch (error) { reject(error); }
      });
      entry.resume();
    } catch (error) { reject(error); }
  });
  let prefix = Buffer.alloc(0), checked = false;
  const plainTar = new Transform({ transform(chunk, _, done) {
    if (checked) return done(null, chunk);
    prefix = Buffer.concat([prefix, chunk]);
    if (prefix.length < 4) return done();
    checked = true;
    if (prefix[0] === 0x1f && prefix[1] === 0x8b || prefix.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) return done(failure('unsupported_capsule_archive'));
    done(null, prefix); prefix = null;
  } });
  try { await pipeline(createReadStream(path), createGunzip(), bound(maxExpandedBytes), plainTar, parser); }
  catch (error) { throw parserError || failure(error.code === 'capsule_review_limit' ? error.code : 'unsupported_capsule_archive'); }
  if (parserError) throw parserError;
  return { files, tableSizes, hasData };
}

function projectLog(bytes, descriptor) {
  if (!descriptor) return null;
  if (!bytes || descriptor.path !== 'logs/capture.json' || descriptor.sha256 !== hash(bytes)) fail('invalid_capture_log');
  let log; try { log = JSON.parse(bytes); } catch { fail('invalid_capture_log'); }
  if (log?.formatVersion !== 1 || log.scope !== 'capture-before-archive' || !Array.isArray(log.records) || log.records.length > 128) fail('invalid_capture_log');
  const events = ['capture.started', 'component.started', 'component.finished', 'component.failed', 'component.skipped', 'capture.finished'];
  const records = log.records.map(row => {
    if (!row || !events.includes(row.event) || typeof row.at !== 'string' || row.at.length !== 24 || !Number.isFinite(Date.parse(row.at))
      || row.component !== undefined && !componentNames.includes(row.component)) fail('invalid_capture_log');
    const result = { event: row.event, at: row.at };
    if (row.component) result.component = row.component;
    if (['complete', 'partial', 'failed', 'skipped'].includes(row.outcome)) result.outcome = row.outcome;
    if (states.includes(row.status)) result.status = row.status;
    if (integer(row.durationMs)) result.durationMs = row.durationMs;
    return result;
  });
  return { scope: log.scope, truncated: log.truncated === true, records };
}

export async function withAuthenticatedPrivateCapsule(options, useReview) {
  if (typeof useReview !== 'function') fail('capsule_review_setup_required');
  const binding = await capsuleReviewBinding(options);
  if (typeof options.passphrase !== 'string' || options.passphrase.length < 16) fail('capsule_passphrase_required');
  const base = join(binding.root, '.capsule-review');
  try { await mkdir(base, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await validatePrivateDirectory(base);
  const scratch = await mkdtemp(join(base, 'inspect-'));
  const encrypted = join(scratch, 'encrypted.pbase'), archive = join(scratch, 'archive.tar.gz');
  try {
    const source = await fileHandle(join(binding.capsule, 'capsule.pbase'), options.maxCipherBytes);
    try { await pipeline(source.createReadStream({ autoClose: false }), bound(options.maxCipherBytes), createWriteStream(encrypted, { flags: 'wx', mode: 0o600 })); }
    finally { await source.close(); }
    // Nothing from the archive is parsed or exposed before authenticated decryption succeeds.
    try { await decryptFile(encrypted, archive, options.passphrase, binding.metadata.encryption); }
    catch { fail('capsule_authentication_failed'); }
    const { files, tableSizes, hasData } = await scanArchive(archive, options.maxExpandedBytes);
    let manifest, storage;
    try { manifest = JSON.parse(files.get('manifest.json')); storage = files.has('storage/storage-manifest.json') ? JSON.parse(files.get('storage/storage-manifest.json')) : null; }
    catch { fail('invalid_capsule_manifest'); }
    if (manifest?.formatVersion !== 1 || manifest.projectRef !== options.projectRef || manifest.projectRef !== binding.metadata.projectRef
      || !states.includes(manifest.status) || manifest.status !== binding.metadata.status || manifest.createdAt !== binding.metadata.createdAt
      || typeof manifest.createdAt !== 'string' || manifest.createdAt.length !== 24 || !Number.isFinite(Date.parse(manifest.createdAt))
      || !manifest.contents || typeof manifest.contents !== 'object') fail('capsule_binding_mismatch');
    if (manifest.kind === 'delta' || binding.metadata.kind === 'delta') fail('capsule_baseline_required');
    const buckets = [], bucketIds = new Set();
    if (storage && (!Array.isArray(storage.buckets) || storage.buckets.length > 1000)) fail('invalid_capsule_manifest');
    for (const bucket of storage?.buckets || []) {
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(bucket?.id || '') || bucketIds.has(bucket.id) || !Array.isArray(bucket.objects)) fail('invalid_capsule_manifest');
      bucketIds.add(bucket.id); let bytes = 0;
      for (const object of bucket.objects) { if (!integer(object?.size)) fail('invalid_capsule_manifest'); bytes += object.size; if (!integer(bytes)) fail('capsule_review_limit'); }
      buckets.push({ id: bucket.id, objectCount: bucket.objects.length, bytes, selected: true });
    }
    const names = manifest.contents.functions?.names || [];
    if (!Array.isArray(names) || names.length > 1000 || new Set(names).size !== names.length || names.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(name))) fail('invalid_capsule_manifest');
    const components = componentNames.map(name => ({ name, complete: manifest.contents[name]?.complete === true, skipped: manifest.contents[name]?.skipped === true, limited: manifest.contents[name]?.limited === true }));
    const log = projectLog(files.get('logs/capture.json'), manifest.captureLog);
    const after = await capsuleReviewBinding(options);
    if (after.digest !== binding.digest || after.ciphertextSha256 !== binding.ciphertextSha256) fail('capsule_changed');
    const review = { binding: { metadataSha256: binding.digest, ciphertextSha256: binding.ciphertextSha256 }, capsuleId: binding.metadata.id,
      projectRef: manifest.projectRef, status: manifest.status, createdAt: manifest.createdAt, components, captureLog: log,
      hasData, inventoryAvailable: { storage: storage !== null, functions: Array.isArray(manifest.contents.functions?.names) },
      tables: tableSizes.map(row => ({ ...row, selected: true })), buckets, functions: names.map(name => ({ name, selected: true })) };
    // Runner-internal lifetime seam: a consumer can use the exact authenticated
    // archive without reopening original capsule paths. HTTP exposes review only.
    return await useReview({ review, archivePath: archive, metadata: binding.metadata });
  } finally {
    // Only these two fixed files can exist: no recursive extraction or cleanup.
    if (dirname(scratch) !== base) fail('capsule_path_refused');
    await validatePrivateDirectory(scratch);
    for (const file of [encrypted, archive]) { try { await unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    await rmdir(scratch);
  }
}

export async function readPrivateCapsule(options) {
  return withAuthenticatedPrivateCapsule(options, ({ review }) => review);
}
