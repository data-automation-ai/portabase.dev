import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CompactEncrypt, compactDecrypt, importJWK } from 'jose';
import { createProofService, TYPE } from './protocol.mjs';

const nonce = () => randomBytes(32).toString('base64url');
const challenge = nonce();
async function sealed(offer, overrides = {}) {
  const body = { sessionId: offer.sessionId, challenge, operation: 'synthetic-roundtrip',
    sample: nonce(), passphrase: nonce(), responseKey: nonce(), ...overrides };
  const envelope = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(body)))
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: TYPE })
    .encrypt(await importJWK(offer.publicKey, 'RSA-OAEP-256'));
  return { body, envelope };
}
const attest = async () => 'fixture-token-never-used-as-hardware-evidence';
test('only the generated private key opens the request; response is encrypted to the client', async () => {
  let calls = 0;
  const service = createProofService({ attest, run: async p => { calls++; return { fixtureSample: p.sample }; } });
  const offer = await service.offer(challenge);
  const { body, envelope } = await sealed(offer);
  assert.ok(!envelope.includes(body.sample));
  const result = await service.execute(offer.sessionId, envelope);
  assert.ok(!JSON.stringify(result).includes(body.sample));
  const { plaintext } = await compactDecrypt(result.envelope, Buffer.from(body.responseKey, 'base64url'));
  assert.equal(JSON.parse(new TextDecoder().decode(plaintext)).fixtureSample, body.sample);
  assert.equal(calls, 1);
  await assert.rejects(service.execute(offer.sessionId, envelope), /rejected/);
  await assert.rejects(compactDecrypt(result.envelope, randomBytes(32)));
});
test('rejects changed ciphertext without executing the synthetic operation', async () => {
  let calls = 0;
  const service = createProofService({ attest, run: async () => { calls++; } });
  const offer = await service.offer(challenge);
  const { envelope } = await sealed(offer);
  const parts = envelope.split('.');
  parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  await assert.rejects(service.execute(offer.sessionId, parts.join('.')), /rejected/);
  assert.equal(calls, 0);
});
test('rejects expired sessions, wrong challenges and requests for real operations', async () => {
  let clock = 0, calls = 0;
  const service = createProofService({ attest, now: () => clock, run: async () => { calls++; } });
  const expired = await service.offer(challenge);
  const first = await sealed(expired);
  clock = 90001;
  await assert.rejects(service.execute(expired.sessionId, first.envelope), /rejected/);
  for (const overrides of [{ challenge: nonce() }, { operation: 'backup' }, { SUPABASE_DB_URL: 'forbidden' }]) {
    const offer = await service.offer(challenge);
    const { envelope } = await sealed(offer, overrides);
    await assert.rejects(service.execute(offer.sessionId, envelope), /rejected/);
  }
  assert.equal(calls, 0);
});
test('does not offer a key without a successful attestation response', async () => {
  const service = createProofService({ attest: async () => { throw new Error('provider unavailable'); } });
  await assert.rejects(service.offer(challenge), /attestation_unavailable/);
});
