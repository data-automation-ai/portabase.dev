import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CloudWatchLivePage, CloudTrailLivePage } from '/src/console/pages.jsx';
import '/src/console/console.css';
const props = {
  navigate: page => { document.getElementById('destination').textContent = page; },
  state: { secrets: [{ id: 'PRIVATE_SECRET', label: 'PRIVATE_LABEL' }] },
};
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null,
  React.createElement(CloudWatchLivePage, props), React.createElement(CloudTrailLivePage, props)));`;
const compiled = await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'private-log-fixture',
    resolveId(id) { if (id.endsWith('virtual:private-log-fixture')) return '\0private-log-fixture'; },
    load(id) { if (id === '\0private-log-fixture') return fixture; },
  }], build: { write: false, minify: false, lib: { entry: 'virtual:private-log-fixture', formats: ['iife'], name: 'LogFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(item => item.output);
const bundle = output.find(item => item.type === 'chunk' && item.isEntry).code;
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map(item => String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.setContent('<div class="pb-console"><main class="pb-main"><div class="pb-body" id="root"></div><output id="destination"></output></main></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
    await page.getByRole('heading', { name: 'Runner activity' }).waitFor();
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE_'), false);
    await page.getByRole('heading', { name: 'AWS audit history' }).waitFor();
    const buttons = page.getByRole('button', { name: 'Open telemetry' });
    assert.equal(await buttons.count(), 2);
    for (let index = 0; index < 2; index++) {
      await page.locator('#destination').evaluate(node => { node.textContent = ''; });
      await buttons.nth(index).click();
      assert.equal(await page.locator('#destination').innerText(), 'telemetry');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    await page.close();
  }
  console.log('Private log panel: 320/1440px, telemetry navigation, no private fields or network calls passed.');
} finally { await browser.close(); }
