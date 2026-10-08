import { WebhooksHelper } from 'square';
import { getSubscriptionByUserId, getUserIdBySquareOrder, getUserIdBySquareSubscription } from '../shared/subscription-store.mjs';
import { reconcileSubscription } from '../shared/billing-entitlement.mjs';
import { squareFetch, resolvePortabaseSquareSecret } from '../shared/square-cloud.mjs';

export function createWebhookHandler({
  get = getSubscriptionByUserId, findOrder = getUserIdBySquareOrder, findSubscription = getUserIdBySquareSubscription,
  reconcile = reconcileSubscription, request = squareFetch,
  secret = () => resolvePortabaseSquareSecret('SQUARE_WEBHOOK_SIGNATURE_KEY', 'webhook_signature_key'),
  verifySignature = WebhooksHelper.verifySignature,
  notificationUrl = `${(process.env.PORTABASE_SITE_URL || process.env.URL || 'https://portabase.dev').replace(/\/$/, '')}/api/square/webhook`,
} = {}) {
  return async event => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    if (Buffer.byteLength(raw) > 256 * 1024) return { statusCode: 413, body: 'Payload too large' };
    try {
      const signatureKey = await secret();
      if (!signatureKey) throw new Error('missing_signature_key');
      const signatureHeader = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === 'x-square-hmacsha256-signature')?.[1] || '';
      if (!await verifySignature({ requestBody: raw, signatureHeader, signatureKey, notificationUrl })) return { statusCode: 403, body: 'Webhook rejected' };
    } catch { return { statusCode: 503, body: 'Webhook verification unavailable' }; }
    let message;
    try { message = JSON.parse(raw); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
    try {
      const object = message?.data?.object || {};
      let subscriptionId, orderId;
      if (message.type?.startsWith('subscription.')) subscriptionId = object.subscription?.id;
      else if (message.type?.startsWith('invoice.')) subscriptionId = object.invoice?.subscription_id;
      else if (message.type?.startsWith('payment.')) orderId = object.payment?.order_id;
      else if (message.type?.startsWith('order.')) orderId = object.order_updated?.order_id || object.order_fulfillment_updated?.order_id || object.order_created?.order_id;
      else if (['refund.created', 'refund.updated'].includes(message.type) && object.refund?.payment_id) {
        const { payment } = await request(`/v2/payments/${encodeURIComponent(object.refund.payment_id)}`);
        orderId = payment?.order_id;
      }
      const userId = subscriptionId ? await findSubscription(subscriptionId) : orderId ? await findOrder(orderId) : null;
      if (userId) {
        const record = await get(userId);
        if (!record) throw new Error('missing_billing_record');
        // Old checkout indexes remain reserved. Their events cannot change a
        // replacement checkout. Invoice/refund events always re-read current proof.
        const kind = (subscriptionId && subscriptionId === record.squareAddonSubscriptionId) || (orderId && orderId === record.squareAddonOrderId) ? 'addon' : 'base';
        const matches = subscriptionId
          ? subscriptionId === (kind === 'addon' ? record.squareAddonSubscriptionId : record.squareSubscriptionId)
          : orderId === (kind === 'addon' ? record.squareAddonOrderId : record.squareOrderId);
        if (matches) {
          const result = await reconcile(record, { kind });
          if (!result.verified) return { statusCode: 503, body: 'Billing verification pending' };
        }
      }
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    } catch { return { statusCode: 503, body: 'Billing processing unavailable' }; }
  };
}
export const handler = createWebhookHandler();
