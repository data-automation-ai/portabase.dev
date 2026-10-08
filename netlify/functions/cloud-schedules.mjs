import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { createManagedSchedules } from '../shared/managed-schedules.mjs';
export function createSchedulesHandler({ authenticate = verifyCloudUser, service = createManagedSchedules() } = {}) {
  return async event => {
    if (!['GET', 'PUT', 'PATCH', 'DELETE'].includes(event.httpMethod)) return jsonResponse(405, { error: 'method_not_allowed' });
    let user;
    try { user = await authenticate(event); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    let body;
    if (event.httpMethod !== 'GET') {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      if (Buffer.byteLength(raw) > 4096) return jsonResponse(413, { error: 'body_too_large' });
      try { body = JSON.parse(raw); } catch { return jsonResponse(400, { error: 'invalid_json' }); }
    }
    try {
      const method = { GET: 'read', PUT: 'save', PATCH: 'disable', DELETE: 'remove' }[event.httpMethod];
      return jsonResponse(200, await service[method](user, body));
    } catch (error) {
      const codes = ['unauthorized', 'invalid_schedule', 'schedule_changed', 'schedule_limit', 'runner_schedule_exists', 'runner_not_authorized', 'subscription_required', 'cadence_not_allowed'];
      return jsonResponse(codes.includes(error.code) ? error.status : 503, { error: codes.includes(error.code) ? error.code : 'schedule_service_unavailable' });
    }
  };
}
export const handler = createSchedulesHandler();
