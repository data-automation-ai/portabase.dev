import zlib from 'node:zlib';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import {
  generatePkcePair,
  generateOAuthState,
  buildSupabaseAuthorizeUrl,
  exchangeSupabaseOAuthCode,
  refreshSupabaseAccessToken,
} from '../../cloud/runner/supabase-oauth.mjs';
import {
  buildGoogleDriveAuthorizeUrl,
  exchangeGoogleDriveOAuthCode,
  buildDropboxAuthorizeUrl,
  exchangeDropboxOAuthCode,
  refreshDropboxOAuthToken,
} from '../../cloud/runner/storage-oauth.mjs';
import { discoverSupabaseProjectsAndDatabases } from '../../cloud/runner/supabase-discovery.mjs';
import { openSupabaseSession, sealSupabaseSession } from '../../cloud/runner/oauth-session-cookie.mjs';
import { supabaseAccess } from '../../cloud/confidential/supabase-access.mjs';
import {
  computeDatabaseScopeSummary,
  buildExportManifest,
  generateRunnerCapsule,
  buildRunnerCapsuleRestorePlan,
} from '../../cloud/runner/database-scope.mjs';

function parseCookie(header, name) {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function serializeCookie(name, val, maxAge = 600) {
  const enc = encodeURIComponent(JSON.stringify(val));
  return `${name}=${enc}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function supabaseTokenCookieName(slot) {
  if (slot === 'target') return 'pb_oauth_sb_target_token';
  if (slot === 'source') return 'pb_oauth_sb_source_token';
  return 'pb_oauth_sb_token';
}

function oauthCookieSecret() {
  return process.env.PORTABASE_OAUTH_COOKIE_SECRET || process.env.SUPABASE_OAUTH_CLIENT_SECRET || '';
}

export async function handler(event, { authenticate = verifyCloudUser } = {}) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  const rawUrl = event.rawUrl || `https://${event.headers.host || 'portabase.dev'}${event.path || ''}`;
  const parsed = new URL(rawUrl);
  const pathname = event.path || parsed.pathname;
  const host = event.headers['x-forwarded-host'] || event.headers.host || 'portabase.dev';
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${host}`;

  const query = event.queryStringParameters || {};
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { /* ignore */ }
  }

  // Top-level OAuth navigation has no bearer header. The PKCE callback binds
  // each grant to its own source/destination slot; discovery remains signed in.
  if (pathname.startsWith('/api/cloud/oauth') && ['authorize', 'start'].includes(query.action)) {
    const provider = query.provider || 'supabase';
    if (!['supabase', 'dropbox'].includes(provider)) return jsonResponse(400, { error: 'unsupported_provider' });
    return { statusCode: 302, headers: { Location: `/oauth/${provider}/start?${new URLSearchParams({ slot: query.slot === 'target' ? 'target' : 'source' })}`, 'Cache-Control': 'no-store' } };
  }

  // 1. API: Discovery, Disconnect, Capsule Generate & Capsule Restore via /api/cloud/oauth
  if (
    pathname.startsWith('/api/cloud/oauth') ||
    query.action === 'discover' ||
    query.action === 'test' ||
    query.action === 'disconnect' ||
    query.action === 'generate_capsule' ||
    query.action === 'restore_capsule'
  ) {
    try { await authenticate(event); }
    catch { return jsonResponse(401, { ok: false, error: 'unauthorized' }, { 'Cache-Control': 'no-store' }); }
    const provider = query.provider || body.provider || 'supabase';
    const action = query.action || body.action || 'discover';
    const targetRef = (query.project || body.project || '').trim().toLowerCase();
    const rawSlot = (query.slot || body.slot || '').trim().toLowerCase();
    const slot = rawSlot === 'source' ? 'source' : (rawSlot === 'target' ? 'target' : '');

    if (action === 'generate_capsule') {
      const capsule = generateRunnerCapsule({
        databases: Array.isArray(body.databases) ? body.databases : [],
        destinationStore: body.destinationStore || 's3',
        destinationPath: body.destinationPath || '',
        capsuleLabel: body.capsuleLabel || '',
      });
      return jsonResponse(200, capsule);
    }

    if (action === 'restore_capsule') {
      const restorePlan = buildRunnerCapsuleRestorePlan({
        capsule: body.capsule || null,
        databases: Array.isArray(body.databases) ? body.databases : [],
        targetDatabaseRef: body.targetDatabaseRef || targetRef,
        targetDatabaseName: body.targetDatabaseName || '',
        overwriteExisting: Boolean(body.overwriteExisting),
      });
      return jsonResponse(200, restorePlan);
    }

    if (provider === 'supabase' && action === 'disconnect') {
      const cookieName = supabaseTokenCookieName(slot);
      return jsonResponse(
        200,
        {
          ok: true,
          connected: false,
          disconnected: true,
          slot: slot || 'default',
          message: 'Disconnected from Supabase.',
          databases: [],
          projects: [],
        },
        {
          'Set-Cookie': clearCookie(cookieName),
        },
      );
    }

    if (provider === 'dropbox' && action === 'disconnect') {
      return jsonResponse(
        200,
        {
          ok: true,
          connected: false,
          disconnected: true,
          provider: 'dropbox',
          message: 'Disconnected from Dropbox.',
        },
        {
          'Set-Cookie': clearCookie('pb_oauth_dropbox_token'),
        },
      );
    }

    if ((provider === 'google-drive' || provider === 'gdrive') && action === 'disconnect') {
      return jsonResponse(
        200,
        {
          ok: true,
          connected: false,
          disconnected: true,
          provider: 'google-drive',
          message: 'Disconnected from Google Drive.',
        },
        {
          'Set-Cookie': clearCookie('pb_oauth_gdrive_token'),
        },
      );
    }

    if (provider === 'supabase' && ['discover', 'test', 'inspect'].includes(action)) {
      if (body.token || query.token) {
        return jsonResponse(400, { ok: false, error: 'Manual Supabase tokens are not accepted. Connect with OAuth.' });
      }
      const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
      let cookieName = supabaseTokenCookieName(slot);
      let rawCookie = parseCookie(cookieHeader, cookieName);
      if (!rawCookie && slot === 'source') {
        rawCookie = parseCookie(cookieHeader, 'pb_oauth_sb_token');
        if (rawCookie) cookieName = 'pb_oauth_sb_token';
      }
      if (!rawCookie && !slot) {
        const sourceCookie = parseCookie(cookieHeader, 'pb_oauth_sb_source_token');
        if (sourceCookie) {
          rawCookie = sourceCookie;
          cookieName = 'pb_oauth_sb_source_token';
        } else {
          const defaultCookie = parseCookie(cookieHeader, 'pb_oauth_sb_token');
          if (defaultCookie) {
            rawCookie = defaultCookie;
            cookieName = 'pb_oauth_sb_token';
          }
        }
      }
      // Preserve an existing HttpOnly legacy source grant during migration.
      // It is never used for the destination or sourced from server credentials.
      const cookieSession = openSupabaseSession(rawCookie, oauthCookieSecret()) ||
        (slot !== 'target' && rawCookie?.accessToken ? { ...rawCookie, expiresAt: rawCookie.expiresAt || Date.now() + 300000 } : null);
      if (!cookieSession) {
        if (action === 'test') {
          return jsonResponse(200, {
            ok: false,
            connected: false,
            slot: slot || 'default',
            error: 'No active Supabase OAuth token or session found. Click "Connect Supabase (OAuth PKCE)" first.',
          });
        }
        return jsonResponse(200, {
          ok: true,
          connected: false,
          slot: slot || 'default',
          message: 'Connect Supabase with OAuth to discover projects.',
          databases: [],
          projects: [],
        });
      }

      let session = cookieSession;
      let renewalCookie;
      try {
        if (session.expiresAt <= Date.now() + 60_000) {
          const renewed = await refreshSupabaseAccessToken({
            refreshToken: session.refreshToken,
            clientId: process.env.SUPABASE_OAUTH_CLIENT_ID,
            clientSecret: process.env.SUPABASE_OAUTH_CLIENT_SECRET,
          });
          session = renewed;
          renewalCookie = serializeCookie(cookieName, sealSupabaseSession(session, oauthCookieSecret()), 60 * 60 * 24 * 7);
        }
        if (action === 'inspect') {
          const inspection = await supabaseAccess(session.accessToken).inspect(targetRef);
          return jsonResponse(200, { ok: true, connected: true, slot: slot || 'default', inspection }, renewalCookie ? { 'Set-Cookie': renewalCookie } : {});
        }
        const result = await discoverSupabaseProjectsAndDatabases({
          token: session.accessToken,
          targetRef,
          inspectAllActive: action !== 'test' && slot !== 'target',
        });
        if (action === 'test') {
          const count = result.projects?.length || 0;
          const selected = targetRef ? result.projects?.some(project => project.id === targetRef) : false;
          const databaseReadable = selected && result.databases?.some(database =>
            database.projectRef === targetRef && database.estimatedSizeMb !== null);
          return jsonResponse(200, {
            ok: true,
            connected: true,
            slot: slot || 'default',
            targetAccessible: selected,
            databaseReadable: Boolean(databaseReadable),
            projectCount: count,
            databaseCount: result.databases?.length || 0,
            message: databaseReadable
              ? `Selected source is readable through Supabase OAuth (${count} accessible project${count === 1 ? '' : 's'}).`
              : `Supabase OAuth is connected, but the selected source has not passed the database read check.`,
          }, renewalCookie ? { 'Set-Cookie': renewalCookie } : {});
        }
        const scopeSummary = computeDatabaseScopeSummary(result.databases || []);
        const includeFullManifest = Boolean(query.includeManifest || body.includeManifest);
        const payloadObj = {
          ...result,
          slot: slot || 'default',
          scopeSummary,
          ...(includeFullManifest ? { exportManifest: buildExportManifest(result.databases || []) } : {}),
        };
        const jsonStr = JSON.stringify(payloadObj);
        const acceptEncoding = String(event.headers?.['accept-encoding'] || event.headers?.['Accept-Encoding'] || '');
        if (jsonStr.length > 5.5 * 1024 * 1024 && acceptEncoding.includes('gzip')) {
          const gz = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'));
          return {
            statusCode: 200,
            isBase64Encoded: true,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Encoding': 'gzip',
              'Cache-Control': 'no-store',
              ...(renewalCookie ? { 'Set-Cookie': renewalCookie } : {}),
            },
            body: gz.toString('base64'),
          };
        }
        return jsonResponse(200, payloadObj, renewalCookie ? { 'Set-Cookie': renewalCookie } : {});
      } catch (err) {
        return jsonResponse(401, { ok: false, connected: false, slot: slot || 'default', error: 'Supabase OAuth session failed. Reconnect Supabase.' }, {
          'Set-Cookie': clearCookie(cookieName),
        });
      }
    }

    return jsonResponse(400, { error: 'unsupported_provider_or_action' });
  }

  // 2. /oauth/supabase/start
  if (pathname.includes('/oauth/supabase/start')) {
    const project = query.project || '';
    const slot = query.slot === 'target' ? 'target' : (query.slot === 'source' ? 'source' : '');
    const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId || '');

    if (isUuid && oauthCookieSecret().length >= 16) {
      const { codeVerifier, codeChallenge } = generatePkcePair();
      const state = generateOAuthState();
      const redirectUri = process.env.SUPABASE_OAUTH_REDIRECT_URI || `${origin}/oauth/supabase/callback`;
      const cookie = serializeCookie(slot ? `pb_oauth_supabase_${slot}` : 'pb_oauth_supabase', { codeVerifier, state, project, slot, redirectUri });
      const authorizeUrl = buildSupabaseAuthorizeUrl({ clientId, redirectUri, codeChallenge, state });
      return {
        statusCode: 302,
        headers: {
          Location: authorizeUrl,
          'Set-Cookie': cookie,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: {
          'Set-Cookie': [cookie],
        },
      };
    }

    return {
      statusCode: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      body: 'Supabase OAuth is not configured for this site.',
    };
  }

  // 3. /oauth/supabase/callback AND /confidential/callback
  if (pathname.includes('/oauth/supabase/callback') || pathname.includes('/confidential/callback')) {
    const code = query.code;
    const state = query.state;
    const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
    const pendingNames=['pb_oauth_supabase_source','pb_oauth_supabase_target','pb_oauth_supabase'];
    const pkceName=pendingNames.find(name=>parseCookie(cookieHeader,name)?.state===state) || 'pb_oauth_supabase';
    const pkce = parseCookie(cookieHeader, pkceName);

    if (pathname.includes('/confidential/callback') && !pkce) {
      const hasCodeAndState = typeof code === 'string' && typeof state === 'string';
      const hasError = typeof query.error === 'string';
      if (!hasCodeAndState && !hasError) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
          body: 'Invalid callback parameters: code and state or error required.',
        };
      }
      return {
        statusCode: 302,
        headers: {
          Location: `http://127.0.0.1:58441/confidential/callback?${new URLSearchParams(query).toString()}`,
          'Cache-Control': 'no-store',
        },
      };
    }

    if (!code || !state || !pkce || pkce.state !== state) {
      const clearPkceCookie = clearCookie(pkceName);
      return {
        statusCode: 302,
        headers: {
          Location: '/dashboard?oauth_error=invalid_state',
          'Set-Cookie': clearPkceCookie,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: {
          'Set-Cookie': [clearPkceCookie],
        },
      };
    }

    try {
      const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
      const redirectUri = pkce.redirectUri || `${origin}/oauth/supabase/callback`;
      const tokenResp = await exchangeSupabaseOAuthCode({
        code,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        clientId,
        clientSecret,
      });

      const slotCookieName = supabaseTokenCookieName(pkce.slot);
      const sealedSession = sealSupabaseSession({
        accessToken: tokenResp.accessToken,
        refreshToken: tokenResp.refreshToken,
        expiresAt: tokenResp.expiresAt,
      }, oauthCookieSecret());
      const sessionCookie = serializeCookie(slotCookieName, sealedSession, 60 * 60 * 24 * 7);
      const clearPkce = clearCookie(pkceName);

      const setCookies = [sessionCookie];
      if ((pkce.slot === 'source' || !pkce.slot) && slotCookieName !== 'pb_oauth_sb_token') {
        setCookies.push(serializeCookie('pb_oauth_sb_token', sealedSession, 60 * 60 * 24 * 7));
      }
      setCookies.push(clearPkce);

      const slotParam = pkce.slot ? `&slot=${encodeURIComponent(pkce.slot)}` : '';
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': sessionCookie,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: {
          'Set-Cookie': setCookies,
        },
        body: `<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>Supabase connected</title></head><body><p>Supabase connected. You can return to your recovery screen.</p><script>if(window.opener){window.opener.postMessage({type:'portabase_oauth_complete'},location.origin);window.close();}else{location.replace('/dashboard?oauth=supabase_connected${slotParam}');}</script></body></html>`,
      };
    } catch (err) {
      const clearPkceCookie = clearCookie(pkceName);
      return {
        statusCode: 302,
        headers: {
          Location: `/dashboard?oauth_error=${encodeURIComponent(err.message)}`,
          'Set-Cookie': clearPkceCookie,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: {
          'Set-Cookie': [clearPkceCookie],
        },
      };
    }
  }

  // 4. /oauth/google-drive/start
  if (pathname.includes('/oauth/google-drive/start')) {
    const clientId = (query.clientId || query.appKey || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '').trim();
    if (!clientId) {
      return {
        statusCode: 302,
        headers: { Location: '/dashboard?storage_oauth=gdrive_missing_client_id', 'Cache-Control': 'no-store' },
      };
    }

    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateOAuthState();
    const redirectUri = `${origin}/oauth/google-drive/callback`;
    const cookie = serializeCookie('pb_oauth_gdrive', { codeVerifier, state, clientId });
    const authUrl = buildGoogleDriveAuthorizeUrl({ clientId, redirectUri, codeChallenge, state });
    return {
      statusCode: 302,
      headers: { Location: authUrl, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
      multiValueHeaders: { 'Set-Cookie': [cookie] },
    };
  }

  // 5. /oauth/google-drive/callback
  if (pathname.includes('/oauth/google-drive/callback')) {
    const code = query.code;
    const state = query.state;
    const oauthErr = query.error;
    const cookieHeader = event.headers.cookie || event.headers.Cookie;
    const pkce = parseCookie(cookieHeader, 'pb_oauth_gdrive');

    if (oauthErr || !code || !state || !pkce || pkce.state !== state) {
      const errReason = query.error_description || oauthErr || 'invalid_state';
      const cleared = clearCookie('pb_oauth_gdrive');
      return {
        statusCode: 302,
        headers: {
          Location: `/dashboard?storage_oauth_error=${encodeURIComponent(errReason)}`,
          'Set-Cookie': cleared,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: { 'Set-Cookie': [cleared] },
      };
    }

    try {
      const clientId = pkce.clientId || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = `${origin}/oauth/google-drive/callback`;
      const tokenResp = await exchangeGoogleDriveOAuthCode({
        code,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        clientId,
        clientSecret,
      });

      const tokenPayload = {
        accessToken: tokenResp.accessToken || tokenResp.access_token,
        refreshToken: tokenResp.refreshToken || tokenResp.refresh_token || null,
        scope: tokenResp.scope || null,
        clientId,
      };

      const tokenCookie = serializeCookie('pb_oauth_gdrive_token', tokenPayload, 86400);
      const clearedCookie = clearCookie('pb_oauth_gdrive');

      return {
        statusCode: 302,
        headers: {
          Location: '/dashboard?storage_oauth=google-drive-connected',
          'Set-Cookie': tokenCookie,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: {
          'Set-Cookie': [tokenCookie, clearedCookie],
        },
      };
    } catch (err) {
      const cleared = clearCookie('pb_oauth_gdrive');
      return {
        statusCode: 302,
        headers: {
          Location: `/dashboard?storage_oauth_error=${encodeURIComponent(err.message)}`,
          'Set-Cookie': cleared,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: { 'Set-Cookie': [cleared] },
      };
    }
  }

  // 6. /oauth/dropbox/start
  if (pathname.includes('/oauth/dropbox/start')) {
    const clientId = (query.clientId || query.appKey || process.env.DROPBOX_APP_KEY || process.env.DROPBOX_CLIENT_ID || '').trim();
    if (!clientId) {
      return {
        statusCode: 302,
        headers: { Location: '/dashboard?storage_oauth=dropbox_missing_app_key', 'Cache-Control': 'no-store' },
      };
    }

    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateOAuthState();
    const redirectUri = `${origin}/oauth/dropbox/callback`;
    const cookie = serializeCookie('pb_oauth_dropbox', { codeVerifier, state, clientId });
    const authUrl = buildDropboxAuthorizeUrl({ clientId, redirectUri, codeChallenge, state });
    return {
      statusCode: 302,
      headers: { Location: authUrl, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
      multiValueHeaders: { 'Set-Cookie': [cookie] },
    };
  }

  // 7. /oauth/dropbox/callback
  if (pathname.includes('/oauth/dropbox/callback')) {
    const code = query.code;
    const state = query.state;
    const oauthErr = query.error;
    const cookieHeader = event.headers.cookie || event.headers.Cookie;
    const pkce = parseCookie(cookieHeader, 'pb_oauth_dropbox');

    if (oauthErr || !code || !state || !pkce || pkce.state !== state) {
      const errReason = query.error_description || oauthErr || 'invalid_state';
      const cleared = clearCookie('pb_oauth_dropbox');
      return {
        statusCode: 302,
        headers: {
          Location: `/dashboard?storage_oauth_error=${encodeURIComponent(errReason)}`,
          'Set-Cookie': cleared,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: { 'Set-Cookie': [cleared] },
      };
    }

    try {
      const clientId = pkce.clientId || process.env.DROPBOX_APP_KEY || process.env.DROPBOX_CLIENT_ID;
      const clientSecret = process.env.DROPBOX_APP_SECRET || process.env.DROPBOX_CLIENT_SECRET;
      const redirectUri = `${origin}/oauth/dropbox/callback`;
      const tokenResp = await exchangeDropboxOAuthCode({
        code,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        clientId,
        clientSecret,
      });

      const tokenPayload = {
        accessToken: tokenResp.accessToken || tokenResp.access_token,
        refreshToken: tokenResp.refreshToken || tokenResp.refresh_token || null,
        accountId: tokenResp.accountId || tokenResp.account_id || null,
        uid: tokenResp.uid || null,
        clientId,
      };

      const tokenCookie = serializeCookie('pb_oauth_dropbox_token', tokenPayload, 86400);
      const clearedCookie = clearCookie('pb_oauth_dropbox');

      return {
        statusCode: 302,
        headers: {
          Location: '/dashboard?storage_oauth=dropbox-connected',
          'Set-Cookie': tokenCookie,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: {
          'Set-Cookie': [tokenCookie, clearedCookie],
        },
      };
    } catch (err) {
      const cleared = clearCookie('pb_oauth_dropbox');
      return {
        statusCode: 302,
        headers: {
          Location: `/dashboard?storage_oauth_error=${encodeURIComponent(err.message)}`,
          'Set-Cookie': cleared,
          'Cache-Control': 'no-store',
        },
        multiValueHeaders: { 'Set-Cookie': [cleared] },
      };
    }
  }

  return jsonResponse(404, { error: 'not_found' });
}
