/**
 * Control-plane rows are metadata only.
 * Refuse keys, capsule bytes, dump/Storage bodies, and secret-shaped fields
 * before anything is written to Supabase or the sqlite replica.
 */

export const ESSENTIAL_COLLECTIONS = Object.freeze([
  'subscribers',
  'promo_codes',
  'billing_metadata',
  'jobs',
  'capsule_hashes',
]);

const ALLOWED_FIELDS = Object.freeze({
  subscribers: Object.freeze(['id', 'email', 'user_id', 'status', 'plan_id', 'created_at', 'updated_at']),
  promo_codes: Object.freeze(['id', 'code', 'plan_id', 'percent_off', 'expires_at', 'created_at', 'updated_at']),
  billing_metadata: Object.freeze([
    'id',
    'subscriber_id',
    'square_customer_id',
    'square_subscription_id',
    'trial_ends_at',
    'current_period_end',
    'price_monthly_cents',
    'created_at',
    'updated_at',
  ]),
  jobs: Object.freeze(['id', 'type', 'status', 'project_ref', 'capsule_hash', 'created_at', 'updated_at']),
  capsule_hashes: Object.freeze(['id', 'hash', 'algorithm', 'created_at']),
});

const FORBIDDEN_KEY_RE = /^(service[_-]?role|sb[_-]?secret|passphrase|private[_-]?key|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|encryption[_-]?key|capsule[_-]?bytes|capsule[_-]?ciphertext|ciphertext|bytes|dump|object[_-]?bytes|pbase|postgres[_-]?url|database[_-]?url|db[_-]?url|card[_-]?number|pan|cvv|cvc|payment[_-]?token)$/i;

const FORBIDDEN_VALUE_RE = [
  /service[_-]?role/i,
  /sb_secret_/i,
  /postgres(ql)?:\/\//i,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /passphrase/i,
];

const HASH_LENGTH = Object.freeze({ sha256: 64, sha512: 128, sha1: 40 });

export function isEssentialCollection(name) {
  return ESSENTIAL_COLLECTIONS.includes(name);
}

export function allowedFields(collection) {
  return ALLOWED_FIELDS[collection] || [];
}

export function isCapsuleHash(value, algorithm = 'sha256') {
  const hash = String(value || '').trim().toLowerCase();
  const algo = String(algorithm || 'sha256').toLowerCase();
  const expected = HASH_LENGTH[algo];
  if (!expected) return false;
  return new RegExp(`^[a-f0-9]{${expected}}$`).test(hash);
}

export function looksLikeCapsuleBytes(value) {
  if (value == null) return false;
  if (Buffer.isBuffer(value)) return value.length > 128;
  if (typeof value !== 'string') return false;
  if (value.startsWith('PBASE') || value.includes('.pbase')) return true;
  if (value.length > 128 && /^[A-Za-z0-9+/=\s]+$/.test(value) && !/^[a-f0-9]+$/i.test(value.trim())) {
    return true;
  }
  return false;
}

export function findForbiddenField(value, path = 'body') {
  if (value == null) return null;
  if (typeof value === 'string') {
    for (const re of FORBIDDEN_VALUE_RE) {
      if (re.test(value)) return path;
    }
    if (looksLikeCapsuleBytes(value)) return path;
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenField(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
      if (FORBIDDEN_KEY_RE.test(key) || FORBIDDEN_KEY_RE.test(normalized)) {
        return `key:${key}`;
      }
      const hit = findForbiddenField(child, `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

function reject(code, message) {
  const err = new Error(message || code);
  err.code = code;
  err.status = 400;
  throw err;
}

export function assertAllowedRow(collection, row) {
  if (!isEssentialCollection(collection)) {
    reject('unknown_collection', `Unknown collection: ${collection}`);
  }
  if (row == null || typeof row !== 'object' || Array.isArray(row)) {
    reject('invalid_row', 'Row must be an object');
  }
  const hit = findForbiddenField(row);
  if (hit) {
    reject('forbidden_secret_shape', `Forbidden secret-shaped or capsule field at ${hit}`);
  }
  const allow = new Set(ALLOWED_FIELDS[collection]);
  for (const key of Object.keys(row)) {
    if (!allow.has(key)) {
      reject('unknown_field', `Field ${key} is not an essential control-plane column`);
    }
  }
  if (collection === 'capsule_hashes') {
    if (!isCapsuleHash(row.hash, row.algorithm || 'sha256')) {
      reject('capsule_hash_only', 'capsule_hashes.hash must be a hex digest');
    }
  }
  if (collection === 'jobs' && row.capsule_hash) {
    if (!isCapsuleHash(row.capsule_hash, 'sha256')) {
      reject('capsule_hash_only', 'jobs.capsule_hash must be a sha256 hex digest');
    }
  }
  if (collection === 'subscribers') {
    const email = String(row.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      reject('invalid_email', 'subscribers.email is required');
    }
    if (!String(row.plan_id || '').trim()) {
      reject('invalid_plan', 'subscribers.plan_id is required');
    }
  }
  if (collection === 'promo_codes' && !String(row.code || '').trim()) {
    reject('invalid_promo_code', 'promo_codes.code is required');
  }
  return true;
}

export function projectEssentialRow(collection, row) {
  if (!isEssentialCollection(collection)) {
    reject('unknown_collection', `Unknown collection: ${collection}`);
  }
  if (row == null || typeof row !== 'object' || Array.isArray(row)) {
    reject('invalid_row', 'Row must be an object');
  }
  const hit = findForbiddenField(row);
  if (hit) {
    reject('forbidden_secret_shape', `Forbidden secret-shaped or capsule field at ${hit}`);
  }
  const out = {};
  for (const key of ALLOWED_FIELDS[collection]) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  if (collection === 'capsule_hashes' && out.hash && !isCapsuleHash(out.hash, out.algorithm || 'sha256')) {
    reject('capsule_hash_only', 'capsule_hashes.hash must be a hex digest');
  }
  if (collection === 'jobs' && out.capsule_hash && !isCapsuleHash(out.capsule_hash, 'sha256')) {
    reject('capsule_hash_only', 'jobs.capsule_hash must be a sha256 hex digest');
  }
  return out;
}

export function pickAllowedRow(collection, row) {
  assertAllowedRow(collection, row);
  return projectEssentialRow(collection, row);
}
