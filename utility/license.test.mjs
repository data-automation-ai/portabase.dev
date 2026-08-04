import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signLicense, verifyLicenseEnvelope } from './license-format.mjs';
import { resolveEdition } from './license.mjs';

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

test('open-core defaults to community without a license file', async () => {
  const previous = process.env.PORTABASE_EDITION;
  delete process.env.PORTABASE_EDITION;
  const result = await resolveEdition({ licensePath: './definitely-missing-portabase.license.json' });
  assert.equal(result.edition, 'community');
  assert.equal(result.license.valid, false);
  if (previous === undefined) delete process.env.PORTABASE_EDITION;
  else process.env.PORTABASE_EDITION = previous;
});

test('explicit demo mode remains available', async () => {
  const result = await resolveEdition({ forceTrial: true });
  assert.equal(result.edition, 'trial');
});
