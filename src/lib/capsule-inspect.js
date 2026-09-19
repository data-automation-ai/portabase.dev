/**
 * Customer-side capsule inspect / "open" helpers.
 *
 * Decrypt never leaves this device. Cloud APIs are not called with the file
 * or the passphrase. Full .pbase open uses the CLI (scrypt + streaming AES-GCM).
 */

import { CAPSULE_KEY_MIN_LENGTH, requireLocalPassphrase } from './capsule-key.js';

export const CAPSULE_CRYPTO_FORMAT = 'portabase-aes256gcm-v1';

export const BROWSER_DECRYPT = Object.freeze({
  supported: false,
  format: CAPSULE_CRYPTO_FORMAT,
  reason:
    'This browser cannot derive the CLI scrypt key (N=32768) or stream-decrypt multi-GB .pbase archives. Opening ciphertext is a local CLI job.',
  useInstead: 'portabase verify --capsule <dir> --decrypt',
});

const META_ALLOW = new Set([
  'id',
  'status',
  'createdAt',
  'durationMs',
  'projectRef',
  'formatVersion',
  'edition',
]);

function layerFlags(contents) {
  if (!contents || typeof contents !== 'object') return {};
  const flags = {};
  for (const [name, value] of Object.entries(contents)) {
    if (!/^(database|storage|functions|auth)$/.test(name)) continue;
    flags[name] = Boolean(value?.complete || value === true);
  }
  return flags;
}

/** Strip identifying inventory. Layer names only (boolean complete). */
export function allowlistedCapsuleMeta(raw = {}) {
  const out = { layers: layerFlags(raw.contents || raw.layers) };
  for (const key of META_ALLOW) {
    if (raw[key] != null) out[key] = raw[key];
  }
  out.hasEncryption = Boolean(raw.encryption || raw.hasEncryption);
  out.cryptoFormat = raw.encryption?.format || raw.cryptoFormat || CAPSULE_CRYPTO_FORMAT;
  out.secretsIncluded = false;
  out.plaintextIncluded = false;
  return out;
}

export function classifyLocalFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const size = Number(file?.size) || 0;
  if (name.endsWith('.pbase')) return { kind: 'pbase', name: file.name, size };
  if (name.endsWith('capsule.json') || name.endsWith('.json')) return { kind: 'capsule-json', name: file.name, size };
  return { kind: 'unknown', name: file?.name || 'file', size };
}

export async function inspectLocalFile(file) {
  if (!file) throw new Error('Choose a local capsule.json or .pbase file on this computer.');
  const classified = classifyLocalFile(file);
  if (classified.kind === 'pbase') {
    return {
      ...classified,
      opened: false,
      decrypt: BROWSER_DECRYPT,
      note: 'Ciphertext stayed in this tab. Nothing was uploaded. Use the CLI to decrypt on your runner.',
    };
  }
  if (classified.kind === 'capsule-json') {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    return {
      ...classified,
      opened: true,
      meta: allowlistedCapsuleMeta(parsed),
      decrypt: BROWSER_DECRYPT,
      note: 'Metadata only — layer flags and status. No object names or row contents.',
    };
  }
  throw new Error('Use capsule.json (metadata) or capsule.pbase (ciphertext). Cloud cannot open either for you.');
}

export function cliOpenHints(capsuleDir = '<capsule-directory>') {
  return [
    `# On YOUR runner — Portabase Cloud never sees the passphrase or the file.`,
    `export PORTABASE_ENCRYPTION_PASSPHRASE   # ≥${CAPSULE_KEY_MIN_LENGTH} chars`,
    `portabase verify --capsule ${capsuleDir} --decrypt`,
    `portabase export-manifest --capsule ${capsuleDir}`,
    `portabase replay --capsule ${capsuleDir} --confirm-target <NEW_REF>`,
  ].join('\n');
}

export function assertPassphraseStaysLocal(passphrase) {
  requireLocalPassphrase(passphrase);
  return { postedToCloud: false, usedFor: 'local-unlock-intent-only' };
}

export function inspectNeverShows() {
  return [
    'Storage object names or paths',
    'Table row contents',
    'Decrypted dumps',
    'Passphrases (they never leave this device)',
  ];
}
