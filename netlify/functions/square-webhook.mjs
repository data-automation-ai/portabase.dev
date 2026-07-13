import { WebhooksHelper } from 'square';
import { resolveServerSecret } from '../shared/secrets.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { Allow: 'POST' }, body: 'Method not allowed' };
  try {
    const signatureKey = await resolveServerSecret('SQUARE_WEBHOOK_SIGNATURE_KEY', { service: 'square', key: 'webhook_signature_key' });
    const siteUrl = (process.env.PORTABASE_SITE_URL || process.env.URL || 'https://portabase.dev').replace(/\/$/, '');
    const notificationUrl = `${siteUrl}/api/square/webhook`;
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    const valid = await WebhooksHelper.verifySignature({ requestBody: body, signatureHeader: event.headers['x-square-hmacsha256-signature'] || '', signatureKey, notificationUrl });
    if (!valid) return { statusCode: 403, body: 'Webhook rejected' };
    const squareEvent = JSON.parse(body);
    if (['payment.created', 'payment.updated'].includes(squareEvent.type)) {
      const payment = squareEvent.data?.object?.payment;
      if (payment?.status === 'COMPLETED') console.log(`square_fulfillment=payment_confirmed order=${payment.order_id || 'unknown'}`);
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
  } catch {
    console.error('square_webhook_error=signature_or_configuration');
    return { statusCode: 400, body: 'Webhook rejected' };
  }
}
