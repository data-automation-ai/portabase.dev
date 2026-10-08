/**
 * GET /api/cloud/dashboard — customer telemetry for the signed-in user.
 * Reads the jobs blob store + subscription. Never returns keys or capsule bytes.
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { deriveAccess, getSubscriptionForUser } from '../shared/subscription-store.mjs';
import { findForbiddenField } from '../../cloud/control-plane/forbidden.mjs';
import { buildDashboardModel, sanitizeJobTelemetry } from '../../src/lib/dashboard-view.js';
import { inspectSquareCheckoutReady } from '../shared/square-ready.mjs';
import { publicSquareStatus } from '../../src/lib/square-public.js';
import { runnerAdmission } from '../shared/runner-admission.mjs';
import { publicDashboardJob } from '../shared/public-records.mjs';
import { normalizeJobQueue } from '../shared/job-queue-envelope.mjs';

function jobsStore() {
  return getStore({ name: 'portabase-cloud-jobs', consistency: 'strong' });
}

export function createDashboardHandler({ authenticate = verifyCloudUser, jobsDatabase = jobsStore, subscription = getSubscriptionForUser, squareStatus = () => publicSquareStatus(inspectSquareCheckoutReady()) } = {}) {
return async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });

  let user;
  try {
    user = await authenticate(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const storeKey = `${user.cloudVersion}:${user.id}`;
  let jobs = [];
  try {
    jobs = normalizeJobQueue(await jobsDatabase().get(`jobs:${storeKey}`, { type: 'json' })).jobs;
  } catch {
    return jsonResponse(503, { error: 'dashboard_jobs_unavailable' });
  }
  if (!Array.isArray(jobs)) return jsonResponse(503, { error: 'dashboard_jobs_unavailable' });

  const safeJobs = [];
  for (const job of jobs) {
    if (findForbiddenField(job)) continue;
    const projected = publicDashboardJob(job);
    if (projected) safeJobs.push(sanitizeJobTelemetry(projected));
  }

  let record;
  try { record = await subscription(user); }
  catch { return jsonResponse(503, { error: 'dashboard_subscription_unavailable' }); }
  const access = deriveAccess(record);
  const admission = runnerAdmission(record);
  const square = squareStatus();
  const model = buildDashboardModel({
    jobs: safeJobs,
    billing: record
      ? {
        plan: admission.plan.id,
        planId: admission.plan.id,
        extraTransfersAddon: admission.extraTransfersAddon,
        status: record.status,
      }
      : { plan: admission.plan.id, planId: admission.plan.id, extraTransfersAddon: false },
    proof: null,
    demoMode: false,
    live: safeJobs.length > 0,
    square,
  });

  return jsonResponse(200, {
    ok: true,
    source: model.source,
    labeled: model.labeled,
    live: model.live,
    demo: false,
    empty: model.empty,
    jobs: safeJobs,
    model,
    proof: model.proof,
    access,
    square,
    subscription: record
      ? {
        status: record.status,
        plan: record.plan || null,
        extraTransfersAddon: admission.extraTransfersAddon,
        squareSubscriptionId: record.squareSubscriptionId || null,
      }
      : null,
    privacy: 'metadata-and-hashes-only',
  });
}
}
export const handler = createDashboardHandler();
