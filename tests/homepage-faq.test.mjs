import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOMEPAGE_FAQ } from '../src/data/faq.js';

const REQUIRED = [
  'Do you ever see my Supabase keys?',
  'What is an escape package vs an official backup?',
  'Can I run completely free?',
  'Free CLI vs Cloud — what do I pay for?',
  'Does Cloud Free include scheduled service?',
  'Does the proof lamp go green without a real MATCH?',
  'What do SMS alerts contain?',
  'Do you store my capsule?',
  'How do I keep a Cloud capsule under the plan cap?',
  'My code is already in GitHub — isn’t that enough?',
  'How is this better than a backup I’ve never restored?',
];

test('homepage FAQ covers the honest questions Louis asked for', () => {
  const questions = HOMEPAGE_FAQ.map((item) => item.q);
  for (const q of REQUIRED) assert.equal(questions.includes(q), true, q);
});

test('FAQ answers stay honest: keys, free path, lamp, SMS, vault', () => {
  const byQ = Object.fromEntries(HOMEPAGE_FAQ.map((item) => [item.q, item.a]));

  assert.match(byQ['Do you ever see my Supabase keys?'], /^No\b/);
  assert.match(byQ['Do you ever see my Supabase keys?'], /keys stay on the machine/i);
  assert.match(byQ['Do you ever see my Supabase keys?'], /seals keys to your runner/i);
  assert.match(byQ['Do you ever see my Supabase keys?'], /control plane is blind/i);

  assert.match(byQ['What is an escape package vs an official backup?'], /customer-owned encrypted capsule/i);
  assert.match(byQ['What is an escape package vs an official backup?'], /not Storage files/i);
  assert.match(byQ['What is an escape package vs an official backup?'], /Supabase is an excellent product/i);

  assert.match(byQ['Can I run completely free?'], /^Yes\b/);
  assert.match(byQ['Can I run completely free?'], /--exclude-binaries/);
  assert.match(byQ['Can I run completely free?'], /huge unimportant table/i);
  assert.match(byQ['Can I run completely free?'], /no fake percentage/i);
  assert.match(byQ['Can I run completely free?'], /table sizer/i);
  assert.doesNotMatch(byQ['Can I run completely free?'], /\d+%/);

  assert.match(byQ['Free CLI vs Cloud — what do I pay for?'], /\$7/);
  assert.match(byQ['Free CLI vs Cloud — what do I pay for?'], /\$17/);
  assert.match(byQ['Free CLI vs Cloud — what do I pay for?'], /100 MB/);
  assert.doesNotMatch(byQ['Free CLI vs Cloud — what do I pay for?'], /\$37/);
  assert.match(byQ['Free CLI vs Cloud — what do I pay for?'], /open-source engine is unlimited and free/i);
  assert.match(byQ['Free CLI vs Cloud — what do I pay for?'], /The free plan has no scheduled service/);
  assert.match(byQ['Can I run completely free?'], /The free plan has no scheduled service/i);
  assert.match(byQ['Does Cloud Free include scheduled service?'], /^No\b/);
  assert.match(byQ['Does Cloud Free include scheduled service?'], /The free plan has no scheduled service/);
  assert.match(byQ['Does Cloud Free include scheduled service?'], /unlimited free path/i);

  assert.match(byQ['How do I keep a Cloud capsule under the plan cap?'], /table sizer/i);
  assert.match(byQ['How do I keep a Cloud capsule under the plan cap?'], /NOT COVERED/);
  assert.match(byQ['How do I keep a Cloud capsule under the plan cap?'], /include list/);

  assert.match(byQ['Does the proof lamp go green without a real MATCH?'], /^No\b/);
  assert.match(byQ['Does the proof lamp go green without a real MATCH?'], /stays red/i);
  assert.match(byQ['Does the proof lamp go green without a real MATCH?'], /MATCH/);

  assert.match(byQ['What do SMS alerts contain?'], /Status only/i);
  assert.match(byQ['What do SMS alerts contain?'], /\$17/);
  assert.match(byQ['What do SMS alerts contain?'], /Never keys/i);
  assert.match(byQ['What do SMS alerts contain?'], /capsule bytes/i);

  assert.match(byQ['Do you store my capsule?'], /^No\b/);
  assert.match(byQ['Do you store my capsule?'], /customer-owned/i);

  // Advanced-user skeptic: concedes the repo is real, then isolates the actual gap.
  assert.match(byQ['My code is already in GitHub — isn’t that enough?'], /^Probably, for code\b/);
  assert.match(byQ['My code is already in GitHub — isn’t that enough?'], /Edge Functions/);
  assert.match(byQ['My code is already in GitHub — isn’t that enough?'], /Storage object/);
  assert.match(byQ['My code is already in GitHub — isn’t that enough?'], /Auth users/);
  assert.match(byQ['My code is already in GitHub — isn’t that enough?'], /active, tested backup/i);
  assert.match(byQ['My code is already in GitHub — isn’t that enough?'], /code survives and the business does not/i);

  // Tested-restore pitch: capability + verification, with the honest Auth carve-out.
  assert.match(byQ['How is this better than a backup I’ve never restored?'], /hope, not a plan/);
  assert.match(byQ['How is this better than a backup I’ve never restored?'], /replay straight into a brand-new Supabase project/);
  assert.match(byQ['How is this better than a backup I’ve never restored?'], /--confirm-target/);
  assert.match(byQ['How is this better than a backup I’ve never restored?'], /MATCH/);
  assert.match(byQ['How is this better than a backup I’ve never restored?'], /no automation can do it/i);
  assert.match(byQ['How is this better than a backup I’ve never restored?'], /AUTH-CUTOVER\.md/);
});

test('FAQ says open source, not OSS, and never claims proven-green', () => {
  const blob = HOMEPAGE_FAQ.map((item) => `${item.q}\n${item.a}`).join('\n');
  assert.doesNotMatch(blob, /\bOSS\b/);
  assert.match(blob, /open-source/);
  assert.doesNotMatch(blob, /proven-green/);
  assert.doesNotMatch(blob, /90%|99%/);
});

test('homepage mounts FAQ after the install CTA and uses the shared copy', () => {
  const src = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/data\/faq\.js'/);
  // FAQ follows the conversion sections (InstallCta) so it answers questions
  // readers actually have by then — not ones nobody has asked yet.
  assert.match(src, /<InstallCta Arrow=\{Arrow\} \/><Faq \/>/);
  assert.match(src, /id="faq"/);
  assert.doesNotMatch(src, /id="faq"[\s\S]{0,400}\bOSS\b/);
});
