import test from 'node:test';
import assert from 'node:assert/strict';
import { safeAuthReturnPath, checkoutPlanFromSearch } from '../src/lib/auth-return.js';

test('same-site return preserves checkout intent without accepting external navigation', () => {
  const wanted = '/app/account?tab=billing&plan=cloud-7';
  assert.equal(safeAuthReturnPath(wanted), wanted);
  assert.equal(safeAuthReturnPath('/dashboard?version=supabase'), '/dashboard?version=supabase');
  for (const value of ['https://evil.example', '//evil.example/path', '/\\evil.example', '/%2fevil.example', '/%2F%2fevil.example', '/%5cevil.example', '/%255cevil.example', '/%252fevil.example', '/app%0a/evil', '/app%0D', '/app%00', '/app\u007f', '/app\n', 'javascript:alert(1)', null, '/broken%']) {
    assert.equal(safeAuthReturnPath(value), '/dashboard', JSON.stringify(value));
  }
});
test('checkout plan query accepts only public paid choices and carries no entitlement', () => {
  assert.equal(checkoutPlanFromSearch('?plan=cloud-7'), 'cloud-7');
  assert.equal(checkoutPlanFromSearch('?plan=cloud-17'), 'cloud-17');
  for (const value of ['cloud-free', 'cloud-37', 'cloud-27', 'unknown', '']) assert.equal(checkoutPlanFromSearch(`?plan=${value}`), null);
});
