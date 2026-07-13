import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signLicense, verifyLicenseEnvelope } from './license-format.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const payload = {
  licenseVersion: 1,
  licenseId: 'license_test',
  orderId: 'order_test',
  edition: 'essentials',
  platform: 'win32',
  issuedAt: '2026-07-13T00:00:00.000Z',
  updates: 'lifetime',
  projectAllowance: 1,
  deviceAllowance: 2,
};

test('signed lifetime license verifies offline only on its selected platform', () => {
  const envelope = signLicense(payload, privateKey);
  assert.equal(verifyLicenseEnvelope(envelope, publicKey, 'win32').valid, true);
  assert.equal(verifyLicenseEnvelope(envelope, publicKey, 'linux').reason, 'wrong_platform');
});

test('license payload tampering fails closed', () => {
  const envelope = signLicense(payload, privateKey);
  envelope.payload.projectAllowance = 99;
  assert.equal(verifyLicenseEnvelope(envelope, publicKey, 'win32').valid, false);
});
