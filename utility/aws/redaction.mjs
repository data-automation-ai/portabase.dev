/**
 * Redaction rules for AWS inventory and capsule manifests.
 * Live credentials, secret values, and private keys must never be packed.
 */

export const REDACTED = '[omitted]';

/** Keys that must never appear with a real value in a capsule or inventory document. */
export const FORBIDDEN_SECRET_KEYS = Object.freeze([
  'secretAccessKey',
  'SecretAccessKey',
  'aws_secret_access_key',
  'AWS_SECRET_ACCESS_KEY',
  'privateKey',
  'PrivateKey',
  'private_key',
  'SecretString',
  'secretString',
  'SecureString',
  'secureStringValue',
  'passphrase',
  'PORTABASE_ENCRYPTION_PASSPHRASE',
  'sessionToken',
  'SessionToken',
  'password',
  'Password',
]);

const FORBIDDEN_KEY_SET = new Set(FORBIDDEN_SECRET_KEYS.map((k) => k.toLowerCase()));

export function isForbiddenSecretKey(key) {
  return FORBIDDEN_KEY_SET.has(String(key).toLowerCase());
}

/**
 * Walk a document and collect forbidden secret keys that still have values.
 * Empty / omitted sentinels are still treated as a schema violation — omit the key.
 */
export function findForbiddenSecrets(value, path = '$') {
  const hits = [];
  if (value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...findForbiddenSecrets(item, `${path}[${i}]`)));
    return hits;
  }
  if (typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isForbiddenSecretKey(key) && child != null && child !== '') {
      hits.push({ path: childPath, key });
    }
    hits.push(...findForbiddenSecrets(child, childPath));
  }
  return hits;
}

/** Lambda / SSM / Secrets Manager: keep names, drop values. */
export function namesOnlyMap(record) {
  if (!record || typeof record !== 'object') return [];
  return Object.keys(record).sort();
}

export function redactTxtRdata(rdata) {
  const text = String(rdata || '');
  if (!text) return REDACTED;
  if (/(private|secret|token|password|begin [a-z ]*key)/i.test(text)) return REDACTED;
  if (text.length > 256) return REDACTED;
  return text;
}
