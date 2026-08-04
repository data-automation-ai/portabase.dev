import { DEFAULT_CLOUD_VERSION, normalizeCloudVersion, setStoredCloudVersion } from './cloud-versions.js';

const KEY = 'portabase.auth.v1';

/**
 * Session shapes:
 *  Supabase: { provider: 'supabase', cloudVersion: 'supabase', accessToken, refreshToken, user }
 *  AWS:      { provider: 'aws', cloudVersion: 'aws', idToken, accessToken, refreshToken, user|email }
 */
export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data) return null;

    if (data.provider === 'supabase' && data.accessToken) {
      return { ...data, cloudVersion: 'supabase' };
    }
    if (data.provider === 'aws' && (data.idToken || data.accessToken)) {
      return { ...data, cloudVersion: 'aws' };
    }
    // Legacy Cognito (no provider field)
    if (data.idToken && data.accessToken && !data.provider) {
      return { ...data, provider: 'aws', cloudVersion: 'aws' };
    }
    // Supabase without provider
    if (data.accessToken && data.user?.id && !data.idToken) {
      return { ...data, provider: 'supabase', cloudVersion: 'supabase' };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  const cloudVersion = normalizeCloudVersion(
    session.cloudVersion || session.provider,
    session.provider === 'aws' || session.idToken ? 'aws' : DEFAULT_CLOUD_VERSION,
  );
  const provider = session.provider || (cloudVersion === 'aws' ? 'aws' : 'supabase');
  setStoredCloudVersion(cloudVersion);
  localStorage.setItem(KEY, JSON.stringify({
    ...session,
    provider,
    cloudVersion,
    savedAt: new Date().toISOString(),
  }));
  window.dispatchEvent(new Event('portabase-auth'));
}

export function clearSession() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('portabase-auth'));
}

export function isTokenExpired(token, skewSeconds = 60) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return false;
    return Date.now() >= (payload.exp - skewSeconds) * 1000;
  } catch {
    return true;
  }
}

export function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** @deprecated */
export function decodeIdToken(token) {
  return decodeJwt(token);
}

/** Token sent as Bearer to Cloud APIs */
export function sessionAccessToken(session = loadSession()) {
  if (!session) return null;
  if (session.cloudVersion === 'aws' || session.provider === 'aws') {
    return session.idToken || session.accessToken || null;
  }
  return session.accessToken || session.idToken || null;
}

export function authHeaders(session = loadSession()) {
  const token = sessionAccessToken(session);
  if (!token) return {};
  const version = session?.cloudVersion || session?.provider || DEFAULT_CLOUD_VERSION;
  return {
    Authorization: `Bearer ${token}`,
    'X-Portabase-Cloud-Version': normalizeCloudVersion(version),
  };
}

export function sessionUser(session = loadSession()) {
  if (!session) return null;
  if (session.user?.email || session.user?.id) return session.user;
  const token = sessionAccessToken(session);
  const claims = decodeJwt(token);
  if (!claims) {
    if (session.email) return { id: null, email: session.email, name: '' };
    return null;
  }
  return {
    id: claims.sub,
    email: claims.email || session.email || '',
    name: claims.user_metadata?.full_name || claims.name || claims.given_name || '',
  };
}

export function sessionCloudVersion(session = loadSession()) {
  if (!session) return null;
  return normalizeCloudVersion(session.cloudVersion || session.provider);
}
