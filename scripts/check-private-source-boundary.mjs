import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const user = { id: 'source-boundary-fixture', email: 'fixture@example.test', cloudVersion: 'supabase' };
const agent = { id: '11111111-1111-4111-8111-111111111111', name: 'Private QA runner', revokedAt: null, jobAccess: true, credentialRevision: 1 };
const reference = { version: 2, type: 'backup', runnerId: agent.id, configRef: '22222222-2222-4222-8222-222222222222', configRevision: 1 };
const fixture = `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ConsoleApp} from '/src/console/ConsoleApp.jsx';
  import {emptyWorkspace} from '/src/console/data/store.js';
  import {fetchSupabaseProjects,fetchSupabaseInventory,fetchCloudSelection,saveCloudSelection} from '/src/lib/cloud-api.js';
  window.retiredHelpers=[fetchSupabaseProjects,fetchSupabaseInventory,fetchCloudSelection,saveCloudSelection];
  if (new URLSearchParams(location.search).get('demo') === '1') sessionStorage.setItem('portabase.console.demo','1');
  const token='fixture.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))+'.fixture';
  localStorage.setItem('portabase.auth.v1',JSON.stringify({provider:'supabase',cloudVersion:'supabase',accessToken:token,user:${JSON.stringify(user)}}));
  const state=emptyWorkspace(${JSON.stringify(user)});
  state.schedules=[{id:'synthetic-schedule',everyHours:24,timezone:'UTC',enabled:true}];
  localStorage.setItem('portabase.console.live.v1',JSON.stringify(state));
  createRoot(document.getElementById('root')).render(React.createElement(ConsoleApp));
`;
const compiled = await build({ root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'source-boundary-fixture', resolveId(id) { if (id.endsWith('virtual:source-boundary')) return '\0source-boundary'; },
    load(id) { if (id === '\0source-boundary') return fixture; } }],
  build: { write: false, minify: false, lib: { entry: 'virtual:source-boundary', formats: ['iife'], name: 'SourceBoundaryFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(value => value.output);
const bundle = output.find(value => value.type === 'chunk' && value.isEntry).code;
const css = output.filter(value => value.type === 'asset' && value.fileName.endsWith('.css')).map(value => String(value.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const evidence = resolve(root, 'portabase-evidence/private-source-boundary'); await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) for (const path of ['/dashboard?section=sizer', '/app/supabase-viewer', '/app/inspect', '/dashboard?section=sizer&demo=1']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); page.setDefaultTimeout(10000);
    const requests = [], errors = [], rows = new Map(); let revision = 0, unavailable = false;
    const db = { async get(key) { return structuredClone(rows.get(key)?.data ?? null); }, async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
      async setJSON(key, data, opts) { const previous = rows.get(key); if (opts.onlyIfNew && previous || opts.onlyIfMatch && opts.onlyIfMatch !== previous?.etag) return { modified: false };
        rows.set(key, { data: structuredClone(data), etag: String(++revision) }); return { modified: true }; } };
    const jobs = createJobsHandler({ authenticate: async () => user, ownedRunners: async () => [agent],
      getSubscription: async () => null, database: () => db, publishCompletion: async () => {} });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, 'https://portabase.fixture.test', 'No provider/private runner requests');
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
      if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
      requests.push({ path: url.pathname, method: request.method(), body: request.postData() });
      assert.ok(!['/api/cloud/supabase', '/api/cloud/selection'].includes(url.pathname), 'Retired privacy routes must never be called');
      let data;
      if (url.pathname === '/api/cloud/agents') {
        if (unavailable) return route.fulfill({ status: 503, json: {} });
        data = { agents: [agent, { ...agent, id: reference.configRef, name: 'Revoked runner', revokedAt: '2026-10-01' }] };
      } else if (url.pathname === '/api/cloud/jobs') { const result = await jobs({ httpMethod: request.method(), headers: request.headers(), body: request.postData() }); return route.fulfill({ status: result.statusCode, contentType: 'application/json', body: result.body }); }
      else if (url.pathname === '/api/cloud/me') data = { user, access: { hasAccess: false }, subscription: null };
      else if (url.pathname === '/api/cloud/dashboard') data = { jobs: [], live: true, proof: { proven: false } };
      else if (url.pathname === '/api/cloud/telemetry-events') data = { events: [] };
      else if (url.pathname === '/api/cloud/notification-preferences') data = { revision: 0, preferences: { email: { onFailure: false, onSuccess: false }, sms: { onFailure: false, onSuccess: false } }, deliveryConfigured: false };
      else if (url.pathname === '/api/cloud/notification-destinations') data = { destinations: { email: { verified: false, revision: 0 }, sms: { verified: false, revision: 0 } } };
      else if (url.pathname === '/api/cloud/notification-history') data = { deliveries: [], truncated: false };
      else assert.fail(`Unexpected request: ${url.pathname}`);
      return route.fulfill({ json: data });
    });
    await page.goto(`https://portabase.fixture.test${path}`);
    if (path.includes('demo=1')) {
      await page.getByRole('region', { name: 'Sample backup selection', exact: true }).waitFor();
      assert.equal(await page.locator('input[type=password]').count(), 0);
      assert.deepEqual(requests, []);
      await page.screenshot({ path: resolve(evidence, `demo-${width}.png`), fullPage: true });
      await page.getByRole('tab', { name: 'Utilities', exact: true }).click();
      const toggle = page.getByRole('button', { name: 'Sample on', exact: true }).first();
      await toggle.click();
      await page.getByText('Sample schedule changed locally. No runner schedule was saved.', { exact: true }).waitFor();
      assert.ok(await page.getByRole('button', { name: 'Sample off', exact: true }).count() > 0);
      assert.deepEqual(requests, []); assert.deepEqual(errors, []); await page.close(); continue;
    }
    const setup = page.getByRole('region', { name: 'Private Supabase setup', exact: true });
    await setup.getByText('Hosted private workspace access is not available yet.', { exact: true }).waitFor();
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal(await setup.getByRole('button', { name: /Revoked runner/ }).count(), 0);
    assert.match(await setup.locator('pre').innerText(), path.endsWith('/inspect') ? /--private-capsule-review.*--review-max-expanded-bytes/ : /--private-setup.*--config/);
    const before = requests.length;
    const retired = await page.evaluate(async () => {
      const results = [], value = { toJSON() { throw new Error('serialized-private-input'); } };
      for (const helper of window.retiredHelpers) { try { await helper(value, value); results.push('unexpected-success'); }
        catch (error) { results.push([error.status, error.code]); } }
      return results;
    });
    assert.deepEqual(retired, Array(4).fill([410, 'private_runner_setup_required']));
    assert.equal(requests.length, before);
    await setup.getByRole('button', { name: /Import reference for Private QA runner/ }).click();
    const panel = setup.getByRole('region', { name: 'Queue private job for Private QA runner', exact: true });
    const file = panel.getByLabel('Opaque job reference JSON (maximum 4 KiB)', { exact: true });
    await file.setInputFiles({ name: 'private.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ token: 'PRIVATE_CANARY' })) });
    await panel.getByRole('alert').waitFor(); assert.equal(requests.filter(row => row.method === 'POST').length, 0);
    const intent = { ...reference, type: path.endsWith('/inspect') ? 'replay' : 'backup' };
    await file.setInputFiles({ name: 'job.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(intent)) });
    await panel.getByLabel('Local job reference preview').waitFor();
    const queue = panel.getByRole('button', { name: 'Queue job', exact: true }); assert.equal(await queue.isDisabled(), true);
    await panel.getByRole('checkbox').check(); await queue.click();
    await panel.getByRole('status').filter({ hasText: 'account-reported status' }).waitFor();
    assert.equal([...rows.values()][0].data.length, 1);
    assert.doesNotMatch(JSON.stringify(requests), /PRIVATE_CANARY|excludeTables|passphrase|projectRef/);
    assert.equal(await setup.evaluate(element => element.scrollWidth > element.clientWidth), false, 'Private setup must fit its viewport');
    await page.screenshot({ path: resolve(evidence, `${path.includes('inspect') ? 'replay' : path.includes('viewer') ? 'viewer' : 'setup'}-${width}.png`), fullPage: true });
    unavailable = true; await setup.getByRole('button', { name: 'Refresh registered runners', exact: true }).click();
    await setup.getByRole('alert').waitFor(); assert.equal(await setup.getByRole('region', { name: /Queue private job/ }).count(), 0);
    assert.equal(await setup.getByRole('button', { name: /Import reference for/ }).count(), 0);
    assert.deepEqual(errors, []);
    if (path.startsWith('/dashboard')) {
      await page.getByRole('tab', { name: 'Utilities', exact: true }).click();
      await page.getByText('Schedule editing is unavailable until runner scheduling is connected.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Unavailable', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: /^(On|Off)$/ }).count(), 0);
    }
    await page.close();
  }
  console.log('Actual ConsoleApp routes at320/1440: private setup/replay guidance, no credential forms or retired requests, opaque queue flow, failure clears stale runner, legacy helpers fail locally, real schedules disabled. All network intercepted.');
} finally { await browser.close(); }
