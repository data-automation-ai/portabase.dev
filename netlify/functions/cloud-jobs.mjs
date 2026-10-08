/**
 * Account-scoped job intents. Admission and atomic queue writes enforce current
 * entitlements; this endpoint does not itself run backup or recovery processes.
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { getSubscriptionForUser } from '../shared/subscription-store.mjs';
import { runnerAdmission } from '../shared/runner-admission.mjs';
import { claimNextJob, finishJob, parseJobRequest } from '../../cloud/runner/job-intent.mjs';
import { authenticateAgent, listAgents, ownerKey } from '../shared/agent-store.mjs';
import { createJobCompletionPublisher } from '../shared/job-completion-events.mjs';
import { readJobCompletionReceipt, storeJobCompletionReceipt } from '../shared/job-completion-receipts.mjs';
import { normalizeJobQueue, storedJobQueue, publicClaimDecision } from '../shared/job-queue-envelope.mjs';
import { publicJobRecord as publicJob } from '../shared/public-records.mjs';
import { enqueuePrivateJob, scheduledClaimAllowed } from '../shared/job-enqueue.mjs';

function store() { return getStore({ name: 'portabase-cloud-jobs', consistency: 'strong' }); }

export function createJobsHandler({ authenticate = verifyCloudUser, getSubscription,
  authenticateRunner = authenticateAgent, ownedRunners = listAgents, database = store, clock = Date.now,
  publishCompletion = createJobCompletionPublisher() } = {}) {
  return async event => {
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (!['GET', 'POST'].includes(event.httpMethod)) return jsonResponse(405, { error: 'method_not_allowed' });
    let user;
    try { user = await authenticate(event); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    const account = `${user.cloudVersion}:${user.id}`;
    const key = `jobs:${account}`;
    try {
      const db = database();
      if (event.httpMethod === 'GET') {
        const { jobs } = normalizeJobQueue(await db.get(key, { type: 'json' }));
        return jsonResponse(200, { ok: true, jobs: jobs.map(publicJob), maxAgents: 12, execution: 'intent_queue_only' });
      }
      let body;
      try {
        if (Buffer.byteLength(event.body || '') > 64 * 1024) return jsonResponse(413, { error: 'body_too_large' });
        body = JSON.parse(event.body || '{}');
      } catch { return jsonResponse(400, { error: 'invalid_json' }); }
      if (body && typeof body === 'object' && !Array.isArray(body) && (body.version === undefined || body.version === 1)) {
        return jsonResponse(410, { error: 'private_runner_setup_required' });
      }
      const parsed = parseJobRequest(body);
      if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
      const privateJob = body.version === 2;
      let runner = null, runnerAuthorization;
      if (privateJob) {
        const owner = ownerKey(user);
        if (parsed.action === 'queue') {
          runner = (await ownedRunners(owner)).find(row => row.id === body.runnerId && !row.revokedAt);
          if (runner && runner.jobAccess !== true) return jsonResponse(403, { error: 'runner_job_access_required' });
        } else {
          runnerAuthorization = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === 'x-portabase-agent-authorization')?.[1];
          runner = await authenticateRunner(runnerAuthorization);
          if (runner?.owner !== owner || runner?.id !== body.runnerId || runner?.revokedAt) runner = null;
        }
        if (!runner) return jsonResponse(403, { error: 'runner_not_authorized' });
      }
      // Completion reports do not start work; allow an in-flight worker to
      // finish after subscription expiry. All new execution needs admission.
      let access;
      async function currentAccess() {
        if (access !== undefined) return access;
        return access = runnerAdmission(await (getSubscription ? getSubscription(account) : getSubscriptionForUser(user)), clock());
      }
      async function admissionError(job, queue) {
        const current = await currentAccess();
        if (!job.admission || (!current.paid && job.admission.paid)) return 'subscription_required';
        if (job.admission.maxBytes > current.plan.storageCapBytes) return 'job_exceeds_plan';
        if (!scheduledClaimAllowed(job, queue, current)) return 'schedule_no_longer_active';
        return null;
      }
      async function completeEvents(job) {
        if (!privateJob) return;
        if (job.completionEventsPending !== false) await publishCompletion({ job, runner, authorization: runnerAuthorization });
        await storeJobCompletionReceipt(db, runner.owner, job);
        // Keep pending rows until all side effects persist. The worker journal
        // retains its finish report across a 503 and retries without execution.
        for (let attempt = 0; attempt < 4; attempt++) {
          const snapshot = await db.getWithMetadata(key, { type: 'json' });
          const queue = normalizeJobQueue(snapshot?.data), rows = queue.jobs, current = rows.find(row => row.id === job.id);
          if (!current || current.status !== job.status || current.finishedAt !== job.finishedAt) throw new Error('completion_changed');
          if (current.completionEventsPending === false) return;
          const next = rows.map(row => row.id === job.id ? { ...row, completionEventsPending: false } : row);
          if ((await db.setJSON(key, storedJobQueue({ ...queue, jobs: next }, snapshot.data), { onlyIfMatch: snapshot.etag })).modified) return;
        }
        throw new Error('completion_changed');
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const snapshot = await db.getWithMetadata(key, { type: 'json' });
        const queue = normalizeJobQueue(snapshot?.data);
        let jobs = queue.jobs;
        const now = clock();
        // Each CAS retry re-reads authority. Separate stores cannot provide an
        // atomic revocation boundary; runners independently recheck on claim.
        if (privateJob) {
          runner = parsed.action === 'queue' ? (await ownedRunners(ownerKey(user))).find(row => row.id === body.runnerId && !row.revokedAt)
            : await authenticateRunner(runnerAuthorization);
          if (!runner || runner.id !== body.runnerId || runner.revokedAt || parsed.action !== 'queue' && runner.owner !== ownerKey(user)) return jsonResponse(403, { error: 'runner_not_authorized' });
          if (parsed.action === 'queue' && runner.jobAccess !== true) return jsonResponse(403, { error: 'runner_job_access_required' });
        }
        let next, job, claimSlot, claimSlots = queue.claimSlots;
        if (privateJob && parsed.action === 'queue' && parsed.requestId) {
          const previous = jobs.find(row => row.version === 2 && row.requestId === parsed.requestId);
          if (previous) {
            const matches = previous.type === parsed.type && previous.runnerId === runner.id
              && previous.payload?.configRef === parsed.payload.configRef
              && previous.payload?.configRevision === parsed.payload.configRevision;
            if (!matches) return jsonResponse(409, { error: 'request_id_conflict' });
            return jsonResponse(200, { ok: true, job: publicJob(previous), execution: 'intent_queue_only', deduplicated: true });
          }
        }
        if (parsed.action === 'claim') {
          if (parsed.claimProtocol === 1) {
            if (!Number.isInteger(runner?.slot) || runner.slot < 0 || runner.slot >= 12) return jsonResponse(403, { error: 'runner_not_authorized' });
            const previous = claimSlots.find(row => row.slot === runner.slot);
            if (previous?.runnerId === runner.id) {
              const priorJob = previous.jobId === null ? null : jobs.find(row => row.id === previous.jobId);
              if (previous.jobId !== null && (!priorJob || priorJob.version !== 2 || priorJob.runnerId !== runner.id
                || priorJob.workerId !== runner.id || priorJob.payload?.runnerId !== runner.id
                || !['running', 'succeeded', 'failed'].includes(priorJob.status))) throw new Error('invalid_claim_assignment');
              if (parsed.claimSequence === previous.sequence) {
                if (parsed.claimRequestId !== previous.requestId) return jsonResponse(409, { error: 'claim_reference_conflict' });
                const denied = priorJob?.status === 'running' ? await admissionError(priorJob, queue) : null;
                if (denied) return jsonResponse(denied === 'schedule_no_longer_active' ? 409 : 402, { error: denied });
                return jsonResponse(200, { ok: true, job: publicJob(priorJob), claim: publicClaimDecision(previous), execution: 'intent_queue_only', deduplicated: true });
              }
              if (parsed.claimSequence !== previous.sequence + 1 || parsed.claimRequestId === previous.requestId) return jsonResponse(409, { error: 'claim_sequence_conflict' });
              if (priorJob && (!['succeeded', 'failed'].includes(priorJob.status) || priorJob.completionEventsPending !== false)) {
                return jsonResponse(409, { error: 'claim_previous_unfinished' });
              }
            } else if (parsed.claimSequence !== 1) return jsonResponse(409, { error: 'claim_sequence_conflict' });
            // Never adopt or requeue a prior legacy/unknown running assignment.
            if (jobs.some(row => row.version === 2 && row.runnerId === runner.id && row.status === 'running')) {
              return jsonResponse(409, { error: 'runner_execution_pending' });
            }
          } else if (claimSlots.some(row => row.runnerId === runner?.id)) {
            return jsonResponse(409, { error: 'durable_claim_required' });
          }
          await currentAccess();
          jobs = jobs.map(row => row.status === 'queued' && row.schedule && !scheduledClaimAllowed(row, queue, access)
            ? { ...row, status: 'cancelled', finishedAt: new Date(now).toISOString(), safeError: null } : row);
          const eligible = jobs.filter(row => privateJob
            ? row.version === 2 && row.runnerId === runner.id
            : row.version !== 2);
          const claimed = claimNextJob(eligible, { workerId: runner?.id || user.id, runnerId: runner?.id, now: new Date(now).toISOString() });
          job = claimed.job;
          if (!job && parsed.claimProtocol !== 1) return jsonResponse(200, { ok: true, job: null });
          const denied = job ? await admissionError(job, queue) : null;
          if (denied) return jsonResponse(denied === 'schedule_no_longer_active' ? 409 : 402, { error: denied });
          next = job ? jobs.map(row => row.id === job.id ? job : row) : jobs;
          if (parsed.claimProtocol === 1) {
            claimSlot = { slot: runner.slot, runnerId: runner.id, sequence: parsed.claimSequence,
              requestId: parsed.claimRequestId, jobId: job?.id || null, decidedAt: new Date(now).toISOString() };
            claimSlots = [...claimSlots.filter(row => row.slot !== runner.slot), claimSlot];
          }
        } else if (parsed.action === 'finish') {
          const existing = jobs.find(row => row.id === parsed.jobId);
          if (privateJob && !existing) {
            const receipt = await readJobCompletionReceipt(db, runner.owner, runner.id, parsed.jobId);
            if (receipt) {
              const repeated = finishJob([receipt], { ...parsed, projectRef: runner.projectRef });
              if (!repeated.ok) return jsonResponse(409, { error: repeated.error });
              return jsonResponse(200, { ok: true, job: publicJob(receipt), execution: 'intent_queue_only', deduplicated: true });
            }
          }
          if (existing?.version === 2 && (!privateJob || existing.runnerId !== runner?.id || existing.workerId !== runner?.id)) {
            return jsonResponse(403, { error: 'runner_not_authorized' });
          }
          if (privateJob && existing?.version !== 2) return jsonResponse(403, { error: 'runner_not_authorized' });
          const done = finishJob(jobs, { ...parsed, projectRef: runner?.projectRef, now: new Date(now).toISOString() });
          if (!done.ok) return jsonResponse(409, { error: done.error });
          if (done.unchanged) {
            await completeEvents(done.job);
            return jsonResponse(200, { ok: true, job: publicJob(done.job), execution: 'intent_queue_only', deduplicated: true });
          }
          next = done.jobs; job = done.job;
          if (privateJob) {
            job = { ...job, completionEventsPending: true };
            next = next.map(row => row.id === job.id ? job : row);
          }
        } else {
          await currentAccess();
          const enqueued = enqueuePrivateJob(queue, { user, runner, parsed, access, now });
          if (enqueued.error) { const { status, ...body } = enqueued; return jsonResponse(status, body); }
          job = enqueued.job; next = enqueued.jobs;
        }
        const written = await db.setJSON(key, storedJobQueue({ ...queue, jobs: next, claimSlots }, snapshot?.data), snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true });
        if (written.modified) {
          if (parsed.action === 'finish') await completeEvents(job);
          return jsonResponse(200, { ok: true, job: publicJob(job), ...(claimSlot ? { claim: publicClaimDecision(claimSlot) } : {}), execution: 'intent_queue_only' });
        }
      }
      return jsonResponse(409, { error: 'queue_changed' });
    } catch { return jsonResponse(503, { error: 'job_service_unavailable' }); }
  };
}
export const handler = createJobsHandler();
