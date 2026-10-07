import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { configReference, PRIVATE_OPERATIONS, RUNNER_ID_RE } from './config-reference.mjs';

const REF = /^[a-z0-9]{20}$/;
const MAX_BYTES = 256 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function forbidPath(value) {
  // Refuse F:, UNC and device aliases before any filesystem call.
  if (typeof value !== 'string' || !value || /^[fF]:/.test(value) || /^[\\/]{2}/.test(value)
    || value.includes('\0')) fail('private_config_path_refused');
}
function inside(root, value) {
  forbidPath(value);
  const path = resolve(root, value);
  forbidPath(path);
  const rel = relative(root, path);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) fail('private_config_path_refused');
  return path;
}
async function noLinks(path, { directory = false } = {}) {
  const parsed = parse(path);
  let at = parsed.root;
  for (const segment of path.slice(parsed.root.length).split(sep).filter(Boolean)) {
    at = join(at, segment);
    const info = await lstat(at);
    if (info.isSymbolicLink()) fail('private_config_path_refused');
  }
  if (!samePath(await realpath(path), path)) fail('private_config_path_refused');
  const info = await lstat(path);
  if (directory ? !info.isDirectory() : !info.isFile()) fail('private_config_path_refused');
  return info;
}
async function readJson(path) {
  const before = await noLinks(path);
  if (before.nlink !== 1) fail('private_config_path_refused');
  if (before.size > MAX_BYTES) fail('private_config_too_large');
  const file = await open(path, 'r');
  try {
    const opened = await file.stat();
    const after = await noLinks(path);
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.ino !== after.ino
      || opened.dev !== after.dev || opened.size > MAX_BYTES) fail('private_config_changed');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) fail('private_config_too_large');
    const final = await file.stat();
    if (final.size !== opened.size || final.mtimeMs !== opened.mtimeMs || bytesRead !== opened.size) fail('private_config_changed');
    const contents = bytes.subarray(0, bytesRead);
    return { value: JSON.parse(contents.toString('utf8')), digest: createHash('sha256').update(contents).digest('hex') };
  } finally { await file.close(); }
}
function names(value, re, max) {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || item.length > 256 || !re.test(item))) fail('invalid_private_selection');
  return value.slice();
}
/** `{ [bucketKey]: objectName[] }` — per-object exclusions within an otherwise-included bucket. */
function excludeObjectsMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_private_selection');
  const result = {};
  for (const [bucketKey, list] of Object.entries(value)) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(bucketKey)) fail('invalid_private_selection');
    if (!Array.isArray(list) || list.length > 20000
      || list.some(item => typeof item !== 'string' || !item || item.length > 1024 || /[\0-\x1f\x7f]/.test(item))) fail('invalid_private_selection');
    result[bucketKey] = list.slice();
  }
  return result;
}
function rejectForbiddenDrive(value) {
  if (typeof value === 'string' && (/^[fF]:/.test(value) || /^[\\/]{2}/.test(value))) fail('private_config_path_refused');
  if (value && typeof value === 'object') for (const child of Object.values(value)) rejectForbiddenDrive(child);
}
function rejectPartialBucketCapture(config) {
  const capture = config?.capture;
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) return;
  if (capture.storageInventoryOnly === true
    || (capture.storageSample !== undefined && capture.storageSample !== null && capture.storageSample !== '')) {
    fail('private_partial_bucket_capture_refused');
  }
}
async function checkPrivateOutput(root, value) {
  const path = inside(root, value);
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory() || !samePath(await realpath(current), current)) fail('private_config_path_refused');
    } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}

export async function loadPrivateEngineConfig({ directory, projectRef, engineConfigPath }) {
  forbidPath(directory);
  if (!isAbsolute(directory)) fail('private_config_directory_required');
  const root = resolve(directory);
  await noLinks(root, { directory: true });
  const configPath = inside(root, engineConfigPath);
  const config = await readJson(configPath);
  if (!REF.test(projectRef || '') || !config.value || config.value.projectRef !== projectRef) fail('project_ref_mismatch');
  rejectForbiddenDrive(config.value);
  rejectPartialBucketCapture(config.value);
  for (const field of ['backupDirectory', 'statusDirectory']) await checkPrivateOutput(root, config.value[field]);
  return { root, configPath, ...config };
}

export async function validatePrivateDirectory(directory) {
  forbidPath(directory);
  if (!isAbsolute(directory)) fail('private_config_directory_required');
  const root = resolve(directory);
  await noLinks(root, { directory: true });
  return root;
}

/** Read only an explicitly named revision below a trusted private directory.
 * This adapter never creates storage, fetches configuration, or falls back to latest.
 * The runner owner must prevent concurrent configuration replacement via filesystem ACLs.
 * Saved restore plans are authenticated here. The worker's fixed private replay
 * child pins this record digest and prepares a separate authenticated snapshot
 * before execution; it never falls back to an unfiltered replay for these plans.
 */
export async function resolvePrivateJob(job, { directory, runnerId, projectRef, targetRef,
  passphrase, maxCipherBytes, maxExpandedBytes } = {}) {
  try {
    const reference = configReference(job?.payload);
    if (Object.keys(job.payload).some(key => !Object.hasOwn(reference, key))) fail('mixed_private_job_fields');
    if (!PRIVATE_OPERATIONS.includes(job.type)) fail('unsupported_job_type');
    if (reference.runnerId !== runnerId) fail('runner_binding_mismatch');
    if (typeof projectRef !== 'string' || !REF.test(projectRef)) fail('missing_worker_project');
    forbidPath(directory);
    if (!isAbsolute(directory)) fail('private_config_directory_required');
    const root = resolve(directory);
    await noLinks(root, { directory: true });
    const path = inside(root, `${reference.configRef}/${reference.configRevision}.json`);
    const { value: record, digest: configRevisionSha256 } = await readJson(path);
    const fields = ['version', 'runnerId', 'configRef', 'configRevision', 'operation', 'projectRef', 'targetRef',
      'engineConfigPath', 'engineConfigSha256', 'capsulePath', 'excludeTables', 'excludeBuckets', 'excludeObjects', 'incrementalBinary',
      'restorePlanRef', 'restorePlanBindingSha256'];
    if (!record || Array.isArray(record) || typeof record !== 'object' || Object.keys(record).some(key => !fields.includes(key))) fail('invalid_private_config');
    configReference(record);
    for (const key of ['runnerId', 'configRef', 'configRevision']) if (record[key] !== reference[key]) fail('config_binding_mismatch');
    if (record.operation !== job.type) fail('config_operation_mismatch');
    if (record.projectRef !== projectRef) fail('project_ref_mismatch');
    const hasRestorePlan = Object.hasOwn(record, 'restorePlanRef') || Object.hasOwn(record, 'restorePlanBindingSha256');
    if (hasRestorePlan && (job.type !== 'replay' || typeof record.restorePlanRef !== 'string'
      || !RUNNER_ID_RE.test(record.restorePlanRef) || typeof record.restorePlanBindingSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(record.restorePlanBindingSha256))) fail('invalid_private_restore_plan');
    if (!/^[a-f0-9]{64}$/.test(record.engineConfigSha256 || '')) fail('invalid_private_config');
    const configPath = inside(root, record.engineConfigPath);
    const config = await readJson(configPath);
    if (config.digest !== record.engineConfigSha256) fail('engine_config_changed');
    if (!config.value || config.value.projectRef !== projectRef) fail('project_ref_mismatch');
    rejectForbiddenDrive(config.value);
    rejectPartialBucketCapture(config.value);
    // No implicit working-directory defaults for private runner staging or status.
    for (const field of ['backupDirectory', 'statusDirectory']) {
      await checkPrivateOutput(root, config.value[field]);
    }
    const payload = { projectRef, excludeTables: [], excludeBuckets: [], excludeObjects: {}, incrementalBinary: false };
    let restorePlan;
    if (job.type === 'backup') {
      if (record.targetRef !== undefined || record.capsulePath !== undefined) fail('invalid_private_config');
      payload.excludeTables = names(record.excludeTables, /^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_][A-Za-z0-9_$]*$/, 5000);
      payload.excludeBuckets = names(record.excludeBuckets, /^[A-Za-z0-9._-]{1,100}$/, 1000);
      payload.excludeObjects = excludeObjectsMap(record.excludeObjects ?? {});
      if (typeof record.incrementalBinary !== 'boolean') fail('invalid_private_selection');
      payload.incrementalBinary = record.incrementalBinary === true;
    } else {
      if (['excludeTables', 'excludeBuckets', 'excludeObjects', 'incrementalBinary'].some(key => Object.hasOwn(record, key))) fail('invalid_private_config');
      const capsule = inside(root, record.capsulePath);
      await noLinks(capsule, { directory: true });
      const metadata = await readJson(join(capsule, 'capsule.json'));
      if (metadata.value?.projectRef !== projectRef) fail('capsule_project_mismatch');
      payload.capsulePath = capsule;
      if (job.type === 'replay') {
        if (typeof record.targetRef !== 'string' || !REF.test(record.targetRef) || record.targetRef === projectRef || record.targetRef !== targetRef) fail('target_ref_mismatch');
        payload.targetRef = record.targetRef;
        if (hasRestorePlan) {
          // Admission is authoritative job metadata, never an option or private
          // config override. No coercion, unlimited fallback, or ambient key.
          if (!Number.isSafeInteger(job.admission?.maxBytes) || job.admission.maxBytes <= 0) fail('restore_plan_setup_required');
          // Dynamic import avoids a cycle: the validator uses validatePrivateDirectory.
          const { validatePrivateRestorePlan } = await import('./private-restore-plan.mjs');
          restorePlan = await validatePrivateRestorePlan({ directory: root, runnerId, projectRef,
            capsulePath: capsule, planRef: record.restorePlanRef, expectedBindingSha256: record.restorePlanBindingSha256,
            passphrase, maxCipherBytes, maxExpandedBytes, admissionMaxBytes: job.admission.maxBytes });
        }
      } else if (record.targetRef !== undefined) fail('invalid_private_config');
    }
    return { job: { ...job, payload }, configPath, cwd: root,
      ...(job.type === 'backup' ? { resultContext: {
        statusDirectory: inside(root, config.value.statusDirectory),
        projectRef,
        destinationKind: config.value.provider?.type,
      } } : {}),
      ...(hasRestorePlan ? { restorePlan, configRevisionSha256 } : {}) };
  } catch (error) {
    // Private paths, JSON fragments and OS diagnostics stay inside the runner.
    if (error?.code && /^[a-z_]+$/.test(error.code)) throw error;
    fail('private_config_unavailable');
  }
}
