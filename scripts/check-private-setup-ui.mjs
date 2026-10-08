import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUiServer } from '../utility/ui/server.mjs';
import { resolvePrivateJob } from '../cloud/runner/private-config.mjs';
import { engineArgvForJob } from '../cloud/runner/worker.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
assert.doesNotMatch(tmpdir(), /^[fF]:/);
const directory = await mkdtemp(join(tmpdir(), 'portabase-private-ui-browser-'));
const runnerId = '11111111-1111-4111-8111-111111111111', projectRef = 'abcdefghijklmnopqrst';
await writeFile(join(directory, 'engine.json'), JSON.stringify({ projectRef, provider: { type: 's3', bucket: 'synthetic' }, backupDirectory: 'capsules', statusDirectory: 'status' }));
const privateSetup = { directory, runnerId, projectRef, engineConfigPath: 'engine.json' };
let unavailable = false;
const server = await startUiServer({ privateSetup, collect: async () => {
  if (unavailable) throw new Error('private provider diagnostic');
  return { project: { ref: projectRef }, database: { ok: true, data: { tables: [
    { schema: 'public', name: 'orders', bytes: 3407872, capsule: 'structure + rows' },
    { schema: 'public', name: 'activity_log', bytes: 73400320, capsule: 'structure + rows' },
    { schema: 'storage', name: 'objects', bytes: 524288, capsule: 'recreated' },
  ] } }, storage: { ok: true, data: { buckets: [{ id: 'product-images', totalBytes: 180355072, objectCount: 1800 }] } } };
} });
const origin = new URL(server.url).origin;
const evidence = resolve('portabase-evidence/private-setup'); await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) {
    unavailable = false;
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request(); requests.push({ url: request.url(), method: request.method() });
      return new URL(request.url()).origin === origin ? route.continue() : route.abort();
    });
    await page.goto(server.url);
    await page.getByText('Inventory loaded in this private workspace.', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '');
    const save = page.getByRole('button', { name: 'Save private selection', exact: true });
    await page.getByRole('checkbox', { name: 'Include table public.activity_log', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Include bucket product-images', exact: true }).uncheck();
    assert.match(await page.locator('#summary').innerText(), /1 table · 0 buckets/);
    await page.screenshot({ path: join(evidence, `selection-${width}.png`), fullPage: true });
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/configurations'));
    await save.click();
    const response = await responsePromise;
    assert.equal(response.status(), 201);
    const saved = await response.json(); const { type, ...payload } = saved.intent;
    const resolved = await resolvePrivateJob({ type, payload }, privateSetup);
    const argv = engineArgvForJob(resolved.job, resolved);
    assert.equal(argv[argv.indexOf('--exclude-table-data') + 1], 'public.activity_log');
    assert.equal(argv[argv.indexOf('--exclude-buckets') + 1], 'product-images');
    await page.getByRole('heading', { name: 'Private selection saved', exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    assert.doesNotMatch(await page.locator('#intent').innerText(), /activity_log|product-images/);
    await page.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Include table public.orders', exact: true }).waitFor();
    await page.getByRole('checkbox', { name: 'Include table public.orders', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Include table public.activity_log', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Include bucket product-images', exact: true }).uncheck();
    assert.equal(await save.isDisabled(), true);
    await page.getByRole('checkbox', { name: 'I intend to save with no table rows or bucket files selected', exact: true }).check();
    assert.equal(await save.isDisabled(), false);
    unavailable = true;
    await page.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await save.isDisabled(), true);
    assert.doesNotMatch(await page.getByRole('alert').innerText(), /private provider diagnostic/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(requests.every(request => new URL(request.url).origin === origin), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Private setup UI: 320/1440 px; select/save -> private resolver -> argv; empty-selection gate; failed refresh; no external requests or overflow.');
} finally { await browser.close(); await server.close(); }
