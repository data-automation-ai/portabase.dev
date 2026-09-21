/**
 * On-disk AWS escape-package shape.
 *
 * Same customer-owned files as a Supabase Portabase capsule:
 *   capsule.json · capsule.pbase · checksums.sha256 · RECOVER.txt
 *
 * This scaffold documents and validates the shape. It does not seal a .pbase
 * and never writes keys or capsule bytes to Portabase Cloud.
 */

import { AWS_CAPSULE_FORMAT_VERSION, AWS_CAPSULE_KIND, AWS_DEFAULT_PROFILE } from './versions.mjs';

/** Files that make a Portabase capsule directory, AWS or Supabase. */
export const AWS_PACKAGE_FILES = Object.freeze({
  manifest: 'capsule.json',
  ciphertext: 'capsule.pbase',
  checksums: 'checksums.sha256',
  recover: 'RECOVER.txt',
});

export const AWS_PACKAGE_NUMERIC_FORMAT = 2;

/**
 * Build the public (unsealed) package metadata for an AWS capsule directory.
 * `sealed` stays false until a later capture command writes capsule.pbase.
 */
export function buildCapsulePackageShape(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('buildCapsulePackageShape requires a validated AWS capsule manifest.');
  }
  return {
    family: 'portabase-escape-package',
    formatVersion: AWS_PACKAGE_NUMERIC_FORMAT,
    kind: manifest.kind || AWS_CAPSULE_KIND,
    capsuleFormatVersion: manifest.capsuleFormatVersion || AWS_CAPSULE_FORMAT_VERSION,
    profile: manifest.profile || AWS_DEFAULT_PROFILE,
    files: { ...AWS_PACKAGE_FILES },
    present: {
      [AWS_PACKAGE_FILES.manifest]: true,
      [AWS_PACKAGE_FILES.ciphertext]: Boolean(options.sealed),
      [AWS_PACKAGE_FILES.checksums]: Boolean(options.checksums),
      [AWS_PACKAGE_FILES.recover]: true,
    },
    sealed: Boolean(options.sealed),
    holdsKeys: false,
    holdsBytes: Boolean(options.sealed),
    owner: 'customer',
    recoverHint: [
      'This capsule is encrypted (or will be) with a customer-held passphrase.',
      'Portabase never holds sealing keys or capsule bytes.',
      'AWS binaries are the most recent completed backups (IDs only). Portabase never holds the bytes.',
      'Do not claim MATCH until an AWS restore drill into a blank account exists.',
    ].join(' '),
  };
}

export function recoverTxt() {
  return [
    'Portabase AWS Capsule V2',
    '',
    'Customer-owned encrypted escape package. Same files as a Supabase capsule:',
    '  capsule.json  — manifest (this family is portabase-aws-capsule)',
    '  capsule.pbase — ciphertext (not produced by this read-only scaffold)',
    '  checksums.sha256',
    '  RECOVER.txt   — this file',
    '',
    'Keep PORTABASE_ENCRYPTION_PASSPHRASE outside the vault.',
    'Portabase never holds keys or capsule bytes.',
    'Binaries = most recent completed backups. Capsule scripts the runs; Portabase never holds the bytes.',
    'Prefer an existing latest snapshot over CreateSnapshot. This scaffold does not create snapshots.',
    'This scaffold does not claim MATCH.',
    '',
  ].join('\n');
}
