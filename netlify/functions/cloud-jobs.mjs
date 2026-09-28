/**
 * W5: lightweight agent job queue for Cloud console (replay/backup intents).
 * Stores jobs in Netlify Blobs — agents poll with Bearer token (Supabase/Cognito JWT).
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { getSubscriptionByUserId } from '../shared/subscription-store.mjs';
import { countTransfersLast24h, getCloudPlan, transferWindow } from '../shared/product.mjs';
import { claimNextJob, finishJob, manualBackupBlocked, parseJobRequest } from '../../cloud/runner/job-intent.mjs';

function store() {
  return getStore({ name: 'portabase-cloud-jobs', consistency: 'strong' });
}

/** What the browser and the worker are allowed to see. No secrets exist on the record. */
function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    payload: job.payload || null,
    createdAt: job.createdAt || null,
    claimedAt: job.claimedAt || null,
    finishedAt: job.finishedAt || null,
    safeError: job.safeError || null,
    cloudVersion: job.cloudVersion || null,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  let user;
  try {
    user = await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const key = `jobs:${user.cloudVersion}:${user.id}`;

  if (event.httpMethod === 'GET') {
    try {
      const jobs = (await store().get(key, { type: 'json' })) || [];
      return jsonResponse(200, { ok: true, jobs, maxAgents: 12 });
    } catch {
      return jsonResponse(200, { ok: true, jobs: [] });
    }
  }

  if (event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch {
      return jsonResponse(400, { error: 'invalid_json' });
    }
    const parsed = parseJobRequest(body);
    if (!parsed.ok) {
      return jsonResponse(parsed.error === 'zero_knowledge_forbidden' ? 400 : 400, {
        error: parsed.error,
        detail: parsed.error === 'zero_knowledge_forbidden'
          ? 'Cloud jobs do not accept keys, decrypt requests, or capsule inventory.'
          : undefined,
      });
    }

    let jobs = [];
    try { jobs = (await store().get(key, { type: 'json' })) || []; } catch { jobs = []; }

    if (parsed.action === 'claim') {
      const claimed = claimNextJob(jobs, { workerId: user.id });
      await store().setJSON(key, claimed.jobs);
      return jsonResponse(200, { ok: true, job: claimed.job ? publicJob(claimed.job) : null });
    }

    if (parsed.action === 'finish') {
      const done = finishJob(jobs, {
        jobId: parsed.jobId,
        status: parsed.status,
        safeError: parsed.safeError,
      });
      if (!done.ok) return jsonResponse(409, { error: done.error });
      await store().setJSON(key, done.jobs);
      return jsonResponse(200, { ok: true, job: publicJob(done.job) });
    }

    if (parsed.type === 'backup') {
      const storeKey = `${user.cloudVersion}:${user.id}`;
      const sub = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id)) || {};
      const used = countTransfersLast24h(jobs.filter((j) => j.type === 'backup'));
      const plan = getCloudPlan(sub.plan);
      const window = transferWindow({
        usedLast24h: used,
        extraTransfersAddon: Boolean(sub.extraTransfersAddon),
        planId: plan.id,
      });
      if (manualBackupBlocked({ plan, usedLast24h: used, atLimit: window.atLimit })) {
        return jsonResponse(429, {
          error: 'transfer_rate_limited',
          transferWindow: window,
          message: plan.scheduled === false
            ? 'Cloud Free allows one manual capsule per 24 hours. It has no scheduled service.'
            : (window.extraTransfersAddon
              ? '3 transfers already used in the last 24 hours.'
              : 'Plan includes 1 capsule transfer / 24h. Upgrade Extra transfers for up to 3.'),
        });
      }
    }

    const job = {
      id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: parsed.type,
      status: 'queued',
      payload: parsed.payload,
      createdAt: new Date().toISOString(),
      cloudVersion: user.cloudVersion,
    };

    jobs = [job, ...jobs].slice(0, 50);
    await store().setJSON(key, jobs);
    return jsonResponse(200, { ok: true, job: publicJob(job) });
  }

  return jsonResponse(405, { error: 'method_not_allowed' });
}
