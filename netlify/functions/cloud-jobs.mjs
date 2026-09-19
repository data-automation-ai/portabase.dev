/**
 * W5: lightweight agent job queue for Cloud console (replay/backup intents).
 * Stores jobs in Netlify Blobs — agents poll with Bearer token (Supabase/Cognito JWT).
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { getSubscriptionByUserId } from '../shared/subscription-store.mjs';
import { countTransfersLast24h, transferWindow } from '../shared/product.mjs';
import { findForbiddenField } from '../../cloud/control-plane/forbidden.mjs';

function store() {
  return getStore({ name: 'portabase-cloud-jobs', consistency: 'strong' });
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
    const type = String(body.type || 'replay').slice(0, 40);
    const allowed = new Set(['replay', 'backup', 'verify', 'heartbeat']);
    if (!allowed.has(type)) return jsonResponse(400, { error: 'invalid_type' });
    if (body.passphrase || body.decrypt || body.objectName || body.tableRows || body.plaintext || findForbiddenField(body)) {
      return jsonResponse(400, { error: 'zero_knowledge_forbidden', detail: 'Cloud jobs do not accept keys, decrypt requests, or capsule inventory.' });
    }

    let jobs = [];
    try { jobs = (await store().get(key, { type: 'json' })) || []; } catch { jobs = []; }

    if (type === 'backup') {
      const storeKey = `${user.cloudVersion}:${user.id}`;
      const sub = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id)) || {};
      const used = countTransfersLast24h(jobs.filter((j) => j.type === 'backup'));
      const window = transferWindow({
        usedLast24h: used,
        extraTransfersAddon: Boolean(sub.extraTransfersAddon),
        planId: sub.plan,
      });
      if (window.atLimit) {
        return jsonResponse(429, {
          error: 'transfer_rate_limited',
          transferWindow: window,
          message: window.extraTransfersAddon
            ? '3 transfers already used in the last 24 hours.'
            : 'Plan includes 1 capsule transfer / 24h. Upgrade Extra transfers for up to 3.',
        });
      }
    }

    const job = {
      id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      status: 'queued',
      payload: {
        capsuleId: body.capsuleId ? String(body.capsuleId).slice(0, 120) : null,
        targetRef: body.targetRef ? String(body.targetRef).slice(0, 40) : null,
        projectRef: body.projectRef ? String(body.projectRef).slice(0, 40) : null,
        note: body.note ? String(body.note).slice(0, 500) : null,
      },
      createdAt: new Date().toISOString(),
      cloudVersion: user.cloudVersion,
    };

    jobs = [job, ...jobs].slice(0, 50);
    await store().setJSON(key, jobs);
    return jsonResponse(200, { ok: true, job });
  }

  return jsonResponse(405, { error: 'method_not_allowed' });
}
