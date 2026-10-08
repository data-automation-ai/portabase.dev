import { lstat, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

// Only these operational codes may leave the private runner. Diagnostics stay there.
const codes = new Set(['worker_failed', 'project_ref_mismatch', 'missing_target_ref',
  'missing_worker_auth', 'job_request_failed', 'engine_failed', 'unsupported_job_type',
  'missing_worker_project', 'missing_job_project', 'job_result_unconfirmed',
  'job_execution_unknown', 'invalid_job_capsule_limit', 'job_capsule_limit_exceeded']);
export function publicJobError(value) {
  if (typeof value !== 'string') return 'worker_failed';
  if (codes.has(value)) return value;
  // OS process exit status is a bounded integer, never arbitrary exception text.
  if (/^engine_exit_(?:[1-9]\d{0,2}|unknown)$/.test(value)) {
    if (value === 'engine_exit_unknown' || Number(value.slice(12)) <= 255) return value;
  }
  return 'worker_failed';
}

export const SAFE_JOB_RESULT_FIELDS = Object.freeze([
  'schemaVersion', 'capsuleId', 'status', 'capsuleHash', 'manifestHash',
  'sizeBytes', 'objectCount', 'durationMs', 'destinationKind',
  'destinationVerified', 'completedAt',
]);
const DESTINATIONS = new Set(['s3', 'dropbox', 'gdrive', 'local', 'nas', 'azure-blob', 'gcs', 'rclone']);
const STATUSES = new Set(['COMPLETE', 'SELECTIVE', 'TRIAL']);
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const timestamp = value => typeof value === 'string' && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
const destination = value => value === 'aws' ? 's3' : value === 'azure' ? 'azure-blob' : value;

/** Exact safe projection allowed to leave a customer-controlled runner. */
export function publicJobResult(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== SAFE_JOB_RESULT_FIELDS.length
    || Object.keys(value).some(key => !SAFE_JOB_RESULT_FIELDS.includes(key))
    || value.schemaVersion !== 1 || typeof value.capsuleId !== 'string'
    || !/^[A-Za-z0-9._-]{1,200}$/.test(value.capsuleId) || !STATUSES.has(value.status)
    || !hash(value.capsuleHash) || !hash(value.manifestHash)
    || integer(value.sizeBytes) === null || integer(value.objectCount) === null
    || integer(value.durationMs) === null || !DESTINATIONS.has(destination(value.destinationKind))
    || typeof value.destinationVerified !== 'boolean' || !timestamp(value.completedAt)) {
    throw Object.assign(new Error('invalid_job_result'), { code: 'invalid_job_result' });
  }
  return { ...value, destinationKind: destination(value.destinationKind) };
}

/** Store the safe result on a job without overwriting the queue status. */
export function jobResultRecord(value) {
  const result = publicJobResult(value);
  if (!result) return {};
  const { status, ...rest } = result;
  return { ...rest, capsuleStatus: status };
}

export function jobResultFromRecord(job) {
  if (!job || typeof job !== 'object') return null;
  // Ordinary jobs already have status, duration and destination fields. Only
  // markers unique to this protocol opt a retained row into strict validation.
  const present = ['schemaVersion', 'capsuleId', 'manifestHash', 'destinationVerified', 'completedAt']
    .some(key => Object.hasOwn(job, key));
  if (!present) return null;
  return publicJobResult(Object.fromEntries(SAFE_JOB_RESULT_FIELDS.map(key => [key, key === 'status' ? job.capsuleStatus : job[key]])));
}

async function boundedJson(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16 * 1024) throw new Error('invalid_job_result');
  const file = await open(path, 'r');
  try {
    const opened = await file.stat(), bytes = Buffer.alloc(16 * 1024 + 1);
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw new Error('invalid_job_result');
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0), after = await file.stat();
    if (bytesRead > 16 * 1024 || bytesRead !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('invalid_job_result');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally { await file.close(); }
}

/** Read the engine's private status and return only the fixed public projection. */
export async function readPrivateBackupResult({ statusDirectory, projectRef, destinationKind, startedAt }) {
  if (!isAbsolute(statusDirectory || '') || /^[fF]:/.test(statusDirectory) || !/^[a-z0-9]{20}$/.test(projectRef || '')
    || !Number.isFinite(startedAt)) throw new Error('invalid_job_result');
  const status = await boundedJson(join(statusDirectory, 'latest.json'));
  if (status.projectRef !== projectRef || Date.parse(status.completedAt) < startedAt - 1000) throw new Error('invalid_job_result');
  return publicJobResult({
    schemaVersion: 1,
    capsuleId: status.capsule,
    status: status.state,
    capsuleHash: status.capsuleHash,
    manifestHash: status.manifestHash,
    sizeBytes: status.sizeBytes,
    objectCount: status.objectCount,
    durationMs: status.durationMs,
    destinationKind,
    destinationVerified: status.destinationVerified === true,
    completedAt: status.completedAt,
  });
}
