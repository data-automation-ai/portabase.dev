import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { safeCloudEvent, CLOUD_EVENT_MAX_AGE_MS } from './safe-telemetry.mjs';
import { storeLatestReport } from './runner-reports.mjs';
import { createNotificationOutbox } from './notification-outbox.mjs';
import { jobResultFromRecord } from '../../cloud/runner/job-result.mjs';

const fail = () => { throw new Error('invalid_job_completion_binding'); };
const operations = { backup: ['backup', 'capture', 'backup_error'], verify: ['verify', 'verify', 'verify_error'], replay: ['restore', 'restore', 'restore_error'] };

/** A worker exit report is operational status, never proof of complete capture,
 * successful delivery, a tested restore, or recovered application behavior. */
export function jobCompletionEvent(job, runner, now = Date.now()) {
  const finished = Date.parse(job?.finishedAt);
  if (!job || job.version !== 2 || !runner || runner.revokedAt || !/^[a-f0-9]{64}$/.test(runner.owner || '')
    || !/^[a-f0-9-]{36}$/.test(runner.id || '') || !/^[a-z0-9]{20}$/.test(runner.projectRef || '')
    || job.runnerId !== runner.id || job.workerId !== runner.id || job.payload?.runnerId !== runner.id
    || typeof job.id !== 'string' || !/^job_[A-Za-z0-9_-]{1,76}$/.test(job.id)
    || !Object.hasOwn(operations, job.type) || !['succeeded', 'failed'].includes(job.status)
    || typeof job.finishedAt !== 'string' || !Number.isFinite(finished) || !Number.isFinite(now)
    || finished > now + 300_000 || new Date(finished).toISOString() !== job.finishedAt) fail();
  const [operation, phase, errorClass] = operations[job.type], failed = job.status === 'failed';
  let result = null;
  try { result = jobResultFromRecord(job); } catch { fail(); }
  if (result && (failed || job.type !== 'backup')) fail();
  return safeCloudEvent({ eventType: `${operation}.${failed ? 'failed' : 'completed'}`,
    projectRef: runner.projectRef, occurredAt: job.finishedAt,
    payload: { runnerState: failed ? 'needs_attention' : 'completed', status: failed ? 'failed' : 'completed',
      phase, ...(failed ? { errorClass } : {}), ...(result ? {
        capsuleId: result.capsuleId, capsuleHash: result.capsuleHash, manifestHash: result.manifestHash,
        sizeBytes: result.sizeBytes, objectCount: result.objectCount, durationMs: result.durationMs,
        destinationKind: result.destinationKind, destinationVerified: result.destinationVerified,
      } : {}) } }, runner, now - finished > CLOUD_EVENT_MAX_AGE_MS ? finished : now);
}

/** Deterministic writes let the job completion journal retry partial persistence.
 * This enqueues notifications only; no transport/provider send happens here. */
export function createJobCompletionPublisher({
  telemetryStore = () => getStore({ name: 'portabase-cloud-telemetry', consistency: 'strong' }),
  enqueueNotifications = input => createNotificationOutbox().enqueue(input), clock = Date.now,
} = {}) {
  return async ({ job, runner, authorization }) => {
    const event = jobCompletionEvent(job, runner, clock());
    const id = createHash('sha256').update(JSON.stringify([runner.owner, runner.id, job.id])).digest('hex');
    const key = `owners/${runner.owner}/${job.finishedAt.slice(0, 10)}/job-${id}.json`;
    const store = telemetryStore(), record = { owner: runner.owner, receivedAt: job.finishedAt, event };
    const written = await store.setJSON(key, record, { onlyIfNew: true });
    if (!written.modified) {
      const existing = await store.get(key, { type: 'json' });
      if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('job_completion_event_conflict');
    }
    await storeLatestReport(store, record);
    await enqueueNotifications({ authorization, input: event, sourceJobId: job.id,
      expectedOwner: runner.owner, expectedAgentId: runner.id });
  };
}
