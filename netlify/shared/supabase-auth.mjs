import { createClient } from '@supabase/supabase-js';
import { resolveServerSecret } from './secrets.mjs';

const DEFAULT_URL = 'https://ekklokrukxmqlahtonnc.supabase.co';

let cachedPublic;

export async function resolveSupabasePublicConfig() {
  if (cachedPublic) return cachedPublic;

  let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_URL;
  url = String(url).replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');

  let anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || '';

  if (!anonKey) {
    try {
      anonKey = await resolveServerSecret('SUPABASE_ANON_KEY', { service: 'supabase', key: 'publishable-key' });
    } catch {
      try {
        anonKey = await resolveServerSecret('SUPABASE_ANON_KEY', { service: 'supabase', key: 'anon-key' });
      } catch {
        anonKey = '';
      }
    }
  }

  cachedPublic = {
    url,
    anonKey,
    provider: 'supabase',
    trialDays: 7,
    priceMonthlyCents: 1700,
    listPriceMonthlyCents: 3400,
    currency: 'USD',
    promoUntil: '2026-08-31',
    authRedirectPath: '/auth/callback',
  };
  return cachedPublic;
}

export function jsonResponse(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function bearerToken(authorizationHeader) {
  const raw = String(authorizationHeader || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Verify Supabase access token and return user claims. */
export async function verifySupabaseUser(authorizationHeader) {
  const token = bearerToken(authorizationHeader);
  if (!token) throw new Error('missing_bearer');

  const { url, anonKey } = await resolveSupabasePublicConfig();
  if (!url || !anonKey) throw new Error('supabase_not_configured');

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error(error?.message || 'invalid_token');
    err.code = 'unauthorized';
    throw err;
  }

  const user = data.user;
  const email = String(user.email || '').toLowerCase();
  if (!user.id || !email) throw new Error('invalid_claims');

  return {
    id: user.id,
    email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    provider: user.app_metadata?.provider || 'email',
    authProvider: 'supabase',
  };
}
