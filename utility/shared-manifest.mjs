/** Customer-previewable sharing format. Never pass a raw capsule manifest here. */
export const MAX_SHARED_MANIFEST_BYTES = 256 * 1024;
const encoder = new TextEncoder();
function invalid() { throw new Error('invalid_shared_manifest'); }
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
}
function name(value, maxBytes, objectPath = false) {
  if (typeof value !== 'string' || !value || encoder.encode(value).length > maxBytes) invalid();
  if (/[\u0000-\u001f\u007f]|(?:postgres(?:ql)?|https?):\/\/|sb_secret_|BEGIN .*PRIVATE KEY|Bearer\s|(?:password|passphrase|api[_ -]?key|access[_ -]?token)\s*[:=]|(?:AKIA|ASIA)[A-Z0-9]{16}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\./i.test(value)) invalid();
  if (objectPath) {
    if (value.startsWith('/') || value.includes('\\') || /^[a-z]:/i.test(value) || value.split('/').some(part => part === '..' || part === '.')) invalid();
  } else if (/[\/\\]/.test(value)) invalid();
  return value;
}
function array(value, maxItems, transform) {
  if (!Array.isArray(value) || value.length > maxItems) invalid();
  return value.map(transform);
}

/** Strict field rejection prevents accidental silent sharing of secrets or raw diagnostics. */
export function projectSharedManifest(input, { inventoryConsent = false, projectRef } = {}) {
  shape(input, ['schemaVersion', 'projectRef', 'capturedAt', 'capsuleHash', 'status', 'counts', 'inventory']);
  if (encoder.encode(JSON.stringify(input)).length > MAX_SHARED_MANIFEST_BYTES) invalid();
  if (input.schemaVersion !== 1 || typeof input.projectRef !== 'string' || !/^[a-z0-9]{20}$/.test(input.projectRef) || input.projectRef !== projectRef) invalid();
  if (typeof input.capturedAt !== 'string' || input.capturedAt.length > 24 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.capturedAt)) invalid();
  const captured = Date.parse(input.capturedAt);
  if (!Number.isFinite(captured) || new Date(captured).toISOString().replace('.000Z', 'Z') !== input.capturedAt.replace('.000Z', 'Z')) invalid();
  if (typeof input.capsuleHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.capsuleHash)) invalid();
  if (!['COMPLETE', 'PARTIAL', 'SELECTIVE', 'TRIAL'].includes(input.status)) invalid();
  const fields = ['tableCount', 'bucketCount', 'objectCount', 'functionCount', 'totalBytes'];
  shape(input.counts, fields);
  const counts = {};
  for (const field of fields) if (Object.hasOwn(input.counts, field)) {
    if (!Number.isSafeInteger(input.counts[field]) || input.counts[field] < 0) invalid();
    counts[field] = input.counts[field];
  }
  const out = { schemaVersion: 1, projectRef: input.projectRef, capturedAt: new Date(captured).toISOString(), capsuleHash: input.capsuleHash, status: input.status, counts };
  if (Object.hasOwn(input, 'inventory')) {
    if (inventoryConsent !== true) throw new Error('inventory_consent_required');
    shape(input.inventory, ['projectName', 'tables', 'buckets', 'objects']);
    const inventory = {};
    if (Object.hasOwn(input.inventory, 'projectName')) inventory.projectName = name(input.inventory.projectName, 128);
    if (Object.hasOwn(input.inventory, 'tables')) inventory.tables = array(input.inventory.tables, 200, row => {
      shape(row, ['schema', 'name']);
      return { schema: name(row.schema, 128), name: name(row.name, 128) };
    });
    if (Object.hasOwn(input.inventory, 'buckets')) inventory.buckets = array(input.inventory.buckets, 100, row => {
      shape(row, ['name']);
      return { name: name(row.name, 128) };
    });
    if (Object.hasOwn(input.inventory, 'objects')) inventory.objects = array(input.inventory.objects, 1000, row => {
      shape(row, ['bucket', 'name']);
      return { bucket: name(row.bucket, 128), name: name(row.name, 512, true) };
    });
    out.inventory = inventory;
  }
  if (encoder.encode(JSON.stringify(out)).length > MAX_SHARED_MANIFEST_BYTES) invalid();
  return out;
}

/** Browser preview and server digest must use these canonical bytes. Hash with SHA-256. */
export function sharedManifestBytes(input, options) {
  return encoder.encode(JSON.stringify(projectSharedManifest(input, options)));
}
