/**
 * Portabase Cloud identity backends.
 *
 * LAUNCH: Supabase-only (email + Google via hosted Supabase Auth).
 * AWS Cognito remains in code for a later release — not offered in the UI.
 */

/** Flip to true to re-enable Cognito login in UI (not for v1 launch). */
export const AWS_CLOUD_VERSION_ENABLED = false;

export const CLOUD_VERSIONS = {
  supabase: {
    id: 'supabase',
    label: 'Supabase',
    short: 'Supabase',
    description: 'Sign in with hosted Supabase Auth (email + Google). Portabase Cloud is built for Supabase projects first.',
    authLabel: 'Supabase Auth',
    loginPath: '/login',
    providers: ['email', 'google'],
    launch: true,
  },
  aws: {
    id: 'aws',
    label: 'AWS',
    short: 'AWS (later)',
    description: 'Amazon Cognito identity — reserved for a future AWS-native Cloud path. Not available at launch.',
    authLabel: 'Amazon Cognito',
    loginPath: '/login?version=aws',
    providers: ['email', 'google'],
    launch: false,
  },
};

export const DEFAULT_CLOUD_VERSION = 'supabase';
export const CLOUD_VERSION_STORAGE_KEY = 'portabase.cloud.version';

export function isCloudVersion(value) {
  return value === 'supabase' || value === 'aws';
}

export function normalizeCloudVersion(value, fallback = DEFAULT_CLOUD_VERSION) {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'cognito') return AWS_CLOUD_VERSION_ENABLED ? 'aws' : DEFAULT_CLOUD_VERSION;
  if (v === 'aws' && !AWS_CLOUD_VERSION_ENABLED) return DEFAULT_CLOUD_VERSION;
  if (isCloudVersion(v)) {
    if (v === 'aws' && !AWS_CLOUD_VERSION_ENABLED) return DEFAULT_CLOUD_VERSION;
    return v;
  }
  return fallback === null ? null : fallback;
}

export function getStoredCloudVersion() {
  try {
    return normalizeCloudVersion(localStorage.getItem(CLOUD_VERSION_STORAGE_KEY));
  } catch {
    return DEFAULT_CLOUD_VERSION;
  }
}

export function setStoredCloudVersion(version) {
  const v = normalizeCloudVersion(version);
  try {
    localStorage.setItem(CLOUD_VERSION_STORAGE_KEY, v);
  } catch {
    /* ignore */
  }
  return v;
}

export function versionFromSearch(search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  return normalizeCloudVersion(params.get('version') || params.get('v'), null);
}

/** Versions shown in the product UI (launch = Supabase only). */
export function listCloudVersions() {
  return Object.values(CLOUD_VERSIONS).filter(v => v.launch || AWS_CLOUD_VERSION_ENABLED);
}

export function isSupabaseOnlyLaunch() {
  return !AWS_CLOUD_VERSION_ENABLED;
}
