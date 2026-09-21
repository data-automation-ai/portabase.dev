import test from 'node:test';
import assert from 'node:assert/strict';
import { isCloudConsolePath, isDemoConsoleSearch, isDocsPath } from '../src/lib/site-links.js';

test('dashboard demo query is a console route, not the homepage', () => {
  assert.equal(isCloudConsolePath('/dashboard'), true);
  assert.equal(isCloudConsolePath('/dashboard/'), true);
  assert.equal(isCloudConsolePath('/dashboard?demo=1'), true);
  assert.equal(isCloudConsolePath('/dashboard?demo=1&section=sizer'), true);
  assert.equal(isCloudConsolePath('/app'), true);
  assert.equal(isCloudConsolePath('/app/home'), true);
  assert.equal(isCloudConsolePath('/console'), true);
  assert.equal(isCloudConsolePath('/'), false);
  assert.equal(isCloudConsolePath('/cloud'), false);
  assert.equal(isCloudConsolePath('/docs'), false);
  assert.equal(isDemoConsoleSearch('?demo=1'), true);
  assert.equal(isDemoConsoleSearch('?version=supabase&demo=1'), true);
  assert.equal(isDemoConsoleSearch(''), false);
});

test('docs paths are the docs site, not the homepage', () => {
  assert.equal(isDocsPath('/docs'), true);
  assert.equal(isDocsPath('/docs/introduction'), true);
  assert.equal(isDocsPath('/docs/quickstart'), true);
  assert.equal(isDocsPath('/'), false);
});
