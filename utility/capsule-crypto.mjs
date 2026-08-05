/**
 * Portabase capsule key protection — **open source (Apache-2.0)**
 * ============================================================================
 * This module is the customer-auditable crypto path for Escape capsules.
 * Cloud and the CLI both call these functions; there is no separate closed-source
 * encryptor for recovery bytes.
 *
 * ## What this protects
 * - **Encryption passphrase** (customer secret, ≥16 characters) → scrypt KDF → 256-bit key
 * - **Capsule payload** → AES-256-GCM (authenticated encryption)
 * - **Integrity** → SHA-256 of plaintext and ciphertext recorded in capsule metadata
 *
 * ## What this does NOT do
 * - Store passphrases, Supabase service keys, or DB URLs
 * - Send crypto material to Portabase Cloud
 * - Implement Cloud “Trust Portabase” secret injection (ops layer; not this file)
 *
 * ## Algorithm summary (format `portabase-aes256gcm-v1`)
 * 1. Require passphrase length ≥ 16
 * 2. Generate random 16-byte salt + 12-byte IV
 * 3. `scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1 })` → AES key
 * 4. AES-256-GCM encrypt stream with AAD (e.g. capsule id)
 * 5. Persist metadata: kdf params, iv, authTag, aad, plaintextSha256, ciphertextSha256
 * 6. Decrypt verifies ciphertext hash, GCM auth tag, then plaintext hash
 *
 * ## Where it is used
 * - `utility/portabase.mjs` — `backup` / `verify` / `restore` / `replay`
 * - Re-exported from `utility/portabase-core.mjs` for existing imports
 *
 * Read this file. Fork it. Pin a commit. That is the product promise for key protection code.
 *
 * @module capsule-crypto
 * @license Apache-2.0
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/** Public format id written into capsule.json encryption metadata. */
export const CAPSULE_CRYPTO_FORMAT = 'portabase-aes256gcm-v1';

/** Cipher name (Node OpenSSL). */
export const CAPSULE_CIPHER = 'aes-256-gcm';

/** scrypt parameters — must stay stable for decrypt of existing capsules. */
export const CAPSULE_SCRYPT = Object.freeze({
  name: 'scrypt',
  N: 32768,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 64 * 1024 * 1024,
});

/** Minimum passphrase length enforced before any crypto runs. */
export const CAPSULE_PASSPHRASE_MIN_LENGTH = 16;

/**
 * SHA-256 hex digest of a file (streaming).
 * Used for plaintext/ciphertext integrity in capsule metadata.
 */
export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Fail closed if the customer passphrase is missing or too short.
 * @param {string} passphrase
 */
export function requirePassphrase(passphrase) {
  if (!passphrase || passphrase.length < CAPSULE_PASSPHRASE_MIN_LENGTH) {
    throw new Error(
      `PORTABASE_ENCRYPTION_PASSPHRASE must contain at least ${CAPSULE_PASSPHRASE_MIN_LENGTH} characters.`,
    );
  }
}

/**
 * Encrypt a file into a Portabase capsule ciphertext object.
 *
 * @param {string} inputPath - plaintext path (e.g. capsule.tar.gz)
 * @param {string} outputPath - ciphertext path (e.g. capsule.pbase); must not already exist
 * @param {string} passphrase - customer secret (never logged, never written by this function)
 * @param {string} aadText - additional authenticated data (typically capsule id)
 * @returns {Promise<object>} encryption metadata for capsule.json
 */
export async function encryptFile(inputPath, outputPath, passphrase, aadText) {
  requirePassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scrypt(passphrase, salt, CAPSULE_SCRYPT.keylen, {
    N: CAPSULE_SCRYPT.N,
    r: CAPSULE_SCRYPT.r,
    p: CAPSULE_SCRYPT.p,
    maxmem: CAPSULE_SCRYPT.maxmem,
  });
  const cipher = createCipheriv(CAPSULE_CIPHER, key, iv);
  const aad = Buffer.from(String(aadText || ''), 'utf8');
  cipher.setAAD(aad);
  const plaintextSha256 = await hashFile(inputPath);
  await pipeline(createReadStream(inputPath), cipher, createWriteStream(outputPath, { flags: 'wx' }));
  return {
    format: CAPSULE_CRYPTO_FORMAT,
    cipher: CAPSULE_CIPHER,
    kdf: {
      name: CAPSULE_SCRYPT.name,
      N: CAPSULE_SCRYPT.N,
      r: CAPSULE_SCRYPT.r,
      p: CAPSULE_SCRYPT.p,
      salt: salt.toString('base64'),
    },
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    aad: aad.toString('base64'),
    plaintextSha256,
    ciphertextSha256: await hashFile(outputPath),
  };
}

/**
 * Decrypt a Portabase capsule ciphertext object.
 * Verifies ciphertext SHA-256, GCM auth tag, then plaintext SHA-256.
 *
 * @param {string} inputPath - ciphertext path
 * @param {string} outputPath - plaintext output; must not already exist
 * @param {string} passphrase - same customer secret used at encrypt time
 * @param {object} encryption - metadata from capsule.json (returned by encryptFile)
 */
export async function decryptFile(inputPath, outputPath, passphrase, encryption) {
  requirePassphrase(passphrase);
  if (!existsSync(inputPath)) throw new Error(`Encrypted capsule not found: ${inputPath}`);
  if (!encryption || typeof encryption !== 'object') {
    throw new Error('Capsule encryption metadata is missing.');
  }
  if (await hashFile(inputPath) !== encryption.ciphertextSha256) {
    throw new Error('Encrypted capsule checksum does not match capsule metadata.');
  }
  const salt = Buffer.from(encryption.kdf.salt, 'base64');
  const key = await scrypt(passphrase, salt, CAPSULE_SCRYPT.keylen, {
    N: encryption.kdf.N,
    r: encryption.kdf.r,
    p: encryption.kdf.p,
    maxmem: CAPSULE_SCRYPT.maxmem,
  });
  const decipher = createDecipheriv(
    encryption.cipher || CAPSULE_CIPHER,
    key,
    Buffer.from(encryption.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(encryption.aad, 'base64'));
  decipher.setAuthTag(Buffer.from(encryption.authTag, 'base64'));
  await pipeline(createReadStream(inputPath), decipher, createWriteStream(outputPath, { flags: 'wx' }));
  if (await hashFile(outputPath) !== encryption.plaintextSha256) {
    throw new Error('Decrypted capsule checksum does not match capsule metadata.');
  }
}

/**
 * Human-readable description for docs / doctor / security pages.
 */
export function capsuleCryptoPublicDescription() {
  return [
    `Format: ${CAPSULE_CRYPTO_FORMAT}`,
    `Cipher: ${CAPSULE_CIPHER}`,
    `KDF: scrypt N=${CAPSULE_SCRYPT.N} r=${CAPSULE_SCRYPT.r} p=${CAPSULE_SCRYPT.p} keylen=${CAPSULE_SCRYPT.keylen}`,
    `Passphrase minimum length: ${CAPSULE_PASSPHRASE_MIN_LENGTH}`,
    'Source of truth: utility/capsule-crypto.mjs (Apache-2.0 open source)',
  ].join('\n');
}
