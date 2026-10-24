import { randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair } from 'jose';
import { requestGoogleAttestation } from './google-token.mjs';
export const COMMAND_TYPE = 'portabase-confidential-command-v1';
const validNonce = s => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
const reject = () => { throw new Error('encrypted_request_rejected'); };
export function commandChannel({ attest = requestGoogleAttestation, dispatch, now = Date.now } = {}) {
  const offers = new Map();
  return {
    async offer(owner, challenge) {
      if (!/^[a-f0-9]{64}$/.test(owner || '') || !validNonce(challenge)) reject();
      for (const [id, entry] of offers) if (entry.expires <= now()) offers.delete(id);
      if (offers.size >= 32) throw new Error('runner_busy');
      const sessionId = randomBytes(32).toString('base64url');
      const entry = { owner, challenge, expires: now() + 90000 };
      offers.set(sessionId, entry);
      try {
        const pair = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072 });
        entry.privateKey = pair.privateKey;
        const publicKey = await exportJWK(pair.publicKey);
        const attestation = await attest(challenge, await calculateJwkThumbprint(publicKey));
        return { sessionId, publicKey, attestation };
      } catch { offers.delete(sessionId); throw new Error('attestation_unavailable'); }
    },
    async execute(owner, { sessionId, envelope }, authorization) {
      const offer = offers.get(sessionId);
      // Another user cannot consume this customer's pending offer.
      if (!offer || offer.owner !== owner) reject();
      offers.delete(sessionId);
      if (offer.expires <= now() || typeof envelope !== 'string' || envelope.length > 262144) reject();
      let payload;
      try {
        const decoded = await compactDecrypt(envelope, offer.privateKey, {
          keyManagementAlgorithms: ['RSA-OAEP-256'], contentEncryptionAlgorithms: ['A256GCM'] });
        if (decoded.protectedHeader.typ !== COMMAND_TYPE) reject();
        payload = JSON.parse(new TextDecoder().decode(decoded.plaintext));
        decoded.plaintext.fill(0);
      } catch { reject(); }
      if (payload.sessionId !== sessionId || payload.challenge !== offer.challenge || !validNonce(payload.responseKey)
        || typeof payload.operation !== 'string' || !payload.input || typeof payload.input !== 'object' || Array.isArray(payload.input)) reject();
      const responseKey = Buffer.from(payload.responseKey, 'base64url');
      try {
        let result;
        try { result = { ok: true, data: await dispatch({ owner, operation: payload.operation, input: payload.input, authorization }) }; }
        catch (error) { result = { ok: false, error: /^[a-z0-9_]{3,80}$/.test(error.message) ? error.message : 'operation_failed' }; }
        const plaintext = new TextEncoder().encode(JSON.stringify({ ...result, sessionId, challenge: offer.challenge }));
        const encrypted = await new CompactEncrypt(plaintext).setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: COMMAND_TYPE }).encrypt(responseKey);
        plaintext.fill(0);
        return { envelope: encrypted };
      } finally { responseKey.fill(0); payload.responseKey = ''; }
    },
  };
}
