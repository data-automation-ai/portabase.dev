import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

// Actual AlertsHubPage and cloud-api helpers, with every HTTP request intercepted.
// The session is synthetic; this never sends email/SMS or reaches a provider.
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { AlertsHubPage } from '/src/console/pages.jsx';
  import { CustomerDashboardPage } from '/src/console/customer-dashboard.jsx';
  import { seedWorkspace } from '/src/console/data/store.js';
  import '/src/console/console.css';
  const scenario = window.notificationScenario;
  const state = seedWorkspace();
  state.demoMode = scenario === 'demo' || scenario === 'dashboard-demo';
  state.billing.planId = 'cloud-17';
  state.billing.plan = 'cloud-17';
  const jwt = 'fixture.' + btoa(JSON.stringify({ exp: Math.floor(Date.now()/1000) + 3600 })) + '.fixture';
  localStorage.setItem('portabase.auth.v1', JSON.stringify({ provider: 'supabase', cloudVersion: 'supabase', accessToken: jwt, user: {id: 'fixture'} }));
  window.notificationAudit = {writes: 0, toasts: []};
  function Harness() {
    const [current, update] = React.useState(state);
    window.notificationAudit.state = current;
    return React.createElement(scenario.startsWith('dashboard') ? CustomerDashboardPage : AlertsHubPage, {
      state: current, demoMode: state.demoMode || scenario === 'mismatched-demo', section: 'utilities', navigate: () => {},
      setState: mutator => { window.notificationAudit.writes++; update(previous => mutator(structuredClone(previous))); },
      toast: text => window.notificationAudit.toasts.push(text),
    });
  }
  createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const compiled = await build({
  root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'notification-regression-fixture',
    resolveId(id) { if (id.endsWith('virtual:notification-fixture')) return '\0notification-fixture'; },
    load(id) { if (id === '\0notification-fixture') return fixture; },
  }],
  build: { write: false, minify: false, lib: { entry: 'virtual:notification-fixture', formats: ['iife'], name: 'NotificationFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(result => result.output);
const code = output.find(item => item.type === 'chunk' && item.isEntry).code;
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const scenario of ['live', 'mismatched-demo', 'demo', 'dashboard-live', 'dashboard-demo']) {
    const page = await browser.newPage({ viewport: { width: scenario.startsWith('dashboard') ? 1280 : 390, height: 844 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    const requests = [];
    let failLoad = scenario === 'live';
    let failSave = scenario === 'live';
    let conflict = false;
    let record = { preferences: { email: { onFailure: false, onSuccess: false }, sms: { onFailure: false, onSuccess: false } }, revision: 0, deliveryConfigured: false };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div class="pb-console"><main class="pb-main"><div id="root" class="pb-body"></div></main></div></body></html>' });
      requests.push({ path, method: request.method(), headers: request.headers(), body: request.postDataJSON() });
      const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/api/cloud/notification-history' && request.method() === 'GET') return reply(200, { deliveries: [], truncated: false });
      if (path === '/api/cloud/notification-destinations' && request.method() === 'GET') return reply(200, { destinations: { email: { verified: false, revision: 0, addressHint: null }, sms: { verified: false, revision: 0, addressHint: null } } });
      if (path !== '/api/cloud/notification-preferences') return reply(500, { error: 'unexpected_fixture_request' });
      if (request.method() === 'GET') {
        if (failLoad) { failLoad = false; return reply(503, { error: 'notification_preferences_unavailable' }); }
        return reply(200, record);
      }
      if (failSave) { failSave = false; return reply(503, { error: 'notification_preferences_unavailable' }); }
      if (conflict) { conflict = false; record = { ...record, revision: record.revision + 1 }; return reply(409, { error: 'preferences_changed_reload' }); }
      const body = request.postDataJSON();
      if (body.revision !== record.revision) return reply(409, { error: 'preferences_changed_reload' });
      record = { ...record, preferences: body.preferences, revision: record.revision + 1 };
      return reply(200, record);
    });
    await page.goto('https://portabase.fixture.test/');
    await page.evaluate(value => { window.notificationScenario = value; }, scenario);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: code });
    if (scenario === 'dashboard-demo') {
      const toggle = page.getByRole('checkbox', { name: 'Text on success', exact: true });
      await toggle.waitFor();
      await toggle.setChecked(!(await toggle.isChecked()));
      assert.ok((await page.evaluate(() => window.notificationAudit.toasts)).some(text => text.includes('saved locally')));
      assert.equal(requests.length, 0);
    } else if (scenario === 'demo') {
      await page.getByRole('button', { name: 'SMS texts', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Test', exact: true }).first().click();
      assert.ok((await page.evaluate(() => window.notificationAudit.toasts)).some(text => text.includes('(demo)')));
      assert.equal(requests.length, 0);
    } else {
      await page.getByText('Notification delivery is not connected', { exact: true }).waitFor();
      assert.equal(await page.getByRole('checkbox', { name: /^(Enable SMS status alerts|Text on failure|Text on success)$/ }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /^(Verify|Test|Add number|Escalation)$/ }).count(), 0);
      if (scenario === 'live') {
        await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
      }
      const emailFailure = page.getByRole('checkbox', { name: 'Email for failures and missed backups', exact: true });
      await emailFailure.waitFor();
      assert.equal(await emailFailure.isChecked(), false);
      await emailFailure.check();
      await page.getByRole('checkbox', { name: 'SMS for failures and missed backups', exact: true }).check();
      await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
      if (scenario === 'live') {
        await page.getByText('Could not save your preferences. Your changes are still here; retry saving.', { exact: true }).waitFor();
        assert.equal(await emailFailure.isChecked(), true);
        await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
      }
      await page.getByText('Preferences saved. Notification delivery is not connected yet.', { exact: true }).waitFor();
      assert.equal(record.revision, 1);
      assert.deepEqual(record.preferences, { email: { onFailure: true, onSuccess: false }, sms: { onFailure: true, onSuccess: false } });
      if (scenario === 'live') {
        conflict = true;
        await page.getByRole('checkbox', { name: 'Email for completed backups, checks and restores', exact: true }).check();
        await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
        await page.getByRole('button', { name: 'Reload latest settings', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Save preferences', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: 'Reload latest settings', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('input[type="checkbox"]')?.disabled && !document.body.textContent.includes('Loading notification preferences'));
        assert.equal(await page.getByRole('checkbox', { name: 'Email for completed backups, checks and restores', exact: true }).isChecked(), false);
        await page.getByRole('checkbox', { name: 'Email for completed backups, checks and restores', exact: true }).check();
        await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
        await page.getByText('Preferences saved. Notification delivery is not connected yet.', { exact: true }).waitFor();
        assert.equal(record.revision, 3);
        assert.equal(record.preferences.email.onSuccess, true);
      }
      assert.equal(await page.evaluate(() => window.notificationAudit.writes), 0);
      assert.ok(requests.length >= 2);
      assert.ok(requests.every(request => ['/api/cloud/notification-preferences', '/api/cloud/notification-destinations', '/api/cloud/notification-history'].includes(request.path) && request.headers.authorization?.startsWith('Bearer fixture.') && request.headers['x-portabase-cloud-version'] === 'supabase'));
      for (const request of requests.filter(request => request.method === 'PUT')) assert.deepEqual(Object.keys(request.body).sort(), ['preferences', 'revision']);
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
        overflowing: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })),
      }));
      assert.equal(layout.overflow, false, JSON.stringify({ scenario, ...layout }));
    }
    assert.deepEqual(errors, []);
    results.push({ scenario, passed: true, requestCount: requests.length });
    await page.close();
  }
  console.log(JSON.stringify({ results }, null, 2));
} finally { await browser.close(); }
