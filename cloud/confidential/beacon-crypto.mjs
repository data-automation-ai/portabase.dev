import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { request } from 'node:http';
import { BEACON_KMS_KEY, BEACON_WIF_PROVIDER, beaconOwner } from './beacon-config.mjs';

export function beaconAttestation() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ audience: 'https://sts.googleapis.com', token_type: 'OIDC' });
    const req = request({ socketPath: '/run/container_launcher/teeserver.sock', path: '/v1/token', method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let raw = ''; res.on('data', chunk => { raw += chunk; if (raw.length > 32768) req.destroy(); });
      res.on('end', () => res.statusCode === 200 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(raw.trim()) ? resolve(raw.trim()) : reject(Error('beacon_attestation_unavailable')));
      res.on('error', () => reject(Error('beacon_attestation_unavailable')));
    });
    req.setTimeout(5000, () => req.destroy()); req.on('error', () => reject(Error('beacon_attestation_unavailable'))); req.end(body);
  });
}

export function beaconCrypto({ attest = beaconAttestation, fetchImpl = fetch } = {}) {
  let access, expires = 0;
  async function token() {
    if (access && expires > Date.now() + 60000) return access;
    const response = await fetchImpl('https://sts.googleapis.com/v1/token', { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000), body: JSON.stringify({
      audience: BEACON_WIF_PROVIDER, grantType: 'urn:ietf:params:oauth:grant-type:token-exchange', requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt', scope: 'https://www.googleapis.com/auth/cloud-platform', subjectToken: await attest(),
    }) });
    if (!response.ok) throw Error('beacon_attested_identity_denied');
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in < 60) throw Error('beacon_attested_identity_denied');
    access = data.access_token; expires = Date.now() + Math.min(data.expires_in, 3600) * 1000;
    return access;
  }
  async function kms(operation, body) {
    const response = await fetchImpl(`https://cloudkms.googleapis.com/v1/${BEACON_KMS_KEY}:${operation}`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('beacon_key_release_denied');
    return response.json();
  }
  return {
    token,
    async seal(owner, value) {
      const aad = Buffer.from('portabase-beacon-delegation-v1:' + beaconOwner(owner)), key = randomBytes(32), iv = randomBytes(12);
      const plaintext = Buffer.from(JSON.stringify(value));
      if (plaintext.length > 128 * 1024) throw Error('beacon_delegation_too_large');
      try {
        const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const wrapped = await kms('encrypt', { plaintext: key.toString('base64'), additionalAuthenticatedData: aad.toString('base64') });
        if (typeof wrapped.ciphertext !== 'string') throw Error('beacon_key_release_denied');
        return { version: 1, wrappedKey: wrapped.ciphertext, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
      } finally { key.fill(0); plaintext.fill(0); }
    },
    async open(owner, envelope) {
      const aad = Buffer.from('portabase-beacon-delegation-v1:' + beaconOwner(owner));
      if (envelope?.version !== 1 || !['wrappedKey', 'iv', 'tag', 'ciphertext'].every(k => typeof envelope[k] === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope[k])) || envelope.ciphertext.length > 180000) throw Error('beacon_delegation_invalid');
      const result = await kms('decrypt', { ciphertext: envelope.wrappedKey, additionalAuthenticatedData: aad.toString('base64') });
      const key = Buffer.from(result.plaintext || '', 'base64'); let plaintext;
      try {
        const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
        if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw Error('beacon_delegation_invalid');
        const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad); cipher.setAuthTag(tag);
        plaintext = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]);
        const value = JSON.parse(plaintext);
        if (value.owner !== owner || value.version !== 1) throw Error('beacon_delegation_invalid');
        return value;
      } catch { throw Error('beacon_delegation_invalid'); }
      finally { key.fill(0); plaintext?.fill(0); }
    },
  };
}
