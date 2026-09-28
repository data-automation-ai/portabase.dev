/**
 * Customer-side capsule key injection.
 *
 * Passphrases / wrap keys stay in the browser or on the CLI runner.
 * Portabase Cloud APIs are never called with the secret.
 * We persist only a non-reversible fingerprint + status locally.
 */

export const CAPSULE_KEY_MIN_LENGTH = 16;
export const CAPSULE_KEY_STORE = 'portabase.capsule-keys.v1';

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

export function requireLocalPassphrase(passphrase) {
  const value = String(passphrase || '');
  if (value.length < CAPSULE_KEY_MIN_LENGTH) {
    throw new Error(`Passphrase must be at least ${CAPSULE_KEY_MIN_LENGTH} characters.`);
  }
  return value;
}

/** SHA-256 hex fingerprint — not the key, not reversible to the passphrase. */
export async function fingerprintPassphrase(passphrase, capsuleId = 'unbound') {
  const secret = requireLocalPassphrase(passphrase);
  const digest = await crypto.subtle.digest('SHA-256', utf8(`portabase-key-fp|${capsuleId}|${secret}`));
  return bytesToHex(new Uint8Array(digest));
}

export function shortFingerprint(hex) {
  return `${String(hex || '').slice(0, 8)}…${String(hex || '').slice(-4)}`;
}

/**
 * Wrap the passphrase with a customer PIN using Web Crypto AES-GCM.
 * Result is a downloadable JSON file for the runner — never uploaded.
 */
export async function wrapPassphraseForDownload({ passphrase, pin, capsuleId }) {
  const secret = requireLocalPassphrase(passphrase);
  const localPin = requireLocalPassphrase(pin);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', utf8(localPin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(capsuleId || 'unbound') },
    key,
    utf8(secret),
  );
  const fingerprint = await fingerprintPassphrase(secret, capsuleId);
  return {
    format: 'portabase-keywrap-v1',
    capsuleId: capsuleId || null,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 210000 },
    cipher: 'AES-256-GCM',
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
    fingerprint,
    createdAt: new Date().toISOString(),
    warning: 'Customer-held wrap. Never upload this file to Portabase Cloud. Unlock only on your runner.',
  };
}

export function cliInjectHint(capsuleId) {
  const id = capsuleId || '<capsule-id>';
  return [
    '# Run on YOUR runner — Portabase Cloud never sees this value.',
    'export PORTABASE_ENCRYPTION_PASSPHRASE   # ≥16 chars, not committed',
    `portabase backup --capsule ${id}`,
    '# or rotate: set a new passphrase locally, then re-seal / verify',
  ].join('\n');
}

export function loadKeyRecords() {
  try {
    const raw = localStorage.getItem(CAPSULE_KEY_STORE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveKeyRecord(record) {
  const next = loadKeyRecords().filter((row) => row.capsuleId !== record.capsuleId);
  next.unshift(record);
  localStorage.setItem(CAPSULE_KEY_STORE, JSON.stringify(next.slice(0, 40)));
  return next;
}

export function recordForCapsule(capsuleId) {
  return loadKeyRecords().find((row) => row.capsuleId === capsuleId) || null;
}

/**
 * Persist only fingerprint + status. The passphrase argument is used then discarded.
 */
export async function injectKeyLocally({ capsuleId, passphrase, method = 'browser-local' }) {
  const fingerprint = await fingerprintPassphrase(passphrase, capsuleId);
  const record = {
    capsuleId,
    fingerprint,
    fingerprintShort: shortFingerprint(fingerprint),
    method,
    injectedAt: new Date().toISOString(),
    rotatedAt: recordForCapsule(capsuleId)?.injectedAt || null,
    status: 'injected-local',
  };
  saveKeyRecord(record);
  return record;
}

export function downloadJson(filename, object) {
  const blob = new Blob([`${JSON.stringify(object, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}

export function neverSendFields() {
  return [
    'encryption passphrase',
    'wrapped key ciphertext (unless you download it to your own disk)',
    'PIN used to wrap a local key file',
    'Supabase service-role / DB URL',
  ];
}
