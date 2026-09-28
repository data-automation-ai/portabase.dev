import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectSquareCheckoutReady,
  squareBlockedPayload,
  squareMode,
} from '../netlify/shared/square-ready.mjs';

test('defaults to LIVE production when env is unset', () => {
  assert.equal(squareMode({}), 'LIVE');
  assert.equal(squareMode({ SQUARE_ENV: 'sandbox' }), 'TEST');
  assert.equal(squareMode({ SQUARE_ENVIRONMENT: 'production' }), 'LIVE');
});

test('lists exact missing Square var names and never invents values', () => {
  const inspect = inspectSquareCheckoutReady({});
  assert.equal(inspect.ready, false);
  assert.deepEqual(inspect.missing, ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID']);
  const payload = squareBlockedPayload(inspect);
  assert.equal(payload.error, 'checkout_blocked');
  assert.match(payload.message, /SQUARE_ACCESS_TOKEN/);
  assert.match(payload.message, /SQUARE_LOCATION_ID/);
  assert.equal(payload.mode, 'LIVE');
  assert.ok(!JSON.stringify(payload).includes('sq0'));
});

test('ready when required vars are present', () => {
  const inspect = inspectSquareCheckoutReady({
    SQUARE_ACCESS_TOKEN: 'set',
    SQUARE_LOCATION_ID: 'set',
    SQUARE_ENVIRONMENT: 'production',
  });
  assert.equal(inspect.ready, true);
  assert.equal(inspect.mode, 'LIVE');
  assert.deepEqual(inspect.missing, []);
});
