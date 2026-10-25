import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AUDIENCE, ISSUER, ENTRYPOINT, APPLICATION_ENTRYPOINT, verifyOffer } from './attestation.mjs';

// Software signature fixtures only. No hardware, cloud job or backup is proven here.
const signer = await generateKeyPair('RS256');
const recipient = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072 });
const publicKey = await exportJWK(recipient.publicKey);
const challenge = randomBytes(32).toString('base64url');
const sessionId = randomBytes(32).toString('base64url');
const keyFingerprint = await calculateJwkThumbprint(publicKey);
const policy = { imageDigest: `sha256:${'a'.repeat(64)}`, projectNumber: '495102144848', hardware: 'GCP_INTEL_TDX' };
const now = Math.floor(Date.now() / 1000);
const claims = () => ({
  iss: ISSUER, aud: AUDIENCE, iat: now, nbf: now - 1, exp: now + 300,
  sub: 'synthetic-test-fixture', swname: 'CONFIDENTIAL_SPACE', secboot: true,
  dbgstat: 'disabled-since-boot', hwmodel: policy.hardware, eat_nonce: [challenge, keyFingerprint],
  submods: {
    confidential_space: { support_attributes: ['STABLE', 'USABLE'] },
    gce: { project_number: policy.projectNumber },
    container: { image_digest: policy.imageDigest, args: ENTRYPOINT, cmd_override: [], env_override: {}, restart_policy: 'Never' },
  },
});
async function offer(mutate = () => {}, signingKey = signer.privateKey) {
  const payload = claims(); mutate(payload);
  return { sessionId, publicKey, attestation: await new SignJWT(payload).setProtectedHeader({ alg: 'RS256' }).sign(signingKey) };
}
const verify = (o, p = policy, c = challenge) => verifyOffer(o, c, p, { keyResolver: signer.publicKey });

test('production policy accepts only the production application entrypoint', async () => {
  const production={...policy,workload:'application'};
  const accepted=await offer(p=>{p.submods.container.args=APPLICATION_ENTRYPOINT;});
  assert.ok((await verify(accepted,production)).encryptionKey);
  await assert.rejects(verify(await offer(),production),/entrypoint/);
  await assert.rejects(verify(accepted,policy),/entrypoint/);
});

test('accepts the signed fixture only for the customer-approved image and generated key', async () => {
  const result = await verify(await offer());
  assert.equal(result.evidence.imageDigest, policy.imageDigest);
  assert.equal(result.evidence.keyFingerprint, keyFingerprint);
  assert.equal(result.evidence.debugDisabled, true);
  assert.ok(result.encryptionKey);
});

const mutations = [
  ['a different image', p => { p.submods.container.image_digest = `sha256:${'b'.repeat(64)}`; }],
  ['debug access', p => { p.dbgstat = 'enabled'; }],
  ['an ordinary VM', p => { p.hwmodel = 'GCP_SHIELDED_VM'; }],
  ['disabled secure boot', p => { p.secboot = false; }],
  ['unsupported OS', p => { p.swname = 'GCE'; }],
  ['a different project', p => { p.submods.gce.project_number = '123456789012'; }],
  ['an overridden command', p => { p.submods.container.cmd_override = ['sh']; }],
  ['an overridden environment', p => { p.submods.container.env_override = { NODE_OPTIONS: '--inspect=0.0.0.0' }; }],
  ['a malformed command override', p => { p.submods.container.cmd_override = null; }],
  ['a malformed environment override', p => { p.submods.container.env_override = []; }],
  ['a substituted entrypoint', p => { p.submods.container.args = ['sh']; }],
  ['a restart policy change', p => { p.submods.container.restart_policy = 'Always'; }],
  ['an expired token', p => { p.exp = now - 60; }],
  ['an old token', p => { p.iat = now - 300; }],
  ['a future token', p => { p.nbf = now + 120; }],
  ['the wrong audience', p => { p.aud = 'urn:other-customer'; }],
  ['the wrong issuer', p => { p.iss = 'https://attacker.invalid'; }],
  ['a replayed challenge', p => { p.eat_nonce[0] = randomBytes(32).toString('base64url'); }],
  ['missing key binding', p => { p.eat_nonce = [challenge]; }],
  ['a revoked image family', p => { p.submods.confidential_space.support_attributes = ['EXPERIMENTAL']; }],
];
test('accepts unused override fields omitted by the real Google-signed attestation', async () => {
  const value = await offer(p => {
    delete p.submods.container.cmd_override;
    delete p.submods.container.env_override;
  });
  assert.ok((await verify(value)).encryptionKey);
});
for (const [label, mutate] of mutations) {
  test(`rejects ${label} before returning an encryption key`, async () => {
    await assert.rejects(verify(await offer(mutate)), /attestation_rejected:/);
  });
}

test('rejects a valid-looking token signed by an untrusted key', async () => {
  const attacker = await generateKeyPair('RS256');
  await assert.rejects(verify(await offer(undefined, attacker.privateKey)), /signature_or_time/);
});
test('rejects a public key substituted by a relay', async () => {
  const substituted = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072 });
  const value = await offer(); value.publicKey = await exportJWK(substituted.publicKey);
  await assert.rejects(verify(value), /key_binding/);
});
test('rejects absent customer policy and arbitrary digest values', async () => {
  await assert.rejects(verify(await offer(), {}), /policy_digest/);
  await assert.rejects(verify(await offer(), { ...policy, imageDigest: 'latest' }), /policy_digest/);
});
test('rejects an unsigned token rather than trusting decoded claims', async () => {
  const value = await offer();
  value.attestation = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.`;
  await assert.rejects(verify(value), /signature_or_time/);
});
