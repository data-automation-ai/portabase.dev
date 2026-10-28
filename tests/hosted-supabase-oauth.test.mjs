import test from 'node:test';
import assert from 'node:assert/strict';
import { sealSupabaseSession, openSupabaseSession } from '../cloud/runner/oauth-session-cookie.mjs';
import { handler, supabaseTokenCookieName } from '../netlify/functions/cloud-oauth.mjs';
import {sealOAuthConfig,openOAuthConfig} from '../netlify/shared/hosted-oauth-config.mjs';


const cookieSecret = 'test-only-oauth-cookie-secret-32-bytes';

test('private OAuth configuration is encrypted, authenticated and bound to the site storage key',()=>{
  const config={clientId:'registered-client',clientSecret:'private-client-secret',redirectUri:'https://portabase.dev/confidential/callback'};
  const envelope=sealOAuthConfig(config,'fixture-storage-key');
  assert.deepEqual(openOAuthConfig(envelope,'fixture-storage-key'),config);
  assert.doesNotMatch(JSON.stringify(envelope),/private-client-secret/);
  assert.throws(()=>openOAuthConfig(envelope,'wrong-storage-key'));
});

test('Supabase OAuth session cookie is authenticated and hides tokens', () => {
  const session = { accessToken: 'access-test', refreshToken: 'refresh-test', expiresAt: Date.now() + 300_000 };
  const sealed = sealSupabaseSession(session, cookieSecret);
  assert.equal(sealed.includes(session.accessToken), false);
  assert.equal(sealed.includes(session.refreshToken), false);
  assert.deepEqual(openSupabaseSession(sealed, cookieSecret), { v: 1, ...session });
  assert.equal(openSupabaseSession(`${sealed.slice(0, -2)}zz`, cookieSecret), null);
});

test('hosted Supabase discovery rejects manual token input', async () => {
  const result = await handler({
    httpMethod: 'GET',
    path: '/api/cloud/oauth',
    headers: { host: 'portabase.dev' },
    queryStringParameters: { provider: 'supabase', action: 'discover', token: 'manual-token' },
  }, { authenticate: async () => ({ id: 'test-user' }) });
  assert.equal(result.statusCode, 400);
  assert.match(result.body, /Manual Supabase tokens are not accepted/);
});

test('hosted discovery refreshes an expired OAuth session and rotates its cookie', async () => {
  const oldFetch = globalThis.fetch;
  const oldSecret = process.env.PORTABASE_OAUTH_COOKIE_SECRET;
  const oldClientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
  process.env.PORTABASE_OAUTH_COOKIE_SECRET = cookieSecret;
  process.env.SUPABASE_OAUTH_CLIENT_ID = 'test-client-id';
  const stale = sealSupabaseSession({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000 }, cookieSecret);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith('/oauth/token')) {
      return { ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }) };
    }
    if (String(url).endsWith('/v1/projects')) {
      assert.equal(options.headers.Authorization, 'Bearer new-access');
      return { ok: true, json: async () => [] };
    }
    throw new Error('unexpected network request');
  };
  try {
    const result = await handler({
      httpMethod: 'GET',
      path: '/api/cloud/oauth',
      headers: { host: 'portabase.dev', cookie: `pb_oauth_sb_token=${encodeURIComponent(JSON.stringify(stale))}` },
      queryStringParameters: { provider: 'supabase', action: 'discover' },
    }, { authenticate: async () => ({ id: 'test-user' }) });
    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 2);
    const sealed = decodeURIComponent(result.headers['Set-Cookie'].split(';')[0].split('=')[1]);
    assert.equal(openSupabaseSession(JSON.parse(sealed), cookieSecret).refreshToken, 'new-refresh');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.PORTABASE_OAUTH_COOKIE_SECRET;
    else process.env.PORTABASE_OAUTH_COOKIE_SECRET = oldSecret;
    if (oldClientId === undefined) delete process.env.SUPABASE_OAUTH_CLIENT_ID;
    else process.env.SUPABASE_OAUTH_CLIENT_ID = oldClientId;
  }
});

test('hosted discovery denies anonymous project inventory', async () => {
  const result = await handler({
    httpMethod: 'GET', path: '/api/cloud/oauth', headers: { host: 'portabase.dev' },
    queryStringParameters: { provider: 'supabase', action: 'discover' },
  }, { authenticate: async () => { throw new Error('unauthorized'); } });
  assert.equal(result.statusCode, 401);
  assert.doesNotMatch(result.body, /projects|databases/);
});

test('supabaseTokenCookieName maps slot names to distinct cookies', () => {
  assert.equal(supabaseTokenCookieName('target'), 'pb_oauth_sb_target_token');
  assert.equal(supabaseTokenCookieName('source'), 'pb_oauth_sb_source_token');
  assert.equal(supabaseTokenCookieName(''), 'pb_oauth_sb_token');
  assert.equal(supabaseTokenCookieName(undefined), 'pb_oauth_sb_token');
});

test('separate source and target Supabase OAuth cookies do not overwrite each other and are discovered independently', async () => {
  const oldFetch = globalThis.fetch;
  const oldSecret = process.env.PORTABASE_OAUTH_COOKIE_SECRET;
  process.env.PORTABASE_OAUTH_COOKIE_SECRET = cookieSecret;

  const sourceSession = { accessToken: 'source-access-token', refreshToken: 'source-refresh-token', expiresAt: Date.now() + 300_000 };
  const targetSession = { accessToken: 'target-access-token', refreshToken: 'target-refresh-token', expiresAt: Date.now() + 300_000 };

  const sourceSealed = sealSupabaseSession(sourceSession, cookieSecret);
  const targetSealed = sealSupabaseSession(targetSession, cookieSecret);

  const cookieHeader = `pb_oauth_sb_source_token=${encodeURIComponent(JSON.stringify(sourceSealed))}; pb_oauth_sb_target_token=${encodeURIComponent(JSON.stringify(targetSealed))}`;

  const requestedTokens = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/v1/projects')) {
      const authHeader = options?.headers?.Authorization || '';
      requestedTokens.push(authHeader);
      if (authHeader === 'Bearer source-access-token') {
        return { ok: true, json: async () => [{ id: 'proj-source', name: 'Source Database' }] };
      }
      if (authHeader === 'Bearer target-access-token') {
        return { ok: true, json: async () => [{ id: 'proj-target', name: 'Target Database' }] };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    // 1. Discover slot=source
    const resSource = await handler({
      httpMethod: 'GET',
      path: '/api/cloud/oauth',
      headers: { host: 'portabase.dev', cookie: cookieHeader },
      queryStringParameters: { provider: 'supabase', action: 'discover', slot: 'source' },
    }, { authenticate: async () => ({ id: 'test-user' }) });

    assert.equal(resSource.statusCode, 200);
    const bodySource = JSON.parse(resSource.body);
    assert.equal(bodySource.slot, 'source');
    assert.equal(bodySource.projects?.length, 1);
    assert.equal(bodySource.projects[0].id, 'proj-source');

    // 2. Discover slot=target
    const resTarget = await handler({
      httpMethod: 'GET',
      path: '/api/cloud/oauth',
      headers: { host: 'portabase.dev', cookie: cookieHeader },
      queryStringParameters: { provider: 'supabase', action: 'discover', slot: 'target' },
    }, { authenticate: async () => ({ id: 'test-user' }) });

    assert.equal(resTarget.statusCode, 200);
    const bodyTarget = JSON.parse(resTarget.body);
    assert.equal(bodyTarget.slot, 'target');
    assert.equal(bodyTarget.projects?.length, 1);
    assert.equal(bodyTarget.projects[0].id, 'proj-target');

    assert.deepEqual(requestedTokens, ['Bearer source-access-token', 'Bearer target-access-token']);

    // 3. Disconnect slot=target clears only pb_oauth_sb_target_token
    const resDisconnect = await handler({
      httpMethod: 'POST',
      path: '/api/cloud/oauth',
      headers: { host: 'portabase.dev', cookie: cookieHeader },
      queryStringParameters: { provider: 'supabase', action: 'disconnect', slot: 'target' },
    }, { authenticate: async () => ({ id: 'test-user' }) });

    assert.equal(resDisconnect.statusCode, 200);
    const setCookie = resDisconnect.headers['Set-Cookie'];
    assert.match(setCookie, /^pb_oauth_sb_target_token=;/);
    assert.doesNotMatch(setCookie, /pb_oauth_sb_source_token/);
    const disconnectBody = JSON.parse(resDisconnect.body);
    assert.equal(disconnectBody.slot, 'target');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.PORTABASE_OAUTH_COOKIE_SECRET;
    else process.env.PORTABASE_OAUTH_COOKIE_SECRET = oldSecret;
  }
});

test('/confidential/callback without hosted pb_oauth_supabase cookie redirects to local runner on 127.0.0.1:58441', async () => {
  const result = await handler({
    httpMethod: 'GET',
    path: '/confidential/callback',
    headers: { host: 'portabase.dev' },
    queryStringParameters: { code: 'abc', state: 'xyz' },
  });
  assert.equal(result.statusCode, 302);
  assert.equal(result.headers['Location'], 'http://127.0.0.1:58441/confidential/callback?code=abc&state=xyz');
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('/confidential/callback with OAuth error parameter forwards to local runner on 127.0.0.1:58441', async () => {
  const result = await handler({
    httpMethod: 'GET',
    path: '/confidential/callback',
    headers: { host: 'portabase.dev' },
    queryStringParameters: { error: 'access_denied', error_description: 'User denied authorization' },
  });
  assert.equal(result.statusCode, 302);
  assert.equal(result.headers['Location'], 'http://127.0.0.1:58441/confidential/callback?error=access_denied&error_description=User+denied+authorization');
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('hosted OAuth start and callback preserve slot in cookie and redirect', async () => {
  const oldSecret = process.env.PORTABASE_OAUTH_COOKIE_SECRET;
  const oldClientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const oldClientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  const oldFetch = globalThis.fetch;

  process.env.PORTABASE_OAUTH_COOKIE_SECRET = cookieSecret;
  process.env.SUPABASE_OAUTH_CLIENT_ID = '00000000-0000-0000-0000-000000000000';
  process.env.SUPABASE_OAUTH_CLIENT_SECRET = 'test-client-secret-longer-than-16-bytes';

  try {
    // 1. /oauth/supabase/start with slot=target
    const startRes = await handler({
      httpMethod: 'GET',
      path: '/oauth/supabase/start',
      headers: { host: 'portabase.dev' },
      queryStringParameters: { slot: 'target', project: 'my-target-proj' },
    });
    assert.equal(startRes.statusCode, 302);
    assert.match(startRes.headers['Location'], /api\.supabase\.com\/v1\/oauth\/authorize/);

    const pkceCookieHeader = startRes.headers['Set-Cookie'];
    const pkceRaw = decodeURIComponent(pkceCookieHeader.split(';')[0].split('=')[1]);
    const pkceData = JSON.parse(pkceRaw);
    assert.equal(pkceData.slot, 'target');
    assert.equal(pkceData.project, 'my-target-proj');

    // 2. /oauth/supabase/callback with target slot
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/oauth/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'target-acc-token', refresh_token: 'target-ref-token', expires_in: 3600 }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const callbackRes = await handler({
      httpMethod: 'GET',
      path: '/oauth/supabase/callback',
      headers: {
        host: 'portabase.dev',
        cookie: `pb_oauth_supabase_target=${encodeURIComponent(JSON.stringify(pkceData))}`,
      },
      queryStringParameters: { code: 'test-code', state: pkceData.state },
    });

    assert.equal(callbackRes.statusCode, 200);
    assert.match(callbackRes.body, /postMessage/);
    assert.match(callbackRes.body, /slot=target/);
    const targetTokenCookie = callbackRes.headers['Set-Cookie'];
    assert.match(targetTokenCookie, /^pb_oauth_sb_target_token=/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.PORTABASE_OAUTH_COOKIE_SECRET;
    else process.env.PORTABASE_OAUTH_COOKIE_SECRET = oldSecret;
    if (oldClientId === undefined) delete process.env.SUPABASE_OAUTH_CLIENT_ID;
    else process.env.SUPABASE_OAUTH_CLIENT_ID = oldClientId;
    if (oldClientSecret === undefined) delete process.env.SUPABASE_OAUTH_CLIENT_SECRET;
    else process.env.SUPABASE_OAUTH_CLIENT_SECRET = oldClientSecret;
  }
});
