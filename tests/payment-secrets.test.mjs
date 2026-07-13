import test from 'node:test';
import assert from 'node:assert/strict';
import { findBundleValue } from '../netlify/shared/secrets.mjs';

test('selects an active Square secret by service and key', () => {
  const bundle = [{ service: 'square', key: 'access_token', value: 'selected' }, { service: 'other', key: 'access_token', value: 'wrong' }];
  assert.equal(findBundleValue(bundle, { service: 'square', key: 'access_token', envName: 'SQUARE_ACCESS_TOKEN' }), 'selected');
});

test('rejects a disabled Square secret', () => {
  const bundle = [{ service: 'square', key: 'webhook_signature_key', value: 'stale', disabled: true }];
  assert.equal(findBundleValue(bundle, { service: 'square', key: 'webhook_signature_key', envName: 'SQUARE_WEBHOOK_SIGNATURE_KEY' }), null);
});
