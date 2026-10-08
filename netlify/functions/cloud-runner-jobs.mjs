import { jsonResponse } from '../shared/verify-user.mjs';
import { authenticateAgent, runnerJobIdentity } from '../shared/agent-store.mjs';
import { parseJobRequest } from '../../cloud/runner/job-intent.mjs';
import { createJobsHandler } from './cloud-jobs.mjs';

/** Delegated runner authority is deliberately narrower than the account API.
 * No account session/refresh token is accepted, looked up or synthesized. */
export function createRunnerJobsHandler({ authenticateRunner = authenticateAgent, ...jobAdapters } = {}) {
  return async event => {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
    const header = name => Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
    if (header('x-portabase-agent-authorization')) return jsonResponse(400, { error: 'ambiguous_runner_auth' });
    const authorization = header('authorization');
    let runner;
    try { runner = await authenticateRunner(authorization); }
    catch { return jsonResponse(503, { error: 'agent_store_unavailable' }); }
    if (!runner) return jsonResponse(401, { error: 'unauthorized' });
    const user = runnerJobIdentity(runner);
    if (!user) return jsonResponse(403, { error: 'runner_job_access_required' });
    let body;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      if (Buffer.byteLength(raw) > 64 * 1024) return jsonResponse(413, { error: 'body_too_large' });
      body = JSON.parse(raw);
    } catch { return jsonResponse(400, { error: 'invalid_json' }); }
    if (body?.version !== 2) return jsonResponse(403, { error: 'runner_action_refused' });
    const parsed = parseJobRequest(body);
    if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
    if (parsed.version !== 2 || !['claim', 'finish'].includes(parsed.action)) return jsonResponse(403, { error: 'runner_action_refused' });
    if (parsed.runnerId !== runner.id) return jsonResponse(403, { error: 'runner_not_authorized' });
    // Reuse the existing CAS queue, entitlement and finish-receipt policies.
    // Its user identity comes only from the server-owned credential mapping;
    // reauthentication prevents an intervening revocation from using cached auth.
    const handler = createJobsHandler({ ...jobAdapters, authenticate: async () => user,
      authenticateRunner: async supplied => {
        if (supplied !== authorization) return null;
        const active = await authenticateRunner(supplied), identity = runnerJobIdentity(active);
        return identity?.cloudVersion === user.cloudVersion && identity?.id === user.id ? active : null;
      },
    });
    return handler({ ...event, isBase64Encoded: false, body: JSON.stringify(body),
      headers: { Authorization: authorization, 'X-Portabase-Agent-Authorization': authorization } });
  };
}
export const handler = createRunnerJobsHandler();
