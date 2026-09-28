/**
 * Cloud identity verification.
 * Launch: Supabase Auth only (UI + product). Cognito verify remains for
 * reserved AWS path / legacy tokens — not advertised (AWS_CLOUD_VERSION_ENABLED=false).
 */

import { verifyIdToken as verifyCognitoIdToken, getPublicAuthConfig as getCognitoPublic } from './cognito-jwt.mjs';
import { resolveSupabasePublicConfig, verifySupabaseUser } from './supabase-auth.mjs';
import { CLOUD_MAX_AGENTS, CLOUD_PLANS, CLOUD_TRIAL_DAYS, extraTransfersAddonPublic, publicPlansPayload } from './product.mjs';

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
    trialDays: CLOUD_TRIAL_DAYS,
    priceMonthlyCents: CLOUD_PLANS['cloud-17'].priceMonthlyCents,
    listPriceMonthlyCents: CLOUD_PLANS['cloud-37'].priceMonthlyCents,
    currency: 'USD',
    paymentGateway: 'square',
    maxAgents: CLOUD_MAX_AGENTS,
    plans: publicPlansPayload(),
    extraTransfersAddon: extraTransfersAddonPublic(),
    transfersPer24hIncluded: 1,
    storage: {
      owner: 'customer',
      includedInCloud: false,
      summary: 'Customer provides capsule storage. Portabase Cloud never hosts recovery bytes and has zero knowledge of encryption keys.',
    },
  };
}

export { jsonResponse } from './supabase-auth.mjs';
