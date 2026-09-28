/**
 * S3: GET|PUT /api/cloud/selection — save/read which Supabase project,
 * tables and buckets a customer wants a capsule to cover.
 * Validation and storage live in netlify/shared/selection-store.mjs (pure + testable).
 */
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { getSubscriptionByUserId } from '../shared/subscription-store.mjs';
import { getCloudPlan } from '../shared/product.mjs';
import { findForbiddenField } from '../../cloud/control-plane/forbidden.mjs';
import { getSelection, planExists, putSelection, validateSelection } from '../shared/selection-store.mjs';

const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due']);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  let user;
  try {
    user = await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const storeKey = `${user.cloudVersion}:${user.id}`;

  if (event.httpMethod === 'GET') {
    const selection = (await getSelection(storeKey)) || (await getSelection(user.id));
    return jsonResponse(200, { ok: true, selection: selection || null });
  }

  if (event.httpMethod === 'PUT') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch {
      return jsonResponse(400, { error: 'invalid_json' });
    }
    if (findForbiddenField(body)) {
      return jsonResponse(400, { error: 'forbidden_field' });
    }

    const sub = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id)) || {};
    const subscriptionActive = ACTIVE_STATUSES.has(String(sub.status));
    const planId = subscriptionActive ? sub.plan : body.planId;

    if (!planExists(planId)) {
      return jsonResponse(400, { error: 'invalid_plan', field: 'planId' });
    }

    const plan = getCloudPlan(planId);
    const result = validateSelection(body, plan);
    if (!result.ok) {
      return jsonResponse(400, { error: result.error, field: result.field });
    }

    const saved = await putSelection(storeKey, result.selection);
    return jsonResponse(200, { ok: true, selection: saved, subscriptionActive });
  }

  return jsonResponse(405, { error: 'method_not_allowed' });
}
