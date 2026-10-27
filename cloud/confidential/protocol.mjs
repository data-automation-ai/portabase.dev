import { randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair } from 'jose';
import { requestGoogleAttestation } from './google-token.mjs';
import { runSyntheticCapsule } from './synthetic-capsule.mjs';

export const TYPE = 'portabase-confidential-synthetic-v1';
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const fail = () => { throw new Error('proof_request_rejected'); };
const isNonce = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);

/** Test dependencies are explicit arguments, never environment variables.
 * The executable always uses Google's real launcher and the real crypto engine.
 */
export function createProofService({ attest = requestGoogleAttestation, run = runSyntheticCapsule, now = Date.now } = {}) {
  const sessions = new Map();
  return {
    async offer(challenge) {
      if (!isNonce(challenge)) fail();
      for (const [id, session] of sessions) if (session.expires <= now()) sessions.delete(id);
      if (sessions.size >= 4) fail();
      const sessionId = randomBytes(32).toString('base64url');
      const session = { challenge, expires: now() + 90000 };
      sessions.set(sessionId, session);
      try {
        const keys = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072 });
        session.privateKey = keys.privateKey;
        const publicKey = await exportJWK(keys.publicKey);
        const fingerprint = await calculateJwkThumbprint(publicKey);
        const attestation = await attest(challenge, fingerprint);
        if (session.expires <= now()) fail();
        return { sessionId, publicKey, attestation };
      } catch { sessions.delete(sessionId); throw new Error('attestation_unavailable'); }
    },
    async execute(sessionId, envelope) {
      const session = sessions.get(sessionId);
      sessions.delete(sessionId); // single attempt, including failed decryptions
      if (!session?.privateKey || session.expires <= now() || typeof envelope !== 'string' || envelope.length > 12000) fail();
      let payload;
      try {
        const { plaintext, protectedHeader } = await compactDecrypt(envelope, session.privateKey, {
          keyManagementAlgorithms: ['RSA-OAEP-256'], contentEncryptionAlgorithms: ['A256GCM'],
        });
        if (protectedHeader.typ !== TYPE) fail();
        payload = JSON.parse(new TextDecoder().decode(plaintext));
      } catch { fail(); }
      if (payload.sessionId !== sessionId || payload.challenge !== session.challenge
          || payload.operation !== 'synthetic-roundtrip' || !isNonce(payload.responseKey)
          || !isNonce(payload.sample) || !isNonce(payload.passphrase)
          || Object.keys(payload).some(k => !['sessionId','challenge','operation','responseKey','sample','passphrase'].includes(k))) fail();
      const responseKey = Buffer.from(payload.responseKey, 'base64url');
      try {
        const result = await run({ sample: payload.sample, passphrase: payload.passphrase });
        return { envelope: await new CompactEncrypt(encode({ ...result, sessionId, challenge: session.challenge }))
          .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: TYPE }).encrypt(responseKey) };
      } finally { responseKey.fill(0); payload.passphrase = ''; payload.responseKey = ''; }
    },
  };
}
