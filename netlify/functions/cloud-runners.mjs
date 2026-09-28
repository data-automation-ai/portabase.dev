/**
 * Cloud Runner lifecycle API.
 * Metadata only. Reject secret-shaped bodies. No SSH / get-key.
 */

import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import {
  assertControlPlaneRunnerBody,
  provisionSleepingRunner,
  rejectControlPlaneAction,
} from '../shared/runner-plane.mjs';

function store() {
  return getStore({ name: 'portabase-cloud-runners', consistency: 'strong' });
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

  const key = `runners:${user.cloudVersion}:${user.id}`;

  if (event.httpMethod === 'GET') {
    try {
      const runners = (await store().get(key, { type: 'json' })) || [];
      return jsonResponse(200, { ok: true, runners, isolation: 'not_proven_green' });
    } catch {
      return jsonResponse(200, { ok: true, runners: [], isolation: 'not_proven_green' });
    }
  }

  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  try {
    assertControlPlaneRunnerBody(body);
    rejectControlPlaneAction(body.action);
  } catch (err) {
    return jsonResponse(err.status || 400, { error: err.code || 'rejected', message: err.message });
  }

  let runners = [];
  try { runners = (await store().get(key, { type: 'json' })) || []; } catch { runners = []; }

  if (!body.action || body.action === 'provision') {
    const runner = provisionSleepingRunner({
      subscriberId: user.id,
      region: body.region || 'us-east-1',
    });
    runners = [runner, ...runners].slice(0, 12);
    await store().setJSON(key, runners);
    return jsonResponse(200, {
      ok: true,
      runner,
      note: 'Sleeping empty runner. Browser seals keys to the runner seal URL — never this API.',
    });
  }

  if (body.action === 'sleep' || body.action === 'wake') {
    const next = runners.map((r) => (
      r.runnerId === body.runnerId
        ? { ...r, status: body.action === 'sleep' ? 'sleeping' : 'ready', updatedAt: new Date().toISOString() }
        : r
    ));
    await store().setJSON(key, next);
    return jsonResponse(200, { ok: true, runners: next });
  }

  return jsonResponse(400, { error: 'unknown_action' });
}
