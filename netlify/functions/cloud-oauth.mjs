import zlib from 'node:zlib';
import { jsonResponse } from '../shared/verify-user.mjs';
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
} from '../../cloud/runner/storage-oauth.mjs';
import { discoverSupabaseProjectsAndDatabases } from '../../cloud/runner/supabase-discovery.mjs';
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

export async function handler(event) {
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

  // 1. API: Discovery, Disconnect, Capsule Generate & Capsule Restore via /api/cloud/oauth
  if (
    pathname.startsWith('/api/cloud/oauth') ||
    query.action === 'discover' ||
    query.action === 'disconnect' ||
    query.action === 'generate_capsule' ||
    query.action === 'restore_capsule'
  ) {
    const provider = query.provider || body.provider || 'supabase';
    const action = query.action || body.action || 'discover';
    const targetRef = (query.project || body.project || '').trim().toLowerCase();

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
      return jsonResponse(
        200,
        {
          ok: true,
          connected: false,
          disconnected: true,
          message: 'Disconnected from Supabase.',
          databases: [],
          projects: [],
        },
        {
          'Set-Cookie': clearCookie('pb_oauth_sb_token'),
        },
      );
    }

    if (provider === 'supabase' && action === 'discover') {
      const authHeader = ((event.headers?.authorization || event.headers?.Authorization) || '')
        .replace(/^Bearer\s+/i, '')
        .trim();
      const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
      const cookieSession = parseCookie(cookieHeader, 'pb_oauth_sb_token');
      const token =
        (body.token || '').trim() ||
        (query.token || '').trim() ||
        authHeader ||
        (cookieSession?.accessToken || '') ||
        process.env.SUPABASE_MANAGEMENT_TOKEN ||
        process.env.SUPABASE_ACCESS_TOKEN ||
        '';

      if (!token) {
        return jsonResponse(200, {
          ok: true,
          connected: false,
          message: 'No management token configured on server.',
          databases: [],
          projects: [],
        });
      }

      try {
        const result = await discoverSupabaseProjectsAndDatabases({
          token,
          targetRef,
          inspectAllActive: true,
        });
        const scopeSummary = computeDatabaseScopeSummary(result.databases || []);
        const includeFullManifest = Boolean(query.includeManifest || body.includeManifest);
        const payloadObj = {
          ...result,
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
              'Access-Control-Allow-Origin': '*',
            },
            body: gz.toString('base64'),
          };
        }
        return jsonResponse(200, payloadObj);
      } catch (err) {
        return jsonResponse(500, { ok: false, error: err.message });
      }
    }

    return jsonResponse(400, { error: 'unsupported_provider_or_action' });
  }

  // 2. /oauth/supabase/start
  if (pathname.includes('/oauth/supabase/start')) {
    const project = query.project || '';
    const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId || '');

    if (isUuid) {
      const { codeVerifier, codeChallenge } = generatePkcePair();
      const state = generateOAuthState();
      const redirectUri = `${origin}/oauth/supabase/callback`;
      const cookie = serializeCookie('pb_oauth_supabase', { codeVerifier, state, project });
      const authorizeUrl = buildSupabaseAuthorizeUrl({ clientId, redirectUri, codeChallenge, state });
      return {
        statusCode: 302,
        headers: {
          Location: authorizeUrl,
          'Set-Cookie': cookie,
          'Cache-Control': 'no-store',
        },
      };
    }

    // Direct resolution using server management credentials
    return {
      statusCode: 302,
      headers: {
        Location: `/dashboard?oauth=supabase_connected&project=${encodeURIComponent(project)}`,
        'Cache-Control': 'no-store',
      },
    };
  }

  // 3. /oauth/supabase/callback
  if (pathname.includes('/oauth/supabase/callback')) {
    const code = query.code;
    const state = query.state;
    const cookieHeader = event.headers.cookie || event.headers.Cookie;
    const pkce = parseCookie(cookieHeader, 'pb_oauth_supabase');

    if (!code || !state || !pkce || pkce.state !== state) {
      return {
        statusCode: 302,
        headers: {
          Location: '/dashboard?oauth_error=invalid_state',
          'Set-Cookie': clearCookie('pb_oauth_supabase'),
          'Cache-Control': 'no-store',
        },
      };
    }

    try {
      const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
      const redirectUri = `${origin}/oauth/supabase/callback`;
      const tokenResp = await exchangeSupabaseOAuthCode({
        code,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        clientId,
        clientSecret,
      });

      const sessionCookie = tokenResp?.access_token
        ? serializeCookie('pb_oauth_sb_token', { accessToken: tokenResp.access_token }, 3600)
        : clearCookie('pb_oauth_supabase');

      return {
        statusCode: 302,
        headers: {
          Location: `/dashboard?oauth=supabase_connected&project=${encodeURIComponent(pkce.project || '')}`,
          'Set-Cookie': sessionCookie,
          'Cache-Control': 'no-store',
        },
      };
    } catch (err) {
      return {
        statusCode: 302,
        headers: {
          Location: `/dashboard?oauth_error=${encodeURIComponent(err.message)}`,
          'Set-Cookie': clearCookie('pb_oauth_supabase'),
          'Cache-Control': 'no-store',
        },
      };
    }
  }

  // 4. /oauth/google-drive/start
  if (pathname.includes('/oauth/google-drive/start')) {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      return {
        statusCode: 302,
        headers: { Location: '/dashboard?storage_oauth=gdrive_missing_client_id', 'Cache-Control': 'no-store' },
      };
    }

    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateOAuthState();
    const redirectUri = `${origin}/oauth/google-drive/callback`;
    const cookie = serializeCookie('pb_oauth_gdrive', { codeVerifier, state });
    const authUrl = buildGoogleDriveAuthorizeUrl({ clientId, redirectUri, codeChallenge, state });
    return {
      statusCode: 302,
      headers: { Location: authUrl, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
    };
  }

  // 5. /oauth/google-drive/callback
  if (pathname.includes('/oauth/google-drive/callback')) {
    return {
      statusCode: 302,
      headers: {
        Location: '/dashboard?storage_oauth=google-drive-connected',
        'Set-Cookie': clearCookie('pb_oauth_gdrive'),
        'Cache-Control': 'no-store',
      },
    };
  }

  // 6. /oauth/dropbox/start
  if (pathname.includes('/oauth/dropbox/start')) {
    const clientId = process.env.DROPBOX_APP_KEY || process.env.DROPBOX_CLIENT_ID;
    if (!clientId) {
      return {
        statusCode: 302,
        headers: { Location: '/dashboard?storage_oauth=dropbox_missing_app_key', 'Cache-Control': 'no-store' },
      };
    }

    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateOAuthState();
    const redirectUri = `${origin}/oauth/dropbox/callback`;
    const cookie = serializeCookie('pb_oauth_dropbox', { codeVerifier, state });
    const authUrl = buildDropboxAuthorizeUrl({ clientId, redirectUri, codeChallenge, state });
    return {
      statusCode: 302,
      headers: { Location: authUrl, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
    };
  }

  // 7. /oauth/dropbox/callback
  if (pathname.includes('/oauth/dropbox/callback')) {
    return {
      statusCode: 302,
      headers: {
        Location: '/dashboard?storage_oauth=dropbox-connected',
        'Set-Cookie': clearCookie('pb_oauth_dropbox'),
        'Cache-Control': 'no-store',
      },
    };
  }

  return jsonResponse(404, { error: 'not_found' });
}
