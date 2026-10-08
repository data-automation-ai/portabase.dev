/**
 * V2 jobs carry opaque private configuration references only.
 * Legacy v1 retains named selection until the coordinated runner migration.
 */
import { findForbiddenField } from '../control-plane/forbidden.mjs';
import { jobResultFromRecord, jobResultRecord, publicJobError, publicJobResult } from './job-result.mjs';
import { configReference, PRIVATE_OPERATIONS, RUNNER_ID_RE } from './config-reference.mjs';

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const TABLE_RE = /^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_][A-Za-z0-9_$]*$/;
const BUCKET_RE = /^[A-Za-z0-9._-]{1,100}$/;
const DESTINATION_KINDS = new Set(['s3', 'dropbox', 'gdrive', 'local']);
const QUEUE_TYPES = new Set(['replay', 'backup', 'verify', 'heartbeat']);
const MAX_TABLES = 5000;
const MAX_BUCKETS = 1000;

function stringList(list, { re, max, field }) {
  if (list == null) return { ok: true, value: [] };
  if (!Array.isArray(list)) return { ok: false, error: `invalid_${field}`, field };
  if (list.length > max) return { ok: false, error: `too_many_${field}`, field };
  const value = [];
  for (const item of list) {
    if (typeof item !== 'string' || !re.test(item)) {
      return { ok: false, error: `invalid_${field}_entry`, field };
    }
    value.push(item);
  }
  return { ok: true, value };
}

/**
 * Classify a POST body. Returns { ok, action: 'queue'|'claim'|'finish', ... }.
 * `queue` includes the record fields the handler should persist.
 */
export function parseJobRequest(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_json' };
  }
  if (body.version !== undefined && ![1, 2].includes(body.version)) return { ok: false, error: 'invalid_job_version' };
  if (body.version === 2) {
    const type = body.type;
    const fields = type === 'claim' ? ['version', 'type', 'runnerId', 'claimProtocol', 'claimSequence', 'claimRequestId']
      : type === 'finish' ? ['version', 'type', 'runnerId', 'jobId', 'status', 'safeError', 'result']
        : ['version', 'type', 'runnerId', 'configRef', 'configRevision', 'requestId'];
    if (Object.keys(body).some(key => !fields.includes(key))) return { ok: false, error: 'mixed_private_job_fields' };
    if (typeof body.runnerId !== 'string' || !RUNNER_ID_RE.test(body.runnerId)) return { ok: false, error: 'invalid_runner_id' };
    if (type === 'claim') {
      const durable = ['claimProtocol', 'claimSequence', 'claimRequestId'].some(key => Object.hasOwn(body, key));
      if (durable && (body.claimProtocol !== 1 || !Number.isSafeInteger(body.claimSequence) || body.claimSequence < 1
        || typeof body.claimRequestId !== 'string' || !RUNNER_ID_RE.test(body.claimRequestId))) return { ok: false, error: 'invalid_claim_reference' };
      return { ok: true, action: 'claim', version: 2, runnerId: body.runnerId,
        ...(durable ? { claimProtocol: 1, claimSequence: body.claimSequence, claimRequestId: body.claimRequestId } : {}) };
    }
    if (type === 'finish') {
      if (typeof body.jobId !== 'string' || !/^job_[A-Za-z0-9_-]{1,76}$/.test(body.jobId)) return { ok: false, error: 'invalid_job_id' };
      if (!['succeeded', 'failed'].includes(body.status)) return { ok: false, error: 'invalid_status' };
      if (body.safeError != null && typeof body.safeError !== 'string') return { ok: false, error: 'invalid_safe_error' };
      let result = null;
      try { result = publicJobResult(body.result); } catch { return { ok: false, error: 'invalid_job_result' }; }
      if (body.status === 'failed' && result) return { ok: false, error: 'invalid_job_result' };
      return { ok: true, action: 'finish', version: 2, runnerId: body.runnerId, jobId: body.jobId,
        status: body.status, safeError: body.status === 'failed' ? publicJobError(body.safeError) : null,
        ...(result ? { result } : {}) };
    }
    if (!PRIVATE_OPERATIONS.includes(type)) return { ok: false, error: 'invalid_type' };
    if (body.requestId !== undefined && (typeof body.requestId !== 'string' || !RUNNER_ID_RE.test(body.requestId))) return { ok: false, error: 'invalid_request_id' };
    try { return { ok: true, action: 'queue', version: 2, type, requestId: body.requestId, payload: configReference(body) }; }
    catch { return { ok: false, error: 'invalid_config_reference' }; }
  }
  const forbidden = findForbiddenField(body);
  if (forbidden || body.passphrase || body.decrypt || body.objectName || body.tableRows || body.plaintext) {
    return { ok: false, error: 'zero_knowledge_forbidden', field: forbidden || 'body' };
  }

  const type = String(body.type || body.action || 'replay').slice(0, 40);
  if (type === 'claim') return { ok: true, action: 'claim' };
  if (type === 'finish') {
    const jobId = String(body.jobId || '').slice(0, 80);
    if (!jobId.startsWith('job_')) return { ok: false, error: 'invalid_job_id', field: 'jobId' };
    const status = body.status === 'succeeded' || body.status === 'failed' ? body.status : null;
    if (!status) return { ok: false, error: 'invalid_status', field: 'status' };
    let safeError = null;
    if (body.safeError != null && body.safeError !== '') {
      if (typeof body.safeError !== 'string') return { ok: false, error: 'invalid_safe_error', field: 'safeError' };
      safeError = publicJobError(body.safeError);
    }
    return { ok: true, action: 'finish', jobId, status, safeError };
  }
  if (!QUEUE_TYPES.has(type)) return { ok: false, error: 'invalid_type', field: 'type' };

  let projectRef = null;
  if (body.projectRef != null && body.projectRef !== '') {
    projectRef = String(body.projectRef);
    if (!PROJECT_REF_RE.test(projectRef)) return { ok: false, error: 'invalid_project_ref', field: 'projectRef' };
  }
  if (type === 'backup' && !projectRef) return { ok: false, error: 'missing_project_ref', field: 'projectRef' };

  const tables = stringList(body.excludeTables, { re: TABLE_RE, max: MAX_TABLES, field: 'exclude_table' });
  if (!tables.ok) return tables;
  const buckets = stringList(body.excludeBuckets, { re: BUCKET_RE, max: MAX_BUCKETS, field: 'exclude_bucket' });
  if (!buckets.ok) return buckets;

  let destinationKind = null;
  if (body.destinationKind != null && body.destinationKind !== '') {
    destinationKind = String(body.destinationKind);
    if (!DESTINATION_KINDS.has(destinationKind)) {
      return { ok: false, error: 'invalid_destination_kind', field: 'destinationKind' };
    }
  }

  let targetRef = null;
  if (body.targetRef != null && body.targetRef !== '') {
    targetRef = String(body.targetRef);
    if (!PROJECT_REF_RE.test(targetRef)) return { ok: false, error: 'invalid_target_ref', field: 'targetRef' };
  }
  if (type === 'replay' && !targetRef) return { ok: false, error: 'missing_target_ref', field: 'targetRef' };

  let incrementalBinary = false;
  if (body.incrementalBinary != null && body.incrementalBinary !== false) {
    if (body.incrementalBinary !== true) {
      return { ok: false, error: 'invalid_incremental_binary', field: 'incrementalBinary' };
    }
    if (type !== 'backup') {
      return { ok: false, error: 'incremental_binary_backup_only', field: 'incrementalBinary' };
    }
    incrementalBinary = true;
  }

  return {
    ok: true,
    action: 'queue',
    type,
    payload: {
      projectRef,
      targetRef,
      destinationKind,
      excludeTables: tables.value,
      excludeBuckets: buckets.value,
      capsuleId: body.capsuleId ? String(body.capsuleId).slice(0, 120) : null,
      note: body.note ? String(body.note).slice(0, 200) : null,
      manual: true,
      incrementalBinary,
    },
  };
}

/** Oldest queued job becomes running. Jobs are stored newest-first. */
export function claimNextJob(jobs, { workerId = 'worker', runnerId, now = new Date().toISOString() } = {}) {
  const list = Array.isArray(jobs) ? jobs.slice() : [];
  let index = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    const privateJob = row?.version === 2 || row?.payload?.version === 2;
    const matches = runnerId ? privateJob && row.payload?.runnerId === runnerId && (!row.runnerId || row.runnerId === runnerId) : !privateJob;
    if (row?.status === 'queued' && matches) {
      index = i;
      break;
    }
  }
  if (index < 0) return { ok: true, job: null, jobs: list };
  const job = {
    ...list[index],
    status: 'running',
    claimedAt: now,
    workerId: String(workerId).slice(0, 80),
  };
  list[index] = job;
  return { ok: true, job, jobs: list };
}

export function finishJob(jobs, { jobId, status, safeError = null, runnerId, result: suppliedResult = null,
  projectRef, now = new Date().toISOString() } = {}) {
  const list = Array.isArray(jobs) ? jobs.slice() : [];
  const index = list.findIndex((job) => job?.id === jobId);
  if (index < 0) return { ok: false, error: 'job_not_found', jobs: list };
  const row = list[index];
  if ((row.version === 2 || row.payload?.version === 2) && (!runnerId || row.payload?.runnerId !== runnerId
    || row.runnerId && row.runnerId !== runnerId)) return { ok: false, error: 'runner_binding_mismatch', jobs: list };
  const resultError = status === 'failed' ? publicJobError(safeError) : null;
  let result = null;
  try { result = publicJobResult(suppliedResult); } catch { return { ok: false, error: 'invalid_job_result', jobs: list }; }
  if (result && (status !== 'succeeded' || row.type !== 'backup')) {
    return { ok: false, error: 'invalid_job_result', jobs: list };
  }
  if (row.version === 2 && ['succeeded', 'failed'].includes(row.status)) {
    let storedResult;
    try { storedResult = jobResultFromRecord(row); } catch { return { ok: false, error: 'job_result_conflict', jobs: list }; }
    if (row.status === status && row.safeError === resultError && JSON.stringify(storedResult) === JSON.stringify(result)) {
      return { ok: true, job: row, jobs: list, unchanged: true };
    }
    return { ok: false, error: 'job_result_conflict', jobs: list };
  }
  if (row.status !== 'running') return { ok: false, error: 'job_not_running', jobs: list };
  if (result && !/^[a-z0-9]{20}$/.test(projectRef || '')) return { ok: false, error: 'invalid_job_result', jobs: list };
  list[index] = {
    ...list[index],
    status,
    safeError: resultError,
    finishedAt: now,
    ...(result ? { ...jobResultRecord(result), projectRef } : {}),
  };
  return { ok: true, job: list[index], jobs: list };
}

/**
 * Cloud Free has transfersPer24h 0 because it has no scheduled service.
 * A manual backup is still the product: one per 24h, never a schedule.
 */
export function manualBackupBlocked({ plan, usedLast24h, atLimit }) {
  if (plan && plan.scheduled === false) return Number(usedLast24h) >= 1;
  return Boolean(atLimit);
}
