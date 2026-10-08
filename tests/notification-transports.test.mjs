import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationTransport } from '../netlify/shared/notification-transports.mjs';
const twilio = { accountSid: `AC${'1'.repeat(32)}`, authToken: 'synthetic-secret', messagingServiceSid: `MG${'2'.repeat(32)}` };
const mailgun = { domain: 'mail.portabase.dev', from: 'alerts@mail.portabase.dev', apiKey: 'synthetic-secret' };
const sms = { channel: 'sms', to: '+12025550123', subject: 'Portabase: Backup finished', text: 'Your runner reported a finished backup.' };

test('provider acceptance remains distinct from delivery and uses fixed TLS endpoints', async () => {
  const calls = [];
  const send = createNotificationTransport({ twilio, mailgun, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => url.includes('twilio') ? { sid: `SM${'3'.repeat(32)}`, status: 'queued' } : { id: '<synthetic@mail.portabase.dev>' } };
  } });
  assert.equal((await send(sms)).status, 'accepted');
  assert.equal((await send({ ...sms, channel: 'email', to: 'customer@example.com' })).status, 'accepted');
  assert.equal(calls[0].init.body.get('To'), sms.to);
  assert.equal(calls[1].init.body.get('to'), 'customer@example.com');
  assert.ok(calls.every(c => c.url.startsWith('https://') && c.init.redirect === 'error'));
});
test('ambiguous timeout, server error and malformed success never automatically retry', async () => {
  for (const fetchImpl of [async () => { throw new Error('secret transport error'); }, async () => ({ ok: false, status: 500 }), async () => ({ ok: true, status: 200, json: async () => ({}) })]) {
    assert.deepEqual(await createNotificationTransport({ twilio, fetchImpl })(sms), { status: 'unknown' });
  }
  for (const status of [401, 429]) {
    assert.deepEqual(await createNotificationTransport({ twilio, fetchImpl: async () => ({ ok: false, status }) })(sms), { status: 'rejected', retryable: status === 429 });
  }
});
test('missing credentials and invalid recipients fail before any network request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error(); };
  assert.equal((await createNotificationTransport({ fetchImpl })(sms)).status, 'rejected');
  const send = createNotificationTransport({ twilio, mailgun, fetchImpl });
  for (const input of [{ ...sms, to: 'not-a-phone' }, { ...sms, channel: 'email', to: 'a@example.com,b@example.com' }, { ...sms, subject: 'hello\r\nBcc: attacker' }]) assert.equal((await send(input)).status, 'rejected');
  assert.equal(calls, 0);
});

test('direct SMS adapters refuse invalid callback destinations without a provider request', async () => {
  let calls = 0;
  for (const statusCallback of [null, '', 'https://attacker.example/receipt', 'https://portabase.dev/api/notifications/mailgun-receipt']) {
    const send = createNotificationTransport({ twilio: { ...twilio, statusCallback }, fetchImpl: async () => { calls++; throw new Error(); } });
    assert.deepEqual(await send(sms), { status: 'rejected', retryable: false });
  }
  assert.equal(calls, 0);
});
