import { authHeaders, loadSession, sessionCloudVersion } from './session.js';
import { ensureFreshSession as ensureSupabaseSession } from './supabase-auth.js';
import { ensureFreshSession as ensureAwsSession } from './cognito.js';
import { DEFAULT_CLOUD_VERSION, normalizeCloudVersion } from './cloud-versions.js';

export async function ensureSessionForVersion(version) {
  const v = normalizeCloudVersion(version, sessionCloudVersion() || DEFAULT_CLOUD_VERSION);
  if (v === 'aws') return ensureAwsSession();
  return ensureSupabaseSession();
}

async function api(path, { method = 'GET', body, version } = {}) {
  const v = normalizeCloudVersion(version, sessionCloudVersion() || DEFAULT_CLOUD_VERSION);
  await ensureSessionForVersion(v);
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(loadSession()),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || data.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function fetchAuthConfig() {
  return fetch('/api/auth/config').then(r => r.json());
}

export function fetchMe(version) {
  return api('/api/cloud/me', { version });
}

export function startTrialCheckout(version, planId = 'cloud-17') {
  return api('/api/cloud/subscribe', { method: 'POST', body: { planId }, version });
}

export function confirmCheckout({ attempt, version } = {}) {
  return api('/api/cloud/confirm-checkout', { method: 'POST', body: { attempt: attempt || null }, version });
}

export function requestSelfRefund(version) {
  return api('/api/cloud/self-refund', { method: 'POST', body: {}, version });
}
