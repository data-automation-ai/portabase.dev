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

async function lambdaHandler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  const hasDropboxToken = Boolean(process.env.DROPBOX_ACCESS_TOKEN || process.env.DROPBOX_REFRESH_TOKEN);
  const hasGoogleDriveToken = Boolean(process.env.GOOGLE_DRIVE_ACCESS_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN);

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
          authTypes: ['access_token', 'oauth_refresh'],
        },
        'google-drive': {
          provider: 'google-drive',
          name: 'Google Drive',
          modes: ['direct-api', 'rclone'],
          defaultFolderPath: 'Portabase',
          configured: hasGoogleDriveToken,
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
  const simulate = body.simulate === true ||
    (typeof body.accessToken === 'string' && body.accessToken.startsWith('sim_')) ||
    (!body.accessToken && !hasDropboxToken && provider === 'dropbox') ||
    (!body.accessToken && !hasGoogleDriveToken && provider === 'google-drive');

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
        accountEmail: provider === 'dropbox' ? (body.accountEmail || 'customer@dropbox.test') : (body.accountEmail || 'customer@gmail.com'),
        displayName: provider === 'dropbox' ? (body.displayName || 'Dropbox User') : (body.displayName || 'Google Drive User'),
        usedBytes: provider === 'dropbox' ? 104857600 : 209715200,
        allocatedBytes: provider === 'dropbox' ? 2147483648 : 16106127360,
        folderPath,
        verifiedHash,
      });
    }

    try {
      const opts = {
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        clientId: body.clientId || body.appKey,
        clientSecret: body.clientSecret || body.appSecret,
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
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        clientId: body.clientId || body.appKey,
        clientSecret: body.clientSecret || body.appSecret,
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
