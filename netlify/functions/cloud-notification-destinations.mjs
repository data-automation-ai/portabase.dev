import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { createNotificationDestinationService } from '../shared/notification-destinations.mjs';
import { resolveNotificationTransport } from '../shared/notification-config.mjs';

export function createNotificationDestinationsHandler({ authenticate = verifyCloudUser, service = null,
  serviceFactory = createNotificationDestinationService, resolveTransport = resolveNotificationTransport } = {}) {
  return async event => {
    if (!['GET', 'POST'].includes(event.httpMethod)) return jsonResponse(405, { error: 'method_not_allowed' });
    let user;
    try { user = await authenticate(event); if (user.cloudVersion !== 'supabase') throw new Error(); }
    catch { return jsonResponse(401, { error: 'unauthorized' }); }
    try {
      const destinationService = service || serviceFactory();
      if (event.httpMethod === 'GET') return jsonResponse(200, { destinations: await destinationService.list(user) });
      let body;
      try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
        if (Buffer.byteLength(raw) > 1024) return jsonResponse(413, { error: 'body_too_large' });
        body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      } catch { return jsonResponse(400, { error: 'invalid_json' }); }
      const fields = body.action === 'request' ? ['action', 'channel', ...(body.channel === 'sms' ? ['phone'] : [])]
        : body.action === 'verify' ? ['action', 'channel', 'challengeId', 'code'] : ['action', 'channel'];
      if (!['email', 'sms'].includes(body.channel) || Object.keys(body).some(key => !fields.includes(key))) return jsonResponse(400, { error: 'invalid_request' });
      if (body.action === 'request') {
        if (body.channel === 'sms' && (typeof body.phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(body.phone))) return jsonResponse(400, { error: 'invalid_phone' });
        let senderService = service;
        if (!senderService) {
          const configuration = await resolveTransport(body.channel);
          if (!configuration.available) return jsonResponse(503, { error: 'verification_delivery_unconfigured' });
          senderService = serviceFactory({ sendChallenge: configuration.transport });
        }
        const result = await senderService.request(user, body.channel, body.phone);
        return jsonResponse(result.deliveryStatus === 'accepted' ? 202 : 503, result);
      }
      if (body.action === 'verify') return jsonResponse(200, { destination: await destinationService.verify(user, body.channel, body.challengeId, body.code) });
      if (body.action === 'revoke') return jsonResponse(200, { destination: await destinationService.revoke(user, body.channel) });
      return jsonResponse(400, { error: 'invalid_action' });
    } catch (error) {
      return jsonResponse(error.status || 503, { error: error.code || 'notification_destination_unavailable' });
    }
  };
}
// Sending requires explicit global/channel enable flags and product-specific
// provider configuration. Missing configuration fails before a reservation.
export const handler = createNotificationDestinationsHandler();
