import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SQUARE_REQUIRED_VAR_NAMES,
  squareBillingView,
  publicSquareStatus,
} from '../src/lib/square-public.js';
import { inspectSquareCheckoutReady } from '../netlify/shared/square-ready.mjs';

test('demo and unknown Square status fail closed with exact var names', () => {
  const demo = squareBillingView({ demoMode: true });
  assert.equal(demo.ready, false);
  assert.equal(demo.failClosed, true);
  assert.deepEqual(demo.missing, ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID']);
  assert.doesNotMatch(JSON.stringify(demo), /sq0|EAAA|secret-value/i);

  const unknown = squareBillingView({});
  assert.equal(unknown.ready, false);
  assert.deepEqual(unknown.missing, SQUARE_REQUIRED_VAR_NAMES);
});

test('live ready only when inspect says ready and names stay names', () => {
  const blocked = publicSquareStatus(inspectSquareCheckoutReady({}));
  assert.equal(blocked.ready, false);
  assert.ok(blocked.missing.includes('SQUARE_ACCESS_TOKEN'));

  const ready = publicSquareStatus(inspectSquareCheckoutReady({
    SQUARE_ACCESS_TOKEN: 'set',
    SQUARE_LOCATION_ID: 'set',
  }));
  assert.equal(ready.ready, true);
  assert.equal(ready.failClosed, false);
  assert.doesNotMatch(JSON.stringify(ready), /sq0|"set"/);
});

test('secret-shaped live payloads are discarded', () => {
  const stripped = squareBillingView({
    live: { ready: true, missing: [], message: 'token sq0atp-secret' },
  });
  assert.equal(stripped.ready, false);
  assert.equal(stripped.reason, 'secret_stripped');
});
