import { DEFAULT_CLOUD_VERSION, normalizeCloudVersion } from './cloud-versions.js';

import {
  CLOUD_LIST_PRICE_MONTHLY_USD,
  CLOUD_PAYMENT_GATEWAY,
  CLOUD_PRICE_MONTHLY_USD,
  CLOUD_TRIAL_DAYS,
  STORAGE_POLICY,
} from './product.js';

/** Shared product pricing (both auth versions). */
export const productConfig = {
  trialDays: CLOUD_TRIAL_DAYS,
  priceMonthly: CLOUD_PRICE_MONTHLY_USD,
  listPriceMonthly: CLOUD_LIST_PRICE_MONTHLY_USD,
  promoUntil: '2026-08-31',
  paymentGateway: CLOUD_PAYMENT_GATEWAY,
  storage: STORAGE_POLICY,
};

/** @deprecated use productConfig */
export const authConfig = {
  provider: 'supabase',
  launchPlatform: 'supabase',
  ...productConfig,
  // defaults used by older imports
  url: import.meta.env.VITE_SUPABASE_URL || 'https://ekklokrukxmqlahtonnc.supabase.co',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
};

export const supabasePublicDefaults = {
  url: import.meta.env.VITE_SUPABASE_URL || 'https://ekklokrukxmqlahtonnc.supabase.co',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
};

export const cognitoPublicDefaults = {
  region: import.meta.env.VITE_COGNITO_REGION || 'us-east-1',
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_xuKTz92hx',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '2mmmjhe11rvdpjaabi8fq5lgrv',
  domain: import.meta.env.VITE_COGNITO_DOMAIN || 'portabase-cloud-899867382621',
};

export function siteOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'https://portabase.dev';
}

export function authCallbackUrl(version) {
  const v = normalizeCloudVersion(version, DEFAULT_CLOUD_VERSION);
  return `${siteOrigin()}/auth/callback?version=${v}`;
}

export function cognitoIdpBase() {
  return `https://cognito-idp.${cognitoPublicDefaults.region}.amazonaws.com/`;
}

export function hostedUiBase() {
  const { domain, region } = cognitoPublicDefaults;
  return `https://${domain}.auth.${region}.amazoncognito.com`;
}
