import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { createNotificationDestinationService } from '../netlify/shared/notification-destinations.mjs';
import { createNotificationDestinationsHandler } from '../netlify/functions/cloud-notification-destinations.mjs';
import { createNotificationPreferencesHandler } from '../netlify/functions/cloud-notification-preferences.mjs';

// Real UI, API helpers, handlers and destination service. In-memory stores and
// a captured-message transport substitute for providers; nothing is delivered.
const user = { id: 'contact-ui-fixture', cloudVersion: 'supabase', email: 'contact-fixture@example.test' };
const rows = new Map();
let etag = 0;
const store = {
  async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
  async setJSON(key, data, options = {}) {
    const previous = rows.get(key);
    if ((options.onlyIfNew && previous) || (options.onlyIfMatch && previous?.etag !== options.onlyIfMatch)) return { modified: false };
    rows.set(key, { data: structuredClone(data), etag: String(++etag) });
    return { modified: true };
  },
};
let now = Date.now();
let configured = false;
let outcome = 'accepted';
const messages = [];
const options = { store, clock: () => now };
const unconfigured = createNotificationDestinationService(options);
const service = createNotificationDestinationService({ ...options, sendChallenge: async message => { messages.push(message); return { status: outcome }; } });
const authenticate = async event => { if (!event.headers.authorization?.startsWith('Bearer fixture.')) throw new Error('unauthorized'); return user; };
const destinationHandler = createNotificationDestinationsHandler({ authenticate, service: { ...service,
  request: (...args) => (configured ? service : unconfigured).request(...args),
} });
const preferencesHandler = createNotificationPreferencesHandler({ authenticate, storeFactory: () => store });
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { NotificationPreferences } from '/src/console/notification-preferences.jsx';
  import '/src/console/console.css';
  const token = 'fixture.' + btoa(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600 })) + '.fixture';
  localStorage.setItem('portabase.auth.v1', JSON.stringify({ provider:'supabase', cloudVersion:'supabase', accessToken:token, user:{id:'contact-ui-fixture'} }));
  createRoot(document.getElementById('root')).render(React.createElement(NotificationPreferences));
`;
const compiled = await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'contact-ui-fixture',
    resolveId(id) { if (id.endsWith('virtual:contact-fixture')) return '\0contact-fixture'; },
    load(id) { if (id === '\0contact-fixture') return fixture; },
  }], build: { write: false, minify: false, lib: { entry: 'virtual:contact-fixture', formats: ['iife'], name: 'ContactFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(item => item.output);
const bundle = output.find(item => item.type === 'chunk' && item.isEntry).code;
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  const requests = [];
  let failList = true;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div class="pb-console"><main class="pb-main"><div class="pb-body" id="root"></div></main></div></body></html>' });
    const event = { httpMethod: request.method(), headers: request.headers(), body: request.postData() || '' };
    requests.push({ path, method: event.httpMethod, body: request.postDataJSON() });
    let response;
    if (path === '/api/cloud/notification-destinations') {
      if (event.httpMethod === 'GET' && failList) { failList = false; response = { statusCode: 503, body: JSON.stringify({ error: 'fixture_temporarily_unavailable' }) }; }
      else response = await destinationHandler(event);
    } else if (path === '/api/cloud/notification-preferences') response = await preferencesHandler(event);
    else if (path === '/api/cloud/notification-history') response = { statusCode: 200, body: JSON.stringify({ deliveries: [], truncated: false }) };
    else response = { statusCode: 500, body: JSON.stringify({ error: 'unexpected_fixture_request' }) };
    return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
  });
  async function mount() {
    await page.goto('https://portabase.fixture.test/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
  }
  const contact = channel => page.getByRole('article', { name: `${channel} contact`, exact: true });
  const lastCode = () => messages.at(-1).text.match(/\b\d{8}\b/)[0];
  async function enterCode(channel, code = lastCode()) {
    await contact(channel).getByLabel(`${channel} verification code`, { exact: true }).fill(code);
    await contact(channel).getByRole('button', { name: `Verify ${channel} contact`, exact: true }).click();
  }
  async function expectVerified(channel) { await contact(channel).getByText('Verified contact', { exact: true }).waitFor(); }
  await mount();
  await page.getByRole('button', { name: 'Refresh contact status', exact: true }).click();
  await contact('Email').getByText('Not verified', { exact: true }).waitFor();
  assert.equal(await contact('Email').getByRole('textbox').count(), 0);
  await contact('Email').getByRole('button', { name: 'Request Email code', exact: true }).click();
  await contact('Email').getByText('Verification delivery is not configured. No verification message was sent. You can retry when the service is connected.', { exact: true }).waitFor();
  assert.equal(messages.length, 0);
  assert.equal(await contact('Email').getByLabel('Email verification code').count(), 0);
  configured = true;
  await contact('Email').getByRole('button', { name: 'Request Email code', exact: true }).click();
  await contact('Email').getByText('Verification request accepted by the provider. Delivery is not yet confirmed.', { exact: true }).waitFor();
  assert.equal(messages.at(-1).to, user.email);
  assert.equal(await contact('Email').getByLabel('Verification request ID').inputValue(), [...rows.values()].find(row => row.data.channel === 'email').data.challenge.id);
  const correct = lastCode();
  await enterCode('Email', correct === '00000000' ? '11111111' : '00000000');
  await contact('Email').getByText('That verification code is incorrect. Try the eight-digit code from this request.', { exact: true }).waitFor();
  assert.equal(await contact('Email').getByLabel('Email verification code').inputValue(), '');
  await enterCode('Email', correct);
  await expectVerified('Email');
  await contact('Email').getByRole('button', { name: 'Revoke Email contact', exact: true }).click();
  await contact('Email').getByText('Not verified', { exact: true }).waitFor();

  await contact('SMS').getByLabel('Mobile number (E.164)', { exact: true }).fill('invalid');
  await contact('SMS').getByRole('button', { name: 'Request SMS code', exact: true }).click();
  await contact('SMS').getByText('Enter a phone number in E.164 format, such as +15551234567.', { exact: true }).waitFor();
  assert.equal(messages.length, 1);
  const phone = '+12025550123';
  await contact('SMS').getByLabel('Mobile number (E.164)', { exact: true }).fill(phone);
  await contact('SMS').getByRole('button', { name: 'Request SMS code', exact: true }).click();
  await contact('SMS').getByLabel('SMS verification code').waitFor();
  const smsCode = lastCode();
  await enterCode('SMS', smsCode);
  await expectVerified('SMS');
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const privateValue of [phone, correct, smsCode, user.email]) assert.equal(storage.includes(privateValue), false);
  await mount();
  await expectVerified('SMS');
  assert.equal(await contact('SMS').getByLabel('Mobile number (E.164)', { exact: true }).inputValue(), '');
  assert.equal(await contact('SMS').getByLabel('SMS verification code').count(), 0);
  await contact('SMS').getByRole('button', { name: 'Revoke SMS contact', exact: true }).click();
  await contact('SMS').getByText('Not verified', { exact: true }).waitFor();

  now += 60_001; outcome = 'unknown';
  await contact('SMS').getByLabel('Mobile number (E.164)', { exact: true }).fill(phone);
  await contact('SMS').getByRole('button', { name: 'Request SMS code', exact: true }).click();
  await contact('SMS').getByText('Verification delivery status is unknown. If a code arrives, you can enter it below.', { exact: true }).waitFor();
  await enterCode('SMS');
  await expectVerified('SMS');
  now += 60_001; outcome = 'rejected';
  await contact('SMS').getByLabel('Mobile number (E.164)', { exact: true }).fill(phone);
  await contact('SMS').getByRole('button', { name: 'Request SMS code', exact: true }).click();
  await contact('SMS').getByText('The provider rejected the verification request. Retry after checking your contact details.', { exact: true }).waitFor();
  await contact('SMS').getByText('Not verified', { exact: true }).waitFor();
  assert.equal(await contact('SMS').getByLabel('SMS verification code').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => ['/api/cloud/notification-destinations', '/api/cloud/notification-preferences', '/api/cloud/notification-history'].includes(request.path)));
  for (const request of requests.filter(request => request.body?.action === 'request' && request.body.channel === 'email')) assert.deepEqual(request.body, { action: 'request', channel: 'email' });
  console.log(JSON.stringify({ passed: true, checks: ['load retry', 'unconfigured retry', 'account-bound email', 'wrong code', 'verified contact', 'revoke', 'E.164 validation', 'no private browser storage', 'reload state', 'unknown delivery', 'rejected delivery', '390px layout'], realMessagesSent: 0 }, null, 2));
} finally { await browser.close(); }
