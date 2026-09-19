import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPSULE_KEY_MIN_LENGTH,
  cliInjectHint,
  fingerprintPassphrase,
  neverSendFields,
  requireLocalPassphrase,
  shortFingerprint,
} from '../src/lib/capsule-key.js';

test('passphrase minimum is 16 and fingerprint is hex, not the secret', async () => {
  assert.equal(CAPSULE_KEY_MIN_LENGTH, 16);
  assert.throws(() => requireLocalPassphrase('short'), /16/);
  const secret = 'correct horse battery';
  const fp = await fingerprintPassphrase(secret, 'cap_demo');
  assert.match(fp, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(fp, /horse/);
  assert.equal(shortFingerprint(fp).includes('…'), true);
  const other = await fingerprintPassphrase(secret, 'cap_other');
  assert.notEqual(fp, other);
});

test('CLI inject hint never embeds the passphrase', () => {
  const hint = cliInjectHint('cap_abc');
  assert.match(hint, /PORTABASE_ENCRYPTION_PASSPHRASE/);
  assert.match(hint, /cap_abc/);
  assert.doesNotMatch(hint, /correct horse/);
  assert.ok(neverSendFields().some((item) => /passphrase/i.test(item)));
});
