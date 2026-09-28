import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOUD_FREE, CLI_INSTALL } from '../src/lib/product.js';
import { CLOUD_FREE as serverFree } from '../netlify/shared/product.mjs';
import { isDocsPath } from '../src/lib/site-links.js';
import { DOCS_NAV, QUICKSTART_COMMANDS, resolveDocsSlug } from '../src/data/docs-site.js';

test('docs routes cover introduction, quickstart, cloud, threat model, proven', () => {
  assert.equal(isDocsPath('/docs'), true);
  assert.equal(isDocsPath('/docs/introduction'), true);
  assert.equal(isDocsPath('/docs/quickstart'), true);
  assert.equal(isDocsPath('/cloud'), false);
  assert.equal(resolveDocsSlug('/docs'), 'introduction');
  assert.equal(resolveDocsSlug('/docs/introduction'), 'introduction');
  assert.equal(resolveDocsSlug('/docs/quickstart'), 'quickstart');
  assert.equal(resolveDocsSlug('/docs/cloud'), 'cloud');
  assert.equal(resolveDocsSlug('/docs/threat-model'), 'threat-model');
  assert.equal(resolveDocsSlug('/docs/proven'), 'proven');
  assert.equal(resolveDocsSlug('/docs/keepalive'), 'keepalive');
  assert.equal(resolveDocsSlug('/docs/restore-targets'), 'restore-targets');
  assert.equal(resolveDocsSlug('/docs/rls-check'), 'rls-check');
  assert.equal(resolveDocsSlug('/docs', '#install'), 'cli');
  const slugs = DOCS_NAV.flatMap((g) => g.items.map((i) => i.slug));
  for (const need of ['introduction', 'quickstart', 'keepalive', 'rls-check', 'restore-targets', 'cloud', 'threat-model', 'proven']) {
    assert.equal(slugs.includes(need), true, need);
  }
});

test('quickstart commands match FREE-CLI.md / README, no invented flags', () => {
  assert.equal(QUICKSTART_COMMANDS.install, CLI_INSTALL.npmCommand);
  assert.match(QUICKSTART_COMMANDS.capture, /portabase init/);
  assert.match(QUICKSTART_COMMANDS.capture, /portabase doctor/);
  assert.match(QUICKSTART_COMMANDS.capture, /portabase backup/);
  assert.match(QUICKSTART_COMMANDS.capture, /portabase verify --capsule/);
  assert.match(QUICKSTART_COMMANDS.capture, /portabase restore --capsule/);
  assert.match(QUICKSTART_COMMANDS.capture, /--execute --confirm-target/);
  assert.match(QUICKSTART_COMMANDS.replay, /portabase replay/);
  assert.match(QUICKSTART_COMMANDS.exclude, /--exclude-binaries/);
  assert.doesNotMatch(QUICKSTART_COMMANDS.capture, /--invented|--magic-sync/);
  const freeCli = readFileSync(new URL('../docs/FREE-CLI.md', import.meta.url), 'utf8');
  assert.match(freeCli, /npm i -g portabase/);
  assert.match(freeCli, /portabase backup/);
  assert.match(freeCli, /portabase verify/);
  assert.match(freeCli, /portabase restore/);
});

test('Cloud Free is 100 MB with no scheduled service', () => {
  assert.equal(CLOUD_FREE.id, 'cloud-free');
  assert.equal(CLOUD_FREE.priceMonthlyUsd, 0);
  assert.equal(CLOUD_FREE.projects, 1);
  assert.equal(CLOUD_FREE.storageCapMb, 100);
  assert.equal(CLOUD_FREE.storageCapLabel, '100 MB');
  assert.equal(CLOUD_FREE.scheduled, false);
  assert.equal(serverFree.scheduled, false);
  assert.equal(serverFree.storageCapMb, 100);
  const src = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(src, /CLOUD_FREE/);
  assert.match(src, /No scheduled service/);
  assert.match(src, /The free plan has no scheduled service/);
  assert.match(src, /100 MB/);
  assert.match(src, /10 GB/);
  assert.match(src, /25 GB/);
  assert.doesNotMatch(src, /Cloud Free, then \$7, \$17, or \$37/);
});

test('marketing canvas is IBM Plex Sans on a light teal system, not lime-on-black', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /IBM Plex Sans/);
  assert.match(css, /--accent:\s*#0e7c74/);
  assert.match(css, /\.auth-page\{[^}]*var\(--bg\)/);
  assert.doesNotMatch(css, /\.auth-page\{[^}]*var\(--black\)/);
  assert.match(css, /color-scheme:\s*light/);
});

test('docs copy says open source, praises Supabase, never fake MATCH green', () => {
  const app = readFileSync(new URL('../src/docs/DocsApp.jsx', import.meta.url), 'utf8');
  assert.match(app, /open source/i);
  assert.doesNotMatch(app, /\bOSS\b/);
  assert.match(app, /Supabase is an excellent product/);
  assert.match(app, /stays <strong>RED<\/strong>/);
  assert.match(app, /cannot turn the lamp green/);
  assert.match(app, /not a third-party audited, proven-green/);
  assert.match(app, /table \+ bucket sizer/i);
  assert.match(app, /NOT COVERED/);
  assert.match(app, /100 MB/);
  assert.match(app, /10 GB/);
  assert.match(app, /25 GB/);
});

test('rls-check page resolves, sits in nav, and blames the default', () => {
  assert.equal(resolveDocsSlug('/docs/rls-check'), 'rls-check');
  const slugs = DOCS_NAV.flatMap((g) => g.items.map((i) => i.slug));
  assert.equal(slugs.includes('rls-check'), true);
  const entry = DOCS_NAV.flatMap((g) => g.items).find((i) => i.slug === 'rls-check');
  assert.equal(entry.href, '/docs/rls-check');
  const app = readFileSync(new URL('../src/docs/DocsApp.jsx', import.meta.url), 'utf8');
  assert.match(app, /'rls-check': RlsCheck/);
  assert.match(app, /function RlsCheck/);
  assert.match(app, /What the anon key is/);
  assert.match(app, /Why RLS-off means open/);
  assert.match(app, /Three exposure checks/);
  assert.match(app, /relrowsecurity/);
  assert.match(app, /pg_policies/);
  assert.match(app, /apikey: YOUR-ANON-KEY/);
  assert.match(app, /villain.*default|default.*villain/i);
  assert.match(app, /never you/i);
});

test('homepage reality grid links item 13 to the rls-check guide', () => {
  const src = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(src, /<b>13<\/b>/);
  assert.match(src, /\/docs\/rls-check/);
  assert.match(src, /Check yours in 5 minutes/);
});

test('cloud page carries the cold/warm ladder and never promises hot', () => {
  const src = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(src, /COLD · EVERY PLAN/i);
  assert.match(src, /Encrypted escape in your Dropbox/);
  assert.match(src, /WARM · \$17 \/ PREMIUM/i);
  assert.match(src, /re-adapt runbook/i);
  assert.match(src, /Re-pointable in an hour, not a millisecond/);
  assert.match(src, /HOT · NEVER PROMISED/i);
});

test('keepalive guide keeps RLS on with a single justified public-read policy', () => {
  const docs = readFileSync(new URL('../src/docs/DocsApp.jsx', import.meta.url), 'utf8');
  assert.match(docs, /keepalive: Keepalive,/);
  assert.match(docs, /alter table keepalive enable row level security/);
  assert.doesNotMatch(docs, /disable row level security/);
  assert.match(docs, /Never widen this pattern/);
});