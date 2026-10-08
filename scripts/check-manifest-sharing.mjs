import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createManifestSharingHandler } from '../netlify/functions/cloud-manifest-sharing.mjs';
import { grantManifestSharing, ManifestSharingError, readManifestSharing, revokeManifestSharing, uploadSharedManifest } from '../netlify/shared/manifest-sharing.mjs';
import { ownerKey } from '../netlify/shared/agent-store.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const base = process.argv[2] || 'http://127.0.0.1:4175';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('This check is local-only.');
const out = resolve('portabase-evidence/manifest-sharing');
await mkdir(out, { recursive: true });
const agent = { id: 'fc9a4248-bb28-49f6-a779-447f349c3397', name: 'QA runner', projectRef: 'abcdefghijklmnopqrst', slot: 0, tokenHint: 'test', revokedAt: null };
const owner = ownerKey({ id: 'qa-user', cloudVersion: 'supabase' });
const snapshot = { schemaVersion: 1, projectRef: agent.projectRef, capturedAt: '2026-10-05T12:00:00Z', capsuleHash: 'a'.repeat(64), status: 'COMPLETE', counts: { tableCount: 1 }, inventory: { projectName: 'Synthetic sharing proof', tables: [{ schema: 'public', name: 'synthetic_orders' }] } };
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const pageErrors = [];
    const requests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const token = `header.${Buffer.from(JSON.stringify({ exp: 4102444800, sub: 'qa-user' })).toString('base64url')}.signature`;
    await page.addInitScript(token => localStorage.setItem('portabase.auth.v1', JSON.stringify({ provider: 'supabase', cloudVersion: 'supabase', accessToken: token, user: { id: 'qa-user', email: 'qa@example.test' } })), token);
    const rows = new Map();
    let version = 0;
    const store = {
      async get(key) { return structuredClone(rows.get(key)?.data || null); },
      async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
      async setJSON(key, data, options = {}) {
        const existing = rows.get(key);
        if (options.onlyIfNew && existing || options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
        rows.set(key, { data: structuredClone(data), etag: String(++version) });
        return { modified: true };
      },
    };
    let failUpload = false, conflictGrant = false, failRevoke = false;
    const handle = createManifestSharingHandler({
      verifyUser: async () => ({ id: 'qa-user', cloudVersion: 'supabase' }),
      agents: async () => [agent],
      read: (account, id) => readManifestSharing(account, id, store),
      grant: (account, runner, body) => { if (conflictGrant) throw new ManifestSharingError(409, 'consent_changed'); return grantManifestSharing(account, runner, body, store); },
      upload: (account, runner, body) => { if (failUpload) throw new Error('synthetic outage'); return uploadSharedManifest(account, runner, body, store); },
      revoke: (account, id) => { if (failRevoke) throw new Error('synthetic outage'); return revokeManifestSharing(account, id, store); },
    });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/cloud/manifest-sharing') {
        const method = route.request().method();
        const body = route.request().postData();
        requests.push({ method, body });
        const response = await handle({ httpMethod: method, headers: route.request().headers(), queryStringParameters: Object.fromEntries(url.searchParams), body });
        return route.fulfill({ status: response.statusCode, headers: response.headers, body: response.body });
      }
      const body = url.pathname === '/api/cloud/agents' ? { agents: [agent] }
        : url.pathname === '/api/cloud/telemetry-events' ? { events: [] }
          : url.pathname === '/api/cloud/me' ? { user: { id: 'qa-user', email: 'qa@example.test' }, access: { hasAccess: true } }
            : { jobs: [], live: true };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${base}/app/agents?version=supabase`);
    await page.getByRole('button', { name: 'Manifest sharing for QA runner', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Manifest sharing for QA runner', exact: true });
    await panel.getByText('Sharing is off.', { exact: true }).waitFor();
    const file = panel.getByLabel('Shareable snapshot JSON (maximum 256 KiB)', { exact: true });
    const importJson = value => file.setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    const writes = () => requests.filter(request => request.method !== 'GET');
    await importJson({ formatVersion: 1, contents: {}, password: 'never-upload-this-synthetic-secret' });
    await panel.getByRole('alert').filter({ hasText: 'Nothing from this file was uploaded' }).waitFor();
    assert.equal(writes().length, 0);
    await importJson(snapshot);
    await panel.getByLabel('Local snapshot preview', { exact: true }).waitFor();
    assert.equal(writes().length, 0);
    const consent = panel.getByRole('checkbox', { name: 'Allow Portabase to store this exact preview in my account.', exact: true });
    const inventory = panel.getByRole('checkbox', { name: 'Also allow the project, table, bucket and object names shown here.', exact: true });
    const share = panel.getByRole('button', { name: 'Share this snapshot', exact: true });
    assert.equal(await share.isDisabled(), true);
    await consent.check();
    assert.equal(await share.isDisabled(), true);
    assert.equal(writes().length, 0);
    await inventory.check();
    await share.click();
    await panel.getByText('This exact snapshot is now shared in your account.', { exact: true }).waitFor();
    assert.deepEqual(writes().map(request => request.method), ['POST', 'PUT']);
    assert.equal(JSON.parse(writes()[0].body).snapshot, undefined);
    assert.equal((await readManifestSharing(owner, agent.id, store)).snapshot.inventory.projectName, snapshot.inventory.projectName);
    await panel.getByText('View currently shared snapshot', { exact: true }).click();
    await panel.getByLabel('Currently shared snapshot', { exact: true }).waitFor();
    await panel.screenshot({ path: resolve(out, `shared-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await panel.evaluate(element => [...element.querySelectorAll('button,input,pre')].some(control => control.getBoundingClientRect().right > element.getBoundingClientRect().right + 1)), false);
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Manifest sharing for QA runner', exact: true }).click();
    await panel.getByText('A snapshot is currently shared.', { exact: true }).waitFor();
    assert.equal(await panel.getByLabel('Local snapshot preview', { exact: true }).count(), 0);
    await panel.getByText('View currently shared snapshot', { exact: true }).click();
    await panel.getByLabel('Currently shared snapshot', { exact: true }).waitFor();
    await importJson(snapshot);
    await panel.getByLabel('Local snapshot preview', { exact: true }).waitFor();
    assert.equal(writes().length, 2);
    const revoke = panel.getByRole('button', { name: 'Revoke sharing and remove stored snapshot', exact: true });
    await revoke.click();
    await panel.getByText('Sharing is off.', { exact: true }).waitFor();
    assert.equal((await readManifestSharing(owner, agent.id, store)).snapshot, null);

    failUpload = true;
    await consent.check(); await inventory.check(); await share.click();
    await panel.getByRole('alert').filter({ hasText: 'Consent was saved, but the upload was not confirmed' }).waitFor();
    assert.equal(await share.isDisabled(), true);
    assert.equal((await readManifestSharing(owner, agent.id, store)).snapshot, null);
    await panel.getByRole('button', { name: 'Refresh sharing status', exact: true }).click();
    await panel.getByText('Consent is active, but no snapshot has been uploaded.', { exact: true }).waitFor();
    assert.equal(await consent.isChecked(), false);
    failUpload = false; conflictGrant = true;
    await consent.check(); await inventory.check(); await share.click();
    await panel.getByRole('alert').filter({ hasText: 'Sharing changed while this request was in progress' }).waitFor();
    conflictGrant = false;
    await panel.getByRole('button', { name: 'Refresh sharing status', exact: true }).click();
    await panel.getByText('Consent is active, but no snapshot has been uploaded.', { exact: true }).waitFor();
    await consent.check(); await inventory.check(); await share.click();
    await panel.getByText('This exact snapshot is now shared in your account.', { exact: true }).waitFor();
    failRevoke = true;
    await revoke.click();
    await panel.getByRole('alert').filter({ hasText: 'The snapshot may still be shared' }).waitFor();
    failRevoke = false;
    await revoke.click();
    await panel.getByText('Sharing is off.', { exact: true }).waitFor();
    const beforeOversize = writes().length;
    await file.setInputFiles({ name: 'oversize.json', mimeType: 'application/json', buffer: Buffer.alloc(256 * 1024 + 1, 'x') });
    await panel.getByRole('alert').filter({ hasText: 'Nothing from this file was uploaded' }).waitFor();
    assert.equal(writes().length, beforeOversize);
    assert.equal(requests.some(request => request.body?.includes('never-upload-this-synthetic-secret')), false);
    assert.equal(await page.evaluate(() => Object.values(localStorage).join('').includes('synthetic_orders')), false);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ width, localPreviewOnly: true, exactConsentRequired: true, inventoryConsentRequired: true, rawManifestRejectedLocally: true, sharedReadback: true, revoke: true, failureRecovery: true, overflow: false, pageErrors }));
    await page.close();
  }
} finally { await browser.close(); }
