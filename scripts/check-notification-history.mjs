import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { createNotificationHistoryHandler } from '../netlify/functions/cloud-notification-history.mjs';
import { ownerKey } from '../netlify/shared/agent-store.mjs';

// Actual rendered component, authenticated API helper, and owner-filtered history
// handler. All requests are intercepted; the store is in memory and cannot send.
const user = { id: 'history-ui-fixture', cloudVersion: 'supabase' };
const owner = ownerKey(user);
let rows = [];
const handler = createNotificationHistoryHandler({ authenticate: async event => {
  assert.match(event.headers.authorization, /^Bearer fixture\./); return user;
}, storeFactory: () => ({
  async *list({ prefix }) { yield { blobs: rows.map(row => ({ key: `${prefix}${row.eventId}/${row.channel}` })) }; },
  async get(key) { return rows.find(row => key.endsWith(`${row.eventId}/${row.channel}`)); },
}) });
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { NotificationHistory } from '/src/console/notification-history.jsx';
  import '/src/console/console.css';
  const token = 'fixture.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))+'.fixture';
  localStorage.setItem('portabase.auth.v1',JSON.stringify({provider:'supabase',cloudVersion:'supabase',accessToken:token,user:{id:'history-ui-fixture'}}));
  createRoot(document.getElementById('root')).render(React.createElement(NotificationHistory));
`;
const compiled = await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'notification-history-fixture',
    resolveId(id) { if (id.endsWith('virtual:history-fixture')) return '\0history-fixture'; },
    load(id) { if (id === '\0history-fixture') return fixture; },
  }], build: { write: false, minify: false, lib: { entry: 'virtual:history-fixture', formats: ['iife'], name: 'HistoryFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(item => item.output);
const bundle = output.find(item => item.type === 'chunk' && item.isEntry).code;
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const row = (index, state, deliveryStatus = null) => ({ owner, eventId: index.toString(16).padStart(64, '0'), channel: index % 2 ? 'email' : 'sms',
  state, deliveryStatus, eventType: 'backup.failed', createdAt: new Date(Date.UTC(2026, 9, 4, 0, index)).toISOString(), updatedAt: null, lastReceiptAt: null,
  address: 'PRIVATE_ADDRESS_CANARY@example.test', body: 'PRIVATE_BODY_CANARY', providerError: 'PRIVATE_ERROR_CANARY',
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10_000);
  const errors = [], requests = [];
  let fail = true, malformed = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin, 'https://portabase.fixture.test');
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div class="pb-console"><main class="pb-main"><div class="pb-body" id="root"></div></main></div></body></html>' });
    requests.push({ path: url.pathname, method: request.method() });
    assert.equal(url.pathname, '/api/cloud/notification-history');
    assert.equal(request.method(), 'GET');
    const response = fail ? { statusCode: 503, body: JSON.stringify({ error: 'PRIVATE_ERROR_CANARY' }) }
      : malformed ? { statusCode: 200, body: JSON.stringify({ deliveries: [], truncated: 'no' }) }
      : await handler({ httpMethod: 'GET', headers: request.headers() });
    return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
  });
  await page.goto('https://portabase.fixture.test/');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  const unavailable = page.getByText('Delivery history is unavailable. Retry to check recorded outcomes.', { exact: true });
  const empty = page.getByText('No notification deliveries are recorded in this result. This does not confirm that alerts are connected or that backups are healthy.', { exact: true });
  await unavailable.waitFor();
  assert.equal(await empty.count(), 0);
  assert.equal((await page.locator('body').innerText()).includes('PRIVATE_ERROR_CANARY'), false);
  fail = false;
  await page.getByRole('button', { name: 'Retry delivery history', exact: true }).click();
  await empty.waitFor();
  rows = ['pending', 'leased', 'sending', 'accepted', 'unknown', 'suppressed', 'rejected'].map((state, i) => row(i + 1, state));
  rows.push(...['accepted', 'sent', 'delivered', 'failed', 'conflicted'].map((status, i) => row(i + 10, 'accepted', status)));
  rows.push(row(20, 'unknown', 'delivered'));
  await page.getByRole('button', { name: 'Refresh delivery history', exact: true }).click();
  await page.getByText('Rejected by provider', { exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 13);
  for (const label of ['Pending', 'Preparing to send', 'Dispatch in progress', 'Sent by provider', 'Delivery failed', 'Suppressed']) assert.equal(await page.getByText(label, { exact: true }).count(), 1);
  assert.equal(await page.getByText('Accepted by provider', { exact: true }).count(), 2);
  assert.equal(await page.getByText('Delivered', { exact: true }).count(), 2);
  assert.equal(await page.getByText('Delivery uncertain', { exact: true }).count(), 2);
  assert.equal(await page.getByRole('button', { name: /resend|send again/i }).count(), 0);
  assert.equal(await page.getByRole('button').count(), 1);
  assert.equal((await page.locator('body').innerText()).includes('PRIVATE_'), false);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('PRIVATE_')), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // Refresh failures hide the stale list instead of presenting old status as current.
  fail = true;
  await page.getByRole('button', { name: 'Refresh delivery history', exact: true }).click();
  await unavailable.waitFor();
  assert.equal(await page.getByRole('article').count(), 0);
  fail = false; malformed = true;
  await page.getByRole('button', { name: 'Retry delivery history', exact: true }).click();
  await unavailable.waitFor();
  assert.equal(await empty.count(), 0);
  malformed = false;
  rows = Array.from({ length: 101 }, (_, i) => row(i + 1, 'accepted'));
  await page.getByRole('button', { name: 'Retry delivery history', exact: true }).click();
  await page.getByText('This history is incomplete. Additional records may exist beyond those shown.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 100);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['503 retry', 'honest empty state', '13 queue and receipt states', 'unknown reconciled by receipt', 'no resend', 'no private fields', '390px layout', 'stale list hidden on error', 'invalid response rejected', 'truncated history'], requests: requests.length, realMessagesSent: 0 }, null, 2));
} finally { await browser.close(); }
