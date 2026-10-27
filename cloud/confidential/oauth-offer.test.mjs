import test from 'node:test';
import assert from 'node:assert/strict';
import {needsOAuthOffer} from './oauth-offer.mjs';

test('expired account-switch offer renews while the existing connection stays usable', () => {
  const existing = { connected: true, link: 'https://example.test/authorize', offeredAt: 1000 };
  assert.equal(needsOAuthOffer({ ...existing, now: 1000 + 7 * 60000 }), false);
  assert.equal(needsOAuthOffer({ ...existing, now: 1000 + 8 * 60000 }), true);
  assert.equal(existing.connected, true);
});

test('completed connections do not start new consent, disconnected slots do', () => {
  assert.equal(needsOAuthOffer({ connected: true }), false);
  assert.equal(needsOAuthOffer({ connected: false }), true);
  assert.equal(needsOAuthOffer({ connected: true, link: 'pending' }), true);
});
