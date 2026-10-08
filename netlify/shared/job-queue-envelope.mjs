import { RUNNER_ID_RE } from '../../cloud/runner/config-reference.mjs';
import { validScheduleRecord } from './schedule-contract.mjs';

const fail = () => { throw new Error('invalid_job_queue'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const time = value => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

/** Legacy arrays remain readable. Claim slots are internal metadata, never jobs
 * or account API fields. One bounded slot per registered runner slot prevents
 * idle polling from accumulating claim receipts. */
export function normalizeJobQueue(value) {
  if (value == null) return { version: 1, jobs: [], claimSlots: [] };
  if (Array.isArray(value)) return { version: 1, jobs: value, claimSlots: [] };
  if (![1, 2].includes(value.version) || !exact(value, value.version === 2 ? ['version', 'jobs', 'claimSlots', 'schedules'] : ['version', 'jobs', 'claimSlots'])
    || !Array.isArray(value.jobs) || !Array.isArray(value.claimSlots) || value.claimSlots.length > 12) fail();
  const slots = new Set(), runners = new Set();
  for (const row of value.claimSlots) {
    if (!exact(row, ['slot', 'runnerId', 'sequence', 'requestId', 'jobId', 'decidedAt'])
      || !Number.isInteger(row.slot) || row.slot < 0 || row.slot >= 12 || slots.has(row.slot)
      || typeof row.runnerId !== 'string' || !RUNNER_ID_RE.test(row.runnerId) || runners.has(row.runnerId)
      || !Number.isSafeInteger(row.sequence) || row.sequence < 1
      || typeof row.requestId !== 'string' || !RUNNER_ID_RE.test(row.requestId)
      || row.jobId !== null && (typeof row.jobId !== 'string' || !/^job_[A-Za-z0-9_-]{1,76}$/.test(row.jobId))
      || !time(row.decidedAt)) fail();
    slots.add(row.slot); runners.add(row.runnerId);
  }
  if (value.version === 2 && (!Array.isArray(value.schedules) || value.schedules.length > 12
    || value.schedules.some(row => !validScheduleRecord(row))
    || new Set(value.schedules.map(row => row.id)).size !== value.schedules.length
    || new Set(value.schedules.map(row => row.runnerId)).size !== value.schedules.length)) fail();
  return { version: value.version, jobs: value.jobs, claimSlots: value.claimSlots,
    ...(value.version === 2 ? { schedules: value.schedules } : {}) };
}

/** Preserve the legacy stored shape until first durable claim; thereafter every
 * queue/finish write carries claim metadata in the same atomic CAS. */
export function storedJobQueue(queue, previous) {
  const normalized = normalizeJobQueue(queue);
  return normalized.version === 2 || normalized.claimSlots.length || previous && !Array.isArray(previous) ? normalized : normalized.jobs;
}

export function publicClaimDecision(slot) {
  return { protocol: 1, sequence: slot.sequence, requestId: slot.requestId, runnerId: slot.runnerId };
}
