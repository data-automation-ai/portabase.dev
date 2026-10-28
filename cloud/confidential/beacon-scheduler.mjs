import { randomUUID } from 'node:crypto';
import { beaconStorage } from './beacon-storage.mjs';
import { BEACON_INTERVAL_MS, BEACON_MAX_SECONDS } from './beacon-config.mjs';

export function beaconScheduler({ storage = beaconStorage(), compute, now = Date.now, uuid = randomUUID } = {}) {
  if (!compute) throw Error('beacon_compute_required');
  return async () => {
    const result = { examined: 0, started: 0, completed: 0, busy: 0, failed: 0 };
    const checkpoint=await storage.get('control','scheduler');
    let cursor=checkpoint?.data?.cursor;
    // One bounded page per minute with a durable cursor avoids starving later
    // customers or holding the controller request open for an entire account list.
    for (let page = 0; page < 1; page++) {
      const listing = await storage.list(cursor);
      for (const owner of listing.owners) {
        result.examined++;
        try {
          const prior = await storage.get('leases', owner), old = prior?.data;
          const instance = await compute.getBeacon(owner);
          if (old?.state === 'running') {
            if (instance && instance.leaseId !== old.id) { result.busy++; continue; }
            if (old.receipt || now() >= old.deadlineAt) {
              if (instance) { await compute.removeBeacon(owner, old.id); result.busy++; continue; }
              const finished = { ...old, state: old.receipt?.status || 'failed', finishedAt: now(),
                runnerAllocatedMs: Math.max(0, now() - (old.runnerCreatedAt || old.startedAt)),
                errorCode: old.receipt ? null : 'beacon_runner_deadline',
                retryAfter:now()+(old.attempts>=3?BEACON_INTERVAL_MS:3600000),
                history: [...(old.history || []), ...(old.receipt ? [old.receipt] : [{kind:'beacon',requestId:old.id,status:'failed',startedAt:new Date(old.startedAt).toISOString(),finishedAt:new Date(now()).toISOString(),durationMs:0,outboundBytes:null,billableBytes:0,errorCode:'beacon_runner_deadline'}])].slice(-120) };
              if ((await storage.put('leases', owner, finished, prior.generation)).modified) result.completed++;
              continue;
            }
            if (instance && !old.runnerCreatedAt) await storage.put('leases', owner, { ...old, runnerCreatedAt: Date.parse(instance.createdAt) || old.startedAt }, prior.generation);
            result.busy++; continue;
          }
          // Unknown existing instance is preserved; it is never adopted/deleted.
          if (instance) { result.busy++; continue; }
          const record = await storage.get('delegations', owner), schedule = record?.data;
          if (!schedule?.enabled || !Number.isFinite(schedule.nextDueAt) || schedule.nextDueAt > now()) continue;
          if (old?.retryAfter > now()) continue;
          const lease = { id: uuid(), state: 'running', startedAt: now(), deadlineAt: now() + (BEACON_MAX_SECONDS + 120) * 1000,
            dueAt:schedule.nextDueAt,attempts:old?.dueAt===schedule.nextDueAt?(old.attempts||0)+1:1,
            history: old?.history || [], receipt: null };
          if (!(await storage.put('leases', owner, lease, prior?.generation || '0')).modified) { result.busy++; continue; }
          try { await compute.createBeacon(owner, lease.id); result.started++; }
          catch {
            // The create result may be ambiguous. Keep the lease until its
            // deadline rather than blindly retrying and allocating twice.
            result.failed++;
          }
        } catch { result.failed++; }
      }
      cursor = listing.cursor;
      await storage.put('control','scheduler',{cursor:cursor||null},checkpoint?.generation||'0');
    }
    return result;
  };
}

export async function beaconUsage(owner, storage = beaconStorage(), now = Date.now()) {
  const current = (await storage.get('leases', owner))?.data;
  const records = [...(current?.history || []), ...(current?.state === 'running' && current.receipt ? [current.receipt] : [])]
    .filter(row => Date.parse(row.finishedAt) >= now - 30 * 86400000 && Date.parse(row.finishedAt) <= now);
  return { intervalHours: 72, windowDays: 30, jobsSucceeded: records.filter(x => x.status === 'succeeded').length,
    jobsFailed: records.filter(x => x.status === 'failed').length,
    jobRuntimeMs: records.reduce((sum, x) => sum + (Number.isFinite(x.durationMs) && x.durationMs >= 0 ? x.durationMs : 0), 0),
    outboundBytes: null, chargedBytes: 0, lastBeacon: records.at(-1) || null,
    runnerState: current?.state || 'not_started', runnerAllocationMs: current?.runnerAllocatedMs ?? null,
    guarantee: 'activity_probe_only' };
}
