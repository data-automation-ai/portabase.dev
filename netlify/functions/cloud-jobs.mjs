/**
 * W5: lightweight agent job queue for Cloud console (replay/backup intents).
 * Stores jobs in Netlify Blobs — agents poll with Bearer token (Supabase/Cognito JWT).
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';

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

    let jobs = [];
    try { jobs = (await store().get(key, { type: 'json' })) || []; } catch { jobs = []; }
    jobs = [job, ...jobs].slice(0, 50);
    await store().setJSON(key, jobs);
    return jsonResponse(200, { ok: true, job });
  }

  return jsonResponse(405, { error: 'method_not_allowed' });
}
