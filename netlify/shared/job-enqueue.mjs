import { createHash, randomUUID } from 'node:crypto';
import { countTransfersLast24h, transferWindow } from './product.mjs';
import { manualBackupBlocked } from '../../cloud/runner/job-intent.mjs';

/** Pure shared reservation policy. The caller must commit these rows with its
 * schedule occurrence/high-water in the SAME account queue CAS. */
export function enqueuePrivateJob(queue, { user, runner, parsed, access, now, occurrence = null }) {
  if (occurrence && (!access.paid || access.plan.scheduled !== true)) return { status: 402, error: 'subscription_required' };
  if (parsed.type === 'backup') {
    const used = countTransfersLast24h(queue.jobs.filter(row => row.type === 'backup'), { now });
    const window = transferWindow({ usedLast24h: used, planId: access.plan.id, extraTransfersAddon: access.extraTransfersAddon, now });
    if (manualBackupBlocked({ plan: access.plan, usedLast24h: used, atLimit: window.atLimit })) {
      return { status: 429, error: 'transfer_rate_limited', transferWindow: access.paid ? window : { ...window, allowance: 1, remaining: 0, atLimit: true }, planId: access.plan.id };
    }
  }
  const pinned = new Set(queue.claimSlots.map(row => row.jobId).filter(Boolean));
  const keep = queue.jobs.filter((row, index) => pinned.has(row.id) || row.completionEventsPending === true || ['queued', 'running'].includes(row.status)
    || Date.parse(row.createdAt) >= now - 86400000 || index < 50);
  if (keep.length >= 200) return { status: 409, error: 'queue_full' };
  const id = occurrence ? createHash('sha256').update(JSON.stringify([`${user.cloudVersion}:${user.id}`, occurrence.id, occurrence.revision, occurrence.dueAt])).digest('hex') : randomUUID();
  const job = { id: `job_${id}`, type: parsed.type, status: 'queued', payload: parsed.payload, version: 2, runnerId: runner.id,
    ...(parsed.requestId ? { requestId: parsed.requestId } : {}), ...(occurrence ? { schedule: occurrence } : {}),
    createdAt: new Date(now).toISOString(), cloudVersion: user.cloudVersion,
    admission: { paid: access.paid, planId: access.plan.id, maxBytes: access.plan.storageCapBytes, manual: !occurrence } };
  return { job, jobs: [job, ...keep] };
}

export function scheduledClaimAllowed(job, queue, access) {
  if (!job.schedule) return true;
  const schedule = (queue.schedules || []).find(row => row.id === job.schedule.id);
  return access.paid && access.plan.scheduled === true && schedule?.enabled === true
    && schedule.revision === job.schedule.revision && schedule.runnerId === job.runnerId
    && schedule.configRef === job.payload?.configRef && schedule.configRevision === job.payload?.configRevision;
}
