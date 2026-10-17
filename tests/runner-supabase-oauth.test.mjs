import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import {
  generatePkcePair,
  generateOAuthState,
  buildSupabaseAuthorizeUrl,
  exchangeSupabaseOAuthCode,
  refreshSupabaseAccessToken,
  resolveRunnerAccessToken,
  DEFAULT_SUPABASE_OAUTH_AUTHORIZE_URL,
  DEFAULT_SUPABASE_OAUTH_TOKEN_URL,
} from '../cloud/runner/supabase-oauth.mjs';
import {
  validateRuntimeSecrets,
  privateRuntimeSecretStatus,
  runtimeSecretUpdates,
  savePrivateRuntimeSecrets,
  loadPrivateRuntimeSecrets,
} from '../cloud/runner/runtime-secrets.mjs';
import { startPrivateSetupUiServer } from '../utility/ui/private-server.mjs';

test('generatePkcePair creates valid RFC 7636 S256 verifier and challenge', () => {
  const pair1 = generatePkcePair();
  const pair2 = generatePkcePair();

  assert.ok(pair1.codeVerifier);
  assert.ok(pair1.codeChallenge);
  assert.equal(pair1.method, 'S256');

  // Must be high-entropy, base64url characters only
  assert.match(pair1.codeVerifier, /^[A-Za-z0-9_-]{43,}$/);
  assert.match(pair1.codeChallenge, /^[A-Za-z0-9_-]{43,}$/);

  // Challenge must equal SHA-256 of verifier in base64url
  const expectedChallenge = createHash('sha256').update(pair1.codeVerifier).digest('base64url');
  assert.equal(pair1.codeChallenge, expectedChallenge);

  // Different invocations yield unique pairs
  assert.notEqual(pair1.codeVerifier, pair2.codeVerifier);
  assert.notEqual(pair1.codeChallenge, pair2.codeChallenge);
});

test('generateOAuthState creates high-entropy base64url state strings', () => {
  const state1 = generateOAuthState();
  const state2 = generateOAuthState();

  assert.match(state1, /^[A-Za-z0-9_-]{20,}$/);
  assert.match(state2, /^[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(state1, state2);
});

test('buildSupabaseAuthorizeUrl validates inputs and constructs authorize URL', () => {
  assert.throws(
    () => buildSupabaseAuthorizeUrl({ clientId: '', redirectUri: 'http://localhost/cb', codeChallenge: 'xyz' }),
    { code: 'invalid_client_id' }
  );
  assert.throws(
    () => buildSupabaseAuthorizeUrl({ clientId: 'cid', redirectUri: '', codeChallenge: 'xyz' }),
    { code: 'invalid_redirect_uri' }
  );
  assert.throws(
    () => buildSupabaseAuthorizeUrl({ clientId: 'cid', redirectUri: 'http://localhost/cb', codeChallenge: '' }),
    { code: 'invalid_code_challenge' }
  );

  const urlStr = buildSupabaseAuthorizeUrl({
    clientId: 'client-123',
    redirectUri: 'http://127.0.0.1:4040/oauth/callback',
    codeChallenge: 'challenge-abc',
    state: 'state-xyz',
    scope: 'all',
    organizationSlug: 'my-org',
  });

  const parsed = new URL(urlStr);
  assert.equal(parsed.origin, 'https://api.supabase.com');
  assert.equal(parsed.pathname, '/v1/oauth/authorize');
  assert.equal(parsed.searchParams.get('client_id'), 'client-123');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'http://127.0.0.1:4040/oauth/callback');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('code_challenge'), 'challenge-abc');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('state'), 'state-xyz');
  assert.equal(parsed.searchParams.get('scope'), 'all');
  assert.equal(parsed.searchParams.get('organization_slug'), 'my-org');
});

test('exchangeSupabaseOAuthCode exchanges PKCE code with Supabase token endpoint', async () => {
  let capturedUrl = null;
  let capturedInit = null;

  const mockFetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'sbp_access_token_12345',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'sbr_refresh_token_67890',
      }),
    };
  };

  const result = await exchangeSupabaseOAuthCode({
    code: 'oauth_code_123',
    codeVerifier: 'verifier_abc',
    redirectUri: 'http://127.0.0.1:3000/callback',
    clientId: 'client_id_456',
    fetchImpl: mockFetch,
  });

  assert.equal(capturedUrl, DEFAULT_SUPABASE_OAUTH_TOKEN_URL);
  assert.equal(capturedInit.method, 'POST');
  assert.equal(capturedInit.headers['Content-Type'], 'application/x-www-form-urlencoded');

  const bodyParams = new URLSearchParams(capturedInit.body);
  assert.equal(bodyParams.get('grant_type'), 'authorization_code');
  assert.equal(bodyParams.get('code'), 'oauth_code_123');
  assert.equal(bodyParams.get('code_verifier'), 'verifier_abc');
  assert.equal(bodyParams.get('redirect_uri'), 'http://127.0.0.1:3000/callback');
  assert.equal(bodyParams.get('client_id'), 'client_id_456');

  assert.equal(result.accessToken, 'sbp_access_token_12345');
  assert.equal(result.refreshToken, 'sbr_refresh_token_67890');
  assert.equal(result.expiresIn, 3600);
  assert.equal(result.tokenType, 'Bearer');
  assert.ok(result.expiresAt > Date.now());
});

test('exchangeSupabaseOAuthCode handles error response from token endpoint', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: 'invalid_grant', error_description: 'Code has expired' }),
  });

  await assert.rejects(
    exchangeSupabaseOAuthCode({
      code: 'expired_code',
      codeVerifier: 'verifier_abc',
      redirectUri: 'http://127.0.0.1:3000/callback',
      fetchImpl: mockFetch,
    }),
    { code: 'invalid_grant', message: 'Code has expired', status: 400 }
  );
});

test('refreshSupabaseAccessToken exchanges refresh token for new access token', async () => {
  let capturedBody = null;

  const mockFetch = async (url, init) => {
    capturedBody = new URLSearchParams(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'sbp_refreshed_access_token',
        token_type: 'Bearer',
        expires_in: 7200,
        refresh_token: 'sbr_new_rotated_refresh_token',
      }),
    };
  };

  const result = await refreshSupabaseAccessToken({
    refreshToken: 'sbr_initial_refresh_token',
    clientId: 'custom_client',
    fetchImpl: mockFetch,
  });

  assert.equal(capturedBody.get('grant_type'), 'refresh_token');
  assert.equal(capturedBody.get('refresh_token'), 'sbr_initial_refresh_token');
  assert.equal(capturedBody.get('client_id'), 'custom_client');

  assert.equal(result.accessToken, 'sbp_refreshed_access_token');
  assert.equal(result.refreshToken, 'sbr_new_rotated_refresh_token');
  assert.equal(result.expiresIn, 7200);
});

test('resolveRunnerAccessToken handles PAT, refresh token, expiry, and rotation', async () => {
  // 1. Static PAT without refresh token
  const staticPat = await resolveRunnerAccessToken({
    SUPABASE_ACCESS_TOKEN: 'sbp_static_pat_valid',
  });
  assert.equal(staticPat.accessToken, 'sbp_static_pat_valid');
  assert.equal(staticPat.rotated, false);

  // 2. Refresh token only -> performs refresh
  let refreshedCount = 0;
  const mockFetch = async () => {
    refreshedCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: `sbp_rotated_token_${refreshedCount}`,
        refresh_token: 'sbr_next_refresh_token',
        expires_in: 3600,
      }),
    };
  };

  const secrets = { SUPABASE_REFRESH_TOKEN: 'sbr_my_refresh_token' };
  const resolved = await resolveRunnerAccessToken(secrets, { fetchImpl: mockFetch });
  assert.equal(resolved.accessToken, 'sbp_rotated_token_1');
  assert.equal(resolved.refreshToken, 'sbr_next_refresh_token');
  assert.equal(resolved.rotated, true);
  // Mutates in-memory secrets
  assert.equal(secrets.SUPABASE_ACCESS_TOKEN, 'sbp_rotated_token_1');
  assert.equal(secrets.SUPABASE_REFRESH_TOKEN, 'sbr_next_refresh_token');

  // 3. Second call with fresh access token -> no rotation
  const cached = await resolveRunnerAccessToken(secrets, { fetchImpl: mockFetch });
  assert.equal(cached.accessToken, 'sbp_rotated_token_1');
  assert.equal(cached.rotated, false);
  assert.equal(refreshedCount, 1);

  // 4. Force refresh -> triggers rotation
  const forced = await resolveRunnerAccessToken(secrets, { forceRefresh: true, fetchImpl: mockFetch });
  assert.equal(forced.accessToken, 'sbp_rotated_token_2');
  assert.equal(forced.rotated, true);
  assert.equal(refreshedCount, 2);

  // 5. Neither access token nor refresh token -> throws
  await assert.rejects(
    resolveRunnerAccessToken({}),
    { code: 'missing_supabase_token' }
  );
});

test('runtime-secrets validates SUPABASE_REFRESH_TOKEN as valid management access', async () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const directory = await mkdtemp(join(tmpdir(), 'portabase-secrets-test-'));

  // Status with refresh token alone
  const status = privateRuntimeSecretStatus({
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_DB_URL: `postgresql://postgres:secret@db.${projectRef}.supabase.co:5432/postgres`,
    SUPABASE_SERVICE_ROLE_KEY: 'service_role_key_value_123',
    SUPABASE_REFRESH_TOKEN: 'sbr_test_refresh_token_12345',
  });
  assert.equal(status.sourceManagementAccess, true);
  assert.equal(status.sourceConfigured, true);
  assert.equal(status.hasRefreshToken, true);
  assert.equal(status.hasAccessToken, false);

  // validateRuntimeSecrets accepts refresh token alone
  const validated = validateRuntimeSecrets({
    SUPABASE_REFRESH_TOKEN: 'sbr_test_refresh_token_12345',
  }, projectRef);
  assert.equal(validated.SUPABASE_REFRESH_TOKEN, 'sbr_test_refresh_token_12345');

  // runtimeSecretUpdates accepts sourceRefreshToken
  const updates = runtimeSecretUpdates({
    sourceRefreshToken: 'sbr_new_refresh_token_abc',
    sourceOAuthClientId: 'custom_client_id_xyz',
  }, projectRef);
  assert.equal(updates.SUPABASE_REFRESH_TOKEN, 'sbr_new_refresh_token_abc');
  assert.equal(updates.SUPABASE_OAUTH_CLIENT_ID, 'custom_client_id_xyz');

  // Persistence to runtime-secrets.json
  await savePrivateRuntimeSecrets({ directory, projectRef }, updates);
  const loaded = await loadPrivateRuntimeSecrets({ directory, projectRef });
  assert.equal(loaded.env.SUPABASE_REFRESH_TOKEN, 'sbr_new_refresh_token_abc');
  assert.equal(loaded.env.SUPABASE_OAUTH_CLIENT_ID, 'custom_client_id_xyz');
  assert.equal(loaded.status.hasRefreshToken, true);
});

function httpCall(server, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: server.address.port,
        path,
        method,
        headers: {
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}),
          'X-Portabase-Session': server.token,
          ...headers,
        },
      },
      response => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          let json;
          try { json = JSON.parse(data); } catch { /* static */ }
          resolve({ status: response.statusCode, headers: response.headers, json, data });
        });
      }
    );
    req.on('error', reject);
    req.end(bytes);
  });
}

test('private setup UI server exposes OAuth endpoints and processes refresh tokens', async () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const directory = await mkdtemp(join(tmpdir(), 'portabase-ui-oauth-test-'));
  const config = { projectRef, provider: { type: 's3', bucket: 'test' }, backupDirectory: 'capsules', statusDirectory: 'status' };
  await writeFile(join(directory, 'engine.json'), JSON.stringify(config));

  const server = await startPrivateSetupUiServer({
    privateSetup: {
      directory,
      runnerId: '11111111-1111-4111-8111-111111111111',
      projectRef,
      engineConfigPath: 'engine.json',
    },
    collect: async () => ({
      project: { ref: projectRef },
      database: { ok: true, data: { tables: [] } },
      storage: { ok: true, data: { buckets: [] } },
    }),
  });

  try {
    const setup = (await httpCall(server, '/api/setup')).json;
    const csrfHeaders = {
      Origin: `http://127.0.0.1:${server.address.port}`,
      'X-Portabase-CSRF': setup.csrf,
    };

    // 1. POST /api/oauth/supabase/start creates authorize URL with state and PKCE challenge
    const startRes = await httpCall(server, '/api/oauth/supabase/start', {
      method: 'POST',
      body: {},
      headers: csrfHeaders,
    });
    assert.equal(startRes.status, 200);
    assert.equal(startRes.json.ok, true);
    assert.ok(startRes.json.authorizeUrl);
    assert.ok(startRes.json.state);

    const authUrl = new URL(startRes.json.authorizeUrl);
    assert.equal(authUrl.searchParams.get('response_type'), 'code');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authUrl.searchParams.get('state'), startRes.json.state);

    // 2. GET /oauth/supabase/start redirects to authorize URL
    const getStartRes = await httpCall(server, '/oauth/supabase/start');
    assert.equal(getStartRes.status, 302);
    assert.ok(getStartRes.headers.location.startsWith('https://api.supabase.com/v1/oauth/authorize'));

    // 3. GET /oauth/supabase/callback validates state
    const badCallback = await httpCall(server, '/oauth/supabase/callback?code=abc&state=unknown_state');
    assert.equal(badCallback.status, 400);
    assert.match(badCallback.data, /oauth_state_mismatch/);

    // 4. POST /api/connections updates sourceRefreshToken
    const connRes = await httpCall(server, '/api/connections', {
      method: 'POST',
      body: {
        sourceRefreshToken: 'sbr_ui_test_refresh_token_123',
        sourceOAuthClientId: 'test_client_id_456',
      },
      headers: csrfHeaders,
    });
    assert.equal(connRes.status, 201);
    assert.equal(connRes.json.saved, true);
    assert.equal(connRes.json.connections.hasRefreshToken, true);

    const loaded = await loadPrivateRuntimeSecrets({ directory, projectRef });
    assert.equal(loaded.env.SUPABASE_REFRESH_TOKEN, 'sbr_ui_test_refresh_token_123');
    assert.equal(loaded.env.SUPABASE_OAUTH_CLIENT_ID, 'test_client_id_456');
  } finally {
    await server.close();
  }
});
