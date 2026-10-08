import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { ownerKey } from '../shared/agent-store.mjs';

const defaults = () => ({ email: { onFailure: false, onSuccess: false }, sms: { onFailure: false, onSuccess: false } });
function valid(input) {
  return input && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).length === 2
    && ['email', 'sms'].every(channel => {
      const value = input[channel];
      return value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === 2
        && typeof value.onFailure === 'boolean' && typeof value.onSuccess === 'boolean';
    });
}

export function createNotificationPreferencesHandler({ authenticate = verifyCloudUser, storeFactory = () => getStore({ name: 'portabase-notification-preferences', consistency: 'strong' }) } = {}) {
  return async event => {
    if (!['GET', 'PUT'].includes(event.httpMethod)) return jsonResponse(405, { error: 'method_not_allowed' });
    let owner;
    try { owner = ownerKey(await authenticate(event)); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    let body;
    if (event.httpMethod === 'PUT') {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      if (Buffer.byteLength(raw) > 1024) return jsonResponse(413, { error: 'body_too_large' });
      try { body = JSON.parse(raw); } catch { return jsonResponse(400, { error: 'invalid_json' }); }
      if (!body || Object.keys(body).some(key => !['revision', 'preferences'].includes(key)) || !Number.isSafeInteger(body.revision) || body.revision < 0 || !valid(body.preferences)) return jsonResponse(400, { error: 'invalid_preferences' });
    }
    try {
      const store = storeFactory();
      const key = `owners/${owner}`;
      const current = await store.getWithMetadata(key, { type: 'json' });
      const record = current?.data;
      if (record && (record.owner !== owner || !valid(record.preferences))) throw new Error('invalid_stored_preferences');
      if (event.httpMethod === 'GET') return jsonResponse(200, { preferences: record?.preferences || defaults(), revision: record?.revision || 0, deliveryConfigured: false });
      if (body.revision !== (record?.revision || 0)) return jsonResponse(409, { error: 'preferences_changed_reload' });
      const next = { owner, preferences: body.preferences, revision: body.revision + 1, updatedAt: new Date().toISOString() };
      const saved = await store.setJSON(key, next, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
      if (!saved.modified) return jsonResponse(409, { error: 'preferences_changed_reload' });
      return jsonResponse(200, { preferences: next.preferences, revision: next.revision, deliveryConfigured: false });
    } catch { return jsonResponse(503, { error: 'notification_preferences_unavailable' }); }
  };
}
export const handler = createNotificationPreferencesHandler();
