import { configReference, RUNNER_ID_RE } from '../../cloud/runner/config-reference.mjs';
import { jobResultFromRecord, jobResultRecord, publicJobError } from '../../cloud/runner/job-result.mjs';
import { CLOUD_PLANS } from './product.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const member = (value, values, fallback = null) => values.includes(value) ? value : fallback;
const jobId = value => text(value, /^job_[A-Za-z0-9_-]{1,76}$/);
const runnerId = value => text(value, RUNNER_ID_RE);
const projectRef = value => text(value, /^[a-z0-9]{20}$/);
const hash = value => text(value, /^[a-f0-9]{64}$/);
export function publicTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z') ? new Date(time).toISOString() : null;
}

/** Reproject retained rows at every response; write-time validation cannot make
 * legacy blobs or unexpected nested values safe to return. */
export function publicJobRecord(job) {
  if (!object(job)) return null;
  const base = { id: jobId(job.id), type: member(job.type, ['backup', 'capture', 'restore', 'replay', 'verify', 'doctor', 'heartbeat'], 'unknown'),
    status: member(job.status, ['queued', 'running', 'succeeded', 'failed', 'canceled', 'cancelled', 'completed'], 'unknown'),
    createdAt: publicTimestamp(job.createdAt), claimedAt: publicTimestamp(job.claimedAt), finishedAt: publicTimestamp(job.finishedAt),
    safeError: job.safeError == null ? null : publicJobError(job.safeError) };
  if (job.version !== 2) return { ...base, legacy: true, migrationRequired: true };
  let payload = null;
  try { const reference = configReference(job.payload); if (reference.runnerId === job.runnerId) payload = reference; } catch { /* omit invalid references */ }
  const a = job.admission;
  const admission = object(a) && typeof a.paid === 'boolean' && typeof a.manual === 'boolean'
    && Number.isSafeInteger(a.maxBytes) && a.maxBytes > 0 && typeof a.planId === 'string' && (a.planId === 'cloud-free' || Object.hasOwn(CLOUD_PLANS, a.planId))
    ? { paid: a.paid, planId: a.planId, maxBytes: a.maxBytes, manual: a.manual } : null;
  let result = null;
  try { result = jobResultFromRecord(job); } catch { /* omit malformed retained results */ }
  return { ...base, version: 2, runnerId: runnerId(job.runnerId), payload, admission,
    cloudVersion: member(job.cloudVersion, ['supabase', 'aws']), ...(runnerId(job.requestId) ? { requestId: job.requestId } : {}),
    ...(result ? { ...jobResultRecord(result), projectRef: projectRef(job.projectRef) } : {}) };
}

/** Dashboard metrics remain available, but names and diagnostic strings from
 * old flags/phase/verdict fields never enter the presentation sanitizer. */
export function publicDashboardJob(job) {
  const result = publicJobRecord(job); if (!result) return null;
  const source = { ...(object(job.payload) ? job.payload : {}), ...job };
  const out = { ...result, phase: member(source.phase, ['database', 'auth', 'storage', 'functions', 'capture', 'encrypt', 'upload', 'verify', 'restore', 'complete']),
    projectRef: projectRef(source.projectRef || source.project_ref),
    region: text(source.region, /^[a-z0-9-]{1,40}$/), destinationKind: member(source.destinationKind, ['s3', 'dropbox', 'gdrive', 'local', 'nas', 'azure-blob', 'gcs', 'rclone']),
    startedAt: publicTimestamp(source.startedAt || source.createdAt || source.occurredAt),
    capsuleId: text(source.capsuleId, /^[A-Za-z0-9._-]{1,200}$/), capsuleStatus: member(source.capsuleStatus, ['COMPLETE', 'SELECTIVE', 'TRIAL']),
    capsuleHash: hash(source.capsuleHash || source.capsule_hash), manifestHash: hash(source.manifestHash),
    destinationVerified: source.destinationVerified === true, verified: source.verified === true,
    compareVerdict: member(source.compareVerdict || source.verdict, ['MATCH', 'MISMATCH', 'UNKNOWN']),
    errorCode: source.errorCode == null ? null : publicJobError(source.errorCode), flags: {} };
  for (const field of ['objectCount', 'sizeBytes', 'durationMs', 'dbBytes', 'storageBytes', 'functionsBytes', 'authBytes', 'dailyMeterBytes']) {
    const value = integer(source[field]); if (value !== null) out[field] = value;
  }
  for (const field of ['excludeBinaries', 'excludeTableList', 'forceOrphanFks']) if (source.flags?.[field] === true) out.flags[field] = true;
  const layers = {};
  for (const layer of ['database', 'auth', 'storage', 'functions']) {
    const row = source.layerHashes?.[layer], digest = hash(typeof row === 'string' ? row : row?.hash || row?.digest);
    if (digest) layers[layer] = { hash: digest };
    if (object(row)) for (const [field, alternate] of [['sizeBytes', 'bytes'], ['objectCount', 'count']]) {
      const value = integer(row[field] ?? row[alternate]); if (value !== null) (layers[layer] ||= {})[field] = value;
    }
  }
  if (Object.keys(layers).length) out.layerHashes = layers;
  return out;
}

export function publicRunnerRecord(row) {
  if (!object(row)) return null;
  return { runnerId: text(row.runnerId, /^run_[a-f0-9-]{36}$/),
    subscriberId: text(row.subscriberId, /^(?:supabase|aws):[A-Za-z0-9_-]{1,128}$/),
    status: member(row.status, ['unprovisioned', 'sleeping', 'ready', 'running', 'error', 'stopped'], 'unknown'),
    desiredStatus: member(row.desiredStatus, ['sleeping', 'ready']), region: text(row.region, /^[a-z0-9-]{1,40}$/),
    engine: member(row.engine, ['free-open-source-cli']), sealedKeysPresent: row.sealedKeysPresent === true,
    createdAt: publicTimestamp(row.createdAt), updatedAt: publicTimestamp(row.updatedAt), lastJobId: jobId(row.lastJobId),
    provisioning: 'metadata_only', isolation: 'not_proven_green' };
}

export function publicAgentRecord(record, jobAccess = false) {
  return { id: runnerId(record.id), name: text(record.name, /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/) || 'Capsule runner',
    projectRef: projectRef(record.projectRef), slot: Number.isInteger(record.slot) && record.slot >= 0 && record.slot < 12 ? record.slot : null,
    createdAt: publicTimestamp(record.createdAt), revokedAt: record.revokedAt ? publicTimestamp(record.revokedAt) || 'revoked' : null,
    tokenHint: text(record.tokenHint, /^[a-f0-9]{4}$/), credentialRevision: integer(record.credentialRevision) ?? 0, jobAccess: jobAccess === true };
}
