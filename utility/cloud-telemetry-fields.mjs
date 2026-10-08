/**
 * One-way Cloud telemetry allowlist.
 * Allowed: job/customer id, status, phase, timestamps, object counts, sizes,
 * capsule/layer hashes, destination kind, safe error, runner id/region, daily meter bytes.
 * Never: keys, passphrase, capsule bytes, row bodies, function source.
 */

export const ALLOWED_TELEMETRY_FIELDS = Object.freeze([
  'schemaVersion',
  'eventType',
  'occurredAt',
  'jobId',
  'customerId',
  'subscriberId',
  'status',
  'phase',
  'objectCount',
  'sizeBytes',
  'meterBytes',
  'dailyMeterBytes',
  'capsuleId',
  'capsuleHash',
  'manifestHash',
  'layerHashes',
  'destinationKind',
  'destinationVerified',
  'errorCode',
  'errorMessage',
  'runnerId',
  'region',
  'projectRef',
  'agentId',
  'hostname',
  'portabaseVersion',
  'payload',
]);

const FORBIDDEN_PAYLOAD_KEYS = /^(passphrase|password|service[_-]?role|sb[_-]?secret|private[_-]?key|capsule[_-]?bytes|ciphertext|row[_-]?body|function[_-]?source|source[_-]?code|dump|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?access[_-]?key[_-]?id|session[_-]?token|secrets[_-]?bundle|secret[_-]?string)$/i;

export function projectAllowedTelemetry(event = {}) {
  const out = {};
  for (const key of ALLOWED_TELEMETRY_FIELDS) {
    if (event[key] !== undefined) out[key] = event[key];
  }
  if (out.payload && typeof out.payload === 'object') {
    const payload = {};
    for (const [key, value] of Object.entries(out.payload)) {
      if (FORBIDDEN_PAYLOAD_KEYS.test(key)) continue;
      payload[key] = value;
    }
    out.payload = payload;
  }
  return out;
}
