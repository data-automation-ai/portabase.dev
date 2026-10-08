import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { agentStore, agentKey, ownerKey, runnerJobIdentity } from './agent-store.mjs';
import { getSubscriptionForUser } from './subscription-store.mjs';
import { runnerAdmission } from './runner-admission.mjs';
import { minScheduleHours } from './product.mjs';
import { normalizeJobQueue, storedJobQueue } from './job-queue-envelope.mjs';
import { enqueuePrivateJob } from './job-enqueue.mjs';
import { validScheduleInput, exactFields, uuid, scheduleAnchor } from './schedule-contract.mjs';

export const SCHEDULE_INDEX_STORE = 'portabase-schedule-accounts';
const fail = (code, status = 503) => { throw Object.assign(new Error(code), { code, status }); };
const accountFor = user => {
  if (user?.cloudVersion !== 'supabase' || typeof user.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user.id)) fail('unauthorized', 401);
  return `supabase:${user.id}`;
};
export function scheduleIndexIdentity(record) {
  if (!exactFields(record, ['version', 'owner', 'accountKey']) || record.version !== 1
    || typeof record.accountKey !== 'string' || !/^supabase:[A-Za-z0-9_-]{1,128}$/.test(record.accountKey)
    || createHash('sha256').update(record.accountKey).digest('hex') !== record.owner) fail('invalid_schedule_index');
  return { cloudVersion: 'supabase', id: record.accountKey.slice(9) };
}
const mutationIdentity = body => body && uuid(body.id) && Number.isSafeInteger(body.revision) && body.revision > 0;
const cancelQueued = (jobs, id, now) => jobs.map(job => job.status === 'queued' && job.schedule?.id === id
  ? { ...job, status: 'cancelled', finishedAt: new Date(now).toISOString(), safeError: null } : job);

export function createManagedSchedules({ database = () => getStore({ name: 'portabase-cloud-jobs', consistency: 'strong' }),
  indexDatabase = () => getStore({ name: SCHEDULE_INDEX_STORE, consistency: 'strong' }), agentDatabase = agentStore,
  subscription = getSubscriptionForUser, clock = Date.now, env = process.env } = {}) {
  const enabled = () => env.PORTABASE_SCHEDULE_DISPATCH_ENABLED === 'true';
  async function authority(user, now) {
    const owner = ownerKey(user), store = agentDatabase();
    const [record, agents] = await Promise.all([subscription(user), Promise.all(Array.from({ length: 12 }, (_, slot) => store.get(agentKey(owner, slot), { type: 'json' })))]);
    const runners = agents.filter((agent, slot) => {
      const identity = runnerJobIdentity(agent);
      return identity?.cloudVersion === user.cloudVersion && identity?.id === user.id && agent.owner === owner && agent.slot === slot;
    });
    return { runners, access: runnerAdmission(record, now) };
  }
  function status(row, auth) {
    if (!row.enabled) return 'disabled';
    if (!auth.runners.some(runner => runner.id === row.runnerId)) return 'runner_unavailable';
    if (!auth.access.paid || auth.access.plan.scheduled !== true) return 'subscription_required';
    if (row.everyHours < minScheduleHours({ planId: auth.access.plan.id, extraTransfersAddon: auth.access.extraTransfersAddon })) return 'cadence_not_allowed';
    return row.lastOutcome === 'disabled' ? 'waiting' : row.lastOutcome;
  }
  function publicRow(row, queue, auth) {
    const job = queue.jobs.find(job => job.id === row.lastJobId);
    return { ...row, status: auth ? status(row, auth) : 'disabled',
      lastJobStatus: job && ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(job.status) ? job.status : null };
  }
  const result = (schedule, queue, auth) => ({ schedule: publicRow(schedule, queue, auth), dispatcherEnabled: enabled(), execution: 'queue_only' });
  async function ensureIndex(user) {
    const owner = ownerKey(user), index = { version: 1, owner, accountKey: accountFor(user) }, db = indexDatabase();
    const key = `owners/${owner}`;
    const written = await db.setJSON(key, index, { onlyIfNew: true });
    if (!written.modified && JSON.stringify(await db.get(key, { type: 'json' })) !== JSON.stringify(index)) fail('invalid_schedule_index');
  }
  async function read(user) {
    const queue = normalizeJobQueue(await database().get(`jobs:${accountFor(user)}`, { type: 'json' }));
    const auth = await authority(user, clock());
    return { schedules: (queue.schedules || []).map(row => publicRow(row, queue, auth)), dispatcherEnabled: enabled(), execution: 'queue_only' };
  }
  async function save(user, body) {
    if (!validScheduleInput(body)) fail('invalid_schedule', 400);
    const key = `jobs:${accountFor(user)}`, db = database();
    // Write discoverability first. An orphan index is harmless; a saved enabled
    // definition without an index could otherwise remain undiscoverable forever.
    await ensureIndex(user);
    for (let attempt = 0; attempt < 6; attempt++) {
      const snapshot = await db.getWithMetadata(key, { type: 'json' }), queue = normalizeJobQueue(snapshot?.data);
      const schedules = queue.schedules || [], old = schedules.find(row => row.id === body.id), now = clock();
      if (body.revision !== (old?.revision || 0)) fail('schedule_changed', 409);
      if (!old && schedules.length >= 12) fail('schedule_limit', 409);
      if (schedules.some(row => row.id !== body.id && row.runnerId === body.runnerId)) fail('runner_schedule_exists', 409);
      if (Date.parse(body.startAt) > now + 366 * 86400000 || Date.parse(body.startAt) < Date.UTC(2020, 0, 1)) fail('invalid_schedule', 400);
      const auth = await authority(user, now);
      if (!auth.runners.some(runner => runner.id === body.runnerId)) fail('runner_not_authorized', 403);
      if (body.enabled && (!auth.access.paid || auth.access.plan.scheduled !== true)) fail('subscription_required', 402);
      if (body.enabled && body.everyHours < minScheduleHours({ planId: auth.access.plan.id, extraTransfersAddon: auth.access.extraTransfersAddon })) fail('cadence_not_allowed', 422);
      const row = { ...body, revision: body.revision + 1, nextDueAt: scheduleAnchor(body.startAt, body.everyHours, now),
        lastScheduledAt: old?.lastScheduledAt || null, lastJobId: old?.lastJobId || null,
        lastOutcome: body.enabled ? 'waiting' : 'disabled', updatedAt: new Date(now).toISOString() };
      const next = { ...queue, version: 2, jobs: cancelQueued(queue.jobs, body.id, now), schedules: [...schedules.filter(row => row.id !== body.id), row] };
      if ((await db.setJSON(key, storedJobQueue(next, snapshot?.data), snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true })).modified) return result(row, next, auth);
    }
    fail('schedule_changed', 409);
  }
  async function cancel(user, body, remove) {
    if (!mutationIdentity(body) || !exactFields(body, remove ? ['id', 'revision'] : ['id', 'revision', 'enabled']) || !remove && body.enabled !== false) fail('invalid_schedule', 400);
    const key = `jobs:${accountFor(user)}`, db = database();
    for (let attempt = 0; attempt < 6; attempt++) {
      const snapshot = await db.getWithMetadata(key, { type: 'json' }), queue = normalizeJobQueue(snapshot?.data);
      const old = (queue.schedules || []).find(row => row.id === body.id);
      if (!old || old.revision !== body.revision) fail('schedule_changed', 409);
      const now = clock(), row = { ...old, revision: old.revision + 1, enabled: false, lastOutcome: 'disabled', updatedAt: new Date(now).toISOString() };
      const schedules = queue.schedules.filter(row => row.id !== body.id);
      const next = { ...queue, jobs: cancelQueued(queue.jobs, body.id, now), schedules: remove ? schedules : [...schedules, row] };
      if ((await db.setJSON(key, storedJobQueue(next, snapshot.data), { onlyIfMatch: snapshot.etag })).modified) {
        return remove ? { deleted: true, dispatcherEnabled: enabled(), execution: 'queue_only' } : result(row, next, null);
      }
    }
    fail('schedule_changed', 409);
  }
  async function dispatchAccount(index) {
    const user = scheduleIndexIdentity(index);
    if (!enabled()) return { state: 'disabled', queued: 0, blocked: 0 };
    const key = `jobs:${accountFor(user)}`, db = database(), visited = new Set();
    let queued = 0, blocked = 0;
    for (let attempt = 0; attempt < 36 && visited.size < 12; attempt++) {
      const snapshot = await db.getWithMetadata(key, { type: 'json' }), queue = normalizeJobQueue(snapshot?.data), now = clock();
      const row = (queue.schedules || []).filter(row => row.enabled && Date.parse(row.nextDueAt) <= now && !visited.has(row.id))
        .sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt) || a.id.localeCompare(b.id))[0];
      if (!row) return { state: 'processed', queued, blocked };
      const auth = await authority(user, now), runner = auth.runners.find(runner => runner.id === row.runnerId);
      let outcome = status({ ...row, lastOutcome: 'waiting' }, auth), nextJobs = queue.jobs, nextRow;
      if (outcome === 'waiting' && queue.jobs.some(job => job.runnerId === row.runnerId && ['queued', 'running'].includes(job.status))) outcome = 'runner_busy';
      if (outcome === 'waiting') {
        const interval = row.everyHours * 3600000, start = Date.parse(row.startAt);
        const dueAt = new Date(start + Math.floor((now - start) / interval) * interval).toISOString();
        const enqueued = enqueuePrivateJob(queue, { user, runner, access: auth.access, now,
          parsed: { type: 'backup', payload: { version: 2, runnerId: row.runnerId, configRef: row.configRef, configRevision: row.configRevision } },
          occurrence: { id: row.id, revision: row.revision, dueAt } });
        if (enqueued.error) outcome = enqueued.error === 'transfer_rate_limited' ? 'quota_exhausted' : enqueued.error;
        else {
          outcome = 'queued'; nextJobs = enqueued.jobs;
          nextRow = { ...row, nextDueAt: scheduleAnchor(row.startAt, row.everyHours, now, true), lastScheduledAt: dueAt, lastJobId: enqueued.job.id };
        }
      }
      nextRow = { ...(nextRow || row), lastOutcome: outcome, updatedAt: new Date(now).toISOString() };
      const next = { ...queue, jobs: nextJobs, schedules: queue.schedules.map(value => value.id === row.id ? nextRow : value) };
      if ((await db.setJSON(key, storedJobQueue(next, snapshot.data), { onlyIfMatch: snapshot.etag })).modified) {
        visited.add(row.id); if (outcome === 'queued') queued++; else blocked++;
      }
    }
    return { state: 'processed', queued, blocked };
  }
  return { read, save, disable: (user, body) => cancel(user, body, false), remove: (user, body) => cancel(user, body, true), dispatchAccount };
}
