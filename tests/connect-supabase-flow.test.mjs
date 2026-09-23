import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cloudBackupCliCommand } from '../src/lib/table-sizer.js';
import { describeCloudApiError } from '../src/lib/cloud-api.js';

test('cloudBackupCliCommand omits flags with empty lists', () => {
  assert.equal(cloudBackupCliCommand({}), 'npx portabase backup');
  assert.equal(cloudBackupCliCommand({ excludeTables: [], excludeBuckets: [] }), 'npx portabase backup');
});

test('cloudBackupCliCommand adds --exclude-table-data only', () => {
  const cmd = cloudBackupCliCommand({ excludeTables: ['public.big_logs', 'public.events'] });
  assert.equal(cmd, 'npx portabase backup --exclude-table-data public.big_logs,public.events');
});

test('cloudBackupCliCommand adds --exclude-buckets only', () => {
  const cmd = cloudBackupCliCommand({ excludeBuckets: ['videos', 'raw-media'] });
  assert.equal(cmd, 'npx portabase backup --exclude-buckets videos,raw-media');
});

test('cloudBackupCliCommand combines both flags in order', () => {
  const cmd = cloudBackupCliCommand({
    excludeTables: [{ key: 'a.b' }, 'c.d'],
    excludeBuckets: ['x', { key: 'y' }],
  });
  assert.equal(cmd, 'npx portabase backup --exclude-table-data a.b,c.d --exclude-buckets x,y');
});

test('cloudBackupCliCommand drops secret-shaped or empty names', () => {
  const cmd = cloudBackupCliCommand({ excludeTables: ['public.passphrase', '', 'public.ok_table'] });
  assert.equal(cmd, 'npx portabase backup --exclude-table-data public.ok_table');
});

test('describeCloudApiError maps known safe codes to plain language', () => {
  assert.match(describeCloudApiError({ status: 400, data: { error: 'token_rejected' } }), /didn.t work/i);
  assert.match(describeCloudApiError({ status: 429, data: { error: 'rate_limited' } }), /rate-limiting/i);
  assert.match(describeCloudApiError({ status: 404, data: { error: 'project_not_found' } }), /could not be found/i);
  assert.match(describeCloudApiError({ status: 401 }), /sign in again/i);
  assert.match(describeCloudApiError({}), /network error/i);
});

test('describeCloudApiError falls back to the error message for unknown codes', () => {
  const err = new Error('boom');
  err.status = 500;
  err.data = { error: 'weird_code' };
  assert.equal(describeCloudApiError(err), 'boom');
});

const ui = readFileSync(new URL('../src/console/connect-supabase.jsx', import.meta.url), 'utf8');

test('connect-supabase UI never persists the token to storage or a URL', () => {
  assert.doesNotMatch(ui, /localStorage/);
  assert.doesNotMatch(ui, /sessionStorage/);
  assert.doesNotMatch(ui, /token[^\n]*window\.location/);
});

test('connect-supabase UI links to the Supabase token page and explains the token is never saved', () => {
  assert.match(ui, /supabase\.com\/dashboard\/account\/tokens/);
  assert.match(ui, /never saved/i);
  assert.match(ui, /target="_blank"/);
  assert.match(ui, /rel="noopener/);
});

test('connect-supabase UI codes to the projects/inventory/selection contract', () => {
  assert.match(ui, /fetchSupabaseProjects/);
  assert.match(ui, /fetchSupabaseInventory/);
  assert.match(ui, /fetchCloudSelection/);
  assert.match(ui, /saveCloudSelection/);
});

test('connect-supabase UI says what excluding a table or bucket means', () => {
  assert.match(ui, /keeps its structure but skips its rows/i);
  assert.match(ui, /skips its files/i);
});

test('connect-supabase UI disables Save when the selection is over the plan cap', () => {
  assert.match(ui, /disabled=\{loading \|\| overCap\}/);
});

test('connect-supabase UI supports demo mode without a network call for projects/inventory', () => {
  assert.match(ui, /if \(demo\)/);
  assert.match(ui, /sampleSizeInventory/);
  assert.match(ui, /SAMPLE_PROJECTS/);
});

test('connect-supabase UI shows the exact CLI command with a copy button', () => {
  assert.match(ui, /cloudBackupCliCommand/);
  assert.match(ui, /Copy command/);
});
