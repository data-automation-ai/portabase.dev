import { RUNNER_ID_RE } from '../../cloud/runner/config-reference.mjs';
export const SCHEDULE_STATES = ['waiting', 'queued', 'disabled', 'runner_unavailable', 'subscription_required', 'cadence_not_allowed', 'quota_exhausted', 'runner_busy', 'queue_full'];
export const exactFields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
export const isoTime = value => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const uuid = value => typeof value === 'string' && RUNNER_ID_RE.test(value);
export const positive = value => Number.isSafeInteger(value) && value > 0;
export function validScheduleInput(value) {
  return exactFields(value, ['id', 'revision', 'runnerId', 'configRef', 'configRevision', 'everyHours', 'startAt', 'enabled'])
    && uuid(value.id) && Number.isSafeInteger(value.revision) && value.revision >= 0 && uuid(value.runnerId)
    && uuid(value.configRef) && positive(value.configRevision) && Number.isInteger(value.everyHours)
    && value.everyHours >= 1 && value.everyHours <= 168 && isoTime(value.startAt) && typeof value.enabled === 'boolean';
}
export function validScheduleRecord(row) {
  if (!exactFields(row, ['id', 'revision', 'runnerId', 'configRef', 'configRevision', 'everyHours', 'startAt', 'enabled',
    'nextDueAt', 'lastScheduledAt', 'lastJobId', 'lastOutcome', 'updatedAt'])) return false;
  const input = Object.fromEntries(['id', 'revision', 'runnerId', 'configRef', 'configRevision', 'everyHours', 'startAt', 'enabled'].map(key => [key, row[key]]));
  return validScheduleInput(input) && positive(row.revision) && isoTime(row.nextDueAt) && isoTime(row.updatedAt)
    && (row.lastScheduledAt === null || isoTime(row.lastScheduledAt))
    && (row.lastJobId === null || typeof row.lastJobId === 'string' && /^job_[A-Za-z0-9_-]{1,76}$/.test(row.lastJobId))
    && SCHEDULE_STATES.includes(row.lastOutcome);
}
export function scheduleAnchor(startAt, everyHours, now, strictlyFuture = false) {
  const start = Date.parse(startAt), interval = everyHours * 3600000;
  const count = Math.max(0, Math.ceil((now - start + (strictlyFuture ? 1 : 0)) / interval));
  return new Date(start + count * interval).toISOString();
}
