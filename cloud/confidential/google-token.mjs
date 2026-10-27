import { request } from 'node:http';
import { AUDIENCE } from './attestation.mjs';

/** This socket exists only in Confidential Space. There is no simulated fallback. */
export function requestGoogleAttestation(challenge, keyFingerprint) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ audience: AUDIENCE, token_type: 'OIDC', nonces: [challenge, keyFingerprint] });
    const req = request({ socketPath: '/run/container_launcher/teeserver.sock', path: '/v1/token',
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; if (data.length > 32768) req.destroy(new Error('attestation_response_too_large')); });
      res.on('error', () => reject(new Error('attestation_unavailable')));
      res.on('end', () => {
        if (res.statusCode !== 200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.trim())) {
          reject(new Error('attestation_unavailable')); return;
        }
        resolve(data.trim());
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('attestation_timeout')));
    req.on('error', () => reject(new Error('attestation_unavailable')));
    req.end(body);
  });
}
