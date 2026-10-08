/**
 * Runner lifecycle intents. No compute provisioning happens in this endpoint.
 * Customer secrets are refused; records describe requested state only.
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { getSubscriptionForUser } from '../shared/subscription-store.mjs';
import { runnerAdmission } from '../shared/runner-admission.mjs';
import { CLOUD_MAX_AGENTS } from '../shared/product.mjs';
import { assertControlPlaneRunnerBody, provisionSleepingRunner } from '../shared/runner-plane.mjs';
import { publicRunnerRecord } from '../shared/public-records.mjs';

function store() { return getStore({ name: 'portabase-cloud-runners', consistency: 'strong' }); }

export function createRunnersHandler({ authenticate = verifyCloudUser, getSubscription,
  database = store, clock = Date.now, createRecord = provisionSleepingRunner } = {}) {
  return async event => {
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (!['GET', 'POST'].includes(event.httpMethod)) return jsonResponse(405, { error: 'method_not_allowed' });
    let user;
    try { user = await authenticate(event); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    const account = `${user.cloudVersion}:${user.id}`;
    const key = `runners:${account}`;
    try {
      const db = database();
      if (event.httpMethod === 'GET') {
        const runners = (await db.get(key, { type: 'json' })) || [];
        if (!Array.isArray(runners)) throw new Error('invalid_runners');
        return jsonResponse(200, { ok: true, runners: runners.map(publicRunnerRecord).filter(Boolean), provisioning: 'metadata_only', isolation: 'not_proven_green' });
      }
      let body;
      try {
        if (Buffer.byteLength(event.body || '') > 4096) return jsonResponse(413, { error: 'body_too_large' });
        body = JSON.parse(event.body || '{}');
        assertControlPlaneRunnerBody(body);
      } catch (error) { return jsonResponse(error.status || 400, { error: error.code || 'invalid_json' }); }
      const action = body.action || 'provision';
      if (!['provision', 'wake', 'sleep'].includes(action)) return jsonResponse(400, { error: 'unknown_action' });
      if (body.region != null && (typeof body.region !== 'string' || !/^[a-z0-9-]{1,40}$/.test(body.region))) return jsonResponse(400, { error: 'invalid_region' });
      const now = clock();
      // An expired customer can request sleep; it cannot create or wake paid
      // compute. Read access and stopping work remain available.
      if (action !== 'sleep' && !runnerAdmission(await (getSubscription ? getSubscription(account) : getSubscriptionForUser(user)), now).paid) return jsonResponse(402, { error: 'subscription_required' });
      for (let attempt = 0; attempt < 4; attempt++) {
        const snapshot = await db.getWithMetadata(key, { type: 'json' });
        const runners = snapshot?.data || [];
        if (!Array.isArray(runners)) throw new Error('invalid_runners');
        let runner, next;
        if (action === 'provision') {
          if (runners.length >= CLOUD_MAX_AGENTS) return jsonResponse(409, { error: 'runner_limit' });
          runner = { ...createRecord({ subscriberId: account, region: body.region || 'us-east-1' }),
            status: 'unprovisioned', desiredStatus: 'sleeping', provisioning: 'metadata_only', isolation: 'not_proven_green' };
          next = [runner, ...runners];
        } else {
          const index = runners.findIndex(row => row.runnerId === body.runnerId);
          if (index < 0) return jsonResponse(404, { error: 'runner_not_found' });
          runner = { ...runners[index], desiredStatus: action === 'sleep' ? 'sleeping' : 'ready', updatedAt: new Date(now).toISOString() };
          next = runners.map((row, i) => i === index ? runner : row);
        }
        const result = await db.setJSON(key, next, snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true });
        if (result.modified) return jsonResponse(202, { ok: true, runner: publicRunnerRecord(runner), runners: next.map(publicRunnerRecord).filter(Boolean), provisioning: 'metadata_only',
          isolation: 'not_proven_green', message: 'Runner request saved. Compute provisioning is not connected.' });
      }
      return jsonResponse(409, { error: 'runners_changed' });
    } catch { return jsonResponse(503, { error: 'runner_service_unavailable' }); }
  };
}
export const handler = createRunnersHandler();
