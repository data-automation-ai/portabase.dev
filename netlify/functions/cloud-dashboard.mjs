/**
 * GET /api/cloud/dashboard — customer telemetry for the signed-in user.
 * Reads the jobs blob store + subscription. Never returns keys or capsule bytes.
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { deriveAccess, getSubscriptionByUserId } from '../shared/subscription-store.mjs';
import { findForbiddenField } from '../../cloud/control-plane/forbidden.mjs';
import { buildDashboardModel, sanitizeJobTelemetry } from '../../src/lib/dashboard-view.js';

function jobsStore() {
  return getStore({ name: 'portabase-cloud-jobs', consistency: 'strong' });
}

export async function handler(event) {
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
    user = await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const storeKey = `${user.cloudVersion}:${user.id}`;
  let jobs = [];
  try {
    jobs = (await jobsStore().get(`jobs:${storeKey}`, { type: 'json' })) || [];
  } catch {
    jobs = [];
  }
  if (!Array.isArray(jobs)) jobs = [];

  const safeJobs = [];
  for (const job of jobs) {
    if (findForbiddenField(job)) continue;
    safeJobs.push(sanitizeJobTelemetry(job));
  }

  const record = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id)) || null;
  const access = deriveAccess(record);
  const model = buildDashboardModel({
    jobs: safeJobs,
    billing: record
      ? {
        plan: record.plan,
        planId: record.plan,
        extraTransfersAddon: Boolean(record.extraTransfersAddon),
        status: record.status,
      }
      : {},
    proof: null,
    demoMode: false,
    live: safeJobs.length > 0,
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
    subscription: record
      ? {
        status: record.status,
        plan: record.plan || null,
        extraTransfersAddon: Boolean(record.extraTransfersAddon),
        squareSubscriptionId: record.squareSubscriptionId || null,
      }
      : null,
    privacy: 'metadata-and-hashes-only',
  });
}
