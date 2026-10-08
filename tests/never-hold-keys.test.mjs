import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS_COPY } from '../src/data/never-hold-keys.js';
import { assertRunnerSealUrl } from '../src/lib/runner-seal.js';

const blob = JSON.stringify(KEYS_COPY);

test('shared privacy copy discloses unfinished hosting and legacy credential paths', () => {
  assert.doesNotMatch(blob, /paid service is blind|browser seals keys|This site is blind|never leave that box/i);
  assert.match(KEYS_COPY.lead, /Supabase is an excellent product/);
  assert.match(KEYS_COPY.paths[1].body, /not available yet/i);
  assert.match(KEYS_COPY.paths[2].body, /credentials or inventory through the backend/i);
  assert.match(KEYS_COPY.sealTitle, /not available yet/i);
  assert.match(KEYS_COPY.honest, /does not yet provide a verified zero-knowledge service/i);
  assert.doesNotMatch(blob, /proven-green isolation guarantee is complete/);
  assert.doesNotMatch(blob, /\bOSS\b/);
});

test('homepage, login, dashboard, and seal UI use the shared keys copy', () => {
  const home = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const flow = readFileSync(new URL('../src/components/keys-flow.jsx', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../src/auth-pages.jsx', import.meta.url), 'utf8');
  const dash = readFileSync(new URL('../src/console/customer-dashboard.jsx', import.meta.url), 'utf8');
  const seal = readFileSync(new URL('../src/console/seal-keys.jsx', import.meta.url), 'utf8');
  const agents = readFileSync(new URL('../src/console/pages.jsx', import.meta.url), 'utf8');
  assert.match(home, /KEYS_COPY/);
  assert.match(home, /id="never-hold-keys"/);
  assert.match(home, /id="keys"/);
  assert.match(home, /KeysPathCards/);
  assert.match(home, /KeysFlow/);
  assert.doesNotMatch(home, /never-hold-keys-diagram\.png/);
  assert.match(flow, /keys-flow/);
  assert.match(flow, /is-blind/);
  assert.match(auth, /KEYS_COPY/);
  assert.match(auth, /auth-keys-note/);
  assert.match(auth, /auth-keys-steps/);
  assert.match(auth, /never posted to Portabase servers/);
  assert.doesNotMatch(auth, /provably zero-knowledge/i);
  assert.match(dash, /pb-keys-strip/);
  assert.match(dash, /KEYS_COPY/);
  assert.match(dash, /CONTROL PLANE · BLIND/);
  assert.match(dash, /pb-keys-honest/);
  assert.doesNotMatch(seal, /assertRunnerSealUrl/);
  assert.match(seal, /Do not paste service-role keys/);
  assert.doesNotMatch(seal, /KeysFlow/);
  assert.match(agents, /SealKeysPanel/);
  assert.match(agents, /Seal keys/);
  assert.doesNotMatch(home, /provably zero-knowledge of your encryption keys/i);
  assert.doesNotMatch(agents, /Provably zero-knowledge: Cloud cannot see/i);
});

test('seal URL helper still refuses Portabase /api', () => {
  assert.throws(() => assertRunnerSealUrl('https://portabase.dev/api/cloud/runners'), { code: 'seal_to_runner_only' });
  assert.equal(assertRunnerSealUrl('https://runner.example.internal/seal'), 'https://runner.example.internal/seal');
});
