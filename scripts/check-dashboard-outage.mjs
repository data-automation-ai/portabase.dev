import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { createDashboardHandler } from '../netlify/functions/cloud-dashboard.mjs';

// Actual ConsoleApp, API helper and dashboard handler, with authenticated fixture
// identity and an in-memory jobs store. Every browser request stays intercepted.
const user = { id: 'dashboard-fixture', email: 'dashboard@example.test', cloudVersion: 'supabase' };
const currentJob = { id: 'CURRENT_FAILED_JOB', type: 'backup', status: 'failed', startedAt: new Date().toISOString(), errorCode: 'runner_unavailable' };
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { ConsoleApp } from '/src/console/ConsoleApp.jsx';
  import { emptyWorkspace } from '/src/console/data/store.js';
  if (new URLSearchParams(location.search).get('demo') === '1') sessionStorage.setItem('portabase.console.demo','1');
  if (!sessionStorage.getItem('dashboard-fixture-seeded')) {
    const token = 'fixture.' + btoa(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600 })) + '.fixture';
    localStorage.setItem('portabase.auth.v1', JSON.stringify({provider:'supabase',cloudVersion:'supabase',accessToken:token,user:${JSON.stringify(user)}}));
    const state = emptyWorkspace(${JSON.stringify(user)});
    state.jobs = [{ id:'STALE_SUCCESS_JOB',type:'backup',status:'completed',startedAt:new Date().toISOString() }];
    state.proofReport = {kind:'compare',source:'runner',capsuleHash:'b'.repeat(64),verdict:'MATCH',comparedAt:'2025-01-01T00:00:00.000Z'};
    localStorage.setItem('portabase.console.live.v1', JSON.stringify(state));
    sessionStorage.setItem('dashboard-fixture-seeded','1');
  }
  createRoot(document.getElementById('root')).render(React.createElement(ConsoleApp));
`;
const compiled = await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'dashboard-outage-fixture',
    resolveId(id) { if (id.endsWith('virtual:dashboard-outage-fixture')) return '\0dashboard-outage-fixture'; },
    load(id) { if (id === '\0dashboard-outage-fixture') return fixture; },
  }], build: { write: false, minify: false, lib: { entry: 'virtual:dashboard-outage-fixture', formats: ['iife'], name: 'DashboardFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(item => item.output);
const bundle = output.find(item => item.type === 'chunk' && item.isEntry).code;
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const failures = [];
const results = [];
function check(condition, label) { if (!condition) failures.push(label); }
const browser = await chromium.launch({ headless: true });
try {
  for (const path of ['/dashboard', '/app/home', '/app/overview', '/dashboard?demo=1']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    const requests = [];
    let unavailable = true;
    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { started = resolve; });
    const handler = createDashboardHandler({
      authenticate: async event => { assert.match(event.headers.authorization, /^Bearer fixture\./); return user; },
      jobsDatabase: () => ({ get: async () => { if (unavailable) throw new Error('fixture store outage'); return [currentJob]; } }),
      subscription: async () => null,
      squareStatus: () => ({ ready: false }),
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      assert.equal(url.origin, 'https://portabase.fixture.test', 'No provider requests');
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
      if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
      requests.push(url.pathname);
      let response;
      if (url.pathname === '/api/cloud/dashboard') {
        started();
        await gate;
        response = await handler({ httpMethod: request.method(), headers: request.headers() });
      } else if (url.pathname === '/api/cloud/me') response = { statusCode: 200, body: JSON.stringify({ user, access: { hasAccess: false }, subscription: null }) };
      else if (url.pathname === '/api/cloud/telemetry-events') response = { statusCode: 200, body: JSON.stringify({ events: [] }) };
      else if (url.pathname === '/api/cloud/notification-preferences') response = { statusCode: 200, body: JSON.stringify({ revision: 0, preferences: { email: { onFailure: false, onSuccess: false }, sms: { onFailure: false, onSuccess: false } }, deliveryConfigured: false }) };
      else if (url.pathname === '/api/cloud/notification-destinations') response = { statusCode: 200, body: JSON.stringify({ destinations: { email: { verified: false, revision: 0, addressHint: null }, sms: { verified: false, revision: 0, addressHint: null } } }) };
      else if (url.pathname === '/api/cloud/notification-history') response = { statusCode: 200, body: JSON.stringify({ deliveries: [], truncated: false }) };
      else { failures.push(`${path}: unexpected request ${url.pathname}`); response = { statusCode: 500, body: '{}' }; }
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.goto(`https://portabase.fixture.test${path}`);
    if (path.includes('demo=1')) {
      await page.getByLabel('Telemetry status').waitFor();
      check(requests.length === 0, 'Demo dashboard makes no authenticated provider requests');
      check(await page.getByText('Loading account activity', { exact: true }).count() === 0, 'Demo dashboard is not gated on live activity');
      check(errors.length === 0, `Demo: browser errors ${errors.join(', ')}`);
      results.push({ path, dashboardRequests: 0 });
      await page.close();
      continue;
    }
    await requested;
    // Allow React to paint the pending-request state before inspecting it.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(await page.getByLabel('Telemetry status').count() === 0, `${path}: hides overview while dashboard is pending`);
    check(await page.locator('[data-proof-tone="green"]').count() === 0, `${path}: hides stale green proof while pending`);
    release();
    await page.getByText('Account activity is unavailable', { exact: true }).waitFor();
    check(await page.getByLabel('Telemetry status').count() === 0, `${path}: hides overview after 503`);
    check(await page.locator('[data-proof-tone="green"]').count() === 0, `${path}: hides stale green proof after 503`);
    check(!(await page.locator('.pb-body').innerText()).includes('0 ok'), `${path}: no false empty-success summary after 503`);
    // Other pages remain usable during the dashboard outage.
    await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await page.getByText('Runner execution required', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('heading', { name: 'Account', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await page.getByRole('heading', { name: 'Saved event preferences', exact: true }).waitFor();
    await page.getByRole('article', { name: 'Email contact', exact: true }).getByText('Not verified', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    check(await page.getByLabel('Telemetry status').count() === 0, `${path}: navigation back keeps outage guard`);
    unavailable = false;
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload account activity', exact: true }).click()]);
    await page.getByText('CURRENT_FAILED_JOB', { exact: true }).waitFor();
    check(await page.getByText('Account activity is unavailable', { exact: true }).count() === 0, `${path}: successful reload removes outage`);
    check(await page.getByText('STALE_SUCCESS_JOB', { exact: true }).count() === 0, `${path}: successful reload replaces cached jobs`);
    check(await page.locator('[data-proof-tone="green"]').count() === 0, `${path}: server unproven response supersedes cached MATCH`);
    check(await page.locator('[data-proof-tone="red"]').count() === 1, `${path}: successful reload shows unproven status`);
    check(errors.length === 0, `${path}: browser errors ${errors.join(', ')}`);
    results.push({ path, dashboardRequests: requests.filter(value => value === '/api/cloud/dashboard').length });
    await page.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ passed: failures.length === 0, results, failures, realProviderRequests: 0 }, null, 2));
assert.equal(failures.length, 0, 'Dashboard outage browser regressions');
