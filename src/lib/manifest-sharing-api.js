import { ensureSessionForVersion } from './cloud-api.js';
import { authHeaders, loadSession, sessionCloudVersion } from './session.js';

async function request(method, body, agentId) {
  const session = await ensureSessionForVersion(sessionCloudVersion());
  if (!session) throw Object.assign(new Error('unauthorized'), { status: 401 });
  const response = await fetch(`/api/cloud/manifest-sharing${method === 'GET' ? `?agentId=${encodeURIComponent(agentId)}` : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders(loadSession()) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('manifest_request_failed'), { status: response.status });
  if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('invalid_manifest_response');
  return data;
}

export const fetchManifestSharing = agentId => request('GET', undefined, agentId);
export const grantManifestSharing = body => request('POST', body);
export const uploadSharedManifest = body => request('PUT', body);
export const revokeManifestSharing = agentId => request('DELETE', { agentId });
