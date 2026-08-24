import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAccess } from '../netlify/shared/subscription-store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('jobs API requires Cloud entitlement (402), not just a signed-in user', () => {
  const src = readFileSync(resolve(root, 'netlify/functions/cloud-jobs.mjs'), 'utf8');
  assert.match(src, /requireCloudAccess/);
  assert.match(src, /402/);
  assert.match(src, /payment_required/);
});

test('confirm-checkout verifies Square evidence and does not grant on checkout_pending alone', () => {
  const src = readFileSync(resolve(root, 'netlify/functions/cloud-confirm-checkout.mjs'), 'utf8');
  assert.match(src, /retrieveCheckoutEvidence/);
  assert.match(src, /squareCheckoutIsFulfilled/);
  assert.match(src, /checkout_incomplete/);
  const verifyAt = src.indexOf('squareCheckoutIsFulfilled');
  const grantAt = src.indexOf("status: 'trialing'");
  assert.ok(verifyAt > 0 && grantAt > verifyAt, 'must verify Square before granting trialing');
});

test('console paywall is identity ≠ entitlement', () => {
  const src = readFileSync(resolve(root, 'src/console/ConsoleApp.jsx'), 'utf8');
  assert.match(src, /hasAccess/);
  assert.match(src, /Card required to open Cloud ops/);
  assert.match(src, /BillingPage/);
});

test('privacy and terms routes exist for Google publish and checkout honesty', () => {
  const main = readFileSync(resolve(root, 'src/main.jsx'), 'utf8');
  assert.match(main, /path === '\/privacy'/);
  assert.match(main, /path === '\/terms'/);
  assert.match(main, /href="\/privacy"/);
  assert.match(main, /href="\/terms"/);
  const privacy = readFileSync(resolve(root, 'src/legal-pages.jsx'), 'utf8');
  assert.match(privacy, /DataAutomation\.ai, LLC/);
  assert.match(privacy, /Square/);
  assert.match(privacy, /do not receive or store PAN/i);
});

test('unpaid deriveAccess still hasAccess false so jobs stay closed', () => {
  assert.equal(deriveAccess({ status: 'checkout_pending' }).hasAccess, false);
  assert.equal(deriveAccess({ status: 'trialing' }).hasAccess, true);
});
