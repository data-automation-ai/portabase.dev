import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { RUNNER_ID_RE } from './config-reference.mjs';
import { validatePrivateDirectory } from './private-config.mjs';
import { withAuthenticatedPrivateCapsule } from '../../utility/capsule-review-reader.mjs';
import { validateRestorePlan } from '../../utility/portabase-core.mjs';

export const PRIVATE_RESTORE_PLAN_JSON_BYTES = 256 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function boundedJson(path) {
  await validatePrivateDirectory(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail('restore_plan_path_refused');
  if (!integer(before.size) || before.size > PRIVATE_RESTORE_PLAN_JSON_BYTES) fail('restore_plan_too_large');
  const file = await open(path, 'r');
  try {
    if (!sameFile(before, await file.stat())) fail('restore_plan_changed');
    const buffer = Buffer.alloc(PRIVATE_RESTORE_PLAN_JSON_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > PRIVATE_RESTORE_PLAN_JSON_BYTES) fail('restore_plan_too_large');
    await validatePrivateDirectory(dirname(path));
    const after = await lstat(path);
    if (after.isSymbolicLink() || after.nlink !== 1 || size !== before.size || !sameFile(before, after)
      || !sameFile(before, await file.stat())) fail('restore_plan_changed');
    const bytes = buffer.subarray(0, size);
    let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('restore_plan_invalid'); }
    return { value, sha256: digest(bytes) };
  } finally { await file.close(); }
}

function matchInventory(plan, review) {
  for (const [name, keys, identity] of [
    ['tables', ['schema', 'table', 'bytes', 'selected'], row => JSON.stringify([row.schema, row.table])],
    ['buckets', ['id', 'objectCount', 'bytes', 'selected'], row => row.id],
    ['functions', ['name', 'selected'], row => row.name],
  ]) {
    const rows = plan[name], expected = review[name];
    if (!Array.isArray(rows) || rows.length !== expected.length) fail('restore_plan_inventory_mismatch');
    const inventory = new Map(expected.map(row => [identity(row), row])), seen = new Set();
    if (inventory.size !== expected.length) fail('restore_plan_inventory_mismatch');
    for (const row of rows) {
      if (!fields(row, keys) || typeof row.selected !== 'boolean') fail('restore_plan_invalid');
      const id = identity(row), original = inventory.get(id);
      if (!original || seen.has(id)) fail('restore_plan_inventory_mismatch');
      seen.add(id);
      for (const key of keys.filter(key => key !== 'selected')) {
        if (row[key] !== original[key]) fail('restore_plan_inventory_mismatch');
      }
    }
  }
}

/** Authenticate and validate a saved private plan while its authenticated archive
 * remains available to an awaited private callback. Original paths are not pinned
 * for later execution: callers must separately close that TOCTOU gap.
 * Budget uses the reader's table COPY bytes plus bucket bytes; it is not a full
 * database capacity forecast, source-size limit, or outbound bandwidth meter.
 */
export async function withValidatedPrivateRestorePlan(options = {}, usePlan) {
  const { directory, runnerId, projectRef, capsulePath, planRef, expectedBindingSha256,
    passphrase, maxCipherBytes, maxExpandedBytes, admissionMaxBytes } = options;
  if (typeof usePlan !== 'function' || !RUNNER_ID_RE.test(runnerId || '') || !RUNNER_ID_RE.test(planRef || '') || !hash(expectedBindingSha256)
    || !/^[a-z0-9]{20}$/.test(projectRef || '') || typeof passphrase !== 'string' || passphrase.length < 16
    || !integer(maxCipherBytes) || maxCipherBytes < 1 || !integer(maxExpandedBytes) || maxExpandedBytes < 1024
    || admissionMaxBytes !== undefined && (!integer(admissionMaxBytes) || admissionMaxBytes < 1)) fail('restore_plan_setup_required');
  try {
    const root = await validatePrivateDirectory(directory);
    if (typeof capsulePath !== 'string' || !capsulePath || /^[fF]:|^[\\/]{2}/.test(capsulePath) || capsulePath.includes('\0')) fail('restore_plan_path_refused');
    const capsule = resolve(root, capsulePath), rel = relative(root, capsule);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('restore_plan_path_refused');
    await validatePrivateDirectory(capsule);
    const planDirectory = join(root, '.restore-plans', planRef);
    const bindingPath = join(planDirectory, 'binding.json'), planPath = join(planDirectory, 'plan.json');
    const descriptor = await boundedJson(bindingPath), saved = await boundedJson(planPath);
    if (descriptor.sha256 !== expectedBindingSha256) fail('restore_plan_binding_mismatch');
    const binding = descriptor.value, plan = saved.value;
    if (!fields(binding, ['version', 'planRef', 'runnerId', 'projectRef', 'capsuleId', 'capsulePath', 'metadataSha256', 'ciphertextSha256', 'planSha256'])
      || binding.version !== 1 || binding.planRef !== planRef || binding.runnerId !== runnerId || binding.projectRef !== projectRef
      || binding.capsulePath !== rel.replace(/\\/g, '/') || !hash(binding.metadataSha256) || !hash(binding.ciphertextSha256)
      || !hash(binding.planSha256) || binding.planSha256 !== saved.sha256) fail('restore_plan_binding_mismatch');
    if (!fields(plan, ['formatVersion', 'capsuleId', 'projectRef', 'maxBytes', 'createdAt', 'tables', 'buckets', 'functions'])
      || plan.formatVersion !== 1 || plan.capsuleId !== binding.capsuleId || plan.projectRef !== projectRef
      || !integer(plan.maxBytes) || plan.maxBytes < 1 || typeof plan.createdAt !== 'string'
      || plan.createdAt.length !== 24 || !Number.isFinite(Date.parse(plan.createdAt))) fail('restore_plan_invalid');
    return await withAuthenticatedPrivateCapsule({ directory: root, runnerId, projectRef, capsulePath: capsule,
      passphrase, maxCipherBytes, maxExpandedBytes }, async ({ review, archivePath, metadata }) => {
      if (review.capsuleId !== binding.capsuleId || review.projectRef !== projectRef
        || review.binding.metadataSha256 !== binding.metadataSha256 || review.binding.ciphertextSha256 !== binding.ciphertextSha256) fail('restore_plan_binding_mismatch');
      matchInventory(plan, review);
      let budget;
      try { budget = validateRestorePlan(plan, { capsuleId: review.capsuleId, maxBytesOverride: Math.min(plan.maxBytes, admissionMaxBytes ?? plan.maxBytes) }); }
      catch { fail('restore_plan_over_budget'); }
      // Detect modifications during inspection; only archivePath is the retained snapshot.
      if ((await boundedJson(bindingPath)).sha256 !== descriptor.sha256 || (await boundedJson(planPath)).sha256 !== saved.sha256) fail('restore_plan_changed');
      return await usePlan({ plan, planPath, binding, bindingPath, bindingSha256: descriptor.sha256, ...budget, archivePath, metadata });
    });
  } catch (error) {
    if (typeof error?.code === 'string' && /^(restore_plan_|capsule_|invalid_capsule_|unsupported_capsule_|private_config_)/.test(error.code)) throw error;
    fail('restore_plan_unavailable');
  }
}

/** Snapshot validation only. No retained plaintext path escapes this wrapper. */
export async function validatePrivateRestorePlan(options = {}) {
  return withValidatedPrivateRestorePlan(options, ({ archivePath, metadata, ...validated }) => validated);
}
