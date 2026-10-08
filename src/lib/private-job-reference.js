import { configReference, PRIVATE_OPERATIONS, RUNNER_ID_RE } from '../../cloud/runner/config-reference.mjs';

export const MAX_PRIVATE_JOB_FILE_BYTES = 4096;
export const PRIVATE_JOB_RETRY_MS = 24 * 60 * 60 * 1000;
export function privateJobReference(value, agent) {
  const fields = ['version', 'type', 'runnerId', 'configRef', 'configRevision'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))
    || !PRIVATE_OPERATIONS.includes(value.type) || !agent || agent.revokedAt || value.runnerId !== agent.id) throw new Error('invalid_private_job_reference');
  return { ...configReference(value), type: value.type };
}
export function privateJobAttemptKey(account, reference) {
  if (typeof account !== 'string' || !account || account.length > 300) throw new Error('account_required');
  return `portabase.private-job-attempt.v1:${encodeURIComponent(account)}:${reference.runnerId}:${reference.configRef}:${reference.configRevision}:${reference.type}`;
}
export function readPrivateJobAttempt(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const result = JSON.parse(raw);
  if (!result || Object.keys(result).some(field => !['requestId', 'startedAt'].includes(field))
    || !RUNNER_ID_RE.test(result.requestId || '') || !Number.isSafeInteger(result.startedAt) || result.startedAt < 0) throw new Error('invalid_saved_attempt');
  return result;
}
export function canRetryPrivateJob(attempt, now = Date.now()) {
  return Boolean(attempt && Number.isSafeInteger(now) && now >= attempt.startedAt && now - attempt.startedAt < PRIVATE_JOB_RETRY_MS);
}
export function matchingPrivateJob(job, reference, requestId) {
  if (!job || job.version !== 2 || job.runnerId !== reference.runnerId || job.requestId !== requestId || job.type !== reference.type
    || typeof job.id !== 'string' || !/^job_[a-zA-Z0-9_-]{1,76}$/.test(job.id)
    || !['queued', 'running', 'succeeded', 'failed'].includes(job.status)) return null;
  const payload = job.payload;
  if (!payload || Object.keys(payload).some(key => !['version', 'runnerId', 'configRef', 'configRevision'].includes(key))) return null;
  for (const key of ['version', 'runnerId', 'configRef', 'configRevision']) if (payload[key] !== reference[key]) return null;
  return { id: job.id, status: job.status };
}
