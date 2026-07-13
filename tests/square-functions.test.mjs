import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { WebhooksHelper } from 'square';
import { buildSquarePaymentLinkRequest } from '../netlify/functions/create-square-checkout.mjs';
import { isPaidEssentialsOrder } from '../netlify/functions/square-order.mjs';

test('Square payment link is exactly one non-recurring $147 USD license', () => {
  const request = buildSquarePaymentLinkRequest({ locationId: 'LOCATION', attempt: 'ATTEMPT', siteUrl: 'https://portabase.dev' });
  assert.equal(request.order.line_items.length, 1);
  assert.deepEqual(request.order.line_items[0], { name: 'PortaBase Essentials — One-Platform Software License', quantity: '1', base_price_money: { amount: 14700, currency: 'USD' } });
  assert.match(request.description, /Windows, macOS, or Linux/);
  assert.equal(request.checkout_options.redirect_url, 'https://portabase.dev/thanks');
  assert.equal(request.checkout_options.allow_tipping, false);
});

test('payment verification rejects incomplete or price-altered orders', () => {
  const valid = { state: 'COMPLETED', line_items: [{ name: 'PortaBase Essentials — One-Platform Software License', quantity: '1', base_price_money: { amount: 14700, currency: 'USD' } }], total_money: { amount: 14700, currency: 'USD' } };
  assert.equal(isPaidEssentialsOrder(valid), true);
  assert.equal(isPaidEssentialsOrder({ ...valid, state: 'OPEN' }), false);
  assert.equal(isPaidEssentialsOrder({ ...valid, total_money: { amount: 100, currency: 'USD' } }), false);
});

test('Square webhook verification binds the raw body to the exact notification URL', async () => {
  const requestBody = '{"type":"payment.updated"}';
  const notificationUrl = 'https://portabase.dev/api/square/webhook';
  const signatureKey = 'test-signature-key';
  const signatureHeader = createHmac('sha256', signatureKey).update(notificationUrl + requestBody).digest('base64');
  assert.equal(await WebhooksHelper.verifySignature({ requestBody, signatureHeader, signatureKey, notificationUrl }), true);
  assert.equal(await WebhooksHelper.verifySignature({ requestBody, signatureHeader, signatureKey, notificationUrl: `${notificationUrl}/wrong` }), false);
});
