import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

// Exercise the real React component with isolated fixtures. No provider calls,
// real credentials, source projects, or production browser storage are used.
const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { RestoresPage } from '/src/console/pages.jsx';
  import { seedWorkspace } from '/src/console/data/store.js';
  import '/src/console/console.css';
  const scenario = window.restoreScenario;
  const initial = seedWorkspace();
  initial.demoMode = scenario.startsWith('demo');
  initial.restores[0].evidenceStatus = 'RECOVERY_DATA_PATH_VERIFIED';
  window.restoreAudit = { writes: 0, toasts: [], initial: JSON.stringify(initial) };
  function Harness() {
    const [state, update] = React.useState(initial);
    const [live, setLive] = React.useState(false);
    window.restoreAudit.setLive = () => setLive(true);
    window.restoreAudit.state = state;
    const setState = mutator => {
      window.restoreAudit.writes++;
      update(previous => mutator(structuredClone(previous)));
    };
    return React.createElement(RestoresPage, { state, setState,
      demoMode: scenario !== 'live' && !live,
      toast: text => window.restoreAudit.toasts.push(text),
    });
  }
  createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const compiled = await build({
  root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'restore-regression-fixture',
    resolveId(id) { if (id.endsWith('virtual:restore-fixture')) return '\0restore-fixture'; },
    load(id) { if (id === '\0restore-fixture') return fixture; },
  }],
  build: { write: false, minify: false, lib: { entry: 'virtual:restore-fixture', formats: ['iife'], name: 'RestoreFixture' } },
});
const outputs = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(result => result.output);
const bundle = outputs.find(item => item.type === 'chunk' && item.isEntry).code;
const css = outputs.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (const scenario of ['live', 'mismatched-demo', 'demo', 'demo-switch']) {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    const apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.error(`Browser: ${message.text()}`); });
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
    });
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.evaluate(value => { window.restoreScenario = value; }, scenario);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
    if (!scenario.startsWith('demo')) {
      await page.getByText('Runner execution required', { exact: true }).waitFor().catch(error => { throw new Error(`${error.message}\n${errors.join('\n')}`); });
      assert.equal(await page.getByRole('button', { name: /new replay|start.*replay/i }).count(), 0);
      assert.equal(await page.getByText('RECOVERY_DATA_PATH_VERIFIED', { exact: true }).count(), 0);
      await page.waitForTimeout(4500); // Longer than the former full simulated pipeline.
      const evidence = await page.evaluate(() => ({
        writes: window.restoreAudit.writes,
        unchanged: JSON.stringify(window.restoreAudit.state) === window.restoreAudit.initial,
        toasts: window.restoreAudit.toasts,
      }));
      assert.equal(evidence.writes, 0);
      assert.equal(evidence.unchanged, true);
      assert.deepEqual(evidence.toasts, []);
    } else {
      await page.getByRole('heading', { name: 'Replay demo', exact: true }).waitFor();
      assert.equal(await page.getByText('RECOVERY_DATA_PATH_VERIFIED', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'New replay', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('20-char ref of the NEW project').fill('zzzzzzzzzzzzzzzzzzzz');
      await dialog.getByPlaceholder('Must match exactly').fill('zzzzzzzzzzzzzzzzzzzz');
      for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.check();
      await dialog.getByRole('button', { name: 'Start demo replay', exact: true }).click();
      if (scenario === 'demo-switch') {
        const writes = await page.evaluate(() => { window.restoreAudit.setLive(); return window.restoreAudit.writes; });
        await page.getByText('Runner execution required', { exact: true }).waitFor();
        await page.waitForTimeout(4500);
        assert.equal(await page.evaluate(() => window.restoreAudit.writes), writes);
        assert.equal(await page.evaluate(() => window.restoreAudit.state.restores[0].evidenceStatus), null);
      } else {
      await page.waitForFunction(() => window.restoreAudit.state.restores[0].evidenceStatus === 'DEMO_SIMULATION_ONLY');
      const record = await page.evaluate(() => window.restoreAudit.state.restores[0]);
      assert.equal(record.mode, 'demo');
      assert.equal(record.status, 'passed');
      assert.equal(record.evidenceStatus, 'DEMO_SIMULATION_ONLY');
      assert.ok((await page.evaluate(() => window.restoreAudit.toasts)).includes('Demo finished — no restore or validation was performed'));
      }
    }
    assert.deepEqual(errors, [], `${scenario}: browser errors`);
    assert.deepEqual(apiRequests, [], `${scenario}: unexpected API request`);
    results.push({ scenario, passed: true });
    await page.close();
  }
  console.log(JSON.stringify({ results }, null, 2));
} finally {
  await browser?.close();
}
