import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { authenticateAgent, listAgents, ownerKey } from '../shared/agent-store.mjs';
import { grantManifestSharing, ManifestSharingError, readManifestSharing, revokeManifestSharing, uploadSharedManifest } from '../shared/manifest-sharing.mjs';
import { MAX_SHARED_MANIFEST_BYTES } from '../../utility/shared-manifest.mjs';

function authorization(event) {
  const key = Object.keys(event.headers || {}).find(name => name.toLowerCase() === 'authorization');
  return event.headers?.[key] || '';
}
function onlyFields(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw new ManifestSharingError(400, 'invalid_sharing_request');
}

export function createManifestSharingHandler({ verifyUser = verifyCloudUser, authenticate = authenticateAgent, agents = listAgents, read = readManifestSharing, grant = grantManifestSharing, upload = uploadSharedManifest, revoke = revokeManifestSharing } = {}) {
  return async event => {
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(event.httpMethod)) return jsonResponse(405, { error: 'method_not_allowed' });
    const agentRequest = authorization(event).startsWith('Bearer pb_agent_');
    if (agentRequest && event.httpMethod !== 'PUT') return jsonResponse(403, { error: 'owner_auth_required' });
    let owner, credential;
    try {
      if (agentRequest) {
        credential = await authenticate(authorization(event));
        if (!credential) return jsonResponse(401, { error: 'unauthorized' });
        owner = credential.owner;
      } else owner = ownerKey(await verifyUser(event));
    } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    try {
      if (event.httpMethod === 'GET') return jsonResponse(200, await read(owner, event.queryStringParameters?.agentId));
      const bodyBytes = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '');
      if (bodyBytes.length > MAX_SHARED_MANIFEST_BYTES + 2048) return jsonResponse(413, { error: 'body_too_large' });
      let body;
      try { body = JSON.parse(bodyBytes.toString('utf8')); } catch { return jsonResponse(400, { error: 'invalid_json' }); }
      if (event.httpMethod === 'DELETE') {
        onlyFields(body, ['agentId']);
        return jsonResponse(200, await revoke(owner, body.agentId));
      }
      onlyFields(body, event.httpMethod === 'POST' ? ['agentId', 'expectedRevision', 'inventoryConsent', 'previewDigest'] : ['agentId', 'expectedRevision', 'grantId', 'snapshot']);
      const agent = credential || (await agents(owner)).find(row => row.id === body.agentId && !row.revokedAt);
      if (!agent || agent.id !== body.agentId) return jsonResponse(403, { error: 'agent_not_owned' });
      if (event.httpMethod === 'POST') return jsonResponse(200, await grant(owner, agent, body));
      return jsonResponse(200, await upload(owner, agent, body));
    } catch (error) {
      return jsonResponse(error instanceof ManifestSharingError ? error.status : 503, { error: error instanceof ManifestSharingError ? error.message : 'manifest_sharing_unavailable' });
    }
  };
}
export const handler = createManifestSharingHandler();
