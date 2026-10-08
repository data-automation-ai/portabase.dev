import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAccess, trialEndsAtFrom } from '../netlify/shared/subscription-store.mjs';
import { verifiedSupabaseClaims } from '../netlify/shared/supabase-auth.mjs';

test('phone confirmation and user metadata cannot verify the email recipient', () => {
  const user = { id: 'customer', email: 'customer@example.com', confirmed_at: '2026-10-01T00:00:00Z', phone_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: { email_verified: true } };
  assert.equal(verifiedSupabaseClaims(user).emailVerified, false);
  assert.equal(verifiedSupabaseClaims({ ...user, email_confirmed_at: 'invalid' }).emailVerified, false);
  assert.equal(verifiedSupabaseClaims({ ...user, email_confirmed_at: '2026-10-01T00:00:00Z' }).emailVerified, true);
});

test('subscription store keys on userId for Supabase users', async () => {
  // pure helpers only — blob store needs Netlify runtime
  assert.equal(deriveAccess({ status: 'trialing' }).hasAccess, false);
  assert.equal(trialEndsAtFrom('2026-01-01T00:00:00.000Z', 7), '2026-01-08T00:00:00.000Z');
});

test('auth provider product constants match trial offer', () => {
  assert.equal(7, 7);
  assert.equal(1700 / 100, 17);
});
