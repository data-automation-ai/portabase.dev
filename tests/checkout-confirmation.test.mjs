import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutConfirmation, preservePendingCheckout } from '../src/lib/checkout-confirmation.js';
import { checkoutResult } from '../src/lib/checkout-result.js';

test('pending responses and network failure retain an existing attempt for explicit confirmation retry', async () => {
  const requests = [], states = [];
  const results = [{ ok: false, pending: true }, new Error('private error'), { ok: true, access: { hasAccess: true } }];
  const controller = createCheckoutConfirmation({ attempt: 'original', version: 'supabase', addon: null,
    confirm: async input => { requests.push(input); const result = results.shift(); if (result instanceof Error) throw result; return result; } });
  controller.subscribe(value => states.push(value.status));
  assert.equal((await controller.retry()).status, 'pending');
  assert.equal((await controller.retry()).status, 'unavailable');
  assert.equal(controller.snapshot().message.includes('private error'), false);
  assert.equal((await controller.retry()).status, 'verified');
  await controller.retry();
  assert.equal(requests.length, 3);
  assert.ok(requests.every(value => value.attempt === 'original' && value.version === 'supabase'));
  assert.deepEqual(states, ['verifying', 'pending', 'verifying', 'unavailable', 'verifying', 'verified']);
});

test('simultaneous retries share one in-flight confirmation; missing reference makes no request', async () => {
  let finish, calls = 0;
  const controller = createCheckoutConfirmation({ attempt: 'original', confirm: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = controller.retry(), second = controller.retry();
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1);
  finish({ ok: false, pending: true }); await first;
  const missing = createCheckoutConfirmation({ confirm: () => { throw new Error('must not request'); } });
  assert.equal((await missing.retry()).retryable, false);
});

test('navigation preserves pending callback identity and only verified access can clear it', () => {
  const checkout = { attempt: 'existing-attempt', addon: 'extra-transfers', verified: false };
  const path = preservePendingCheckout('/app/account?version=supabase&tab=billing', checkout);
  const url = new URL(path, 'https://portabase.dev');
  assert.equal(url.searchParams.get('attempt'), checkout.attempt);
  assert.equal(url.searchParams.get('checkout'), 'complete');
  assert.equal(url.searchParams.get('addon'), checkout.addon);
  assert.equal(url.searchParams.get('tab'), 'billing');
  assert.equal(preservePendingCheckout('/dashboard', { ...checkout, verified: true }), '/dashboard');
  assert.equal(checkoutResult({ ok: true, access: { hasAccess: 'true' } }).confirmed, false);
});

test('base access cannot announce an unverified or expired add-on as confirmed', () => {
  const result = { ok: true, access: { hasAccess: true }, subscription: { extraTransfersAddon: true, addonStatus: 'active', addonVerifiedBy: 'square_api', addonCurrentPeriodEnd: '2026-10-10T00:00:00Z' } };
  const options = { addon: 'extra-transfers', now: Date.parse('2026-10-05T00:00:00Z') };
  assert.equal(checkoutResult(result, options).confirmed, true);
  assert.equal(checkoutResult({ ...result, subscription: {} }, options).confirmed, false);
  assert.equal(checkoutResult(result, { ...options, now: Date.parse('2026-10-11T00:00:00Z') }).confirmed, false);
});
