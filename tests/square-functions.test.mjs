import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { WebhooksHelper } from 'square';
import { buildSquarePaymentLinkRequest, handler as checkoutHandler } from '../netlify/functions/create-square-checkout.mjs';
import { isPaidEssentialsOrder } from '../netlify/functions/square-order.mjs';
import { buildLicensePayload } from '../netlify/functions/issue-license.mjs';

test('legacy $147 checkout endpoint is retired (410)', async () => {
  assert.throws(() => buildSquarePaymentLinkRequest({}), /legacy_147_checkout_retired/);
  const res = await checkoutHandler({ httpMethod: 'POST', headers: {} });
  assert.equal(res.statusCode, 410);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'legacy_checkout_retired');
  assert.equal(body.priceMonthlyUsd, 17);
  assert.match(body.message, /open source/i);
});

test('legacy payment verification still recognizes historical $147 Essentials orders only', () => {
  const valid = {
    state: 'COMPLETED',
    line_items: [{
      name: 'Portabase Essentials — One-Platform Software License',
      quantity: '1',
      base_price_money: { amount: 14700, currency: 'USD' },
    }],
    total_money: { amount: 14700, currency: 'USD' },
  };
  assert.equal(isPaidEssentialsOrder(valid), true);
  assert.equal(isPaidEssentialsOrder({ ...valid, state: 'OPEN' }), false);
  assert.equal(isPaidEssentialsOrder({ ...valid, total_money: { amount: 100, currency: 'USD' } }), false);
});

test('legacy license fulfillment binds a paid order to one platform and lifetime updates', () => {
  const license = buildLicensePayload({ orderId: 'ORDER_12345678', platform: 'linux', issuedAt: '2026-07-13T00:00:00.000Z', licenseId: 'LICENSE_1' });
  assert.equal(license.platform, 'linux');
  assert.equal(license.projectAllowance, 1);
  assert.equal(license.updates, 'lifetime');
  assert.equal(license.orderId, 'ORDER_12345678');
});

test('Square webhook verification binds the raw body to the exact notification URL', async () => {
  const requestBody = '{"type":"payment.updated"}';
  const notificationUrl = 'https://portabase.dev/api/square/webhook';
  const signatureKey = 'test-signature-key';
  const signatureHeader = createHmac('sha256', signatureKey).update(notificationUrl + requestBody).digest('base64');
  assert.equal(await WebhooksHelper.verifySignature({ requestBody, signatureHeader, signatureKey, notificationUrl }), true);
  assert.equal(await WebhooksHelper.verifySignature({ requestBody, signatureHeader, signatureKey, notificationUrl: `${notificationUrl}/wrong` }), false);
});
