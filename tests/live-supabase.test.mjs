import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIVE_VIEWER_COPY,
  assertBrowserToSupabaseOnly,
  isPortabaseHost,
  liveCliFallback,
  neverSendLiveSecretsTo,
  normalizeProjectUrl,
  parsePostgrestCatalog,
  wipeLiveSession,
} from '../src/lib/live-supabase.js';

test('viewer copy is browser-only and contrasts capsule ZK', () => {
  assert.match(LIVE_VIEWER_COPY.banner, /never receives these keys or query results/i);
  assert.match(LIVE_VIEWER_COPY.contrast, /not the capsule/i);
  assert.ok(neverSendLiveSecretsTo().some((item) => /\/api\/cloud/.test(item)));
});

test('normalize and guard reject Portabase Cloud and Management API', () => {
  assert.equal(normalizeProjectUrl('https://abcd.supabase.co/rest/v1/'), 'https://abcd.supabase.co');
  assert.equal(isPortabaseHost('portabase.dev'), true);
  assert.throws(() => assertBrowserToSupabaseOnly('https://portabase.dev/api/cloud/jobs'), /will not call Portabase/);
  assert.throws(() => assertBrowserToSupabaseOnly('https://api.supabase.com/v1/projects'), /Management API/);
  assert.doesNotThrow(() => assertBrowserToSupabaseOnly('https://abcd.supabase.co/rest/v1/users'));
});

test('OpenAPI catalog parser lists tables not rpc', () => {
  const tables = parsePostgrestCatalog({
    definitions: {
      profiles: { properties: { id: { type: 'string' }, email: { type: 'string' } } },
    },
    paths: {
      '/profiles': { get: {} },
      '/rpc/do_thing': { post: {} },
    },
  });
  assert.equal(tables.length, 1);
  assert.equal(tables[0].name, 'profiles');
  assert.equal(tables[0].columns.length, 2);
  assert.ok(!tables.some((t) => t.name === 'do_thing'));
});

test('wipe session does not post to Cloud', () => {
  assert.equal(wipeLiveSession().postedToCloud, false);
});

test('CLI fallback is local and no Netlify proxy function exists', () => {
  assert.match(liveCliFallback('ekklo'), /supabase functions list/);
  assert.doesNotMatch(liveCliFallback(), /portabase\.dev\/api/);
  const dir = join(process.cwd(), 'netlify/functions');
  for (const name of readdirSync(dir)) {
    assert.doesNotMatch(name, /live-supabase|supabase-viewer|proxy-supabase/i);
    const src = readFileSync(join(dir, name), 'utf8');
    assert.doesNotMatch(src, /service_role.*fetch.*supabase\.co/);
  }
});
