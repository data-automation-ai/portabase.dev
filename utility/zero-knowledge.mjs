/**
 * Product law: Portabase Cloud / the website is provably zero-knowledge
 * of capsule contents and customer sealing keys.
 *
 * Control plane may hold management metadata and runner-originated health
 * aggregates only. There is no server-side decrypt path.
 *
 * Residual honesty (orthogonal): a *managed runner* may use job crypto
 * during a capture window — documented on /security. That is not an API
 * that returns plaintext, object names, or keys to the dashboard.
 */

export const PROVABLY_ZERO_KNOWLEDGE = true;

export const ZK_COPY = Object.freeze({
  headline: 'Provably zero-knowledge',
  cannotSee:
    'Portabase Cloud cannot see Storage object names, table rows, function source, or your sealing keys.',
  cannotOpen: 'Portabase cannot open this capsule for you.',
  architecture:
    'Ciphertext-only if anything is echoed; runner-originated aggregates only; no server-side decrypt path.',
});

/** Keys that must never appear on Cloud APIs, telemetry, or dashboard models. */
export const FORBIDDEN_INVENTORY_KEY =
  /objectName|object_name|objectPath|object_path|filePath|file_path|tableRows|table_rows|rowContents|row_contents|functionSource|function_source|schemaSql|schema_sql|plaintext|passphrase|wrapKey|wrappingKey|bucketObject|bucket_object/i;

const FORBIDDEN_VALUE = [
  /password/i,
  /passphrase/i,
  /service[_-]?role/i,
  /sb_secret_/i,
  /private[_-]?key/i,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /postgres(ql)?:\/\/[^\s]+:[^\s]+@/i,
];

/** Customer Storage object path (not a destination type like "s3"). */
export function looksLikeStorageObjectPath(text) {
  const s = String(text || '');
  if (!s || s.length > 500) return false;
  if (/^s3:\/\//i.test(s) && /\/[^/]+\.[a-z0-9]{2,5}$/i.test(s)) return true;
  return /(?:^|[/"'])[a-z0-9._-]+(?:\/[a-z0-9._-]+)+\.(?:jpg|jpeg|png|gif|webp|pdf|mp4|bin|csv|json)\b/i.test(s);
}

export function assertNoIdentifyingInventory(value, path = 'root') {
  if (value == null) return value;
  if (typeof value === 'string') {
    for (const pattern of FORBIDDEN_VALUE) {
      if (pattern.test(value)) throw new Error(`Zero-knowledge rejected secret-shaped content at ${path}`);
    }
    if (looksLikeStorageObjectPath(value) && !/capsule\.json|capsule\.pbase|checksums\.sha256/i.test(value)) {
      throw new Error(`Zero-knowledge rejected Storage object path at ${path}`);
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item, i) => assertNoIdentifyingInventory(item, `${path}[${i}]`));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_INVENTORY_KEY.test(key)) {
        throw new Error(`Zero-knowledge rejected inventory key ${key} at ${path}`);
      }
      out[key] = assertNoIdentifyingInventory(child, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`Zero-knowledge rejected unsupported type at ${path}`);
}

/** Drop forbidden keys; redact path-like strings. Never throws on display paths. */
export function stripIdentifyingInventory(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return looksLikeStorageObjectPath(value) ? 'health signal (path withheld)' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(stripIdentifyingInventory);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_INVENTORY_KEY.test(key)) continue;
      out[key] = stripIdentifyingInventory(child);
    }
    return out;
  }
  return null;
}

export const CLOUD_CAPSULE_ALLOWLIST = Object.freeze([
  'id',
  'status',
  'verified',
  'sizeBytes',
  'durationMs',
  'createdAt',
  'destinationKind',
  'destinationId',
  'projectId',
  'projectRef',
  'scheduleEveryHours',
  'retainDays',
  'edition',
  'formatVersion',
  'rpoHours',
  'errorClass',
  'layers',
]);

export function cloudCapsuleView(raw = {}) {
  const out = {};
  for (const key of CLOUD_CAPSULE_ALLOWLIST) {
    if (raw[key] == null) continue;
    if (key === 'layers' && raw.layers && typeof raw.layers === 'object') {
      out.layers = {};
      for (const [name, on] of Object.entries(raw.layers)) {
        if (/^(database|storage|functions|auth)$/.test(name)) out.layers[name] = Boolean(on);
      }
    } else {
      out[key] = raw[key];
    }
  }
  return stripIdentifyingInventory(out);
}

export function zkForbiddenFromCloud() {
  return [
    'Storage object names or paths',
    'Table row contents, function source, or identifying schema dumps',
    'Capsule plaintext, passphrases, or wrapping keys',
    'Any API or UI that implies Portabase can open or inventory the capsule',
  ];
}

export function hasServerDecryptPath() {
  return false;
}
