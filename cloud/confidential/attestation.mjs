import { calculateJwkThumbprint, createRemoteJWKSet, importJWK, jwtVerify } from 'jose';

export const ISSUER = 'https://confidentialcomputing.googleapis.com';
export const AUDIENCE = 'urn:portabase:confidential-proof:v1';
// Fixed independently of the workload and token headers. No jku/x5u trust.
export const GOOGLE_JWKS = 'https://www.googleapis.com/service_accounts/v1/metadata/jwk/signer@confidentialspace-sign.iam.gserviceaccount.com';
export const ENTRYPOINT = ['node', '/app/cloud/confidential/workload.mjs'];
export const APPLICATION_ENTRYPOINT = ['node', '/app/cloud/confidential/production-workload.mjs'];
const googleKeys = createRemoteJWKSet(new URL(GOOGLE_JWKS), { timeoutDuration: 5000 });
const deny = (code) => { throw new Error(`attestation_rejected:${code}`); };
const emptyObject = (v) => v && !Array.isArray(v) && typeof v === 'object' && Object.keys(v).length === 0;

export function validatePolicy(policy) {
  if (!/^sha256:[a-f0-9]{64}$/.test(policy?.imageDigest || '')) deny('policy_digest');
  if (!/^\d{6,20}$/.test(policy?.projectNumber || '')) deny('policy_project');
  if (policy?.hardware !== 'GCP_INTEL_TDX') deny('policy_hardware');
  if (policy?.workload !== undefined && policy.workload !== 'application') deny('policy_workload');
  return policy;
}

/** Verifies Google's signature BEFORE inspecting workload claims or using its key.
 * The optional resolver is for isolated signature fixtures; the CLI never overrides it.
 */
export async function verifyOffer(offer, challenge, policy, { keyResolver = googleKeys, now = new Date() } = {}) {
  validatePolicy(policy);
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge || '')) deny('challenge');
  if (typeof offer?.attestation !== 'string' || offer.attestation.length > 32768) deny('token');
  const key = offer.publicKey;
  if (!key || key.kty !== 'RSA' || key.e !== 'AQAB' || typeof key.n !== 'string'
      || !/^[A-Za-z0-9_-]{512}$/.test(key.n)
      || Object.keys(key).some((k) => !['kty', 'n', 'e'].includes(k))) deny('encryption_key');
  if (!/^[A-Za-z0-9_-]{43}$/.test(offer.sessionId || '')) deny('session');
  let payload;
  try {
    ({ payload } = await jwtVerify(offer.attestation, keyResolver, {
      algorithms: ['RS256'], issuer: ISSUER, audience: AUDIENCE,
      requiredClaims: ['exp', 'iat', 'nbf', 'sub'], maxTokenAge: '120s',
      clockTolerance: 5, currentDate: now,
    }));
  } catch { deny('signature_or_time'); }
  if (payload.swname !== 'CONFIDENTIAL_SPACE' || payload.secboot !== true) deny('platform');
  if (payload.dbgstat !== 'disabled-since-boot') deny('debug');
  if (payload.hwmodel !== policy.hardware) deny('hardware');
  const support = payload.submods?.confidential_space?.support_attributes;
  if (!Array.isArray(support) || !support.includes('STABLE') || !support.includes('USABLE')) deny('support');
  if (payload.submods?.gce?.project_number !== policy.projectNumber) deny('project');
  const container = payload.submods?.container;
  if (container?.image_digest !== policy.imageDigest) deny('image_digest');
  if (JSON.stringify(container.args) !== JSON.stringify(policy.workload === 'application' ? APPLICATION_ENTRYPOINT : ENTRYPOINT)) deny('entrypoint');
  // The live Google-signed token omits unused override fields. The pinned image
  // also forbids overrides; require the exact argv and reject any supplied value.
  if (container.cmd_override !== undefined && (!Array.isArray(container.cmd_override) || container.cmd_override.length)) deny('command_override');
  if (container.env_override !== undefined && !emptyObject(container.env_override)) deny('environment_override');
  if (container.restart_policy !== 'Never') deny('restart_policy');
  const nonce = payload.eat_nonce;
  const keyFingerprint = await calculateJwkThumbprint(key);
  if (!Array.isArray(nonce) || nonce.length !== 2 || nonce[0] !== challenge || nonce[1] !== keyFingerprint) deny('key_binding');
  return {
    encryptionKey: await importJWK(key, 'RSA-OAEP-256'),
    evidence: { imageDigest: container.image_digest, hardware: payload.hwmodel,
      projectNumber: policy.projectNumber, keyFingerprint, debugDisabled: true },
  };
}
