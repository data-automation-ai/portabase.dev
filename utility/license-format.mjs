import { sign, verify } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function licenseBytes(payload) {
  return Buffer.from(canonicalize(payload), 'utf8');
}

export function signLicense(payload, privateKey) {
  return {
    payload,
    signature: sign(null, licenseBytes(payload), privateKey).toString('base64'),
  };
}

export function verifyLicenseEnvelope(envelope, publicKey, platform = process.platform) {
  const payload = envelope?.payload;
  const signature = envelope?.signature;
  if (!payload || typeof signature !== 'string') return { valid: false, reason: 'malformed_license' };
  if (payload.licenseVersion !== 1 || payload.edition !== 'essentials') return { valid: false, reason: 'unsupported_license' };
  if (!['win32', 'darwin', 'linux'].includes(payload.platform)) return { valid: false, reason: 'unsupported_platform' };
  if (payload.platform !== platform) return { valid: false, reason: 'wrong_platform' };
  if (payload.updates !== 'lifetime' || payload.projectAllowance !== 1) return { valid: false, reason: 'invalid_entitlement' };
  let authentic = false;
  try { authentic = verify(null, licenseBytes(payload), publicKey, Buffer.from(signature, 'base64')); } catch { authentic = false; }
  return authentic ? { valid: true, payload } : { valid: false, reason: 'invalid_signature' };
}
