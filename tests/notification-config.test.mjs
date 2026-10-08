import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNotificationTransport } from '../netlify/shared/notification-config.mjs';
import { findBundleValue } from '../netlify/shared/secrets.mjs';
import { createNotificationDestinationsHandler } from '../netlify/functions/cloud-notification-destinations.mjs';

const enabled = { PORTABASE_NOTIFICATION_SENDING_ENABLED: 'true', PORTABASE_NOTIFICATION_EMAIL_ENABLED: 'true', PORTABASE_NOTIFICATION_SMS_ENABLED: 'true' };
const values = { PORTABASE_MAILGUN_API_KEY: 'test-mail-key', PORTABASE_MAILGUN_DOMAIN: 'mail.portabase.dev', PORTABASE_MAILGUN_FROM: 'alerts@portabase.dev',
  PORTABASE_TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, PORTABASE_TWILIO_AUTH_TOKEN: 'test-sms-key', PORTABASE_TWILIO_MESSAGING_SERVICE_SID: `MG${'b'.repeat(32)}` };

test('sending needs explicit global and channel flags before any secret resolution', async () => {
  for (const env of [{}, { PORTABASE_NOTIFICATION_SENDING_ENABLED: 'true' }, { PORTABASE_NOTIFICATION_EMAIL_ENABLED: 'true' },
    { ...enabled, PORTABASE_NOTIFICATION_SENDING_ENABLED: true }, { ...enabled, PORTABASE_NOTIFICATION_EMAIL_ENABLED: 'false' }]) {
    let calls = 0;
    const result = await resolveNotificationTransport('email', { env, resolve: async () => { calls++; } });
    assert.deepEqual(result, { available: false, reason: 'disabled' });
    assert.equal(calls, 0);
  }
});

test('lookup uses only Portabase-scoped names and selectors, with no provider call while resolving config', async () => {
  for (const channel of ['email', 'sms']) {
    const lookups = []; let requests = 0;
    const result = await resolveNotificationTransport(channel, { env: enabled, resolve: async (name, selector) => { lookups.push({ name, selector }); return values[name]; },
      fetchImpl: async () => { requests++; throw new Error('must not contact provider'); } });
    assert.equal(result.available, true); assert.equal(requests, 0);
    assert.equal(lookups.length, 3);
    assert.ok(lookups.every(row => row.name.startsWith(channel === 'email' ? 'PORTABASE_MAILGUN_' : 'PORTABASE_TWILIO_')));
    assert.ok(lookups.every(row => row.selector.service === (channel === 'email' ? 'portabase-mailgun' : 'portabase-twilio')));
    assert.equal(JSON.stringify(result).includes('test-mail-key'), false);
    assert.equal(JSON.stringify(result).includes('test-sms-key'), false);
    assert.deepEqual(await result.transport({ channel: channel === 'email' ? 'sms' : 'email' }), { status: 'rejected', retryable: false });
  }
});

test('generic or sibling bundle credentials cannot satisfy a Portabase selector; stale records are excluded', () => {
  const selection = { service: 'portabase-mailgun', key: 'api_key', envName: 'PORTABASE_MAILGUN_API_KEY' };
  const otherProducts = [
    { service: 'mailgun', key: 'api_key', value: 'generic' },
    { service: 'musicsupplies-mailgun', key: 'api_key', value: 'sibling' },
    { MAILGUN_API_KEY: 'generic-flat' },
  ];
  assert.equal(findBundleValue(otherProducts, selection), null);
  for (const metadata of [{ disabled: true }, { stale: true }, { active: false }, { expires_at: '2026-10-01' }, { not_after: '2026-10-01' }, { rotates_at: '2026-10-01' }, { expires_at: 'invalid' }]) {
    const now = Date.parse('2026-10-05T00:00:00Z');
    assert.equal(findBundleValue([{ service: 'portabase-mailgun', key: 'api_key', value: 'expired', ...metadata }], selection, now), null);
    assert.equal(findBundleValue({ ...metadata, PORTABASE_MAILGUN_API_KEY: 'expired-nested' }, selection, now), null);
  }
  assert.equal(findBundleValue([{ service: 'portabase-mailgun', key: 'api_key', value: 'valid', expires_at: '2026-11-01' }], selection, Date.parse('2026-10-05')), 'valid');
});

test('missing and malformed config stays unavailable without exposing secret/error values', async () => {
  const missing = await resolveNotificationTransport('email', { env: enabled, resolve: async () => { throw new Error('private credential error'); } });
  assert.deepEqual(missing, { available: false, reason: 'configuration_missing' });
  for (const invalid of [{ PORTABASE_MAILGUN_FROM: 'bad\nheader' }, { PORTABASE_MAILGUN_DOMAIN: '../../wrong' }, { PORTABASE_MAILGUN_API_KEY: '' }]) {
    const result = await resolveNotificationTransport('email', { env: enabled, resolve: async name => ({ ...values, ...invalid })[name] });
    assert.deepEqual(result, { available: false, reason: 'invalid_configuration' });
  }
  assert.equal((await resolveNotificationTransport('email', { env: { ...enabled, PORTABASE_MAILGUN_REGION: 'wrong' }, resolve: async name => values[name] })).available, false);
  assert.equal((await resolveNotificationTransport('sms', { env: enabled, resolve: async name => name === 'PORTABASE_TWILIO_ACCOUNT_SID' ? 'foreign-format' : values[name] })).available, false);
});

test('configured transport uses stubbed network and reports acceptance, never delivery', async () => {
  const requests = [];
  const configuration = await resolveNotificationTransport('email', { env: { ...enabled, PORTABASE_MAILGUN_REGION: 'eu' }, resolve: async name => values[name],
    fetchImpl: async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify({ id: '<test@mail.portabase.dev>' }), { status: 200 }); } });
  const result = await configuration.transport({ channel: 'email', to: 'customer@example.com', subject: 'Verification', text: 'Test code only' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.eu.mailgun.net/v3/mail.portabase.dev/messages');
  assert.deepEqual(result, { status: 'accepted', providerId: '<test@mail.portabase.dev>' });
});

test('default API checks configuration before reserving a challenge; reads and revoke do not need sending enabled', async () => {
  let reservations = 0, configChecks = 0;
  const handler = createNotificationDestinationsHandler({ authenticate: async () => ({ id: 'a', cloudVersion: 'supabase', email: 'a@example.com' }),
    resolveTransport: async () => { configChecks++; return { available: false, reason: 'disabled' }; },
    serviceFactory: () => ({ list: async () => ({}), revoke: async () => ({ verified: false }), request: async () => { reservations++; } }) });
  assert.equal((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'request', channel: 'email' }) })).statusCode, 503);
  assert.equal(reservations, 0); assert.equal(configChecks, 1);
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 200);
  assert.equal((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'revoke', channel: 'email' }) })).statusCode, 200);
  assert.equal(configChecks, 1);
});

test('API injects only the resolved transport into a request-specific challenge service', async () => {
  const send = async () => ({ status: 'accepted', providerId: 'test' });
  let selected;
  const handler = createNotificationDestinationsHandler({ authenticate: async () => ({ id: 'a', cloudVersion: 'supabase' }),
    resolveTransport: async channel => { assert.equal(channel, 'sms'); return { available: true, transport: send }; },
    serviceFactory: options => ({ request: async (_user, channel, phone) => { selected = options.sendChallenge; assert.equal(channel, 'sms'); assert.equal(phone, '+12025550123'); return { deliveryStatus: 'accepted' }; } }) });
  const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'request', channel: 'sms', phone: '+12025550123' }) });
  assert.equal(result.statusCode, 202); assert.equal(selected, send);
});

test('receipt callbacks reject missing, foreign or noncanonical routes before secret reads', async () => {
  for (const [channel, provider, name] of [['sms', 'twilio', 'PORTABASE_TWILIO_STATUS_CALLBACK_URL'], ['email', 'mailgun', 'PORTABASE_MAILGUN_WEBHOOK_URL']]) {
    const path = `/api/notifications/${provider}-receipt`;
    for (const url of [undefined, `http://portabase.dev${path}`, `https://other.example${path}`, 'https://portabase.dev/wrong',
      `https://portabase.dev:444${path}`, `https://user@portabase.dev${path}`, `https://portabase.dev${path}#fragment`, ` https://portabase.dev${path}`]) {
      let lookups = 0;
      const result = await resolveNotificationTransport(channel, { env: { ...enabled, PORTABASE_NOTIFICATION_RECEIPTS_ENABLED: 'true', [name]: url },
        resolve: async () => { lookups++; throw new Error(); } });
      assert.deepEqual(result, { available: false, reason: 'invalid_configuration' });
      assert.equal(lookups, 0);
    }
  }
});

test('Twilio callback configuration preserves exact signed URL bytes and stays absent when disabled', async () => {
  const url = 'https://portabase.dev:443/api/notifications/twilio-receipt?b=2&a=1';
  for (const receiptFlag of ['true', 'false', undefined]) {
    let submitted;
    const config = await resolveNotificationTransport('sms', { env: { ...enabled, PORTABASE_NOTIFICATION_RECEIPTS_ENABLED: receiptFlag, PORTABASE_TWILIO_STATUS_CALLBACK_URL: url },
      resolve: async name => values[name], fetchImpl: async (_url, options) => {
        submitted = options.body;
        return new Response(JSON.stringify({ sid: `SM${'a'.repeat(32)}`, status: 'queued' }), { status: 201 });
      } });
    assert.equal(config.available, true);
    assert.equal((await config.transport({ channel: 'sms', to: '+12025550123', subject: 'Verification', text: 'Test code only' })).status, 'accepted');
    assert.equal(submitted.get('StatusCallback'), receiptFlag === 'true' ? url : null);
  }
});

test('Mailgun receipts require product webhook signing key in addition to send configuration', async () => {
  const env = { ...enabled, PORTABASE_NOTIFICATION_RECEIPTS_ENABLED: 'true', PORTABASE_MAILGUN_WEBHOOK_URL: 'https://portabase.dev/api/notifications/mailgun-receipt' };
  for (const signingKey of [undefined, 'bad\nkey', 'test-signing-key']) {
    let selected;
    const result = await resolveNotificationTransport('email', { env, resolve: async (name, selector) => {
      if (name === 'PORTABASE_MAILGUN_WEBHOOK_SIGNING_KEY') { selected = selector; return signingKey; }
      return values[name];
    } });
    assert.deepEqual(selected, { service: 'portabase-mailgun', key: 'webhook_signing_key' });
    assert.equal(result.available, signingKey === 'test-signing-key');
  }
});
