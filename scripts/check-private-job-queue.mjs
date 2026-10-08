import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createJobsHandler } from '../netlify/functions/cloud-jobs.mjs';
import { privateJobAttemptKey, PRIVATE_JOB_RETRY_MS } from '../src/lib/private-job-reference.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const agent = { jobAccess: true, id: '11111111-1111-4111-8111-111111111111', name: 'QA runner', projectRef: 'abcdefghijklmnopqrst', slot: 0, tokenHint: 'test', revokedAt: null };
const reference = { version: 2, type: 'backup', runnerId: agent.id, configRef: '22222222-2222-4222-8222-222222222222', configRevision: 1 };
const user = { id: 'private-job-ui-fixture', cloudVersion: 'supabase' };
const fixture = `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {AgentCredentials} from '/src/console/agent-credentials.jsx'; import '/src/console/console.css';
  const token='fixture.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))+'.fixture';
  localStorage.setItem('portabase.auth.v1',JSON.stringify({provider:'supabase',cloudVersion:'supabase',accessToken:token,user:{id:'private-job-ui-fixture'}}));
  createRoot(document.getElementById('root')).render(React.createElement(AgentCredentials));
`;
const compiled = await build({ root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'private-job-ui-fixture', resolveId(id) { if (id.endsWith('virtual:private-job')) return '\0private-job'; }, load(id) { if (id === '\0private-job') return fixture; } }],
  build: { write: false, minify: false, lib: { entry: 'virtual:private-job', formats: ['iife'], name: 'PrivateJobFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(value => value.output);
const bundle = output.find(value => value.type === 'chunk' && value.isEntry).code;
const css = output.filter(value => value.type === 'asset' && value.fileName.endsWith('.css')).map(value => String(value.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const evidence = resolve(root, 'portabase-evidence/private-job-queue'); await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); page.setDefaultTimeout(10000);
    const rows = new Map(), requests = [], errors = []; let version = 0, revoked = false, loseResponse = false, hideJobs = false;
    const store = {
      async get(key) { return structuredClone(rows.get(key)?.data || null); },
      async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
      async setJSON(key, data, options) { const previous = rows.get(key); if (options.onlyIfNew && previous || options.onlyIfMatch && options.onlyIfMatch !== previous?.etag) return { modified: false };
        rows.set(key, { data: structuredClone(data), etag: String(++version) }); return { modified: true }; },
    };
    const handler = createJobsHandler({ authenticate: async () => user, ownedRunners: async () => [agent], getSubscription: async () => null, database: () => store });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()); assert.equal(url.origin, 'https://portabase.fixture.test');
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div class="pb-console"><main class="pb-main"><div id="root" class="pb-body"></div></main></div></body></html>' });
      requests.push({ path: url.pathname, method: request.method(), body: request.postData() });
      if (url.pathname === '/api/cloud/agents') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ agents: [{ ...agent, revokedAt: revoked ? '2026-10-05' : null }] }) });
      assert.equal(url.pathname, '/api/cloud/jobs');
      const result = await handler({ httpMethod: request.method(), headers: request.headers(), body: request.postData() });
      if (loseResponse && request.method() === 'POST') { loseResponse = false; return route.abort(); }
      return route.fulfill({ status: result.statusCode, contentType: 'application/json', body: hideJobs && request.method() === 'GET' ? JSON.stringify({ jobs: [] }) : result.body });
    });
    await page.goto('https://portabase.fixture.test/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    const open = () => page.getByRole('button', { name: 'Queue private job for QA runner', exact: true }).click();
    await open();
    const panel = page.getByRole('region', { name: 'Queue private job for QA runner', exact: true });
    const file = panel.getByLabel('Opaque job reference JSON (maximum 4 KiB)', { exact: true });
    const load = value => file.setInputFiles({ name: 'job-reference.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    const writes = () => requests.filter(row => row.method === 'POST');
    for (const value of [{ ...reference, passphrase: 'PRIVATE_CANARY' }, { ...reference, runnerId: reference.configRef }]) {
      await load(value); await panel.getByRole('alert').waitFor(); assert.equal(writes().length, 0);
    }
    await file.setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(4097, 'x') });
    await panel.getByRole('alert').waitFor(); assert.equal(writes().length, 0);
    await load(reference); await panel.getByLabel('Local job reference preview').waitFor();
    assert.equal(writes().length, 0);
    const queue = panel.getByRole('button', { name: 'Queue job', exact: true }); assert.equal(await queue.isDisabled(), true);
    await panel.getByRole('checkbox', { name: 'Queue this backup job on QA runner.', exact: true }).check();
    revoked = true; await queue.click();
    await panel.getByRole('alert').waitFor(); assert.equal(writes().length, 0);
    revoked = false; await panel.getByRole('checkbox').check();
    loseResponse = true; await queue.click();
    await panel.getByRole('alert').filter({ hasText: 'unconfirmed' }).waitFor();
    assert.equal(writes().length, 1);
    hideJobs = true; await panel.getByRole('button', { name: 'Check queue', exact: true }).click();
    await panel.getByText('No matching request was found. You may explicitly retry using the same request ID.', { exact: true }).waitFor();
    await panel.getByRole('checkbox').check(); await panel.getByRole('button', { name: 'Retry the same request', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'account-reported status' }).waitFor();
    assert.equal(writes().length, 2);
    assert.equal(JSON.parse(writes()[0].body).requestId, JSON.parse(writes()[1].body).requestId);
    assert.equal([...rows.values()][0].data.length, 1); // real handler dedup before quota
    assert.doesNotMatch(JSON.stringify(writes()), /PRIVATE_CANARY|excludeTables|passphrase/);
    await page.screenshot({ path: resolve(evidence, `queued-${width}.png`), fullPage: true });
    await panel.getByRole('button', { name: 'Close job reference', exact: true }).click(); await open();
    hideJobs = false; await load(reference);
    await panel.getByRole('button', { name: 'Check queue', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'account-reported status' }).waitFor(); assert.equal(writes().length, 2);
    const key = privateJobAttemptKey('supabase:private-job-ui-fixture', reference);
    await page.evaluate(({ key, age }) => { const value = JSON.parse(sessionStorage.getItem(key)); value.startedAt = Date.now() - age; sessionStorage.setItem(key, JSON.stringify(value)); }, { key, age: PRIVATE_JOB_RETRY_MS + 1 });
    await load(reference); await panel.getByText('The retry window is closed. This panel will not send this request again.', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Queue job', exact: true }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: 'Retry the same request', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Private job queue UI: 320/1440px, local rejection, active-runner check, explicit queue, lost response/retry dedup, reopen reconciliation, expired retry lock; no live requests.');
} finally { await browser.close(); }
