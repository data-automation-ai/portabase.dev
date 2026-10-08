import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, closeSync, lstatSync, mkdirSync, openSync, realpathSync, writeSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Parser } from 'tar';
import { validatePrivateDirectory } from '../cloud/runner/private-config.mjs';
import { RUNNER_ID_RE } from '../cloud/runner/config-reference.mjs';
import { withValidatedPrivateRestorePlan, PRIVATE_RESTORE_PLAN_JSON_BYTES } from '../cloud/runner/private-restore-plan.mjs';
import { REVIEW_JSON_BYTES, REVIEW_MAX_ENTRIES } from './capsule-review-reader.mjs';

const failure = code => Object.assign(new Error(code), { code });
const preparedContexts = new WeakSet();
export function assertPreparedPrivateReplay(prepared) {
  if (!preparedContexts.has(prepared)) throw failure('restore_plan_preparation_required');
  return prepared;
}
const fail = code => { throw failure(code); };
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const equalPath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function contained(root, value) {
  if (typeof value !== 'string' || !value || /^[fF]:|^[\\/]{2}/.test(value) || value.includes('\0')) fail('restore_plan_path_refused');
  const path = resolve(root, value), rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('restore_plan_path_refused');
  return path;
}
function frozen(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}

async function copyPinned(source, destination, maxBytes, expectedHash) {
  await validatePrivateDirectory(dirname(source));
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !Number.isSafeInteger(before.size)
    || before.size > maxBytes) fail('restore_plan_path_refused');
  const file = await open(source, 'r');
  let size = 0; const hash = createHash('sha256');
  try {
    if (!sameFile(before, await file.stat())) fail('restore_plan_changed');
    const count = new Transform({ transform(chunk, _, done) {
      size += chunk.length;
      if (size > maxBytes) return done(failure('restore_plan_too_large'));
      hash.update(chunk); done(null, chunk);
    } });
    await pipeline(file.createReadStream({ autoClose: false }), count, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    const after = await lstat(source);
    if (after.isSymbolicLink() || after.nlink !== 1 || size !== before.size || !sameFile(before, after)
      || !sameFile(before, await file.stat())) fail('restore_plan_changed');
    await validatePrivateDirectory(dirname(source));
    if (hash.digest('hex') !== expectedHash) fail('restore_plan_binding_mismatch');
  } finally { await file.close(); }
}

function archiveName(entry) {
  // Reject aliases on every OS, including Windows device names and ADS paths.
  // Header path matters because tar normalizes backslashes on Windows.
  const raw = entry.header.path;
  if (typeof raw !== 'string' || /[\\\x00-\x1f\x7f:]/.test(raw)) fail('restore_plan_archive_refused');
  let name = entry.path;
  if (typeof name !== 'string' || Buffer.byteLength(name) > 1024 || name.startsWith('/')) fail('restore_plan_archive_refused');
  if (name.startsWith('./')) name = name.slice(2);
  if (entry.type === 'Directory' && name.endsWith('/')) name = name.slice(0, -1);
  if (!name || name === '.') { if (entry.type !== 'Directory') fail('restore_plan_archive_refused'); return ''; }
  if (name.split('/').some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) fail('restore_plan_archive_refused');
  return name;
}

/** Only called with the retained, authenticated archive. Synchronous bounded
 * entry writes keep one file descriptor active and never buffer entire objects.
 * All output is private staging; no database or provider operation occurs here. */
async function extractPrivateArchive(archivePath, extracted, maxExpandedBytes) {
  const parser = new Parser({ strict: true, maxMetaEntrySize: 64 * 1024 });
  let parserError, fd = null, total = 0, count = 0;
  const seen = new Set(), directories = new Map();
  const reject = error => { parserError ||= error; parser.abort(error); };
  function ensureDirectories(path) {
    let current = extracted;
    for (const part of relative(extracted, path).split(sep).filter(Boolean)) {
      current = join(current, part);
      const key = relative(extracted, current).normalize('NFC').toLowerCase();
      if (directories.has(key) && directories.get(key) !== current) fail('restore_plan_archive_refused');
      directories.set(key, current);
      try { mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const info = lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink() || !equalPath(realpathSync(current), current)) fail('restore_plan_path_refused');
    }
  }
  parser.on('meta', () => reject(failure('restore_plan_archive_refused')));
  parser.on('ignoredEntry', () => reject(failure('restore_plan_archive_refused')));
  parser.on('entry', entry => {
    try {
      if (++count > REVIEW_MAX_ENTRIES || !['File', 'Directory'].includes(entry.type) || entry.linkpath
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size !== entry.header.size || entry.size > maxExpandedBytes) fail('restore_plan_archive_refused');
      const name = archiveName(entry);
      if (!name) { entry.resume(); return; }
      const key = name.normalize('NFC').toLowerCase();
      if (seen.has(key)) fail('restore_plan_archive_refused');
      seen.add(key);
      const path = contained(extracted, name);
      if (entry.type === 'Directory') { ensureDirectories(path); entry.resume(); return; }
      ensureDirectories(dirname(path));
      if (fd !== null) fail('restore_plan_archive_refused');
      fd = openSync(path, 'wx', 0o600); let written = 0;
      entry.on('data', chunk => {
        try {
          written += chunk.length;
          if (written > entry.size) fail('restore_plan_archive_refused');
          for (let offset = 0; offset < chunk.length;) {
            const size = writeSync(fd, chunk, offset, chunk.length - offset);
            if (!size) fail('restore_plan_archive_refused');
            offset += size;
          }
        } catch (error) { reject(error); }
      });
      entry.on('end', () => {
        try {
          if (fd !== null) { closeSync(fd); fd = null; }
          if (written !== entry.size) fail('restore_plan_archive_refused');
        } catch (error) { reject(error); }
      });
      entry.resume();
    } catch (error) { reject(error); }
  });
  const limit = new Transform({ transform(chunk, _, done) {
    total += chunk.length; done(total > maxExpandedBytes ? failure('restore_plan_too_large') : null, chunk);
  } });
  try { await pipeline(createReadStream(archivePath), createGunzip(), limit, parser); }
  catch (error) { throw parserError || (error.code === 'restore_plan_too_large' ? error : failure('restore_plan_archive_refused')); }
  finally { if (fd !== null) { closeSync(fd); fd = null; } }
  if (parserError) throw parserError;
}

/** Snapshot first, authenticate/validate that snapshot, then extract it privately.
 * Owner-controlled directory ACLs are a prerequisite. mode0700 is not Windows
 * ACL enforcement, and this API cannot protect against a malicious same-UID user.
 * afterSnapshot is an injected lifecycle seam for local race tests only.
 */
export async function preparePrivateReplay(options = {}, { afterSnapshot } = {}) {
  if (!RUNNER_ID_RE.test(options.runnerId || '') || !RUNNER_ID_RE.test(options.planRef || '')
    || !isHash(options.expectedBindingSha256) || !Number.isSafeInteger(options.maxCipherBytes) || options.maxCipherBytes < 1
    || !Number.isSafeInteger(options.maxExpandedBytes) || options.maxExpandedBytes < 1024) fail('restore_plan_setup_required');
  const root = await validatePrivateDirectory(options.directory);
  const originalCapsule = contained(root, options.capsulePath), capsuleRelative = relative(root, originalCapsule);
  if (['.restore-plans', '.capsule-review', '.replay-runs'].includes(capsuleRelative.split(sep)[0].toLowerCase())) fail('restore_plan_path_refused');
  await validatePrivateDirectory(originalCapsule);
  const runs = join(root, '.replay-runs');
  try { await mkdir(runs, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await validatePrivateDirectory(runs);
  const temp = await mkdtemp(join(runs, 'run-'));
  let removed = false, prepared;
  const cleanup = async () => {
    if (prepared) preparedContexts.delete(prepared);
    if (removed) return;
    if (dirname(temp) !== runs || !temp.startsWith(`${runs}${sep}`)) fail('restore_plan_path_refused');
    await validatePrivateDirectory(temp);
    await rm(temp, { recursive: true, force: true }); removed = true;
  };
  try {
    const snapshotRoot = join(temp, 'inputs');
    const capsulePath = contained(snapshotRoot, capsuleRelative), plans = join(snapshotRoot, '.restore-plans', options.planRef);
    await mkdir(capsulePath, { recursive: true, mode: 0o700 });
    await mkdir(plans, { recursive: true, mode: 0o700 });
    const originalPlan = join(root, '.restore-plans', options.planRef);
    await copyPinned(join(originalPlan, 'binding.json'), join(plans, 'binding.json'), PRIVATE_RESTORE_PLAN_JSON_BYTES, options.expectedBindingSha256);
    let binding;
    try { binding = JSON.parse(await readFile(join(plans, 'binding.json'), 'utf8')); } catch { fail('restore_plan_invalid'); }
    if (!isHash(binding?.planSha256) || !isHash(binding.metadataSha256) || !isHash(binding.ciphertextSha256)
      || binding.capsulePath !== capsuleRelative.replace(/\\/g, '/')) fail('restore_plan_binding_mismatch');
    await copyPinned(join(originalPlan, 'plan.json'), join(plans, 'plan.json'), PRIVATE_RESTORE_PLAN_JSON_BYTES, binding.planSha256);
    await copyPinned(join(originalCapsule, 'capsule.json'), join(capsulePath, 'capsule.json'), REVIEW_JSON_BYTES, binding.metadataSha256);
    await copyPinned(join(originalCapsule, 'capsule.pbase'), join(capsulePath, 'capsule.pbase'), options.maxCipherBytes, binding.ciphertextSha256);
    await afterSnapshot?.();
    prepared = await withValidatedPrivateRestorePlan({ ...options, directory: snapshotRoot, capsulePath: capsuleRelative }, async validated => {
      const extracted = join(temp, 'extracted');
      await mkdir(extracted, { mode: 0o700 });
      await extractPrivateArchive(validated.archivePath, extracted, options.maxExpandedBytes);
      let manifest;
      try { manifest = JSON.parse(await readFile(join(extracted, 'manifest.json'), 'utf8')); } catch { fail('restore_plan_invalid'); }
      return frozen({ metadata: validated.metadata, manifest, plan: validated.plan, extracted, temp, scratchRoot: temp,
        capsulePath, capsuleSha256: binding.ciphertextSha256, bindingSha256: validated.bindingSha256,
        selectedBytes: validated.selectedBytes, maxBytes: validated.maxBytes, cleanup });
    });
    preparedContexts.add(prepared);
    return prepared;
  } catch (error) {
    await cleanup();
    if (typeof error?.code === 'string' && /^(restore_plan_|capsule_|invalid_capsule_|unsupported_capsule_|private_config_)/.test(error.code)) throw error;
    fail('restore_plan_unavailable');
  }
}
