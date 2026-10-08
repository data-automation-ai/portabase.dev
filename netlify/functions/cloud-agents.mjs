import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { createAgent, listAgents, ownerKey, revokeAgent, rotateAgent } from '../shared/agent-store.mjs';
import { agentsWithHealth } from '../shared/runner-reports.mjs';

export function createAgentsHandler({ verifyUser = verifyCloudUser, create = createAgent, list = listAgents, revoke = revokeAgent, rotate = rotateAgent, health = agentsWithHealth } = {}) {
  return async function handler(event) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(event.httpMethod)) return jsonResponse(405, { error: 'method_not_allowed' });
  let owner, user;
  try { user = await verifyUser(event); owner = ownerKey(user); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
  try {
    if (event.httpMethod === 'GET') return jsonResponse(200, { agents: await health(owner, await list(owner)) });
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    if (Buffer.byteLength(rawBody) > 2048) return jsonResponse(413, { error: 'body_too_large' });
    let body;
    try { body = JSON.parse(rawBody || '{}'); } catch { return jsonResponse(400, { error: 'invalid_json' }); }
    if (event.httpMethod === 'POST') return jsonResponse(201, await create(owner, body, undefined, { user }));
    if (event.httpMethod === 'PATCH') return jsonResponse(200, await rotate(owner, body, user));
    return jsonResponse(200, { agent: await revoke(owner, body?.id) });
  } catch (error) {
    return jsonResponse(error.status || 503, { error: error.status ? error.message : 'agent_store_unavailable' });
  }
  };
}
export const handler = createAgentsHandler();
