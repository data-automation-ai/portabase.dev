/**
 * Browser seals customer keys to the Cloud Runner only.
 * The Portabase control plane must never receive this payload.
 */

const CONTROL_PLANE_HOSTS = [
  'portabase.dev',
  'localhost',
];

export function isControlPlaneUrl(url) {
  try {
    const u = new URL(url, 'https://portabase.dev');
    if (/^\/api\//.test(u.pathname)) return true;
    if (CONTROL_PLANE_HOSTS.includes(u.hostname) && /^\/api\//.test(u.pathname)) return true;
    return false;
  } catch {
    return true;
  }
}

export function assertRunnerSealUrl(sealUrl) {
  if (!sealUrl || typeof sealUrl !== 'string') {
    const err = new Error('Runner seal URL is required');
    err.code = 'seal_url_required';
    throw err;
  }
  if (isControlPlaneUrl(sealUrl) || /\/api\/cloud\//i.test(sealUrl)) {
    const err = new Error('Keys must be sealed to the runner, not Portabase /api');
    err.code = 'seal_to_runner_only';
    throw err;
  }
  return sealUrl;
}

export function buildSealedEnvelope({ ciphertext, alg = 'AES-256-GCM', runnerId } = {}) {
  if (!ciphertext) {
    const err = new Error('ciphertext required');
    err.code = 'invalid_seal';
    throw err;
  }
  return {
    alg,
    ciphertext,
    runnerId: runnerId || null,
    sealedAt: new Date().toISOString(),
  };
}

/** Fetch wrapper that refuses to POST seals at the control plane. */
export async function postSealToRunner(sealUrl, envelope, fetchImpl = fetch) {
  const url = assertRunnerSealUrl(sealUrl);
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
}
