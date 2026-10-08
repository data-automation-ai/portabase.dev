import { authHeaders, loadSession, sessionCloudVersion } from './session.js';
import { ensureFreshSession as ensureSupabaseSession } from './supabase-auth.js';
import { ensureFreshSession as ensureAwsSession } from './cognito.js';
import { DEFAULT_CLOUD_VERSION, normalizeCloudVersion } from './cloud-versions.js';

export async function ensureSessionForVersion(version) {
  const v = normalizeCloudVersion(version, sessionCloudVersion() || DEFAULT_CLOUD_VERSION);
  if (v === 'aws') return ensureAwsSession();
  return ensureSupabaseSession();
}

async function api(path, { method = 'GET', body, version, signal } = {}) {
  const v = normalizeCloudVersion(version, sessionCloudVersion() || DEFAULT_CLOUD_VERSION);
  await ensureSessionForVersion(v);
  const response = await fetch(path, {
    method,
    signal,
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

export function cancelCloudSubscription(version) {
  return api('/api/cloud/cancel-subscription', { method: 'POST', body: { confirm: true }, version });
}

// Compatibility exports fail locally before session refresh, serialization or
// network. Source credentials and named selections belong to the private runner.
async function privateSetupRequired() {
  throw Object.assign(new Error('Use the private runner workspace for source setup.'),
    { status: 410, code: 'private_runner_setup_required' });
}
export const fetchSupabaseProjects = privateSetupRequired;
export const fetchSupabaseInventory = privateSetupRequired;
export const fetchCloudSelection = privateSetupRequired;
export const saveCloudSelection = privateSetupRequired;

/**
 * Queue a manual backup/verify/replay intent. The body is labels only —
 * project ref, destination kind, exclude lists. The worker pulls it.
 */
export function queueCloudJob(body, version, { signal } = {}) {
  return api('/api/cloud/jobs', { method: 'POST', body, version, signal });
}

/** Live runner telemetry for the user's own projects (7d default, 30d max server-side). */
export function fetchTelemetryEvents(version, days = 7) {
  return api(`/api/cloud/telemetry-events?days=${encodeURIComponent(days)}`, { version });
}

export function fetchCloudJobs(version, { signal } = {}) {
  return api('/api/cloud/jobs', { version, signal });
}

export const fetchAgents = version => api('/api/cloud/agents', { version });
export const createAgentToken = (body, version) => api('/api/cloud/agents', { method: 'POST', body, version });
export const revokeAgentToken = (id, version) => api('/api/cloud/agents', { method: 'DELETE', body: { id }, version });
export const rotateAgentToken = (id, expectedRevision, version) => api('/api/cloud/agents', {
  method: 'PATCH', body: { id, expectedRevision, enableJobAccess: true }, version,
});

export const fetchNotificationPreferences = version => api('/api/cloud/notification-preferences', { version });
export const saveNotificationPreferences = (body, version) => api('/api/cloud/notification-preferences', { method: 'PUT', body, version });

export const fetchNotificationDestinations = version => api('/api/cloud/notification-destinations', { version });
export const changeNotificationDestination = (body, version) => api('/api/cloud/notification-destinations', { method: 'POST', body, version });
export const fetchNotificationHistory = version => api('/api/cloud/notification-history', { version });

export const fetchBackupSchedules = (version, { signal } = {}) => api('/api/cloud/schedules', { version, signal });
export const saveBackupSchedule = (body, version, { signal } = {}) => api('/api/cloud/schedules', { method: 'PUT', body, version, signal });
export const disableBackupSchedule = (body, version, { signal } = {}) => api('/api/cloud/schedules', { method: 'PATCH', body, version, signal });
