import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createAgentsHandler } from '../netlify/functions/cloud-agents.mjs';
import { createAgent, rotateAgent, revokeAgent, listAgents, authenticateAgent, ownerKey } from '../netlify/shared/agent-store.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const user = { id: 'credential-ui-fixture', cloudVersion: 'supabase' }, owner = ownerKey(user);
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {AgentCredentials} from '/src/console/agent-credentials.jsx'; import '/src/console/console.css';
  const token='fixture.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))+'.fixture';
  localStorage.setItem('portabase.auth.v1',JSON.stringify({provider:'supabase',cloudVersion:'supabase',accessToken:token,user:${JSON.stringify(user)}}));
  createRoot(document.getElementById('root')).render(React.createElement(AgentCredentials));`;
const compiled = await build({ root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'agent-access-fixture', resolveId(id) { if (id.endsWith('virtual:agent-access')) return '\0agent-access'; }, load(id) { if (id === '\0agent-access') return fixture; } }],
  build: { write: false, minify: false, lib: { entry: 'virtual:agent-access', formats: ['iife'], name: 'AgentAccessFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(value => value.output);
const bundle = output.find(value => value.type === 'chunk' && value.isEntry).code;
const css = output.filter(value => value.type === 'asset' && value.fileName.endsWith('.css')).map(value => String(value.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const evidence = resolve(root, 'portabase-evidence/agent-job-access'); await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) {
    const rows = new Map(); let sequence = 0, loseReply = false;
    const store = { async get(key) { return structuredClone(rows.get(key)?.data ?? null); }, async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
      async setJSON(key, data, opts) { const previous = rows.get(key); if (opts.onlyIfNew && previous || opts.onlyIfMatch && opts.onlyIfMatch !== previous?.etag) return { modified: false };
        rows.set(key, { data: structuredClone(data), etag: String(++sequence) }); return { modified: true }; } };
    const legacy = await createAgent(owner, { name: 'Legacy QA runner', projectRef: 'abcdefghijklmnopqrst' }, store);
    const handler = createAgentsHandler({ verifyUser: async () => user,
      list: current => listAgents(current, store), health: async (_, agents) => agents,
      create: (current, body) => createAgent(current, body, store, { user }),
      rotate: (current, body) => rotateAgent(current, body, user, store), revoke: (current, id) => revokeAgent(current, id, store),
    });
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); page.setDefaultTimeout(10000);
    const requests = [], errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()); assert.equal(url.origin, 'https://portabase.fixture.test');
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div class="pb-console"><main class="pb-main"><div id="root" class="pb-body"></div></main></div><script src="/fixture.js"></script></body></html>' });
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
      if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
      assert.equal(url.pathname, '/api/cloud/agents');
      requests.push({ method: request.method(), body: request.postData() });
      const result = await handler({ httpMethod: request.method(), headers: request.headers(), body: request.postData() });
      if (loseReply && request.method() === 'PATCH') { loseReply = false; return route.abort(); }
      return route.fulfill({ status: result.statusCode, contentType: 'application/json', body: result.body });
    });
    await page.goto('https://portabase.fixture.test/');
    await page.getByText('Telemetry only — private jobs require an upgrade', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Queue private job for Legacy QA runner', exact: true }).isDisabled(), true);
    const mutations = () => requests.filter(request => request.method !== 'GET');
    await page.getByRole('button', { name: 'Enable private jobs for Legacy QA runner', exact: true }).click();
    const confirm = page.getByRole('region', { name: 'Confirm runner token replacement', exact: true });
    const replace = () => confirm.getByRole('button', { name: 'Replace token and enable private jobs', exact: true });
    assert.equal(await replace().isDisabled(), true); assert.equal(mutations().length, 0);
    await confirm.getByRole('button', { name: 'Cancel replacement', exact: true }).click(); assert.equal(mutations().length, 0);
    await page.getByRole('button', { name: 'Enable private jobs for Legacy QA runner', exact: true }).click();
    await confirm.getByRole('checkbox').check(); await replace().click();
    const tokenPanel = page.getByRole('region', { name: 'New runner credential', exact: true });
    await tokenPanel.getByText('The previous token is revoked.', { exact: false }).waitFor();
    const upgradedToken = await tokenPanel.getByLabel('Runner token', { exact: true }).inputValue();
    const authenticated = await authenticateAgent(`Bearer ${upgradedToken}`, store);
    assert.equal(authenticated.id, legacy.agent.id); assert.equal(authenticated.jobAccess, true); assert.equal(authenticated.credentialRevision, 1);
    assert.equal(await authenticateAgent(`Bearer ${legacy.token}`, store), null);
    assert.equal(await page.getByRole('button', { name: 'Queue private job for Legacy QA runner', exact: true }).isDisabled(), false);
    assert.deepEqual(JSON.parse(mutations()[0].body), { id: legacy.agent.id, expectedRevision: 0, enableJobAccess: true });
    assert.match(await tokenPanel.innerText(), /PORTABASE_AGENT_TOKEN/); assert.doesNotMatch(await tokenPanel.innerText(), /PORTABASE_CLOUD_TOKEN/);
    assert.equal(JSON.parse(await tokenPanel.locator('pre').innerText()).cloud.tokenEnv, 'PORTABASE_AGENT_TOKEN');
    assert.doesNotMatch(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })), /pb_agent_/);
    // Never save screenshots while the one-time credential is visible.
    await tokenPanel.getByRole('button', { name: 'I saved it — hide token', exact: true }).click();
    assert.equal(await page.getByLabel('Runner token', { exact: true }).count(), 0);
    await page.screenshot({ path: resolve(evidence, `upgraded-${width}.png`), fullPage: true });
    // Another owner action changes the CAS revision after this UI's list was loaded.
    await rotateAgent(owner, { id: legacy.agent.id, expectedRevision: 1, enableJobAccess: true }, user, store);
    await page.getByRole('button', { name: 'Replace token for Legacy QA runner', exact: true }).click();
    await confirm.getByRole('checkbox').check(); await replace().click();
    await page.getByRole('alert').filter({ hasText: 'credential changed or was revoked' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Replace token for Legacy QA runner', exact: true }).isDisabled(), true);
    assert.equal(mutations().length, 2);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Replace token for Legacy QA runner', exact: true }).click();
    await confirm.getByRole('checkbox').check(); loseReply = true; await replace().click();
    await page.getByRole('alert').filter({ hasText: 'old token may already be revoked' }).waitFor();
    assert.equal(mutations().length, 3); assert.equal((await listAgents(owner, store))[0].credentialRevision, 3);
    assert.equal(await page.getByLabel('Runner token', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Replace token for Legacy QA runner', exact: true }).click();
    await confirm.getByRole('checkbox').check(); await replace().click();
    await tokenPanel.waitFor(); assert.equal(mutations().length, 4);
    assert.equal(JSON.parse(mutations()[3].body).expectedRevision, 3);
    assert.equal(await authenticateAgent(`Bearer ${upgradedToken}`, store), null);
    await tokenPanel.getByRole('button', { name: 'I saved it — hide token', exact: true }).click();
    // New registrations receive job-enabled credentials too.
    await page.getByLabel('Runner name', { exact: true }).fill('New QA runner');
    await page.getByLabel('Supabase project reference', { exact: true }).fill('bcdefghijklmnopqrst0');
    await page.getByRole('button', { name: 'Create runner credential', exact: true }).click();
    await tokenPanel.waitFor();
    const newToken = await tokenPanel.getByLabel('Runner token', { exact: true }).inputValue();
    assert.equal((await authenticateAgent(`Bearer ${newToken}`, store)).jobAccess, true);
    assert.doesNotMatch(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })), /pb_agent_/);
    assert.ok(mutations().every(request => !request.body.includes('pb_agent_')));
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Agent job-access UI320/1440: explicit rotation, real CAS/token revocation, same runner identity, conflict/lost-response manual recovery, new enrollment, no token persistence or external requests.');
} finally { await browser.close(); }
