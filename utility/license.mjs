import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyLicenseEnvelope } from './license-format.mjs';

const DEFAULT_PUBLIC_KEY = fileURLToPath(new URL('./portabase-license-public.pem', import.meta.url));

export async function inspectLicense(path, platform = process.platform) {
  if (!path || !existsSync(path)) return { valid: false, reason: 'license_missing' };
  try {
    const [envelope, publicKey] = await Promise.all([
      readFile(path, 'utf8').then(JSON.parse),
      readFile(process.env.PORTABASE_LICENSE_PUBLIC_KEY_FILE || DEFAULT_PUBLIC_KEY, 'utf8'),
    ]);
    return verifyLicenseEnvelope(envelope, publicKey, platform);
  } catch {
    return { valid: false, reason: 'license_unreadable' };
  }
}

export async function inspectEncodedLicense(encoded, platform = process.platform) {
  if (!encoded) return { valid: false, reason: 'license_missing' };
  try {
    const [envelope, publicKey] = await Promise.all([
      Promise.resolve(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))),
      readFile(process.env.PORTABASE_LICENSE_PUBLIC_KEY_FILE || DEFAULT_PUBLIC_KEY, 'utf8'),
    ]);
    return verifyLicenseEnvelope(envelope, publicKey, platform);
  } catch {
    return { valid: false, reason: 'license_unreadable' };
  }
}

/**
 * Open-core: full capture is free by default.
 * Explicit --trial / PORTABASE_EDITION=trial enables limited demo mode only.
 * Legacy signed licenses are inspected for metadata but never gate features.
 */
export async function resolveEdition({ forceTrial = false, licensePath, platform = process.platform } = {}) {
  if (forceTrial || process.env.PORTABASE_EDITION === 'trial') {
    return {
      edition: 'trial',
      license: { valid: false, reason: 'demo_mode_requested' },
    };
  }

  const license = process.env.PORTABASE_LICENSE_ENVELOPE_BASE64
    ? await inspectEncodedLicense(process.env.PORTABASE_LICENSE_ENVELOPE_BASE64, platform)
    : await inspectLicense(licensePath || process.env.PORTABASE_LICENSE_FILE || './portabase.license.json', platform);

  return {
    edition: 'community',
    license: license.valid
      ? license
      : { valid: false, reason: 'open_core_no_license_required' },
  };
}
