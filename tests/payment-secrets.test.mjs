import test from 'node:test';
import assert from 'node:assert/strict';
import { findBundleValue, isForeignSquareSecretName, refuseForeignSquareSecret } from '../netlify/shared/secrets.mjs';

test('selects an active Square secret by service and key', () => {
  const bundle = [{ service: 'square', key: 'access_token', value: 'selected' }, { service: 'other', key: 'access_token', value: 'wrong' }];
  assert.equal(findBundleValue(bundle, { service: 'square', key: 'access_token', envName: 'SQUARE_ACCESS_TOKEN' }), 'selected');
});

test('rejects a disabled Square secret', () => {
  const bundle = [{ service: 'square', key: 'webhook_signature_key', value: 'stale', disabled: true }];
  assert.equal(findBundleValue(bundle, { service: 'square', key: 'webhook_signature_key', envName: 'SQUARE_WEBHOOK_SIGNATURE_KEY' }), null);
});

test('Portabase-scoped Square bundle key is selected by its own name', () => {
  const bundle = {
    'square-portabase-production-access-token': 'pbase-token',
    'square-nysmassageexam-production-access-token': 'nys-token',
  };
  assert.equal(findBundleValue(bundle, { service: 'square', key: 'portabase-production-access-token', envName: 'square-portabase-production-access-token' }), 'pbase-token');
  assert.notEqual(findBundleValue(bundle, { service: 'square', key: 'access_token', envName: 'SQUARE_ACCESS_TOKEN' }), 'nys-token');
});

test('refuses another product\'s Square access token', () => {
  const bundle = { 'square-nysmassageexam-production-access-token': 'EAAA_nys' };
  assert.equal(isForeignSquareSecretName('square-nysmassageexam-production-access-token'), true);
  assert.equal(isForeignSquareSecretName('square-portabase-production-access-token'), false);
  assert.throws(() => refuseForeignSquareSecret('EAAA_nys', bundle), /refusing_foreign_square_credentials/);
  assert.doesNotThrow(() => refuseForeignSquareSecret('EAAA_portabase', bundle));
});
