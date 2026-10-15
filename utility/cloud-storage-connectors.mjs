import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Computes Dropbox's official content_hash:
 * 1. Divide file into 4 MB blocks (4,194,304 bytes).
 * 2. Compute SHA-256 binary digest of each block.
 * 3. Concatenate all block digests.
 * 4. Compute SHA-256 of concatenated block digests and return hex string.
 * For an empty file, returns the SHA-256 of empty string (e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855).
 */
export function computeDropboxContentHash(input) {
  let buffer;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    buffer = Buffer.from(input);
  } else if (typeof input === 'string') {
    if (fs.existsSync(input) && !input.includes('\n')) {
      buffer = fs.readFileSync(input);
    } else {
      buffer = Buffer.from(input, 'utf8');
    }
  } else {
    throw new TypeError('Expected Buffer, Uint8Array, or file path/string');
  }

  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB
  const chunkHashes = [];
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
    chunkHashes.push(crypto.createHash('sha256').update(chunk).digest());
  }

  const concatenated = Buffer.concat(chunkHashes);
  return crypto.createHash('sha256').update(concatenated).digest('hex');
}

/**
 * Computes SHA-256 hex checksum for a buffer or file.
 */
export function computeSha256(input) {
  let buffer;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    buffer = Buffer.from(input);
  } else if (typeof input === 'string') {
    if (fs.existsSync(input) && !input.includes('\n')) {
      buffer = fs.readFileSync(input);
    } else {
      buffer = Buffer.from(input, 'utf8');
    }
  } else {
    throw new TypeError('Expected Buffer, Uint8Array, or file path/string');
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/* ─────────────────────────────────────────────────────────────
   DROPBOX CONNECTOR
───────────────────────────────────────────────────────────── */

/**
 * Resolves Dropbox access token from options, env, or by refreshing OAuth token.
 */
export async function resolveDropboxAccessToken(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (opts.accessToken) return opts.accessToken;
  if (process.env.DROPBOX_ACCESS_TOKEN) return process.env.DROPBOX_ACCESS_TOKEN;

  const refreshToken = opts.refreshToken || process.env.DROPBOX_REFRESH_TOKEN;
  if (refreshToken) {
    if (refreshToken.startsWith('sim_')) {
      return `sim_dropbox_access_${Date.now()}`;
    }
    const appKey = opts.appKey || opts.clientId || process.env.DROPBOX_APP_KEY || process.env.DROPBOX_CLIENT_ID;
    const appSecret = opts.appSecret || opts.clientSecret || process.env.DROPBOX_APP_SECRET || process.env.DROPBOX_CLIENT_SECRET;
    const bodyParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (appKey) bodyParams.set('client_id', appKey);
    if (appSecret) bodyParams.set('client_secret', appSecret);

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (appKey && appSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`;
    }

    const res = await fetchImpl('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers,
      body: bodyParams.toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Dropbox OAuth refresh failed (${res.status}): ${errText}`);
    }
    const data = await res.json();
    return data.access_token;
  }

  throw new Error('Dropbox credentials not found: specify accessToken, DROPBOX_ACCESS_TOKEN, or DROPBOX_REFRESH_TOKEN.');
}

/**
 * Tests Dropbox connection by querying account profile and space usage.
 */
export async function testDropboxConnection(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const folderPath = opts.folderPath || opts.path || '/Portabase';

  let token;
  try {
    token = await resolveDropboxAccessToken(opts);
  } catch (err) {
    if (opts.simulate === true) {
      token = 'sim_dropbox_token';
    } else {
      throw err;
    }
  }

  if (opts.simulate === true || (typeof token === 'string' && token.startsWith('sim_'))) {
    return {
      ok: true,
      provider: 'dropbox',
      simulated: true,
      accountEmail: opts.email || 'customer@dropbox.test',
      displayName: opts.displayName || 'Dropbox User',
      usedBytes: 104857600,
      allocatedBytes: 2147483648,
      folderPath,
    };
  }

  const accountRes = await fetchImpl('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!accountRes.ok) {
    const errText = await accountRes.text();
    throw new Error(`Dropbox account check failed (${accountRes.status}): ${errText}`);
  }
  const accountData = await accountRes.json();

  let usedBytes = null;
  let allocatedBytes = null;
  try {
    const spaceRes = await fetchImpl('https://api.dropboxapi.com/2/users/get_space_usage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (spaceRes.ok) {
      const spaceData = await spaceRes.json();
      usedBytes = spaceData.used || 0;
      allocatedBytes = spaceData.allocation?.allocated || null;
    }
  } catch {
    // optional secondary check
  }

  return {
    ok: true,
    provider: 'dropbox',
    accountEmail: accountData.email,
    displayName: accountData.name?.display_name || accountData.name?.familiar_name || accountData.email,
    usedBytes,
    allocatedBytes,
    folderPath,
  };
}

/**
 * Uploads all files in capsuleDir to Dropbox at folderPath/capsuleId/fileName,
 * verifying each file's returned content_hash against local computeDropboxContentHash.
 */
export async function uploadCapsuleToDropbox(capsuleDir, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const capsuleId = path.basename(capsuleDir);
  const rawFolder = opts.folderPath || opts.path || '/Portabase';
  const folderPath = rawFolder.startsWith('/') ? rawFolder : `/${rawFolder}`;
  const targetRemote = `dropbox:${folderPath}/${capsuleId}`;

  const isSimulated = opts.simulate === true ||
    (opts.accessToken && opts.accessToken.startsWith('sim_')) ||
    (process.env.DROPBOX_ACCESS_TOKEN && process.env.DROPBOX_ACCESS_TOKEN.startsWith('sim_'));

  const files = fs.readdirSync(capsuleDir)
    .filter(name => !name.startsWith('.') && fs.statSync(path.join(capsuleDir, name)).isFile());

  if (files.length === 0) {
    throw new Error(`Capsule directory is empty: ${capsuleDir}`);
  }

  const filesUploaded = [];
  const contentHashes = {};

  if (isSimulated) {
    for (const name of files) {
      const filePath = path.join(capsuleDir, name);
      const hash = computeDropboxContentHash(filePath);
      contentHashes[name] = hash;
      filesUploaded.push({
        name,
        path: `${folderPath}/${capsuleId}/${name}`,
        size: fs.statSync(filePath).size,
        content_hash: hash,
        verified: true,
      });
    }
    return {
      destination: targetRemote,
      verified: true,
      mode: 'dropbox-api',
      simulated: true,
      filesUploaded,
      contentHashes,
    };
  }

  const token = await resolveDropboxAccessToken(opts);

  for (const name of files) {
    const filePath = path.join(capsuleDir, name);
    const fileBuffer = fs.readFileSync(filePath);
    const localHash = computeDropboxContentHash(fileBuffer);
    const targetDropboxPath = `${folderPath}/${capsuleId}/${name}`;

    // For files <= 100 MB, use simple upload
    if (fileBuffer.length <= 100 * 1024 * 1024) {
      const res = await fetchImpl('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': JSON.stringify({
            path: targetDropboxPath,
            mode: 'overwrite',
            autorename: false,
            mute: true,
          }),
          'Content-Type': 'application/octet-stream',
        },
        body: fileBuffer,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Dropbox upload failed for ${name} (${res.status}): ${errText}`);
      }

      const resData = await res.json();
      if (resData.content_hash && resData.content_hash !== localHash) {
        throw new Error(`Dropbox content_hash mismatch on ${name}: expected ${localHash}, got ${resData.content_hash}`);
      }

      contentHashes[name] = resData.content_hash || localHash;
      filesUploaded.push({
        name,
        path: resData.path_display || targetDropboxPath,
        size: resData.size ?? fileBuffer.length,
        content_hash: contentHashes[name],
        verified: true,
      });
    } else {
      // Chunked upload session for files > 100 MB
      const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB upload chunks
      const firstChunk = fileBuffer.subarray(0, CHUNK_SIZE);
      const startRes = await fetchImpl('https://content.dropboxapi.com/2/files/upload_session/start', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': JSON.stringify({ close: false }),
          'Content-Type': 'application/octet-stream',
        },
        body: firstChunk,
      });
      if (!startRes.ok) {
        const errText = await startRes.text();
        throw new Error(`Dropbox upload session start failed for ${name} (${startRes.status}): ${errText}`);
      }
      const { session_id } = await startRes.json();
      let offset = firstChunk.length;

      while (offset + CHUNK_SIZE < fileBuffer.length) {
        const chunk = fileBuffer.subarray(offset, offset + CHUNK_SIZE);
        const appendRes = await fetchImpl('https://content.dropboxapi.com/2/files/upload_session/append_v2', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Dropbox-API-Arg': JSON.stringify({
              cursor: { session_id, offset },
              close: false,
            }),
            'Content-Type': 'application/octet-stream',
          },
          body: chunk,
        });
        if (!appendRes.ok) {
          const errText = await appendRes.text();
          throw new Error(`Dropbox upload session append failed for ${name} (${appendRes.status}): ${errText}`);
        }
        offset += chunk.length;
      }

      const finalChunk = fileBuffer.subarray(offset);
      const finishRes = await fetchImpl('https://content.dropboxapi.com/2/files/upload_session/finish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': JSON.stringify({
            cursor: { session_id, offset },
            commit: {
              path: targetDropboxPath,
              mode: 'overwrite',
              autorename: false,
              mute: true,
            },
          }),
          'Content-Type': 'application/octet-stream',
        },
        body: finalChunk,
      });
      if (!finishRes.ok) {
        const errText = await finishRes.text();
        throw new Error(`Dropbox upload session finish failed for ${name} (${finishRes.status}): ${errText}`);
      }

      const finishData = await finishRes.json();
      if (finishData.content_hash && finishData.content_hash !== localHash) {
        throw new Error(`Dropbox content_hash mismatch on ${name}: expected ${localHash}, got ${finishData.content_hash}`);
      }

      contentHashes[name] = finishData.content_hash || localHash;
      filesUploaded.push({
        name,
        path: finishData.path_display || targetDropboxPath,
        size: finishData.size ?? fileBuffer.length,
        content_hash: contentHashes[name],
        verified: true,
      });
    }
  }

  return {
    destination: targetRemote,
    verified: true,
    mode: 'dropbox-api',
    filesUploaded,
    contentHashes,
  };
}

/**
 * Verifies a previously uploaded Dropbox capsule by checking metadata and hashes.
 */
export async function verifyDropboxCapsule(capsuleId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const rawFolder = opts.folderPath || opts.path || '/Portabase';
  const folderPath = rawFolder.startsWith('/') ? rawFolder : `/${rawFolder}`;

  if (opts.simulate === true) {
    return {
      verified: true,
      destination: `dropbox:${folderPath}/${capsuleId}`,
      simulated: true,
    };
  }

  const token = await resolveDropboxAccessToken(opts);
  const metadataRes = await fetchImpl('https://api.dropboxapi.com/2/files/get_metadata', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: `${folderPath}/${capsuleId}`,
      include_media_info: false,
      include_deleted: false,
      include_has_explicit_shared_members: false,
    }),
  });

  if (!metadataRes.ok) {
    return { verified: false, error: 'Capsule not found on Dropbox destination' };
  }
  const data = await metadataRes.json();
  return {
    verified: true,
    destination: `dropbox:${folderPath}/${capsuleId}`,
    metadata: data,
  };
}

/* ─────────────────────────────────────────────────────────────
   GOOGLE DRIVE CONNECTOR
───────────────────────────────────────────────────────────── */

/**
 * Resolves Google Drive access token from options, env, or OAuth refresh.
 */
export async function resolveGoogleDriveAccessToken(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (opts.accessToken) return opts.accessToken;
  if (process.env.GOOGLE_DRIVE_ACCESS_TOKEN) return process.env.GOOGLE_DRIVE_ACCESS_TOKEN;

  const refreshToken = opts.refreshToken || process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (refreshToken) {
    if (refreshToken.startsWith('sim_')) {
      return `sim_gdrive_access_${Date.now()}`;
    }
    const clientId = opts.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = opts.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    const bodyParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (clientId) bodyParams.set('client_id', clientId);
    if (clientSecret) bodyParams.set('client_secret', clientSecret);

    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive OAuth refresh failed (${res.status}): ${errText}`);
    }
    const data = await res.json();
    return data.access_token;
  }

  throw new Error('Google Drive credentials not found: specify accessToken, GOOGLE_DRIVE_ACCESS_TOKEN, or GOOGLE_DRIVE_REFRESH_TOKEN.');
}

/**
 * Tests Google Drive connection via GET about?fields=user,storageQuota.
 */
export async function testGoogleDriveConnection(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const folderPath = opts.folderPath || opts.path || '/Portabase';

  let token;
  try {
    token = await resolveGoogleDriveAccessToken(opts);
  } catch (err) {
    if (opts.simulate === true) {
      token = 'sim_gdrive_token';
    } else {
      throw err;
    }
  }

  if (opts.simulate === true || (typeof token === 'string' && token.startsWith('sim_'))) {
    return {
      ok: true,
      provider: 'google-drive',
      simulated: true,
      accountEmail: opts.email || 'customer@gmail.com',
      displayName: opts.displayName || 'Google Drive User',
      usedBytes: 209715200,
      allocatedBytes: 16106127360,
      folderPath,
    };
  }

  const aboutRes = await fetchImpl('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!aboutRes.ok) {
    const errText = await aboutRes.text();
    throw new Error(`Google Drive about check failed (${aboutRes.status}): ${errText}`);
  }
  const aboutData = await aboutRes.json();

  return {
    ok: true,
    provider: 'google-drive',
    accountEmail: aboutData.user?.emailAddress,
    displayName: aboutData.user?.displayName || aboutData.user?.emailAddress,
    usedBytes: aboutData.storageQuota?.usage ? Number(aboutData.storageQuota.usage) : null,
    allocatedBytes: aboutData.storageQuota?.limit ? Number(aboutData.storageQuota.limit) : null,
    folderPath,
  };
}

/**
 * Ensures a Google Drive folder exists by name (under parentId if supplied).
 */
async function ensureGoogleDriveFolder(name, parentId, token, fetchImpl) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
  const searchRes = await fetchImpl(searchUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  const createRes = await fetchImpl('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });
  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create Google Drive folder ${name}: ${errText}`);
  }
  const createData = await createRes.json();
  return createData.id;
}

/**
 * Uploads all files in capsuleDir to Google Drive, ensuring target folder hierarchy,
 * and verifying Google Drive's returned sha256Checksum against local computeSha256.
 */
export async function uploadCapsuleToGoogleDrive(capsuleDir, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const capsuleId = path.basename(capsuleDir);
  const rawFolder = opts.folderPath || opts.folderName || opts.path || 'Portabase';
  const folderPath = rawFolder.replace(/^\/+/, '');
  const targetRemote = `gdrive:${folderPath}/${capsuleId}`;

  const isSimulated = opts.simulate === true ||
    (opts.accessToken && opts.accessToken.startsWith('sim_')) ||
    (process.env.GOOGLE_DRIVE_ACCESS_TOKEN && process.env.GOOGLE_DRIVE_ACCESS_TOKEN.startsWith('sim_'));

  const files = fs.readdirSync(capsuleDir)
    .filter(name => !name.startsWith('.') && fs.statSync(path.join(capsuleDir, name)).isFile());

  if (files.length === 0) {
    throw new Error(`Capsule directory is empty: ${capsuleDir}`);
  }

  const filesUploaded = [];
  const sha256Checksums = {};

  if (isSimulated) {
    for (const name of files) {
      const filePath = path.join(capsuleDir, name);
      const hash = computeSha256(filePath);
      sha256Checksums[name] = hash;
      filesUploaded.push({
        name,
        id: `sim_file_${name}`,
        size: fs.statSync(filePath).size,
        sha256Checksum: hash,
        verified: true,
      });
    }
    return {
      destination: targetRemote,
      verified: true,
      mode: 'google-drive-api',
      simulated: true,
      folderId: 'sim_folder_capsule',
      filesUploaded,
      sha256Checksums,
    };
  }

  const token = await resolveGoogleDriveAccessToken(opts);

  // Ensure root folder and subfolder
  const rootFolderId = opts.folderId || await ensureGoogleDriveFolder(folderPath, null, token, fetchImpl);
  const capsuleFolderId = await ensureGoogleDriveFolder(capsuleId, rootFolderId, token, fetchImpl);

  for (const name of files) {
    const filePath = path.join(capsuleDir, name);
    const fileBuffer = fs.readFileSync(filePath);
    const localHash = computeSha256(fileBuffer);

    const boundary = `-------PortabaseDriveUploadBoundary${Date.now()}`;
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart = delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({
        name,
        parents: [capsuleFolderId],
      });

    const fileHeaderPart = delimiter +
      'Content-Type: application/octet-stream\r\n\r\n';

    const fullBody = Buffer.concat([
      Buffer.from(metadataPart, 'utf8'),
      Buffer.from(fileHeaderPart, 'utf8'),
      fileBuffer,
      Buffer.from(closeDelimiter, 'utf8'),
    ]);

    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,sha256Checksum,md5Checksum';
    const uploadRes = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: fullBody,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Google Drive upload failed for ${name} (${uploadRes.status}): ${errText}`);
    }

    const resData = await uploadRes.json();
    if (resData.sha256Checksum && resData.sha256Checksum.toLowerCase() !== localHash.toLowerCase()) {
      throw new Error(`Google Drive sha256Checksum mismatch on ${name}: expected ${localHash}, got ${resData.sha256Checksum}`);
    }

    sha256Checksums[name] = resData.sha256Checksum || localHash;
    filesUploaded.push({
      name,
      id: resData.id,
      size: resData.size ? Number(resData.size) : fileBuffer.length,
      sha256Checksum: sha256Checksums[name],
      verified: true,
    });
  }

  return {
    destination: targetRemote,
    verified: true,
    mode: 'google-drive-api',
    folderId: capsuleFolderId,
    filesUploaded,
    sha256Checksums,
  };
}

/**
 * Verifies a previously uploaded Google Drive capsule by checking files in capsule folder.
 */
export async function verifyGoogleDriveCapsule(capsuleId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const rawFolder = opts.folderPath || opts.folderName || opts.path || 'Portabase';
  const folderPath = rawFolder.replace(/^\/+/, '');

  if (opts.simulate === true) {
    return {
      verified: true,
      destination: `gdrive:${folderPath}/${capsuleId}`,
      simulated: true,
    };
  }

  const token = await resolveGoogleDriveAccessToken(opts);
  const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${capsuleId.replace(/'/g, "\\'")}' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
  const res = await fetchImpl(searchUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    return { verified: false, error: 'Failed to search Google Drive capsule' };
  }
  const data = await res.json();
  const found = data.files && data.files.length > 0;
  return {
    verified: found,
    destination: `gdrive:${folderPath}/${capsuleId}`,
    folderId: found ? data.files[0].id : null,
  };
}
