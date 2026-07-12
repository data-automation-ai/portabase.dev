import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function safeObjectPath(value) {
  const cleaned = normalize(String(value).replaceAll('\\', '/')).replace(/^([/\\])+/, '');
  if (!cleaned || cleaned === '.' || cleaned.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe object path: ${value}`);
  }
  return cleaned.split(/[\\/]/).join(sep);
}

export function isModernApiKey(key = '') {
  return key.startsWith('sb_secret_') || key.startsWith('sb_publishable_');
}

export function supabaseHeaders(key, extra = {}) {
  if (!key) throw new Error('A Supabase API key is required.');
  return {
    apikey: key,
    ...(!isModernApiKey(key) ? { Authorization: `Bearer ${key}` } : {}),
    ...extra,
  };
}

export function projectBaseUrl(value) {
  if (!value) throw new Error('A Supabase project URL is required.');
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/(?:rest|storage)\/v1\/?$/i, '/');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function providerRemote(config, capsuleDir) {
  const provider = config.provider || {};
  const remote = provider.remote || (provider.type === 'google-drive' ? 'gdrive' : 'dropbox');
  const root = String(provider.path || '/PortaBase').replace(/^\/+|\/+$/g, '');
  return `${remote}:${root}/${basename(capsuleDir)}`;
}

export function providerCommand(config, capsuleDir) {
  const provider = config.provider || {};
  const prefix = String(provider.prefix || '').replace(/^\/+|\/+$/g, '');
  switch (provider.type) {
    case 'aws': {
      if (!provider.bucket) throw new Error('AWS provider requires bucket.');
      const target = `s3://${provider.bucket}/${prefix ? `${prefix}/` : ''}${basename(capsuleDir)}`;
      return ['aws', ['s3', 'cp', capsuleDir, target, '--recursive', '--only-show-errors']];
    }
    case 'dropbox':
    case 'google-drive':
    case 'rclone':
      return ['rclone', ['copy', capsuleDir, providerRemote(config, capsuleDir), '--immutable', '--checksum']];
    case 'local':
      return null;
    default:
      throw new Error(`Unsupported provider: ${provider.type}`);
  }
}

export function providerVerifyCommand(config, capsuleDir) {
  if (['dropbox', 'google-drive', 'rclone'].includes(config.provider?.type)) {
    return ['rclone', ['check', capsuleDir, providerRemote(config, capsuleDir), '--one-way', '--checksum']];
  }
  return null;
}

export function validateRestoreTarget(sourceRef, targetRef, confirmation, targetUrl = '') {
  if (!targetRef) throw new Error('PORTABASE_TARGET_PROJECT_REF is required.');
  if (sourceRef === targetRef) throw new Error('Restore refused: target project is the source project.');
  if (confirmation !== targetRef) {
    throw new Error('Restore refused: --confirm-target must exactly match the new target project ref.');
  }
  if (targetUrl) {
    const host = new URL(projectBaseUrl(targetUrl)).hostname;
    if (!host.startsWith(`${targetRef}.`) && !host.includes(`.${targetRef}.`)) {
      throw new Error('Restore refused: target URL does not match PORTABASE_TARGET_PROJECT_REF.');
    }
  }
  return true;
}

export function capsuleName(projectRef, date = new Date()) {
  const stamp = date.toISOString().replaceAll(':', '-').replace('.000Z', 'Z');
  return `${projectRef}-${stamp}`;
}

export function isCapsuleName(projectRef, name) {
  const escaped = String(projectRef).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}(?:\\.\\d{3})?Z$`).test(name);
}

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function requirePassphrase(passphrase) {
  if (!passphrase || passphrase.length < 16) {
    throw new Error('PORTABASE_ENCRYPTION_PASSPHRASE must contain at least 16 characters.');
  }
}

export async function encryptFile(inputPath, outputPath, passphrase, aadText) {
  requirePassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const aad = Buffer.from(aadText, 'utf8');
  cipher.setAAD(aad);
  const plaintextSha256 = await hashFile(inputPath);
  await pipeline(createReadStream(inputPath), cipher, createWriteStream(outputPath, { flags: 'wx' }));
  return {
    format: 'portabase-aes256gcm-v1',
    cipher: 'aes-256-gcm',
    kdf: { name: 'scrypt', N: 32768, r: 8, p: 1, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    aad: Buffer.from(aad).toString('base64'),
    plaintextSha256,
    ciphertextSha256: await hashFile(outputPath),
  };
}

export async function decryptFile(inputPath, outputPath, passphrase, encryption) {
  requirePassphrase(passphrase);
  if (!existsSync(inputPath)) throw new Error(`Encrypted capsule not found: ${inputPath}`);
  if (await hashFile(inputPath) !== encryption.ciphertextSha256) {
    throw new Error('Encrypted capsule checksum does not match capsule metadata.');
  }
  const salt = Buffer.from(encryption.kdf.salt, 'base64');
  const key = await scrypt(passphrase, salt, 32, {
    N: encryption.kdf.N,
    r: encryption.kdf.r,
    p: encryption.kdf.p,
    maxmem: 64 * 1024 * 1024,
  });
  const decipher = createDecipheriv(encryption.cipher, key, Buffer.from(encryption.iv, 'base64'));
  decipher.setAAD(Buffer.from(encryption.aad, 'base64'));
  decipher.setAuthTag(Buffer.from(encryption.authTag, 'base64'));
  await pipeline(createReadStream(inputPath), decipher, createWriteStream(outputPath, { flags: 'wx' }));
  if (await hashFile(outputPath) !== encryption.plaintextSha256) {
    throw new Error('Decrypted capsule checksum does not match capsule metadata.');
  }
}

export async function verifyChecksumFile(root, checksumPath) {
  const lines = (await readFile(checksumPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) {
      results.push({ path: line, ok: false });
      continue;
    }
    const localPath = join(root, safeObjectPath(match[2]));
    results.push({ path: match[2], ok: existsSync(localPath) && await hashFile(localPath) === match[1] });
  }
  return results;
}
