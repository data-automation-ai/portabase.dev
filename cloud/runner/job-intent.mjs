/**
 * Safe job intents the control plane may store and a worker may pull.
 * Labels only: project ref, destination kind, table/bucket names to skip.
 * No DB URLs, passphrases, tokens, object paths, or capsule bytes.
 */
import { findForbiddenField } from '../control-plane/forbidden.mjs';

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
      safeError = body.safeError.slice(0, 300);
      if (findForbiddenField(safeError)) return { ok: false, error: 'zero_knowledge_forbidden', field: 'safeError' };
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
export function claimNextJob(jobs, { workerId = 'worker', now = new Date().toISOString() } = {}) {
  const list = Array.isArray(jobs) ? jobs.slice() : [];
  let index = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.status === 'queued') {
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

export function finishJob(jobs, { jobId, status, safeError = null, now = new Date().toISOString() } = {}) {
  const list = Array.isArray(jobs) ? jobs.slice() : [];
  const index = list.findIndex((job) => job?.id === jobId);
  if (index < 0) return { ok: false, error: 'job_not_found', jobs: list };
  if (list[index].status !== 'running') return { ok: false, error: 'job_not_running', jobs: list };
  list[index] = {
    ...list[index],
    status,
    safeError: safeError || null,
    finishedAt: now,
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
