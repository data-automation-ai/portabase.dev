import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { EXTRA_TRANSFERS_ADDON_ID } from '../shared/product.mjs';
import { deriveAccess, getSubscriptionByUserId } from '../shared/subscription-store.mjs';
import { reconcileSubscription } from '../shared/billing-entitlement.mjs';

export function createConfirmationHandler({ authenticate = verifyCloudUser, get = getSubscriptionByUserId, reconcile = reconcileSubscription } = {}) {
  return async event => {
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
    let user;
    try { user = await authenticate(event); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    let body;
    try {
      if (Buffer.byteLength(event.body || '') > 2048) return jsonResponse(413, { error: 'body_too_large' });
      body = JSON.parse(event.body || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    } catch { return jsonResponse(400, { error: 'invalid_json' }); }
    try {
      const record = await get(`${user.cloudVersion}:${user.id}`);
      if (!record) return jsonResponse(404, { error: 'no_checkout' });
      if (!record.checkoutAttempt || body.attempt !== record.checkoutAttempt) return jsonResponse(409, { error: 'attempt_mismatch' });
      // The caller cannot turn a normal checkout into an add-on purchase.
      const kind = record.pendingAddon === EXTRA_TRANSFERS_ADDON_ID ? 'addon' : 'base';
      const result = await reconcile(record, { kind });
      if (!result.verified) return jsonResponse(202, { ok: false, pending: true, message: 'Square has not confirmed this subscription yet.' });
      return jsonResponse(200, { ok: true, access: deriveAccess(result.record), subscription: result.record, cloudVersion: user.cloudVersion });
    } catch (error) {
      return jsonResponse(error.status === 409 ? 409 : 503, { error: error.status === 409 ? 'billing_state_changed' : 'billing_verification_unavailable' });
    }
  };
}
export const handler = createConfirmationHandler();
