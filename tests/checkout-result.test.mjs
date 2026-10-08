import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutResult } from '../src/lib/checkout-result.js';

test('pending and malformed checkout responses never announce active access', () => {
  for (const response of [undefined, {}, { ok: false, pending: true }, { ok: true, pending: true, access: { hasAccess: true } }, { ok: true }, { ok: true, access: { hasAccess: false } }]) {
    assert.equal(checkoutResult(response).confirmed, false);
    assert.notEqual(checkoutResult(response).tone, 'ok');
  }
});
test('verified checkout with active entitlement permits success', () => {
  assert.equal(checkoutResult({ ok: true, access: { hasAccess: true } }).confirmed, true);
});
