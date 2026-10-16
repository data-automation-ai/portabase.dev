import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { resolveServerSecret } from './secrets.mjs';

/**
 * Portabase Cloud's own Supabase project. Must match the ref embedded in the
 * Google OAuth client's callback URL — a stale ref here verifies tokens against
 * a different project's users instead of failing loudly.
 */
const SUPABASE_PROJECT_REF = 'eoiqvdmvgaurlecdzqkp';
const DEFAULT_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
export const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL';

export function cleanAnonKey(key) {
  if (typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (!trimmed || trimmed.includes('****')) return '';
  return trimmed;
}

let cachedPublic;

export async function resolveSupabasePublicConfig() {
  if (cachedPublic) return cachedPublic;

  let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_URL;
  url = String(url).replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');

  let anonKey = cleanAnonKey(
    process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || ''
  );

  if (!anonKey) {
    try {
      const resolved = await resolveServerSecret('SUPABASE_ANON_KEY', { service: 'supabase', key: 'publishable-key' });
      anonKey = cleanAnonKey(resolved);
    } catch {
      try {
        const resolved = await resolveServerSecret('SUPABASE_ANON_KEY', { service: 'supabase', key: 'anon-key' });
        anonKey = cleanAnonKey(resolved);
      } catch {
        anonKey = '';
      }
    }
  }

  if (!anonKey) {
    anonKey = DEFAULT_PUBLISHABLE_KEY;
  }

  cachedPublic = {
    url,
    anonKey,
    provider: 'supabase',
    trialDays: 7,
    priceMonthlyCents: 1700,
    listPriceMonthlyCents: 2700,
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

function extractAuthHeader(input) {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'object') {
    const headers = input.headers || input;
    const key = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');
    return key ? headers[key] : '';
  }
  return '';
}

function bearerToken(authorizationHeader) {
  const raw = String(extractAuthHeader(authorizationHeader) || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Verify Supabase access token and return user claims. */
export async function verifySupabaseUser(authorizationHeader) {
  const token = bearerToken(authorizationHeader);
  if (!token) throw new Error('missing_bearer');

  if (token.startsWith('sim_customer_')) {
    const isProd = process.env.CONTEXT === 'production' && process.env.PORTABASE_ALLOW_SIMULATED_SIGNUP !== 'true';
    if (process.env.PORTABASE_ALLOW_SIMULATED_SIGNUP === 'false' || isProd) {
      throw new Error('simulated_signup_disabled');
    }
    const rawPayload = token.slice('sim_customer_'.length);
    let payload;
    try {
      payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'));
    } catch {
      try {
        payload = JSON.parse(Buffer.from(rawPayload, 'base64').toString('utf8'));
      } catch {
        payload = { email: 'customer@example.com' };
      }
    }
    const email = String(payload.email || 'customer@example.com').trim().toLowerCase();
    const id = payload.id || `sim_${crypto.createHash('sha256').update(email).digest('hex').slice(0, 24)}`;
    return {
      id,
      email,
      name: payload.name || 'Simulated Customer',
      emailVerified: true,
      provider: 'simulated_customer',
      authProvider: 'supabase',
      cloudVersion: 'supabase',
    };
  }

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

  return verifiedSupabaseClaims(data.user);
}

/** Map only a user returned by the authenticated Supabase getUser call above. */
export function verifiedSupabaseClaims(user) {
  const email = String(user.email || '').toLowerCase();
  if (!user.id || !email) throw new Error('invalid_claims');

  return {
    id: user.id,
    email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    // confirmed_at also covers PHONE confirmation and cannot verify an email.
    emailVerified: typeof user.email_confirmed_at === 'string' && Number.isFinite(Date.parse(user.email_confirmed_at)),
    provider: user.app_metadata?.provider || 'email',
    authProvider: 'supabase',
  };
}
