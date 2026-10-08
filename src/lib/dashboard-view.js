/**
 * Customer dashboard view-model.
 * Control plane = metadata + hashes only.
 * Never keys, passphrase, capsule bytes, row bodies, or function source.
 */

import { deriveProofStatus, PROOF_RED } from './proof-status.js';
import { getCloudPlan, planAllowanceCopy, transferWindow, storageUsage } from './product.js';
import { FORBIDDEN_INVENTORY_KEY } from './zero-knowledge.js';
import { formatOperatorTimeShort, jobDurationMs } from './operator-time.js';
import { squareBillingView } from './square-public.js';
import { normalizeSizeInventory, sampleSizeInventory } from './table-sizer.js';

export const DASHBOARD_SOURCES = Object.freeze({
  empty: 'empty',
  live: 'live',
  demo: 'demo',
});

export const EXISTING_ENGINE_FLAGS = Object.freeze([
  { id: 'excludeBinaries', cli: '--exclude-binaries', label: 'Exclude binaries' },
  { id: 'excludeTableList', cli: '--exclude-table-list', label: 'Exclude table list' },
  { id: 'forceOrphanFks', cli: '--force-orphan-fks', label: 'Force orphan FKs', surfaceOnly: true },
]);

const FORBIDDEN_KEY = /^(passphrase|password|service[_-]?role|sb[_-]?secret|private[_-]?key|capsule[_-]?bytes|ciphertext|row[_-]?body|function[_-]?source|source[_-]?code|dump|object[_-]?name|table[_-]?rows)$/i;

const ALLOWED_JOB_FIELDS = Object.freeze([
  'id',
  'jobId',
  'type',
  'kind',
  'status',
  'phase',
  'startedAt',
  'finishedAt',
  'occurredAt',
  'createdAt',
  'updatedAt',
  'objectCount',
  'sizeBytes',
  'durationMs',
  'dbBytes',
  'storageBytes',
  'functionsBytes',
  'authBytes',
  'dailyMeterBytes',
  'capsuleId',
  'capsuleStatus',
  'capsuleHash',
  'manifestHash',
  'layerHashes',
  'destinationKind',
  'destinationHint',
  'destinationVerified',
  'errorCode',
  'runnerId',
  'region',
  'projectRef',
  'agentId',
  'verified',
  'compareVerdict',
  'flags',
  'doctor',
  'verify',
]);

const JOB_TYPES = new Set(['backup', 'capture', 'restore', 'replay', 'verify', 'doctor', 'heartbeat']);
const SAFE_ERROR = /^[a-z0-9._-]{1,64}$/i;
const DEST_KINDS = new Set(['s3', 'dropbox', 'gdrive', 'local', 'nas', 'azure-blob', 'gcs', 'rclone']);

function cleanText(value, fallback = '') {
  if (value == null || value === '') return fallback;
  const text = String(value).slice(0, 160);
  if (!text || text === 'null' || text === 'undefined') return fallback;
  return FORBIDDEN_INVENTORY_KEY.test(text) ? fallback || 'redacted' : text;
}

function isoOrNull(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function hexHash(value) {
  const hash = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function stripForbidden(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_KEY.test(key) || FORBIDDEN_INVENTORY_KEY.test(key)) continue;
    if (typeof value === 'string' && FORBIDDEN_INVENTORY_KEY.test(value)) continue;
    out[key] = value;
  }
  return out;
}

export function destinationHint(kind) {
  const k = DEST_KINDS.has(String(kind || '').toLowerCase()) ? String(kind).toLowerCase() : 'unknown';
  const hints = {
    s3: 'Open the customer-owned S3 bucket/prefix on the account that received the capsule. Portabase never holds capsule bytes.',
    dropbox: 'Open the customer-owned Dropbox folder that received the capsule. Portabase never holds capsule bytes.',
    gdrive: 'Open the customer-owned Google Drive folder that received the capsule. Portabase never holds capsule bytes.',
    local: 'Open the folder on the machine that ran the job (USB / NAS / local path). Portabase never holds capsule bytes.',
    nas: 'Open the customer-owned NAS / SMB share used as the vault. Portabase never holds capsule bytes.',
    'azure-blob': 'Open the customer-owned Azure Blob container. Portabase never holds capsule bytes.',
    gcs: 'Open the customer-owned GCS bucket. Portabase never holds capsule bytes.',
    rclone: 'Open the rclone remote configured on the runner. Portabase never holds capsule bytes.',
    unknown: 'Capsule destination is customer-owned. Portabase stores destination kind only — never capsule bytes.',
  };
  return { kind: k, hint: hints[k] || hints.unknown };
}

export function usedEngineFlags(flags = {}) {
  const raw = stripForbidden(flags);
  return EXISTING_ENGINE_FLAGS
    .map((meta) => {
      const value = raw[meta.id] ?? raw[meta.cli] ?? raw[meta.id.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)];
      const used = value === true || (typeof value === 'string' && value.trim().length > 0);
      return used
        ? {
          id: meta.id,
          cli: meta.cli,
          label: meta.label,
          value: value === true ? true : String(value).slice(0, 200),
          surfaceOnly: Boolean(meta.surfaceOnly),
        }
        : null;
    })
    .filter(Boolean);
}

export function sanitizeJobTelemetry(job = {}) {
  const payload = stripForbidden(job.payload || {});
  const src = { ...payload, ...stripForbidden(job) };
  const type = JOB_TYPES.has(String(src.type || src.kind || '').toLowerCase())
    ? String(src.type || src.kind).toLowerCase()
    : 'backup';
  const dest = destinationHint(src.destinationKind);
  const flags = usedEngineFlags(src.flags || payload.flags || {});
  const errorCode = SAFE_ERROR.test(String(src.errorCode || '')) ? String(src.errorCode) : null;
  const out = {
    id: cleanText(src.id || src.jobId, null) || `job_${Math.random().toString(36).slice(2, 10)}`,
    jobId: cleanText(src.jobId || src.id, null),
    type,
    status: cleanText(src.status, 'unknown').slice(0, 32),
    phase: cleanText(src.phase, null),
    startedAt: isoOrNull(src.startedAt || src.createdAt || src.occurredAt),
    finishedAt: isoOrNull(src.finishedAt || src.updatedAt),
    objectCount: positiveInt(src.objectCount),
    sizeBytes: positiveInt(src.sizeBytes),
    durationMs: positiveInt(src.durationMs) || jobDurationMs(src.startedAt || src.createdAt, src.finishedAt || src.updatedAt),
    dbBytes: positiveInt(src.dbBytes ?? src.layerBytes?.database ?? src.layerHashes?.database?.sizeBytes),
    storageBytes: positiveInt(src.storageBytes ?? src.layerBytes?.storage ?? src.layerHashes?.storage?.sizeBytes),
    functionsBytes: positiveInt(src.functionsBytes ?? src.layerBytes?.functions ?? src.layerHashes?.functions?.sizeBytes),
    authBytes: positiveInt(src.authBytes ?? src.layerBytes?.auth ?? src.layerHashes?.auth?.sizeBytes),
    dailyMeterBytes: positiveInt(src.dailyMeterBytes || src.meterBytes),
    capsuleId: /^[A-Za-z0-9._-]{1,200}$/.test(String(src.capsuleId || '')) ? String(src.capsuleId) : null,
    capsuleStatus: ['COMPLETE', 'SELECTIVE', 'TRIAL'].includes(src.capsuleStatus) ? src.capsuleStatus : null,
    capsuleHash: hexHash(src.capsuleHash || src.capsule_hash),
    manifestHash: hexHash(src.manifestHash),
    layerHashes: sanitizeLayerHashes(src.layerHashes),
    destinationKind: dest.kind,
    destinationHint: dest.hint,
    destinationVerified: src.destinationVerified === true,
    errorCode,
    runnerId: cleanText(src.runnerId, null),
    region: cleanText(src.region, null),
    projectRef: cleanText(src.projectRef || src.project_ref, null),
    verified: src.verified === true,
    compareVerdict: cleanText(src.compareVerdict || src.verdict, null),
    flags,
  };
  for (const key of Object.keys(out)) {
    if (!ALLOWED_JOB_FIELDS.includes(key) && key !== 'id') delete out[key];
  }
  return out;
}

function sanitizeLayerHashes(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const layer of ['database', 'auth', 'storage', 'functions']) {
    const row = value[layer];
    if (!row) continue;
    if (typeof row === 'string') {
      const hash = hexHash(row);
      if (hash) out[layer] = { hash };
      continue;
    }
    const hash = hexHash(row.hash || row.digest);
    const sizeBytes = positiveInt(row.sizeBytes || row.bytes);
    const objectCount = positiveInt(row.objectCount || row.count);
    if (hash || sizeBytes || objectCount) {
      out[layer] = { ...(hash ? { hash } : {}), ...(sizeBytes ? { sizeBytes } : {}), ...(objectCount ? { objectCount } : {}) };
    }
  }
  return Object.keys(out).length ? out : null;
}

export function buildCapsuleSizeBreakdown(job = {}) {
  const row = job.id ? job : sanitizeJobTelemetry(job);
  const db = positiveInt(row.dbBytes);
  const storage = positiveInt(row.storageBytes);
  const functions = positiveInt(row.functionsBytes);
  const auth = positiveInt(row.authBytes);
  const known = db + storage + functions + auth;
  const total = positiveInt(row.sizeBytes) || known;
  const other = Math.max(0, total - known);
  return {
    jobId: row.jobId || row.id,
    capsuleId: row.capsuleId || null,
    totalBytes: total,
    layers: [
      { id: 'database', label: 'Database', bytes: db },
      { id: 'storage', label: 'Storage', bytes: storage },
      { id: 'functions', label: 'Functions', bytes: functions },
      { id: 'auth', label: 'Auth', bytes: auth },
      { id: 'other', label: 'Other / unscoped', bytes: other },
    ].filter((layer) => layer.bytes > 0 || layer.id === 'database' || layer.id === 'storage' || layer.id === 'functions'),
    hasBreakdown: known > 0,
    objectCount: positiveInt(row.objectCount),
    destinationKind: row.destinationKind,
    destinationVerified: row.destinationVerified === true,
  };
}

function jobLamp(job, workspaceProof) {
  if (workspaceProof?.proven && workspaceProof.capsuleHash && job.capsuleHash === workspaceProof.capsuleHash) {
    return { tone: 'green', label: 'MATCH', qualified: true };
  }
  if (String(job.compareVerdict || '').toUpperCase() === 'MATCH' && job.capsuleHash && job.verified) {
    return deriveProofStatus({
      report: {
        kind: 'compare',
        source: 'runner',
        verdict: 'MATCH',
        capsuleHash: job.capsuleHash,
        comparedAt: job.finishedAt,
      },
    });
  }
  return { tone: PROOF_RED, label: 'Not proven', qualified: false, reason: 'no_match' };
}

export function buildBackupLog(jobs = [], { proof = null, demoMode = false } = {}) {
  const workspaceProof = deriveProofStatus({ report: proof, demoMode });
  return [...jobs]
    .map((job) => sanitizeJobTelemetry(job))
    .sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0))
    .map((job) => {
      const lamp = demoMode ? { tone: PROOF_RED, label: 'Not proven', qualified: false, reason: 'demo_is_not_proof' } : jobLamp(job, workspaceProof);
      return {
        id: job.id,
        type: job.type,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        durationMs: job.durationMs || jobDurationMs(job.startedAt, job.finishedAt),
        sizeBytes: job.sizeBytes,
        objectCount: job.objectCount,
        destinationKind: job.destinationKind,
        region: job.region,
        errorCode: job.errorCode,
        lamp: {
          tone: lamp.tone || PROOF_RED,
          label: lamp.proven ? 'MATCH' : (lamp.label || 'Not proven'),
          qualified: Boolean(lamp.proven || lamp.qualified),
        },
        detailHref: `#job-${job.id}`,
      };
    });
}

function dayKey(iso, now) {
  const t = new Date(iso).getTime();
  const daysAgo = Math.floor((now - t) / 86400e3);
  return Number.isFinite(daysAgo) ? daysAgo : 999;
}

export function buildDashboardCharts(jobs = [], { planId = 'cloud-17', extraTransfersAddon = false, now = Date.now(), days = 7 } = {}) {
  const rows = Array.from({ length: days }, (_, i) => {
    const age = days - 1 - i;
    const dayJobs = jobs.filter((job) => dayKey(job.startedAt || job.finishedAt, now) === age);
    const bytes = dayJobs.reduce((sum, job) => sum + positiveInt(job.sizeBytes || job.dailyMeterBytes), 0);
    const objects = dayJobs.reduce((sum, job) => sum + positiveInt(job.objectCount), 0);
    const ok = dayJobs.filter((job) => /complete|ok|success|verified|passed/i.test(job.status)).length;
    const fail = dayJobs.filter((job) => /fail|error|canceled/i.test(job.status)).length;
    const dayStart = new Date(now - age * 86400e3);
    return {
      label: formatOperatorTimeShort(dayStart),
      success: ok,
      fail,
      sizeBytes: bytes,
      objectCount: objects,
      transfers: dayJobs.filter((job) => job.type === 'backup' || job.type === 'capture').length,
    };
  });
  const plan = getCloudPlan(planId);
  const usedBytes = jobs.reduce((sum, job) => sum + positiveInt(job.sizeBytes), 0);
  const usage = storageUsage(usedBytes, plan.id);
  const window = transferWindow({
    usedLast24h: rows[rows.length - 1]?.transfers || 0,
    extraTransfersAddon,
    planId: plan.id,
    now,
  });
  return {
    days,
    series: rows,
    usage,
    transferWindow: window,
    empty: jobs.length === 0,
  };
}

export function buildUtilitiesView({
  jobs = [],
  doctor = null,
  verify = null,
  schedules = [],
  sms = {},
  planId = 'cloud-17',
} = {}) {
  const latestDoctor = doctor || jobs.find((job) => job.type === 'doctor')?.doctor || null;
  const latestVerify = verify || jobs.find((job) => job.type === 'verify' || job.verified)?.verify || null;
  const flagsUsed = jobs.flatMap((job) => job.flags || []);
  const uniqueFlags = [];
  for (const flag of flagsUsed) {
    if (!uniqueFlags.some((row) => row.id === flag.id && String(row.value) === String(flag.value))) {
      uniqueFlags.push(flag);
    }
  }
  const dests = [...new Map(jobs.map((job) => [job.destinationKind, destinationHint(job.destinationKind)])).values()];
  return {
    doctor: latestDoctor
      ? {
        status: cleanText(latestDoctor.status || (latestDoctor.ok === true ? 'ok' : 'unknown'), 'unknown'),
        checkedAt: isoOrNull(latestDoctor.checkedAt || latestDoctor.occurredAt),
        checks: Array.isArray(latestDoctor.checks)
          ? latestDoctor.checks.slice(0, 20).map((check) => ({
            id: cleanText(check.id, 'check'),
            ok: check.ok === true,
            detail: cleanText(check.detail, check.ok ? 'pass' : 'fail'),
          }))
          : [],
        mocked: latestDoctor.mocked === true || latestDoctor.demo === true,
      }
      : null,
    verify: latestVerify
      ? {
        status: cleanText(latestVerify.status, 'unknown'),
        capsuleHash: hexHash(latestVerify.capsuleHash),
        checkedAt: isoOrNull(latestVerify.checkedAt || latestVerify.occurredAt),
        mocked: latestVerify.mocked === true || latestVerify.demo === true,
      }
      : null,
    flags: uniqueFlags,
    destinations: dests,
    schedules: (schedules || []).map((sch) => ({
      id: cleanText(sch.id, null),
      everyHours: positiveInt(sch.everyHours) || 24,
      timezone: cleanText(sch.timezone, 'UTC'),
      enabled: sch.enabled !== false,
      lastRunAt: isoOrNull(sch.lastRunAt),
      nextRunAt: isoOrNull(sch.nextRunAt),
    })),
    sms: {
      optIn: sms.optIn === true || sms.onFailure === true || sms.onSuccess === true,
      onFailure: sms.onFailure !== false,
      onSuccess: sms.onSuccess === true,
      planAllows: getCloudPlan(planId).smsOptional === true,
      note: 'Optional on $17. Status only — never keys, passphrase, capsule bytes, or customer row data.',
    },
  };
}

export function buildBillingStrip({
  billing = {},
  square = null,
  demoMode = false,
  planId,
} = {}) {
  const plan = getCloudPlan(planId || billing.planId || billing.plan);
  const squareView = squareBillingView({ live: square, demoMode });
  const next = plan.id === 'cloud-7' || plan.id === 'cloud-free' ? getCloudPlan('cloud-17') : null;
  return {
    planId: plan.id,
    planName: plan.title,
    shortLabel: plan.shortLabel,
    allowanceLabel: planAllowanceCopy(plan.id),
    allowanceBytes: plan.storageCapBytes,
    priceMonthlyUsd: plan.priceMonthlyUsd,
    extraTransfersAddon: Boolean(billing.extraTransfersAddon),
    status: billing.status || 'none',
    square: squareView,
    checkoutDisabled: squareView.failClosed,
    upgradeAvailable: Boolean(next),
    nextPlan: next,
  };
}

export function buildTelemetryStrip(jobs = [], proof = null) {
  const list = [...jobs].sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0));
  const latest = list[0] || null;
  const done = list.filter((job) => /complete|ok|success|verified|passed/i.test(job.status)).length;
  const fail = list.filter((job) => /fail|error|canceled/i.test(job.status)).length;
  const lastSize = list.find((job) => job.sizeBytes > 0)?.sizeBytes || 0;
  return {
    latest,
    jobCount: list.length,
    successCount: done,
    failCount: fail,
    lastSizeBytes: lastSize,
    lastErrorCode: latest?.errorCode || null,
    proofTone: proof?.tone || PROOF_RED,
    proofLabel: proof?.proven ? 'MATCH' : 'RED',
  };
}

export function emptyDashboardModel({ planId = 'cloud-17', extraTransfersAddon = false, now = Date.now(), square = null, demoMode = false } = {}) {
  const plan = getCloudPlan(planId);
  const charts = buildDashboardCharts([], { planId: plan.id, extraTransfersAddon, now });
  const proof = deriveProofStatus({ report: null, demoMode: false });
  return {
    source: DASHBOARD_SOURCES.empty,
    labeled: 'No jobs yet — empty customer workspace. This is not live telemetry.',
    live: false,
    demo: false,
    jobs: [],
    telemetry: [],
    strip: buildTelemetryStrip([], proof),
    charts,
    sizes: [],
    log: [],
    inventory: normalizeSizeInventory({}),
    utilities: buildUtilitiesView({ planId: plan.id, sms: { optIn: false, onFailure: true, onSuccess: false } }),
    proof,
    billingStrip: buildBillingStrip({ billing: { planId: plan.id, extraTransfersAddon }, square, demoMode }),
    empty: true,
  };
}

export function sampleDashboardJobs(now = Date.now()) {
  const hoursAgo = (h) => new Date(now - h * 3600e3).toISOString();
  return [
    {
      id: 'demo_job_ok',
      type: 'backup',
      status: 'COMPLETE',
      phase: 'sealed',
      startedAt: hoursAgo(3),
      finishedAt: hoursAgo(2.6),
      objectCount: 184,
      sizeBytes: 482_331_904,
      dbBytes: 210_000_000,
      storageBytes: 250_000_000,
      functionsBytes: 12_331_904,
      destinationKind: 's3',
      region: 'us-east-1',
      runnerId: 'run_demo',
      projectRef: 'demoxxxxxxxxxxxxxxxx',
      capsuleHash: 'b'.repeat(64),
      flags: { excludeBinaries: true },
      mocked: true,
      demo: true,
    },
    {
      id: 'demo_job_fail',
      type: 'backup',
      status: 'FAILED',
      phase: 'storage',
      startedAt: hoursAgo(29),
      finishedAt: hoursAgo(28.9),
      objectCount: 0,
      sizeBytes: 0,
      destinationKind: 'dropbox',
      region: 'us-east-1',
      errorCode: 'destination_unreachable',
      projectRef: 'demoxxxxxxxxxxxxxxxx',
      flags: { excludeTableList: 'public.noise' },
      mocked: true,
      demo: true,
    },
    {
      id: 'demo_job_restore',
      type: 'restore',
      status: 'COMPLETE',
      phase: 'replay',
      startedAt: hoursAgo(80),
      finishedAt: hoursAgo(79.7),
      objectCount: 184,
      sizeBytes: 476_890_112,
      dbBytes: 208_000_000,
      storageBytes: 248_000_000,
      functionsBytes: 20_890_112,
      destinationKind: 's3',
      region: 'us-west-1',
      projectRef: 'demoxxxxxxxxxxxxxxxx',
      mocked: true,
      demo: true,
    },
  ];
}

export function jobsFromConsoleState(state = {}) {
  const capsules = Array.isArray(state.capsules) ? state.capsules : [];
  const restores = Array.isArray(state.restores) ? state.restores : [];
  const fromCapsules = capsules.map((capsule) => sanitizeJobTelemetry({
    id: capsule.id,
    type: 'backup',
    status: capsule.status,
    phase: capsule.status === 'FAILED' ? 'failed' : 'sealed',
    startedAt: capsule.createdAt,
    finishedAt: capsule.durationMs && capsule.createdAt
      ? new Date(Date.parse(capsule.createdAt) + Number(capsule.durationMs)).toISOString()
      : capsule.createdAt,
    durationMs: capsule.durationMs,
    sizeBytes: capsule.sizeBytes,
    objectCount: capsule.objectCount,
    destinationKind: capsule.destinationKind,
    projectRef: capsule.projectRef,
    errorCode: capsule.errorClass,
    verified: capsule.verified,
    flags: capsule.flags,
    dbBytes: capsule.layers?.database ? Math.round((capsule.sizeBytes || 0) * 0.45) : 0,
    storageBytes: capsule.layers?.storage ? Math.round((capsule.sizeBytes || 0) * 0.48) : 0,
    functionsBytes: capsule.layers?.functions ? Math.round((capsule.sizeBytes || 0) * 0.07) : 0,
  }));
  const fromRestores = restores.map((row) => sanitizeJobTelemetry({
    id: row.id,
    type: row.kind === 'replay' ? 'replay' : 'restore',
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    sizeBytes: 0,
    projectRef: row.sourceRef,
  }));
  return [...fromCapsules, ...fromRestores];
}

export function buildDashboardModel({
  jobs = null,
  billing = {},
  proof = null,
  demoMode = false,
  live = false,
  schedules = [],
  sms = {},
  doctor = null,
  verify = null,
  now = Date.now(),
  square = null,
} = {}) {
  const planId = billing.planId || billing.plan || 'cloud-17';
  const extraTransfersAddon = Boolean(billing.extraTransfersAddon);
  if (demoMode) {
    const sample = (jobs && jobs.length ? jobs : sampleDashboardJobs(now)).map(sanitizeJobTelemetry);
    const proofStatus = deriveProofStatus({ report: proof, demoMode: true });
    return {
      source: DASHBOARD_SOURCES.demo,
      labeled: 'SAMPLE UI — not live customer data. Demo gauges cannot turn the proof lamp green.',
      live: false,
      demo: true,
      jobs: sample,
      telemetry: sample,
      strip: buildTelemetryStrip(sample, proofStatus),
      charts: buildDashboardCharts(sample, { planId, extraTransfersAddon, now }),
      sizes: sample.filter((job) => job.type === 'backup' || job.sizeBytes).map(buildCapsuleSizeBreakdown),
      log: buildBackupLog(sample, { proof: null, demoMode: true }),
      inventory: sampleSizeInventory(),
      utilities: buildUtilitiesView({
        jobs: sample,
        doctor: doctor || {
          status: 'ok',
          checkedAt: new Date(now - 3600e3).toISOString(),
          checks: [
            { id: 'pg_dump', ok: true, detail: 'pg_dump present' },
            { id: 'destination', ok: true, detail: 'destination kind reachable (sample)' },
          ],
          mocked: true,
        },
        verify: verify || { status: 'not_proven', mocked: true },
        schedules,
        sms: { ...sms, optIn: sms.optIn === true },
        planId,
      }),
      proof: proofStatus,
      billingStrip: buildBillingStrip({ billing, square, demoMode: true, planId }),
      empty: false,
    };
  }

  const list = Array.isArray(jobs) ? jobs.map(sanitizeJobTelemetry) : [];
  if (!list.length) {
    const empty = emptyDashboardModel({ planId, extraTransfersAddon, now, square, demoMode: false });
    return {
      ...empty,
      utilities: buildUtilitiesView({ schedules, sms, planId, doctor, verify }),
      proof: deriveProofStatus({ report: proof, demoMode: false }),
      billingStrip: buildBillingStrip({ billing, square, demoMode: false, planId }),
    };
  }

  const proofStatus = deriveProofStatus({ report: proof, demoMode: false });
  return {
    source: live ? DASHBOARD_SOURCES.live : DASHBOARD_SOURCES.empty,
    labeled: live ? 'Live control-plane telemetry (metadata + hashes only).' : 'Workspace jobs (metadata only).',
    live: Boolean(live),
    demo: false,
    jobs: list,
    telemetry: list,
    strip: buildTelemetryStrip(list, proofStatus),
    charts: buildDashboardCharts(list, { planId, extraTransfersAddon, now }),
    sizes: list.filter((job) => job.sizeBytes || job.dbBytes || job.storageBytes || job.functionsBytes).map(buildCapsuleSizeBreakdown),
    log: buildBackupLog(list, { proof, demoMode: false }),
    inventory: normalizeSizeInventory(doctor || {}),
    utilities: buildUtilitiesView({ jobs: list, doctor, verify, schedules, sms, planId }),
    proof: proofStatus,
    billingStrip: buildBillingStrip({ billing, square, demoMode: false, planId }),
    empty: false,
  };
}
