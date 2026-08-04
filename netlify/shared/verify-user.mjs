/**
 * Cloud identity verification.
 * Launch: Supabase Auth only (UI + product). Cognito verify remains for
 * reserved AWS path / legacy tokens — not advertised (AWS_CLOUD_VERSION_ENABLED=false).
 */

import { verifyIdToken as verifyCognitoIdToken, getPublicAuthConfig as getCognitoPublic } from './cognito-jwt.mjs';
import { resolveSupabasePublicConfig, verifySupabaseUser } from './supabase-auth.mjs';

function header(event, name) {
  const h = event.headers || {};
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : '';
}

export function requestedCloudVersion(event) {
  const raw = header(event, 'x-portabase-cloud-version')
    || header(event, 'x-cloud-version')
    || '';
  const v = String(raw).toLowerCase().trim();
  if (v === 'cognito') return 'aws';
  if (v === 'aws' || v === 'supabase') return v;
  return null;
}

/**
 * @returns {Promise<{
 *   id: string,
 *   email: string,
 *   name: string,
 *   emailVerified: boolean,
 *   provider: string,
 *   authProvider: 'supabase'|'aws',
 *   cloudVersion: 'supabase'|'aws',
 * }>}
 */
export async function verifyCloudUser(event) {
  const authorization = header(event, 'authorization');
  const preferred = requestedCloudVersion(event);

  if (preferred === 'supabase') {
    const user = await verifySupabaseUser(authorization);
    return { ...user, authProvider: 'supabase', cloudVersion: 'supabase' };
  }
  if (preferred === 'aws') {
    const user = await verifyCognitoIdToken(authorization);
    return {
      id: user.sub,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      provider: 'cognito',
      authProvider: 'aws',
      cloudVersion: 'aws',
    };
  }

  // Auto-detect: try Supabase first, then Cognito
  try {
    const user = await verifySupabaseUser(authorization);
    return { ...user, authProvider: 'supabase', cloudVersion: 'supabase' };
  } catch {
    /* try aws */
  }
  try {
    const user = await verifyCognitoIdToken(authorization);
    return {
      id: user.sub,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      provider: 'cognito',
      authProvider: 'aws',
      cloudVersion: 'aws',
    };
  } catch {
    throw new Error('unauthorized');
  }
}

export async function publicAuthConfigBoth() {
  const [supabase, cognito] = await Promise.all([
    resolveSupabasePublicConfig().catch(() => null),
    Promise.resolve(getCognitoPublic()),
  ]);

  return {
    provider: 'supabase',
    launchPlatform: 'supabase',
    /** Cognito kept in API payload as unavailable for future use */
    versions: {
      supabase: {
        id: 'supabase',
        label: 'Supabase',
        available: Boolean(supabase?.anonKey && supabase?.url),
        launch: true,
        url: supabase?.url || null,
        anonKey: supabase?.anonKey || null,
        authRedirectPath: '/auth/callback',
      },
      aws: {
        id: 'aws',
        label: 'AWS',
        available: false,
        launch: false,
        note: 'Not offered at launch — Supabase only.',
      },
    },
    trialDays: 7,
    priceMonthlyCents: 1700,
    listPriceMonthlyCents: 2700,
    currency: 'USD',
    paymentGateway: 'square',
    maxAgents: 12,
    plans: {
      'cloud-17': { id: 'cloud-17', priceMonthlyCents: 1700, escapesPerDay: 1, cyclesPerDay: 1, title: 'Daily Escape', cadenceLabel: '1 escape per 24 hours' },
      'cloud-27': { id: 'cloud-27', priceMonthlyCents: 2700, escapesPerDay: 3, cyclesPerDay: 3, title: 'Triple Escape', cadenceLabel: 'up to 3 escapes per day' },
    },
    storage: {
      owner: 'customer',
      includedInCloud: false,
      summary: 'Customer provides capsule storage. Portabase Cloud never hosts recovery bytes.',
    },
  };
}

export { jsonResponse } from './supabase-auth.mjs';
