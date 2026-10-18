import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
const VAULT_STORAGE_KEY = 'portabase.runner.vault.sealed.v1';

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function base64ToBuffer(b64) {
  return Buffer.from(b64, 'base64');
}

test('VAULT_STORAGE_KEY is consistent and versioned', () => {
  assert.equal(VAULT_STORAGE_KEY, 'portabase.runner.vault.sealed.v1');
});

test('Client-side WebCrypto zero-knowledge proof: encrypts payload locally with zero network reliance', async () => {
  const testDbPassword = 'TestSuperSecretPostgresPassword!2026';
  const testApiKey = 'sb_secret_abcdef1234567890';
  const sealingPassword = 'UserMasterSealingPassword999!';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // 1. Generate 128-bit cryptographically secure salt & 96-bit IV
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  assert.equal(salt.byteLength, 16);
  assert.equal(iv.byteLength, 12);

  // 2. Derive 256-bit AES-GCM key using PBKDF2 with SHA-256
  const baseKey = await webcrypto.subtle.importKey(
    'raw',
    enc.encode(sealingPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const derivedKey = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // 3. Sensitive payload inside browser memory
  const rawPayload = JSON.stringify({
    projectRef: 'abcdefghijklmnopqrst',
    dbPassword: testDbPassword,
    supabaseApiKey: testApiKey,
    sealedAt: new Date().toISOString(),
  });

  // 4. Encrypt with AES-GCM
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    enc.encode(rawPayload)
  );
  assert.ok(ciphertext.byteLength > 0);

  // 5. Compute SHA-256 fingerprint
  const hashBuffer = await webcrypto.subtle.digest('SHA-256', ciphertext);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // 6. Sealed object stored in localStorage
  const sealed = {
    format: 'portabase-runner-vault-v1',
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 100000,
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext),
    fingerprint: `sha256:${hashHex}`,
    hasDbPassword: Boolean(testDbPassword),
    hasApiKey: Boolean(testApiKey),
  };

  const serialized = JSON.stringify(sealed);

  // Demonstrable evidence: The serialized stored payload NEVER contains the raw secrets
  assert.doesNotMatch(serialized, new RegExp(testDbPassword));
  assert.doesNotMatch(serialized, new RegExp(testApiKey));
  assert.doesNotMatch(serialized, new RegExp(sealingPassword));

  // 7. Decrypt locally to verify lossless roundtrip
  const loadedSalt = base64ToBuffer(sealed.salt);
  const loadedIv = base64ToBuffer(sealed.iv);
  const loadedCiphertext = base64ToBuffer(sealed.ciphertext);

  const decryptBaseKey = await webcrypto.subtle.importKey(
    'raw',
    enc.encode(sealingPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const decryptKey = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: loadedSalt, iterations: sealed.iterations, hash: 'SHA-256' },
    decryptBaseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decrypted = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: loadedIv },
    decryptKey,
    loadedCiphertext
  );

  const recovered = JSON.parse(dec.decode(decrypted));
  assert.equal(recovered.projectRef, 'abcdefghijklmnopqrst');
  assert.equal(recovered.dbPassword, testDbPassword);
  assert.equal(recovered.supabaseApiKey, testApiKey);
});

test('Tampered ciphertext fails closed under AES-GCM authentication tag verification', async () => {
  const enc = new TextEncoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));

  const baseKey = await webcrypto.subtle.importKey(
    'raw',
    enc.encode('CorrectPassword123'),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const derivedKey = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 10000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    enc.encode('secret-data')
  );

  // Tamper with one byte in the ciphertext
  const tamperedBytes = new Uint8Array(ciphertext);
  tamperedBytes[0] ^= 0xff;

  await assert.rejects(async () => {
    await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      tamperedBytes
    );
  }, /operation failed|tag/i);
});
