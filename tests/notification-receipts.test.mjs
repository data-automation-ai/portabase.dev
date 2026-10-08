import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { reserveReceiptIndex, reserveVerificationReceiptIndex, applyDeliveryReceipt, providerReceiptIndexKey } from '../netlify/shared/notification-receipt-store.mjs';
import { createTwilioReceiptHandler, createMailgunReceiptHandler, lookupMailgunReceipt, resolveReceiptConfiguration } from '../netlify/shared/notification-receipts.mjs';

const now = Date.parse('2026-10-05T12:00:00Z');
const owner = 'a'.repeat(64), eventId = 'b'.repeat(64), foreign = 'c'.repeat(64);
const sid = `SM${'a'.repeat(32)}`, accountSid = `AC${'b'.repeat(32)}`;
const twilio = { url: 'https://portabase.dev/api/notifications/twilio?version=1', accountSid, authToken: 'test-auth-token' };
const mailgun = { url: 'https://portabase.dev/api/notifications/mailgun', signingKey: 'test-signing-key', apiKey: 'fake-api-key', domain: 'mail.portabase.dev', region: 'us' };
const emailId = 'message@mail.portabase.dev';
function fixture() {
  const rows = new Map(); let etag = 0;
  const store = {
    async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
    async setJSON(key, data, options = {}) {
      const current = rows.get(key);
      if ((options.onlyIfNew && current) || (options.onlyIfMatch && options.onlyIfMatch !== current?.etag)) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++etag) }); return { modified: true };
    },
  };
  const key = channel => `owners/${owner}/outbox/${eventId}/${channel}`;
  async function seed(channel, providerId) {
    const reference = { owner, eventId, channel };
    await store.setJSON(key(channel), { ...reference, state: 'accepted', providerId });
    await reserveReceiptIndex(store, reference, providerId);
  }
  return { rows, store, key, seed };
}
function smsEvent(status = 'delivered', extras = {}, url = twilio.url) {
  const fields = { AccountSid: accountSid, MessageSid: sid, MessageStatus: status, To: '+12025550123', ErrorMessage: 'private provider error', ...extras };
  const input = Object.keys(fields).sort().reduce((text, key) => text + key + fields[key], url);
  return { httpMethod: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
    'X-Twilio-Signature': createHmac('sha1', twilio.authToken).update(input).digest('base64') }, body: new URLSearchParams(fields).toString() };
}
function mailEvent(event = 'delivered', extras = {}) {
  const signature = { timestamp: String(now / 1000), token: 'a'.repeat(50) };
  signature.signature = createHmac('sha256', mailgun.signingKey).update(signature.timestamp + signature.token).digest('hex');
  const data = { id: 'event-1', event, timestamp: now / 1000, message: { headers: { 'message-id': emailId } }, recipient: 'private@example.com', ...extras };
  return { httpMethod: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature, 'event-data': data }) };
}
const mailProof = (event = 'delivered', extra = {}) => ({ id: 'event-1', event, timestamp: now / 1000,
  message: { headers: { 'message-id': emailId } }, ...extra });

test('Twilio requires signature over configured exact URL/all form fields and correct product account', async () => {
  const { store, seed, rows, key } = fixture(); await seed('sms', sid);
  const handler = createTwilioReceiptHandler({ configuration: async () => twilio, store: () => store, clock: () => now });
  assert.equal((await handler(smsEvent('delivered', {}, twilio.url + '/wrong'))).statusCode, 403);
  assert.equal((await handler(smsEvent('delivered', { AccountSid: `AC${'c'.repeat(32)}` }))).statusCode, 403);
  const changed = smsEvent(); changed.body += '&NewField=unsigned';
  assert.equal((await handler(changed)).statusCode, 403);
  const duplicate = smsEvent(); duplicate.body += '&MessageStatus=sent';
  assert.equal((await handler(duplicate)).statusCode, 403);
  const unicode = smsEvent(); unicode.headers['X-Twilio-Signature'] = 'あ'.repeat(28);
  assert.equal((await handler(unicode)).statusCode, 403);
  assert.equal((await handler(smsEvent('constructor'))).statusCode, 400);
  const correct = await handler(smsEvent('delivered', { AdditionalFutureField: 'supported' }));
  assert.equal(correct.statusCode, 200); assert.equal(rows.get(key('sms')).data.deliveryStatus, 'delivered');
  const stored = JSON.stringify([...rows.values()]);
  assert.equal(stored.includes('+12025550123'), false); assert.equal(stored.includes('private provider error'), false);
});

test('Twilio retries are idempotent and out-of-order progress cannot overwrite terminal evidence', async () => {
  const { store, seed, rows, key } = fixture(); await seed('sms', sid);
  const handler = createTwilioReceiptHandler({ configuration: async () => twilio, store: () => store, clock: () => now });
  for (const state of ['sent', 'delivered', 'queued', 'sent', 'delivered']) assert.equal((await handler(smsEvent(state))).statusCode, 200);
  assert.equal(rows.get(key('sms')).data.deliveryStatus, 'delivered');
  assert.equal(rows.get(key('sms')).data.receiptHashes.length, 3);
  await handler(smsEvent('undelivered'));
  assert.equal(rows.get(key('sms')).data.deliveryStatus, 'conflicted');
  assert.ok(rows.get(key('sms')).data.providerDeliveredAt); assert.ok(rows.get(key('sms')).data.providerFailedAt);
});

test('provider index is exclusive and callback owner/recipient fields cannot redirect an update', async () => {
  const { store, seed, rows, key } = fixture(); await seed('sms', sid);
  await assert.rejects(reserveReceiptIndex(store, { owner: foreign, eventId, channel: 'sms' }, sid), /already_bound/);
  const handler = createTwilioReceiptHandler({ configuration: async () => twilio, store: () => store, clock: () => now });
  assert.equal((await handler(smsEvent('delivered', { owner: foreign, To: '+12025550199' }))).statusCode, 200);
  assert.equal(rows.get(key('sms')).data.owner, owner);
  assert.equal([...rows.keys()].some(value => value.startsWith(`owners/${foreign}/`)), false);
});

test('unmapped early callbacks are retryable and never manufacture a delivery record', async () => {
  const { store, rows } = fixture();
  const handler = createTwilioReceiptHandler({ configuration: async () => twilio, store: () => store, clock: () => now });
  assert.equal((await handler(smsEvent())).statusCode, 503); assert.equal(rows.size, 0);
});

test('known challenge receipts acknowledge authenticated callbacks without verifying contacts or manufacturing alerts', async () => {
  const { store, rows } = fixture();
  const reference = { owner, channel: 'sms', challengeId: '11111111-1111-1111-1111-111111111111' };
  await reserveVerificationReceiptIndex(store, reference, sid);
  const handler = createTwilioReceiptHandler({ configuration: async () => twilio, store: () => store, clock: () => now });
  for (const state of ['delivered', 'sent', 'delivered', 'failed']) {
    const response = await handler(smsEvent(state));
    assert.equal(response.statusCode, 200); assert.equal(JSON.parse(response.body).applied, false);
  }
  const badSignature = smsEvent(); badSignature.headers['X-Twilio-Signature'] = 'invalid';
  assert.equal((await handler(badSignature)).statusCode, 403);
  assert.equal(rows.size, 1); assert.ok([...rows.keys()][0].startsWith('provider-index/'));
  assert.equal(JSON.stringify([...rows.values()]).includes('+12025550123'), false);
  await assert.rejects(reserveReceiptIndex(store, { owner, eventId, channel: 'sms' }, sid), /already_bound/);
  await assert.rejects(reserveVerificationReceiptIndex(store, { ...reference, owner: foreign }, sid), /already_bound/);
  await assert.rejects(reserveVerificationReceiptIndex(store, { ...reference, challengeId: '22222222-2222-2222-2222-222222222222' }, sid), /already_bound/);
  await reserveVerificationReceiptIndex(store, reference, sid);
});

test('Mailgun challenge callbacks still need provider event proof and never write alert history', async () => {
  const { store, rows } = fixture();
  await reserveVerificationReceiptIndex(store, { owner, channel: 'email', challengeId: '11111111-1111-1111-1111-111111111111' }, emailId);
  let proof = null;
  const handler = createMailgunReceiptHandler({ configuration: async () => mailgun, store: () => store, clock: () => now, lookup: async () => proof });
  assert.equal((await handler(mailEvent())).statusCode, 503);
  proof = mailProof();
  const response = await handler(mailEvent());
  assert.equal(response.statusCode, 200); assert.equal(JSON.parse(response.body).applied, false);
  assert.ok([...rows.keys()].every(key => !key.startsWith('owners/')));
});

test('Mailgun authenticates signature but only provider lookup can establish body facts', async () => {
  const { store, seed, rows, key } = fixture(); await seed('email', `<${emailId}>`);
  let proof = mailProof('accepted');
  const handler = createMailgunReceiptHandler({ configuration: async () => mailgun, store: () => store, clock: () => now, lookup: async () => proof });
  const tampered = mailEvent('delivered', { owner: foreign, recipient: 'attacker@example.com' });
  assert.equal((await handler(tampered)).statusCode, 200);
  assert.equal(rows.get(key('email')).data.deliveryStatus, 'accepted');
  assert.equal(rows.get(key('email')).data.providerDeliveredAt, undefined);
  const invalidSignature = JSON.parse(tampered.body); invalidSignature.signature.signature = '0'.repeat(64);
  assert.equal((await handler({ ...tampered, body: JSON.stringify(invalidSignature) })).statusCode, 403);
  assert.equal(JSON.stringify([...rows.values()]).includes('attacker@example.com'), false);
});

test('Mailgun expired signatures, token reuse across events, mismatched proof and test mode cannot claim delivered', async () => {
  const { store, seed, rows, key } = fixture(); await seed('email', emailId);
  let proof = mailProof('delivered', { flags: { 'is-test-mode': true } });
  const handler = createMailgunReceiptHandler({ configuration: async () => mailgun, store: () => store, clock: () => now, lookup: async () => proof });
  assert.equal((await handler(mailEvent())).statusCode, 200); assert.equal(rows.get(key('email')).data.deliveryStatus, undefined);
  proof = mailProof('delivered', { id: 'wrong-event' }); assert.equal((await handler(mailEvent())).statusCode, 503);
  proof = mailProof('delivered'); assert.equal((await handler(mailEvent())).statusCode, 200);
  assert.equal((await handler(mailEvent('delivered', { id: 'different-event' }))).statusCode, 403);
  const expired = createMailgunReceiptHandler({ configuration: async () => mailgun, store: () => store, clock: () => now + 86_400_001 });
  assert.equal((await expired(mailEvent())).statusCode, 403);
});

test('Mailgun temporary failure is not permanent failure and actual provider event controls the outcome', async () => {
  const { store, seed, rows, key } = fixture(); await seed('email', emailId);
  let proof = mailProof('failed', { severity: 'temporary' });
  const handler = createMailgunReceiptHandler({ configuration: async () => mailgun, store: () => store, clock: () => now, lookup: async () => proof });
  await handler(mailEvent()); assert.equal(rows.get(key('email')).data.deliveryStatus, undefined);
  proof = mailProof('failed', { severity: 'permanent' }); await handler(mailEvent());
  assert.equal(rows.get(key('email')).data.deliveryStatus, 'failed');
});

test('Mailgun lookup uses fixed TLS provider endpoint, product domain, exact message/event IDs and no callback URL', async () => {
  const requests = [];
  const result = await lookupMailgunReceipt(mailgun, { providerId: `<${emailId}>`, eventId: 'event-1' }, async (url, options) => {
    requests.push({ url, options }); return new Response(JSON.stringify({ items: [mailProof()] }), { status: 200 });
  });
  assert.equal(result.id, 'event-1');
  assert.equal(new URL(requests[0].url).origin, 'https://api.mailgun.net');
  assert.equal(new URL(requests[0].url).searchParams.get('message-id'), emailId);
  assert.equal(requests[0].options.redirect, 'error');
});

test('receipt CAS preserves simultaneous facts and provider acceptance state', async () => {
  const { store, seed, rows, key } = fixture(); await seed('sms', sid);
  const receipts = ['sent', 'delivered', 'accepted'].map(status => ({ channel: 'sms', providerId: sid, status, receiptId: status, occurredAt: new Date(now).toISOString() }));
  await Promise.all(receipts.map(receipt => applyDeliveryReceipt(store, receipt, now)));
  assert.equal(rows.get(key('sms')).data.state, 'accepted'); assert.equal(rows.get(key('sms')).data.deliveryStatus, 'delivered');
  assert.equal(rows.get(key('sms')).data.receiptHashes.length, 3);
});

test('receipt configuration stays off by default and uses product-scoped secrets only', async () => {
  let calls = 0;
  assert.equal(await resolveReceiptConfiguration('twilio', { env: {}, resolve: async () => { calls++; } }), null);
  assert.equal(calls, 0);
  const names = [];
  const config = await resolveReceiptConfiguration('twilio', { env: { PORTABASE_NOTIFICATION_RECEIPTS_ENABLED: 'true', PORTABASE_TWILIO_STATUS_CALLBACK_URL: twilio.url },
    resolve: async (name, selector) => { names.push(name); assert.equal(selector.service, 'portabase-twilio'); return name.endsWith('ACCOUNT_SID') ? accountSid : 'test-token'; } });
  assert.equal(config.url, twilio.url); assert.ok(names.every(name => name.startsWith('PORTABASE_TWILIO_')));
  const explicitPortUrl = 'https://portabase.dev:443/api/notifications/twilio?z=2&a=1';
  const explicitPort = await resolveReceiptConfiguration('twilio', { env: { PORTABASE_NOTIFICATION_RECEIPTS_ENABLED: 'true', PORTABASE_TWILIO_STATUS_CALLBACK_URL: explicitPortUrl },
    resolve: async name => name.endsWith('ACCOUNT_SID') ? accountSid : 'test-token' });
  assert.equal(explicitPort.url, explicitPortUrl);
});

test('store failure returns retryable error instead of false receipt success', async () => {
  const handler = createTwilioReceiptHandler({ configuration: async () => twilio, store: () => ({ getWithMetadata: async () => { throw new Error('private-error'); } }) });
  const response = await handler(smsEvent()); assert.equal(response.statusCode, 503); assert.equal(response.body.includes('private-error'), false);
});
