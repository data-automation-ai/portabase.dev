import { withBlobs } from '../shared/subscription-store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import {
  computeDropboxContentHash,
  computeSha256,
  testDropboxConnection,
  testGoogleDriveConnection,
  uploadCapsuleToDropbox,
  uploadCapsuleToGoogleDrive,
} from '../../utility/cloud-storage-connectors.mjs';

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

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function lambdaHandler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
  const dropboxCookie = parseCookie(cookieHeader, 'pb_oauth_dropbox_token');
  const gdriveCookie = parseCookie(cookieHeader, 'pb_oauth_gdrive_token');

  const hasDropboxToken = Boolean(
    process.env.DROPBOX_ACCESS_TOKEN ||
    process.env.DROPBOX_REFRESH_TOKEN ||
    dropboxCookie?.accessToken ||
    dropboxCookie?.refreshToken
  );
  const hasGoogleDriveToken = Boolean(
    process.env.GOOGLE_DRIVE_ACCESS_TOKEN ||
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN ||
    gdriveCookie?.accessToken ||
    gdriveCookie?.refreshToken
  );

  if (event.httpMethod === 'GET') {
    return jsonResponse(200, {
      ok: true,
      connectors: {
        dropbox: {
          provider: 'dropbox',
          name: 'Dropbox',
          modes: ['direct-api', 'rclone'],
          defaultFolderPath: '/Portabase',
          configured: hasDropboxToken,
          oauthConnected: Boolean(dropboxCookie?.accessToken || dropboxCookie?.refreshToken),
          accountId: dropboxCookie?.accountId || null,
          uid: dropboxCookie?.uid || null,
          authTypes: ['access_token', 'oauth_refresh'],
        },
        'google-drive': {
          provider: 'google-drive',
          name: 'Google Drive',
          modes: ['direct-api', 'rclone'],
          defaultFolderPath: 'Portabase',
          configured: hasGoogleDriveToken,
          oauthConnected: Boolean(gdriveCookie?.accessToken || gdriveCookie?.refreshToken),
          authTypes: ['access_token', 'oauth_refresh'],
        },
      },
    });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const rawProvider = String(body.provider || 'dropbox').toLowerCase();
  const provider = (rawProvider === 'gdrive' || rawProvider === 'google_drive') ? 'google-drive' : rawProvider;
  const action = body.action || 'test';
  const folderPath = body.folderPath || (provider === 'dropbox' ? '/Portabase' : 'Portabase');

  if (action === 'disconnect') {
    const cookieName = provider === 'dropbox' ? 'pb_oauth_dropbox_token' : 'pb_oauth_gdrive_token';
    return jsonResponse(200, {
      ok: true,
      disconnected: true,
      provider,
      message: `Disconnected ${provider} OAuth.`,
    }, {
      'Set-Cookie': clearCookie(cookieName),
    });
  }

  if (action === 'status') {
    return jsonResponse(200, {
      ok: true,
      provider,
      configured: provider === 'dropbox' ? hasDropboxToken : hasGoogleDriveToken,
      oauthConnected: provider === 'dropbox'
        ? Boolean(dropboxCookie?.accessToken || dropboxCookie?.refreshToken)
        : Boolean(gdriveCookie?.accessToken || gdriveCookie?.refreshToken),
      accountId: provider === 'dropbox' ? (dropboxCookie?.accountId || null) : null,
      uid: provider === 'dropbox' ? (dropboxCookie?.uid || null) : null,
    });
  }

  const effectiveAccessToken = body.accessToken || (provider === 'dropbox' ? dropboxCookie?.accessToken : gdriveCookie?.accessToken);
  const effectiveRefreshToken = body.refreshToken || (provider === 'dropbox' ? dropboxCookie?.refreshToken : gdriveCookie?.refreshToken);
  const effectiveClientId = body.clientId || body.appKey || (provider === 'dropbox' ? (dropboxCookie?.clientId || process.env.DROPBOX_APP_KEY || process.env.DROPBOX_CLIENT_ID) : (gdriveCookie?.clientId || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID));
  const effectiveClientSecret = body.clientSecret || body.appSecret || (provider === 'dropbox' ? (process.env.DROPBOX_APP_SECRET || process.env.DROPBOX_CLIENT_SECRET) : process.env.GOOGLE_CLIENT_SECRET);

  const simulate = body.simulate === true ||
    (typeof effectiveAccessToken === 'string' && effectiveAccessToken.startsWith('sim_')) ||
    (!effectiveAccessToken && !effectiveRefreshToken && !hasDropboxToken && provider === 'dropbox') ||
    (!effectiveAccessToken && !effectiveRefreshToken && !hasGoogleDriveToken && provider === 'google-drive');

  if (action === 'test') {
    if (simulate) {
      let verifiedHash = null;
      try {
        const capsulesDir = path.resolve(process.cwd(), 'portabase-capsules');
        if (fs.existsSync(capsulesDir)) {
          const files = fs.readdirSync(capsulesDir).filter(f => !f.startsWith('.'));
          if (files.length > 0) {
            const firstCap = path.join(capsulesDir, files[0]);
            const targetFile = fs.existsSync(path.join(firstCap, 'manifest.json'))
              ? path.join(firstCap, 'manifest.json')
              : (fs.readdirSync(firstCap).map(f => path.join(firstCap, f)).find(f => fs.statSync(f).isFile()) || null);
            if (targetFile) {
              verifiedHash = provider === 'dropbox'
                ? computeDropboxContentHash(targetFile)
                : computeSha256(targetFile);
            }
          }
        }
      } catch {
        // fallback hash
      }
      if (!verifiedHash) {
        verifiedHash = provider === 'dropbox'
          ? computeDropboxContentHash(Buffer.from('portabase simulated test payload'))
          : computeSha256(Buffer.from('portabase simulated test payload'));
      }

      return jsonResponse(200, {
        ok: true,
        simulated: true,
        provider,
        accountEmail: provider === 'dropbox' ? (body.accountEmail || (dropboxCookie?.accountId ? `dropbox:${dropboxCookie.accountId}` : 'customer@dropbox.test')) : (body.accountEmail || 'customer@gmail.com'),
        displayName: provider === 'dropbox' ? (body.displayName || 'Dropbox User') : (body.displayName || 'Google Drive User'),
        usedBytes: provider === 'dropbox' ? 104857600 : 209715200,
        allocatedBytes: provider === 'dropbox' ? 2147483648 : 16106127360,
        folderPath,
        verifiedHash,
      });
    }

    try {
      const opts = {
        accessToken: effectiveAccessToken,
        refreshToken: effectiveRefreshToken,
        clientId: effectiveClientId,
        clientSecret: effectiveClientSecret,
        folderPath,
      };
      const result = provider === 'dropbox'
        ? await testDropboxConnection(opts)
        : await testGoogleDriveConnection(opts);
      return jsonResponse(200, result);
    } catch (err) {
      return jsonResponse(400, {
        ok: false,
        error: 'connection_test_failed',
        message: err.message,
        provider,
      });
    }
  }

  if (action === 'upload-capsule') {
    let capsuleDir = null;
    const capsulesDir = path.resolve(process.cwd(), 'portabase-capsules');
    if (body.capsuleId) {
      const targetPath = path.join(capsulesDir, path.basename(body.capsuleId));
      if (fs.existsSync(targetPath)) {
        capsuleDir = targetPath;
      }
    }

    if (!capsuleDir && fs.existsSync(capsulesDir)) {
      const available = fs.readdirSync(capsulesDir)
        .filter(d => !d.startsWith('.') && fs.statSync(path.join(capsulesDir, d)).isDirectory());
      if (available.length > 0) {
        capsuleDir = path.join(capsulesDir, available[0]);
      }
    }

    if (!capsuleDir) {
      return jsonResponse(404, {
        ok: false,
        error: 'capsule_not_found',
        message: 'No capsule directory found to upload.',
      });
    }

    try {
      const opts = {
        accessToken: effectiveAccessToken,
        refreshToken: effectiveRefreshToken,
        clientId: effectiveClientId,
        clientSecret: effectiveClientSecret,
        folderPath,
        simulate,
      };
      const result = provider === 'dropbox'
        ? await uploadCapsuleToDropbox(capsuleDir, opts)
        : await uploadCapsuleToGoogleDrive(capsuleDir, opts);

      return jsonResponse(200, {
        ok: true,
        capsuleId: path.basename(capsuleDir),
        ...result,
      });
    } catch (err) {
      return jsonResponse(500, {
        ok: false,
        error: 'upload_failed',
        message: err.message,
        provider,
      });
    }
  }

  return jsonResponse(400, { error: 'unknown_action', message: `Action "${action}" is not supported.` });
}

export const handler = withBlobs(lambdaHandler);
