import { configReference, PRIVATE_OPERATIONS, RUNNER_ID_RE } from '../../cloud/runner/config-reference.mjs';
import { jobResultFromRecord, jobResultRecord, publicJobError } from '../../cloud/runner/job-result.mjs';

const fail = () => { throw new Error('invalid_job_completion_receipt'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const time = value => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function receiptKey(owner, runnerId, jobId) {
  if (!/^[a-f0-9]{64}$/.test(owner || '') || !RUNNER_ID_RE.test(runnerId || '') || typeof jobId !== 'string' || !/^job_[A-Za-z0-9_-]{1,76}$/.test(jobId)) fail();
  return `completions/${owner}/${runnerId}/${jobId}.json`;
}
function projectJob(job) {
  const payload = configReference(job?.payload);
  if (!exact(job.payload, Object.keys(payload)) || job.version !== 2 || job.runnerId !== payload.runnerId || job.workerId !== job.runnerId
    || !PRIVATE_OPERATIONS.includes(job.type) || !['succeeded', 'failed'].includes(job.status)
    || (job.status === 'succeeded' ? job.safeError !== null : job.safeError !== publicJobError(job.safeError))
    || !time(job.finishedAt) || !time(job.createdAt) || !time(job.claimedAt)) fail();
  let result = null;
  try { result = jobResultFromRecord(job); } catch { fail(); }
  if (result && (job.type !== 'backup' || job.status !== 'succeeded' || !/^[a-z0-9]{20}$/.test(job.projectRef || ''))) fail();
  return { id: job.id, version: 2, runnerId: job.runnerId, workerId: job.workerId, type: job.type, payload,
    status: job.status, safeError: job.safeError, createdAt: job.createdAt, claimedAt: job.claimedAt, finishedAt: job.finishedAt,
    ...(result ? { ...jobResultRecord(result), projectRef: job.projectRef } : {}) };
}

/** Immutable bounded receipt written only AFTER telemetry/latest/outbox persist.
 * It acknowledges a terminal result after queue history is pruned; it can never
 * recreate a queued/running job or authorize another execution. */
export async function storeJobCompletionReceipt(store, owner, job) {
  const key = receiptKey(owner, job.runnerId, job.id), receipt = { version: 1, owner, job: projectJob(job) };
  if (Buffer.byteLength(JSON.stringify(receipt)) > 2048) fail();
  const result = await store.setJSON(key, receipt, { onlyIfNew: true });
  if (!result.modified && JSON.stringify(await store.get(key, { type: 'json' })) !== JSON.stringify(receipt)) fail();
}

export async function readJobCompletionReceipt(store, owner, runnerId, jobId) {
  const receipt = await store.get(receiptKey(owner, runnerId, jobId), { type: 'json' });
  if (!receipt) return null;
  if (!exact(receipt, ['version', 'owner', 'job']) || receipt.version !== 1 || receipt.owner !== owner
    || Buffer.byteLength(JSON.stringify(receipt)) > 2048 || receipt.job?.runnerId !== runnerId || receipt.job?.id !== jobId) fail();
  const projected = projectJob(receipt.job);
  if (!exact(receipt.job, Object.keys(projected))) fail();
  return projected;
}
