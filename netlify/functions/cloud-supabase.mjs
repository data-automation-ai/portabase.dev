/**
 * S2: "pick your database" — Supabase Management API proxy for the Cloud
 * dashboard. POST-only. The customer's Personal Access Token is used
 * in-request only: never stored (no Blobs), never logged, never echoed back.
 */
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { fetchInventory, isValidRef, isValidToken, listProjects, SupabaseMgmtError } from '../shared/supabase-mgmt.mjs';

const ALLOWED_ACTIONS = new Set(['projects', 'inventory']);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  try {
    await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const action = String(body.action || '');
  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonResponse(400, { error: 'invalid_action' });
  }

  const token = body.token;
  if (!isValidToken(token)) {
    return jsonResponse(400, { error: 'invalid_token' });
  }

  try {
    if (action === 'projects') {
      const projects = await listProjects(token);
      return jsonResponse(200, { ok: true, projects });
    }

    // action === 'inventory'
    const ref = body.ref;
    if (!isValidRef(ref)) {
      return jsonResponse(400, { error: 'invalid_ref' });
    }
    const inventory = await fetchInventory(token, ref);
    return jsonResponse(200, { ok: true, inventory });
  } catch (err) {
    // Never surface the token or the raw upstream body — map to a safe code only.
    const code = err instanceof SupabaseMgmtError ? err.code : 'upstream_error';
    const status = code === 'token_rejected' ? 401 : code === 'project_not_found' ? 404 : code === 'rate_limited' ? 429 : 502;
    return jsonResponse(status, { error: code });
  }
}
