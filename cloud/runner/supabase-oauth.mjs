/**
 * Supabase OAuth 2.0 PKCE & Refresh Token support for the Portabase Runner.
 *
 * Implements:
 *   - PKCE generation (S256 code verifier & code challenge)
 *   - OAuth state generation
 *   - Supabase authorize URL generation
 *   - Authorization code exchange (POST /v1/oauth/token, grant_type=authorization_code)
 *   - Refresh token exchange (POST /v1/oauth/token, grant_type=refresh_token)
 *   - Automatic runner access token resolution with rotation and optional persistence.
 */

import { createHash, randomBytes } from 'node:crypto';

export const DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL = 'https://api.supabase.com/v1/oauth/authorize';
export const DEFAULT_SUPABASE_OAUTH_TOKEN_URL = 'https://api.supabase.com/v1/oauth/token';

const fail = (code, message, status = 400) => {
  throw Object.assign(new Error(message || code), { code, status });
};

/**
 * Generate PKCE code_verifier and code_challenge using SHA-256 (S256).
 * RFC 7636: code_verifier is a high-entropy cryptographic random string (43-128 chars).
 *
 * @returns {{ codeVerifier: string, codeChallenge: string, method: 'S256' }}
 */
export function generatePkcePair() {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return {
    codeVerifier,
    codeChallenge,
    method: 'S256',
  };
}

/**
 * Generate a cryptographically random OAuth state token.
 *
 * @returns {string}
 */
export function generateOAuthState() {
  return randomBytes(24).toString('base64url');
}

/**
 * Build the Supabase OAuth authorization URL targeting api.supabase.com/v1/oauth/authorize.
 *
 * @param {object} params
 * @param {string} params.clientId - Supabase OAuth App Client ID
 * @param {string} params.redirectUri - Callback URI
 * @param {string} params.codeChallenge - SHA-256 code challenge
 * @param {string} [params.state] - State parameter for CSRF mitigation
 * @param {string} [params.scope] - Optional scope (default: 'all')
 * @param {string} [params.organizationSlug] - Optional organization slug
 * @param {string} [params.authorizeUrl] - Custom authorize URL override
 * @returns {string}
 */
export function buildSupabaseAuthorizeUrl({
  clientId,
  redirectUri,
  codeChallenge,
  state = generateOAuthState(),
  scope = 'all',
  organizationSlug = null,
  authorizeUrl = process.env.SUPABASE_OAUTH_AUTHORIZE_URL || DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
}) {
  if (!clientId || typeof clientId !== 'string') fail('invalid_client_id', 'clientId is required');
  if (!redirectUri || typeof redirectUri !== 'string') fail('invalid_redirect_uri', 'redirectUri is required');
  if (!codeChallenge || typeof codeChallenge !== 'string') fail('invalid_code_challenge', 'codeChallenge is required');

  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (state) url.searchParams.set('state', state);
  if (scope) url.searchParams.set('scope', scope);
  if (organizationSlug) url.searchParams.set('organization_slug', organizationSlug);

  return url.toString();
}

/**
 * Exchange an OAuth authorization code for access and refresh tokens.
 *
 * @param {object} params
 * @param {string} params.code - Authorization code from callback
 * @param {string} params.codeVerifier - PKCE code verifier
 * @param {string} params.redirectUri - Redirect URI used in the authorize request
 * @param {string} [params.clientId] - OAuth Client ID
 * @param {string} [params.clientSecret] - OAuth Client Secret (for confidential clients)
 * @param {string} [params.tokenUrl] - Token endpoint URL override
 * @param {typeof fetch} [params.fetchImpl] - Optional fetch implementation
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, tokenType: string, expiresAt: number|null }>}
 */
export async function exchangeSupabaseOAuthCode({
  code,
  codeVerifier,
  redirectUri,
  clientId,
  clientSecret,
  tokenUrl = process.env.SUPABASE_OAUTH_TOKEN_URL || DEFAULT_SUPABASE_OAUTH_TOKEN_URL,
  fetchImpl = globalThis.fetch,
}) {
  if (!code || typeof code !== 'string') fail('missing_code', 'OAuth code is required');
  if (!codeVerifier || typeof codeVerifier !== 'string') fail('missing_code_verifier', 'PKCE codeVerifier is required');
  if (!redirectUri || typeof redirectUri !== 'string') fail('missing_redirect_uri', 'redirectUri is required');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
  if (clientId) params.set('client_id', clientId);
  if (clientSecret) params.set('client_secret', clientSecret);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (clientId && clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  let response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers,
      body: params.toString(),
    });
  } catch (err) {
    fail('oauth_network_error', `Could not reach Supabase OAuth token endpoint: ${err.message}`, 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail('invalid_token_response', 'Supabase token endpoint returned non-JSON response', response.status);
  }

  if (!response.ok) {
    const code = data?.error || 'oauth_exchange_failed';
    const message = data?.error_description || data?.message || `OAuth token exchange failed (HTTP ${response.status})`;
    fail(code, message, response.status);
  }

  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || 0;
  const tokenType = data.token_type || 'Bearer';
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

  if (!accessToken) fail('invalid_token_response', 'Token response missing access_token');

  return {
    accessToken,
    refreshToken: refreshToken || null,
    expiresIn,
    tokenType,
    expiresAt,
  };
}

/**
 * Exchange a Supabase OAuth refresh token for a fresh access token (and optional rotated refresh token).
 *
 * @param {object} params
 * @param {string} params.refreshToken - Supabase OAuth refresh token
 * @param {string} [params.clientId] - OAuth Client ID
 * @param {string} [params.clientSecret] - OAuth Client Secret
 * @param {string} [params.tokenUrl] - Token endpoint URL override
 * @param {typeof fetch} [params.fetchImpl] - Optional fetch implementation
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, tokenType: string, expiresAt: number|null }>}
 */
export async function refreshSupabaseAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  tokenUrl = process.env.SUPABASE_OAUTH_TOKEN_URL || DEFAULT_SUPABASE_OAUTH_TOKEN_URL,
  fetchImpl = globalThis.fetch,
}) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    fail('missing_refresh_token', 'refreshToken is required');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (clientId) params.set('client_id', clientId);
  if (clientSecret) params.set('client_secret', clientSecret);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (clientId && clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  let response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers,
      body: params.toString(),
    });
  } catch (err) {
    fail('oauth_network_error', `Could not reach Supabase OAuth token endpoint: ${err.message}`, 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail('invalid_token_response', 'Supabase token endpoint returned non-JSON response', response.status);
  }

  if (!response.ok) {
    const code = data?.error || 'refresh_token_failed';
    const message = data?.error_description || data?.message || `Token refresh failed (HTTP ${response.status})`;
    fail(code, message, response.status);
  }

  const accessToken = data.access_token;
  const newRefreshToken = data.refresh_token || refreshToken;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || 0;
  const tokenType = data.token_type || 'Bearer';
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

  if (!accessToken) fail('invalid_token_response', 'Token refresh response missing access_token');

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn,
    tokenType,
    expiresAt,
  };
}

/**
 * Resolve a valid Supabase access token for runner operations.
 *
 * Uses SUPABASE_ACCESS_TOKEN if present and valid/fresh. If SUPABASE_ACCESS_TOKEN
 * is missing or expired, automatically exchanges SUPABASE_REFRESH_TOKEN for a new
 * access token. If options.directory and options.projectRef are provided, the rotated
 * tokens are persisted to runtime-secrets.json.
 *
 * @param {object} secrets - Secrets bundle or process.env
 * @param {object} [options]
 * @param {string} [options.directory] - Runner config directory to persist updated secrets
 * @param {string} [options.projectRef] - Bound project ref
 * @param {boolean} [options.forceRefresh=false] - Force token rotation even if not expired
 * @param {number} [options.minValidityMs=60000] - Buffer window before expiry (ms)
 * @param {typeof fetch} [options.fetchImpl] - Fetch implementation
 * @param {string} [options.tokenUrl] - Token endpoint override
 * @returns {Promise<{ accessToken: string, refreshToken: string|null, expiresAt: number|null, rotated: boolean }>}
 */
export async function resolveRunnerAccessToken(secrets = {}, options = {}) {
  const env = secrets || {};
  let accessToken = env.SUPABASE_ACCESS_TOKEN || env.accessToken || null;
  const refreshToken = env.SUPABASE_REFRESH_TOKEN || env.refreshToken || null;
  const clientId = env.SUPABASE_OAUTH_CLIENT_ID || env.oauthClientId || null;
  const clientSecret = env.SUPABASE_OAUTH_CLIENT_SECRET || env.oauthClientSecret || null;
  const expiresAt = env.SUPABASE_TOKEN_EXPIRES_AT || env.tokenExpiresAt || null;

  const minValidityMs = options.minValidityMs ?? 60000;
  const forceRefresh = Boolean(options.forceRefresh);

  const hasFreshAccessToken = Boolean(
    accessToken &&
      !forceRefresh &&
      (!expiresAt || Number(expiresAt) > Date.now() + minValidityMs)
  );

  if (hasFreshAccessToken) {
    return {
      accessToken,
      refreshToken,
      expiresAt: expiresAt ? Number(expiresAt) : null,
      rotated: false,
    };
  }

  // If no refresh token and we have an access token (like a Personal Access Token), use it
  if (!refreshToken) {
    if (accessToken && !forceRefresh) {
      return {
        accessToken,
        refreshToken: null,
        expiresAt: null,
        rotated: false,
      };
    }
    fail('missing_supabase_token', 'Neither valid SUPABASE_ACCESS_TOKEN nor SUPABASE_REFRESH_TOKEN was provided');
  }

  // Rotate token using the refresh token
  const rotated = await refreshSupabaseAccessToken({
    refreshToken,
    clientId,
    clientSecret,
    tokenUrl: options.tokenUrl,
    fetchImpl: options.fetchImpl,
  });

  // Update in-memory secrets object if provided
  if (typeof secrets === 'object' && secrets !== null) {
    secrets.SUPABASE_ACCESS_TOKEN = rotated.accessToken;
    secrets.SUPABASE_REFRESH_TOKEN = rotated.refreshToken;
    secrets.SUPABASE_TOKEN_EXPIRES_AT = rotated.expiresAt;
  }

  // Persist rotated secrets if directory and projectRef were provided
  if (options.directory && options.projectRef) {
    try {
      const { savePrivateRuntimeSecrets } = await import('./runtime-secrets.mjs');
      await savePrivateRuntimeSecrets(
        { directory: options.directory, projectRef: options.projectRef },
        {
          SUPABASE_ACCESS_TOKEN: rotated.accessToken,
          SUPABASE_REFRESH_TOKEN: rotated.refreshToken,
        }
      );
    } catch {
      // In-memory update succeeded; persistence failure shouldn't block current execution
    }
  }

  return {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    expiresAt: rotated.expiresAt,
    rotated: true,
  };
}
