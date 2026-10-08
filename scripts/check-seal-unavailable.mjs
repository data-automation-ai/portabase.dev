import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

// Compile the actual panel and exercise it without any backend or provider.
const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { SealKeysPanel } from '/src/console/seal-keys.jsx';
  import '/src/console/console.css';
  window.sealToasts = [];
  createRoot(document.getElementById('root')).render(React.createElement(SealKeysPanel, {
    demo: window.sealDemo, toast: text => window.sealToasts.push(text)
  }));
`;
const compiled = await build({
  root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'seal-regression-fixture',
    resolveId(id) { if (id.endsWith('virtual:seal-fixture')) return '\0seal-fixture'; },
    load(id) { if (id === '\0seal-fixture') return fixture; },
  }],
  build: { write: false, minify: false, lib: { entry: 'virtual:seal-fixture', formats: ['iife'], name: 'SealFixture' } },
});
const outputs = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(result => result.output);
const bundle = outputs.find(item => item.type === 'chunk' && item.isEntry).code;
const css = outputs.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map(item => String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const browser = await chromium.launch({ headless: true });
try {
  for (const demo of [false, true]) for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent('<div class="pb-console"><main id="root"></main></div>');
    await page.addStyleTag({ content: css });
    await page.evaluate(value => { window.sealDemo = value; }, demo);
    await page.addScriptTag({ content: bundle });
    const panel = page.getByRole('region', { name: 'Private runner setup' });
    await panel.getByRole('status').waitFor();
    assert.match(await panel.innerText(), /not available yet/);
    assert.equal(await panel.locator('input, textarea, form').count(), 0);
    const action = panel.getByRole('button', { name: 'Private runner setup unavailable', exact: true });
    assert.equal(await action.isDisabled(), true);
    await action.evaluate(button => button.click());
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.sealToasts), []);
    assert.equal(await panel.getByText(/Runner only|Accepted destination|will POST a sealed/).count(), 0);
    assert.equal(await panel.getByText(/Demo workspace/).count(), demo ? 1 : 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Seal panel: live/demo at 320/1440 px, unavailable state, disabled action, no inputs, no requests or success toasts.');
} finally { await browser.close(); }
