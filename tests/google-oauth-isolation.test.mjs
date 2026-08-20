/**
 * Google OAuth isolation + consent-branding guard.
 *
 * Why this test exists: OAuth code gets copied between repos in this portfolio,
 * and the copy carries the previous product's domains, client IDs, and app name
 * with it. That contamination is invisible in review and silently authenticates
 * users against the wrong product. This test is what catches it.
 *
 * It also pins the Supabase project ref. Portabase Cloud identity has its own
 * project; the Google client's callback URL embeds that ref, so a reappearance
 * of the shared portfolio project here means sign-in is pointed at the wrong
 * user table.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// CONFIG — this product
// ---------------------------------------------------------------------------

/** This product's own public domain. */
const PRODUCT_DOMAIN = 'portabase.dev';

/** Exact app name as registered on the Google consent screen. */
const APP_NAME = 'Portabase';

/** Portabase Cloud's dedicated Supabase project ref. */
const SUPABASE_PROJECT_REF = 'eoiqvdmvgaurlecdzqkp';

/** Refs that must never appear in auth code — the shared portfolio project and
 *  the replay-proof project, which replay runs restore over. */
const FOREIGN_SUPABASE_REFS = [
  'ekklokrukxmqlahtonnc', // shared DataAutomation project
  'svltssnxzqsrxtbjgaex', // portabase-replay-proof (restore target, not identity)
];

/** Every other product domain in this portfolio. None may appear here. */
const FOREIGN_DOMAINS = [
  'nysmassageexam.com',
  'dicefootball.com',
  'booked.af',
  'musicsupplies.com',
];

/** Source files that touch OAuth. */
const OAUTH_SOURCES = [
  'src/lib/google-gis-auth.js',
  'src/lib/supabase-auth.js',
  'src/lib/auth-config.js',
];

/** Server-side files that resolve the Supabase project. */
const SERVER_AUTH_SOURCES = [
  'netlify/shared/supabase-auth.mjs',
];

/** Files that must carry consent-screen branding for Google's reviewers. */
const BRANDING_SOURCES = [
  'index.html',
  'src/auth-pages.jsx',
];

// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const joined = paths => paths.map(read).join('\n');

test('loads the Google web client from the build environment, never a literal', () => {
  const sources = joined(OAUTH_SOURCES);

  // The client ID must be injected at build time so each deployment can carry
  // its own. A hardcoded ID travels with a copy-paste into the next repo.
  assert.match(sources, /import\.meta\.env\.VITE_GOOGLE_OAUTH_CLIENT_ID/);
  assert.doesNotMatch(sources, /\d+-[a-z0-9]+\.apps\.googleusercontent\.com/);
});

test('never ships a Google client secret to the browser', () => {
  const sources = joined(OAUTH_SOURCES);

  // Client secrets are server-side only; Google's format is GOCSPX-...
  assert.doesNotMatch(sources, /GOCSPX-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(sources, /VITE_[A-Z_]*CLIENT_SECRET/);
});

test('keeps OAuth redirects isolated to this product', () => {
  const sources = joined(OAUTH_SOURCES);

  assert.ok(sources.includes(PRODUCT_DOMAIN), `expected ${PRODUCT_DOMAIN} in OAuth sources`);
  for (const foreign of FOREIGN_DOMAINS) {
    assert.ok(!sources.includes(foreign), `foreign product domain ${foreign} leaked into OAuth sources`);
  }
});

test('binds auth to this product’s own Supabase project', () => {
  const sources = joined([...OAUTH_SOURCES, ...SERVER_AUTH_SOURCES]);

  assert.ok(
    sources.includes(SUPABASE_PROJECT_REF),
    `expected dedicated project ref ${SUPABASE_PROJECT_REF} in auth sources`,
  );
  for (const ref of FOREIGN_SUPABASE_REFS) {
    assert.ok(!sources.includes(ref), `foreign Supabase project ref ${ref} leaked into auth sources`);
  }
});

test('uses exactly one Supabase client', () => {
  // A second createClient() with the same storage key races the first for the
  // session, which presents as a session that appears and then vanishes.
  //
  // Strip comments before counting: prose explaining createClient() is common
  // in exactly the well-documented files this test is meant to bless, and
  // counting those mentions would fail a correctly-configured product.
  const code = joined(OAUTH_SOURCES)
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

  const total = code.match(/createClient\s*\(/g) || [];
  assert.ok(total.length <= 1, `expected at most one createClient(), found ${total.length}`);
});

test('never re-enables detectSessionInUrl alongside the explicit callback', () => {
  // Two handlers on the same URL fight over the same fragment; the session
  // appears and then vanishes.
  assert.match(read('src/lib/supabase-auth.js'), /detectSessionInUrl:\s*false/);
});

test('does not use Google One Tap / FedCM', () => {
  // Returns 403 + AbortError on this client type and degrades silently.
  const sources = joined(OAUTH_SOURCES);
  assert.doesNotMatch(sources, /accounts\.google\.com\/gsi\/client/);
  assert.doesNotMatch(sources, /google\.accounts\.id\.(initialize|prompt)/);
});

for (const file of BRANDING_SOURCES) {
  test(`renders the consent-screen app name on ${file}`, () => {
    // Google's verification reviewers open the homepage looking for the app
    // identity. A redesign that drops the name fails verification.
    assert.ok(read(file).includes(APP_NAME), `expected app name "${APP_NAME}" in ${file}`);
  });
}
