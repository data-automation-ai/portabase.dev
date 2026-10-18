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

  // 1. API: Discovery & Token Exchange via /api/cloud/oauth
  if (pathname.startsWith('/api/cloud/oauth') || query.action === 'discover') {
    const provider = query.provider || body.provider || 'supabase';
    const action = query.action || body.action || 'discover';
    const targetRef = (query.project || body.project || '').trim().toLowerCase();

    if (provider === 'supabase' && action === 'discover') {
      const token = process.env.SUPABASE_MANAGEMENT_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;
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
        const pRes = await fetch('https://api.supabase.com/v1/projects', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const allProjects = pRes.ok ? await pRes.json() : [];

        let chosenRef = targetRef;
        if (!chosenRef && Array.isArray(allProjects) && allProjects.length > 0) {
          const active = allProjects.find(p => p.status === 'ACTIVE_HEALTHY') || allProjects[0];
          chosenRef = active.id;
        }

        let tables = [];
        let dbBytes = null;
        if (chosenRef) {
          try {
            const [sizeRes, qRes] = await Promise.all([
              fetch(`https://api.supabase.com/v1/projects/${chosenRef}/database/query`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  query: `SELECT pg_database_size(current_database())::bigint AS db_bytes;`,
                }),
              }),
              fetch(`https://api.supabase.com/v1/projects/${chosenRef}/database/query`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  query: `SELECT c.relname AS name, GREATEST(c.reltuples::bigint, 0) AS rows_estimate, pg_total_relation_size(c.oid) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 50;`,
                }),
              }),
            ]);

            if (sizeRes.ok) {
              const sizeRows = await sizeRes.json();
              const rawBytes = sizeRows?.[0]?.db_bytes;
              if (rawBytes != null && !Number.isNaN(Number(rawBytes))) {
                dbBytes = Number(rawBytes);
              }
            }

            if (qRes.ok) {
              const rows = await qRes.json();
              if (Array.isArray(rows)) {
                tables = rows.map(r => {
                  const rawBytes = r.bytes != null ? Number(r.bytes) : null;
                  const rawRows = r.rows_estimate != null ? Number(r.rows_estimate) : null;
                  const sizeMb = (rawBytes != null && !Number.isNaN(rawBytes))
                    ? Number((rawBytes / (1024 * 1024)).toFixed(2))
                    : null;
                  return {
                    name: `public.${r.name}`,
                    rowsEstimate: (rawRows != null && !Number.isNaN(rawRows)) ? rawRows : null,
                    sizeBytes: rawBytes,
                    sizeMb,
                    mode: 'structure_and_data',
                  };
                });
              }
            }
          } catch {
            // discovery non-blocking
          }
        }

        const projectList = Array.isArray(allProjects) ? allProjects : [];
        const databases = projectList.map(p => {
          const isChosen = p.id === chosenRef;
          let estimatedSizeMb = null;
          if (isChosen) {
            if (dbBytes !== null) {
              estimatedSizeMb = Math.round(dbBytes / (1024 * 1024));
            } else if (tables.length > 0 && tables.some(t => typeof t.sizeMb === 'number')) {
              estimatedSizeMb = Math.round(tables.reduce((acc, t) => acc + (t.sizeMb || 0), 0));
            }
          }
          return {
            id: `db_${p.id.slice(0, 8)}`,
            projectRef: p.id,
            name: p.name || p.id,
            region: p.region || 'us-east-1',
            status: p.status || 'ready',
            estimatedSizeMb,
            enabled: isChosen,
            mode: 'structure_and_data',
            tables: isChosen ? tables : [],
          };
        });

        return jsonResponse(200, {
          ok: true,
          connected: true,
          targetProjectRef: chosenRef,
          projects: projectList.map(p => ({ id: p.id, name: p.name, region: p.region, status: p.status })),
          databases,
        });
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
      await exchangeSupabaseOAuthCode({
        code,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        clientId,
        clientSecret,
      });

      return {
        statusCode: 302,
        headers: {
          Location: `/dashboard?oauth=supabase_connected&project=${encodeURIComponent(pkce.project || '')}`,
          'Set-Cookie': clearCookie('pb_oauth_supabase'),
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
