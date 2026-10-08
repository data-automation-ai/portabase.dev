import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const agent = { id: '11111111-1111-4111-8111-111111111111', jobAccess: true, revokedAt: null };
const reference = { version: 2, type: 'backup', runnerId: agent.id, configRef: '22222222-2222-4222-8222-222222222222', configRevision: 1 };
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ManagedBackupSchedules} from '/src/console/managed-backup-schedules.jsx'; import '/src/console/console.css';
  const token='fixture.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))+'.fixture';
  localStorage.setItem('portabase.auth.v1',JSON.stringify({provider:'supabase',cloudVersion:'supabase',accessToken:token,user:{id:'schedule-ui-fixture'}}));
  createRoot(document.getElementById('root')).render(React.createElement(ManagedBackupSchedules));`;
const compiled = await build({ root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'schedule-fixture', resolveId(id) { if (id.endsWith('virtual:schedules')) return '\0schedules'; }, load(id) { if (id === '\0schedules') return fixture; } }],
  build: { write: false, minify: false, lib: { entry: 'virtual:schedules', formats: ['iife'], name: 'ScheduleFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(value => value.output);
const bundle = output.find(value => value.type === 'chunk' && value.isEntry).code;
const css = output.filter(value => value.type === 'asset' && value.fileName.endsWith('.css')).map(value => String(value.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const evidence = resolve(root, 'portabase-evidence/managed-backup-schedules'); await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1050 } }); page.setDefaultTimeout(10000);
    let saved = [], dispatcher = false, deny = null, loseResponse = false;
    const writes = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()); assert.equal(url.origin, 'https://portabase.fixture.test');
      const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div class="pb-console"><main class="pb-main"><div id="root" class="pb-body"></div></main></div></body></html>' });
      if (url.pathname === '/api/cloud/agents') return json({ agents: [agent] });
      assert.equal(url.pathname, '/api/cloud/schedules');
      const envelope = { dispatcherEnabled: dispatcher, execution: 'queue_only' };
      if (req.method() === 'GET') return json({ ...envelope, schedules: saved });
      const body = req.postDataJSON(); writes.push({ method: req.method(), body });
      if (deny) { const result = deny; deny = null; return json({ error: result.error }, result.status); }
      const prior = saved.find(row => row.id === body.id);
      if ((prior?.revision || 0) !== body.revision) return json({ error: 'schedule_changed' }, 409);
      const schedule = { ...prior, ...body, revision: body.revision + 1, status: body.enabled ? 'waiting' : 'disabled',
        nextDueAt: body.startAt || prior?.startAt, lastScheduledAt: null, lastJobStatus: null };
      saved = [...saved.filter(row => row.id !== body.id), schedule];
      if (loseResponse) { loseResponse = false; return route.abort(); }
      return json({ ...envelope, schedule });
    });
    await page.goto('https://portabase.fixture.test/'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    await page.getByText('No saved backup schedules.', { exact: true }).waitFor();
    await page.getByText('Hosted private workspace access is not available yet.', { exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: 'Dispatch blocked' }).waitFor();
    await page.getByRole('button', { name: 'New backup schedule', exact: true }).click();
    const file = page.getByLabel('Opaque backup reference JSON (maximum 4 KiB)', { exact: true });
    const upload = value => file.setInputFiles({ name: 'backup-reference.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    for (const value of [{ ...reference, type: 'replay' }, { ...reference, sourceKey: 'PRIVATE_CANARY' }, { ...reference, runnerId: reference.configRef }]) {
      await upload(value); await page.getByRole('alert').waitFor(); assert.equal(writes.length, 0);
      assert.equal(await page.getByRole('button', { name: 'Save schedule', exact: true }).isDisabled(), true);
    }
    await file.setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(4097, 'x') });
    await page.getByRole('alert').waitFor(); assert.equal(writes.length, 0);
    await upload(reference); await page.getByLabel('Local backup reference preview', { exact: true }).waitFor();
    assert.equal(writes.length, 0);
    await page.getByLabel('Enable scheduled backups for this private reference.', { exact: true }).check();
    deny = { status: 402, error: 'subscription_required' };
    await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'verified paid subscription' }).waitFor();
    await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Schedule saved.' }).waitFor();
    assert.equal(saved.length, 1); assert.equal(writes.length, 2);
    assert.equal(writes[0].body.id, writes[1].body.id);
    assert.deepEqual(Object.keys(writes[1].body).sort(), ['id', 'revision', 'runnerId', 'configRef', 'configRevision', 'everyHours', 'startAt', 'enabled'].sort());
    const refresh = () => page.getByRole('button', { name: 'Refresh saved schedules', exact: true }).click();
    saved[0].status = 'quota_exhausted'; dispatcher = true; await refresh(); await page.getByText('Quota reached', { exact: true }).waitFor();
    saved[0].status = 'queued'; saved[0].lastJobStatus = 'queued'; await refresh(); await page.getByText('Backup queued', { exact: true }).waitFor();
    assert.equal(writes.length, 2);
    await page.screenshot({ path: resolve(evidence, `queued-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Edit schedule 1', exact: true }).click();
    await page.getByLabel('Hours between backups', { exact: true }).fill('48'); saved[0].revision++;
    await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save schedule', exact: true }).isDisabled(), true);
    await refresh(); await page.getByRole('button', { name: 'Disable schedule 1', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Schedule disabled.' }).waitFor();
    assert.equal(saved[0].enabled, false); assert.equal(writes.at(-1).method, 'PATCH');
    assert.deepEqual(Object.keys(writes.at(-1).body).sort(), ['id', 'revision', 'enabled'].sort());
    await page.getByRole('button', { name: 'Edit schedule 1', exact: true }).click();
    await page.getByLabel('Hours between backups', { exact: true }).fill('48'); loseResponse = true;
    await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'change is unconfirmed' }).waitFor();
    const beforeRefresh = writes.length; await refresh();
    await page.getByRole('heading', { name: 'Backup every 48 hours', exact: true }).waitFor(); assert.equal(writes.length, beforeRefresh);
    assert.doesNotMatch(JSON.stringify(writes), /PRIVATE_CANARY|sourceKey|passphrase|manifest|excludeTables/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Edit schedule 1', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(evidence, `editor-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('Schedule GUI passed at 320/1440px: private import rejection, explicit save, subscription denial, dispatcher block, quota/queue states, revision conflict, disable, unknown-response refresh, privacy and overflow. Fixture API only; no providers.');
} finally { await browser.close(); }
