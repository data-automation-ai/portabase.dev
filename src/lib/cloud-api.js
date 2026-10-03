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

export function startAddonCheckout(version, addon = 'extra-transfers') {
  return api('/api/cloud/subscribe', { method: 'POST', body: { addon }, version });
}

export function confirmCheckout({ attempt, version, addon } = {}) {
  return api('/api/cloud/confirm-checkout', { method: 'POST', body: { attempt: attempt || null, addon: addon || null }, version });
}

export function fetchRunners(version) {
  return api('/api/cloud/runners', { version });
}

export function provisionRunner(version, body = {}) {
  return api('/api/cloud/runners', { method: 'POST', body: { action: 'provision', ...body }, version });
}

export function fetchDashboard(version) {
  return api('/api/cloud/dashboard', { version });
}

export function requestSelfRefund(version) {
  return api('/api/cloud/self-refund', { method: 'POST', body: {}, version });
}

/** List the caller's Supabase projects for a pasted Personal Access Token. Token is sent in-request only. */
export function fetchSupabaseProjects(token, version) {
  return api('/api/cloud/supabase', { method: 'POST', body: { action: 'projects', token }, version });
}

/** Measure tables + Storage buckets for one Supabase project ref. Token is sent in-request only. */
export function fetchSupabaseInventory(token, ref, version) {
  return api('/api/cloud/supabase', { method: 'POST', body: { action: 'inventory', token, ref }, version });
}

/** Saved cloud-7 selection, or `{ selection: null }` when nothing is saved yet. */
export function fetchCloudSelection(version) {
  return api('/api/cloud/selection', { version });
}

/** Save the capsule selection (tables/buckets to include, estimate, plan). */
export function saveCloudSelection(selection, version) {
  return api('/api/cloud/selection', { method: 'PUT', body: selection, version });
}

/**
 * Queue a manual backup/verify/replay intent. The body is labels only —
 * project ref, destination kind, exclude lists. The worker pulls it.
 */
export function queueCloudJob(body, version) {
  return api('/api/cloud/jobs', { method: 'POST', body, version });
}

/** Live runner telemetry for the user's own projects (7d default, 30d max server-side). */
export function fetchTelemetryEvents(version, days = 7) {
  return api(`/api/cloud/telemetry-events?days=${encodeURIComponent(days)}`, { version });
}

export function fetchCloudJobs(version) {
  return api('/api/cloud/jobs', { version });
}
