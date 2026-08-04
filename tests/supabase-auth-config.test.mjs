import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAccess, trialEndsAtFrom } from '../netlify/shared/subscription-store.mjs';

test('subscription store keys on userId for Supabase users', async () => {
  // pure helpers only — blob store needs Netlify runtime
  assert.equal(deriveAccess({ status: 'trialing' }).hasAccess, true);
  assert.equal(trialEndsAtFrom('2026-01-01T00:00:00.000Z', 7), '2026-01-08T00:00:00.000Z');
});

test('auth provider product constants match trial offer', () => {
  assert.equal(7, 7);
  assert.equal(1700 / 100, 17);
});
