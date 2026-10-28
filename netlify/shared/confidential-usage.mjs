import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const USAGE_PERIOD_MS = 30 * 86400000;
export const MAX_USAGE_LEASE_MS = (4 * 60 + 5) * 60000;
export const STARTER_OUTBOUND_BYTES = 10_000_000_000;
const id = /^[a-f0-9-]{36}$/i;
const ref = /^[a-z0-9]{20}$/;
const number = n => Number.isSafeInteger(n) && n >= 0;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
export const usageKey = user => createHash('sha256').update(`${user.cloudVersion}:${user.id}`).digest('hex');
// Deliberately no filesystem or in-memory fallback: missing durable state must block a run.
export const usageDatabase = () => getStore({name:'portabase-confidential-usage',consistency:'strong'});
const charge = (job, bytes) => job.kind === 'beacon' ? 0
  : bytes.databaseBytes + bytes.otherBytes + (job.baselineExempt ? 0 : bytes.binaryBytes);
const total = bytes => bytes.databaseBytes + bytes.binaryBytes + bytes.otherBytes;

export function validateUsageCommand(body) {
  const allowed = ['operation','requestId','projectRef','kind','binaryMode','databaseBytes','binaryBytes','otherBytes',
    'status','durationMs','completeness','verified','manifestVerified','binarySnapshotId','binaryBaselineId'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))
    || !['reserve','finish','abort'].includes(body.operation) || !id.test(body.requestId || '') || !ref.test(body.projectRef || '')
    || !['backup','restore','beacon'].includes(body.kind) || !['baseline','incremental','none'].includes(body.binaryMode)
    || !['databaseBytes','binaryBytes','otherBytes'].every(k => number(body[k]))
    || !number(total(body))) fail('invalid_usage');
  if (body.binaryMode === 'baseline' && body.kind !== 'backup') fail('invalid_baseline');
  if (body.kind === 'beacon' && (body.databaseBytes || body.binaryBytes || body.binaryMode !== 'none')) fail('invalid_beacon_usage');
  if (body.operation === 'finish' && (!['succeeded','failed'].includes(body.status) || !number(body.durationMs)
    || body.durationMs > 24 * 60 * 60 * 1000 || !['complete','selected','unverified'].includes(body.completeness)
    || typeof body.verified !== 'boolean' || typeof body.manifestVerified !== 'boolean')) fail('invalid_usage_result');
  for (const key of ['binarySnapshotId','binaryBaselineId']) if (body[key] != null
    && !/^[a-zA-Z0-9_-]{16,128}$/.test(body[key])) fail('invalid_snapshot_id');
  return body;
}

function record(value, now) {
  if (value == null) return { version: 1, anchor: now, projectRef: null, baselines: {}, jobs: {} };
  if (value.version !== 1 || !Number.isSafeInteger(value.anchor) || value.anchor > now
    || !value.jobs || typeof value.jobs !== 'object' || !value.baselines || typeof value.baselines !== 'object')
    fail('usage_record_invalid', 503);
  const saved=structuredClone(value);
  // The production VM is forcibly deleted within four hours of launch. Allow
  // five minutes beyond the later job-start time before closing an orphan.
  for(const job of Object.values(saved.jobs))if(job.status==='running'&&now-job.startedAt>=MAX_USAGE_LEASE_MS){
    Object.assign(job,{status:'failed',actual:{...job.reserved},finishedAt:job.startedAt+MAX_USAGE_LEASE_MS,
      durationMs:MAX_USAGE_LEASE_MS,completeness:'unverified',verified:false,manifestVerified:false,expired:true});
  }
  return saved;
}

export function usageSummary(value, { now = Date.now(), allowanceBytes = null } = {}) {
  if (!value) return { available: true, recorded: false, periodDays: 30, periodStart: null, periodEnd: null,
    allowanceBytes, outboundBytes: 0, chargedBytes: 0, reservedBytes: 0, baselineBytes: 0, beaconBytes: 0,
    jobRuntimeMs: 0, runnerRuntimeMs: null, succeeded: 0, failed: 0, running: 0, beaconSucceeded: 0,
    beaconFailed: 0, lastBackup: null, history: [], initialBinarySnapshotAvailable: true, sourceProjectRef: null };
  const r = record(value, now), start = r.anchor + Math.floor((now-r.anchor)/USAGE_PERIOD_MS)*USAGE_PERIOD_MS;
  const jobs = Object.values(r.jobs).filter(j => j.startedAt >= start && j.startedAt < start+USAGE_PERIOD_MS);
  const result = { available: true, recorded: true, periodDays: 30, periodStart: new Date(start).toISOString(),
    periodEnd: new Date(start+USAGE_PERIOD_MS).toISOString(), allowanceBytes, outboundBytes: 0, chargedBytes: 0,
    reservedBytes: 0, baselineBytes: 0, beaconBytes: 0, jobRuntimeMs: 0, runnerRuntimeMs: null,
    succeeded: 0, failed: 0, running: 0, beaconSucceeded: 0, beaconFailed: 0,
    initialBinarySnapshotAvailable: Object.values(r.baselines).every(b => r.jobs[b.requestId]?.status === 'failed'), sourceProjectRef: r.projectRef };
  const publicJob = j => ({ id: j.requestId, kind: j.kind, status: j.status,
    startedAt: new Date(j.startedAt).toISOString(), finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null,
    durationMs: j.expired || j.aborted ? null : j.durationMs ?? null, outboundBytes: j.actual && !j.expired && !j.aborted ? total(j.actual) : null,
    accountingEstimated: j.expired === true || j.aborted === true,
    completeness: j.completeness || 'unverified', verified: j.status === 'succeeded' && j.verified === true,
    manifestVerified: j.status === 'succeeded' && j.manifestVerified === true,
    projectRef: j.projectRef });
  let accountingEstimated=false,estimatedOutboundBytes=0;
  for (const j of jobs) {
    if (j.status === 'running') { result.running++; result.reservedBytes += charge(j,j.reserved); continue; }
    if(j.expired||j.aborted){accountingEstimated=true;estimatedOutboundBytes+=total(j.actual);}
    else {result.outboundBytes += total(j.actual);result.jobRuntimeMs += j.durationMs;}
    result.chargedBytes += charge(j,j.actual);
    if (j.baselineExempt) result.baselineBytes += j.actual.binaryBytes;
    if (j.kind === 'beacon') { result.beaconBytes += total(j.actual); result[j.status === 'succeeded' ? 'beaconSucceeded' : 'beaconFailed']++; }
    else result[j.status === 'succeeded' ? 'succeeded' : 'failed']++;
  }
  result.accountingEstimated=accountingEstimated;result.estimatedOutboundBytes=estimatedOutboundBytes;
  if(accountingEstimated){result.outboundBytes=null;result.jobRuntimeMs=null;}
  result.lastBackup = Object.values(r.jobs).filter(j=>j.kind==='backup').sort((a,b)=>b.startedAt-a.startedAt).map(publicJob)[0] || null;
  result.history = jobs.sort((a,b)=>b.startedAt-a.startedAt).slice(0,100).map(publicJob);
  return result;
}

/** Called only after signed workload evidence has bound the full command to this account. */
export async function applyUsage(db, key, command, { now = Date.now(), plan } = {}) {
  const body = validateUsageCommand(command), limit = plan?.transferAllowanceBytes ?? null;
  for (let attempt=0; attempt<12; attempt++) {
    const old = await db.getWithMetadata(key,{type:'json'}), r = record(old?.data,now);
    let job = r.jobs[body.requestId];
    if (job && ['projectRef','kind','binaryMode'].some(k => job[k] !== body[k])) fail('usage_request_conflict',409);
    if (body.operation === 'reserve') {
      if (job && job.status !== 'running') fail('usage_job_finished',409);
      if (!job) {
        if (Object.keys(r.jobs).length >= 10000) fail('usage_archive_required',503);
        if (plan?.projects === 1 && body.kind !== 'beacon') {
          if (r.projectRef && r.projectRef !== body.projectRef) fail('plan_project_limit',403);
          r.projectRef = body.projectRef;
        }
        const baseline = r.baselines[body.projectRef];
        // Only a trusted, terminal failure can continue the first baseline on a new run.
        // A running or successful baseline claim is never reset by clients or period rollover.
        const resumableBaseline = baseline && r.jobs[baseline.requestId]?.status === 'failed';
        if (plan?.binaryTransferMode === 'incremental' && body.kind === 'backup'
          && baseline && !resumableBaseline && body.binaryMode === 'baseline')
          fail('incremental_binary_required',403);
        if (body.binaryMode === 'baseline' && baseline && !resumableBaseline) fail('binary_baseline_already_claimed',409);
        const baselineExempt = body.binaryMode === 'baseline' && plan?.initialBinarySnapshotIncluded === true;
        job = r.jobs[body.requestId] = { requestId: body.requestId, projectRef: body.projectRef, kind: body.kind,
          binaryMode: body.binaryMode, baselineExempt, startedAt: now, status: 'running',
          reserved: { databaseBytes: 0, binaryBytes: 0, otherBytes: 0 } };
        if (body.binaryMode === 'baseline') r.baselines[body.projectRef] = { requestId: body.requestId, claimedAt: now };
      }
      // Reservations only grow. Replayed or out-of-order requests cannot release headroom.
      job.reserved = Object.fromEntries(['databaseBytes','binaryBytes','otherBytes'].map(k => [k,Math.max(job.reserved[k],body[k])]));
      const period = Math.floor((job.startedAt-r.anchor)/USAGE_PERIOD_MS);
      const consumed = Object.values(r.jobs).filter(j=>Math.floor((j.startedAt-r.anchor)/USAGE_PERIOD_MS)===period)
        .reduce((sum,j)=>sum+charge(j,j.actual || j.reserved),0);
      if (limit !== null && consumed > limit) fail('transfer_allowance_exceeded',429);
    } else if(body.operation==='abort') {
      if(!job)fail('usage_reservation_required',409);
      if(job.status!=='running')return usageSummary(r,{now,allowanceBytes:limit});
      // Conservatively charge every accepted reservation. A crash cannot prove
      // how much of a pending upload reached its destination.
      Object.assign(job,{status:'failed',actual:{...job.reserved},finishedAt:now,durationMs:Math.min(now-job.startedAt,MAX_USAGE_LEASE_MS),completeness:'unverified',verified:false,manifestVerified:false,aborted:true});
    } else {
      if (!job) fail('usage_reservation_required',409);
      const receipt = { actual: Object.fromEntries(['databaseBytes','binaryBytes','otherBytes'].map(k=>[k,body[k]])),
        status: body.status, durationMs: body.durationMs, completeness: body.completeness,
        verified: body.verified, manifestVerified: body.manifestVerified,
        binarySnapshotId: body.binarySnapshotId || null, binaryBaselineId: body.binaryBaselineId || null };
      if (job.status !== 'running') {
        if (JSON.stringify(job.receipt) !== JSON.stringify(receipt)) fail('usage_receipt_conflict',409);
        return usageSummary(r,{now,allowanceBytes:limit});
      }
      if (Object.keys(receipt.actual).some(k=>receipt.actual[k]>job.reserved[k])) fail('usage_exceeds_reservation',409);
      Object.assign(job,receipt,{receipt,finishedAt:now});
      // Preserve the claim and all attempted bytes. A verified failed receipt permits a new baseline attempt; success locks it permanently.
    }
    const written = await db.setJSON(key,r,old ? {onlyIfMatch:old.etag} : {onlyIfNew:true});
    if (written.modified) return usageSummary(r,{now,allowanceBytes:limit});
  }
  fail('usage_busy',409);
}
