import { createClient } from '@supabase/supabase-js';
import { authCallbackUrl, productConfig, supabasePublicDefaults } from './auth-config.js';
import { clearSession, isTokenExpired, loadSession, saveSession } from './session.js';

let client;
let bootstrappedConfig;

async function fetchRemoteConfig() {
  try {
    const res = await fetch('/api/auth/config');
    const data = await res.json();
    const s = data?.auth?.versions?.supabase || data?.auth;
    if (s?.url && s?.anonKey) return s;
    if (data?.auth?.url && data?.auth?.anonKey) return data.auth;
  } catch {
    /* fall through */
  }
  return null;
}

export async function getAuthConfig() {
  if (bootstrappedConfig) return bootstrappedConfig;
  if (supabasePublicDefaults.anonKey && supabasePublicDefaults.url) {
    bootstrappedConfig = {
      provider: 'supabase',
      url: supabasePublicDefaults.url.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, ''),
      anonKey: supabasePublicDefaults.anonKey,
      trialDays: productConfig.trialDays,
      priceMonthlyCents: productConfig.priceMonthly * 100,
    };
    return bootstrappedConfig;
  }
  const remote = await fetchRemoteConfig();
  if (remote?.url && remote?.anonKey) {
    bootstrappedConfig = remote;
    return bootstrappedConfig;
  }
  throw new Error('Supabase is not configured. Set VITE_SUPABASE_ANON_KEY or deploy /api/auth/config with secrets-bundle.');
}

export async function getSupabase() {
  if (client) return client;
  const cfg = await getAuthConfig();
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'portabase.supabase.auth',
      flowType: 'pkce',
    },
  });
  return client;
}

function persistFromSupabaseSession(session) {
  if (!session?.access_token) {
    clearSession();
    return null;
  }
  const user = session.user;
  saveSession({
    provider: 'supabase',
    cloudVersion: 'supabase',
    accessToken: session.access_token,
    refreshToken: session.refresh_token || null,
    expiresAt: session.expires_at || null,
    user: user
      ? {
        id: user.id,
        email: user.email || '',
        name: user.user_metadata?.full_name || user.user_metadata?.name || '',
        emailVerified: Boolean(user.email_confirmed_at),
      }
      : null,
  });
  return loadSession();
}

export async function syncSessionFromSupabase() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    clearSession();
    return null;
  }
  return persistFromSupabaseSession(data.session);
}

export async function ensureFreshSession() {
  const local = loadSession();
  if (local && local.cloudVersion !== 'supabase') return null;
  if (local?.accessToken && !isTokenExpired(local.accessToken)) return local;
  try {
    const supabase = await getSupabase();
    if (local?.refreshToken || local?.accessToken) {
      const { data, error } = await supabase.auth.getSession();
      if (!error && data.session) return persistFromSupabaseSession(data.session);
      const refreshed = await supabase.auth.refreshSession();
      if (!refreshed.error && refreshed.data.session) return persistFromSupabaseSession(refreshed.data.session);
    } else {
      return await syncSessionFromSupabase();
    }
  } catch {
    /* fall through */
  }
  clearSession();
  return null;
}

export async function signUpWithEmail({ email, password, name }) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: authCallbackUrl('supabase'),
      data: name ? { full_name: name, name } : undefined,
    },
  });
  if (error) throw error;
  if (data.session) persistFromSupabaseSession(data.session);
  return {
    user: data.user,
    session: data.session,
    needsEmailConfirmation: !data.session && Boolean(data.user),
  };
}

export async function signInWithEmail({ email, password }) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return persistFromSupabaseSession(data.session);
}

export async function signInWithGoogle({ next = '/app' } = {}) {
  const supabase = await getSupabase();
  sessionStorage.setItem('portabase.auth.next', next);
  sessionStorage.setItem('portabase.auth.version', 'supabase');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: authCallbackUrl('supabase'),
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
  if (error) throw error;
  if (data?.url) window.location.href = data.url;
  return data;
}

export async function requestPasswordReset({ email }) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${authCallbackUrl('supabase')}&type=recovery`,
  });
  if (error) throw error;
}

export async function resendSignupEmail({ email }) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: authCallbackUrl('supabase') },
  });
  if (error) throw error;
}

export async function completeOAuthCallback() {
  const supabase = await getSupabase();
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return persistFromSupabaseSession(data.session);
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) return persistFromSupabaseSession(data.session);
  throw new Error('No session found after auth redirect. Try signing in again.');
}

export async function signOut() {
  try {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
  } catch {
    /* local clear still required */
  }
  clearSession();
}

export function describeAuthError(error) {
  const msg = String(error?.message || error || 'Authentication failed.');
  const lower = msg.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (lower.includes('email not confirmed')) return 'Confirm your email using the link we sent, then sign in.';
  if (lower.includes('user already registered')) return 'An account with this email already exists. Sign in instead.';
  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
    return 'Google sign-in is not enabled yet in Supabase Auth. Use email login, or enable Google under Authentication → Providers.';
  }
  if (lower.includes('not configured')) return msg;
  return msg;
}
