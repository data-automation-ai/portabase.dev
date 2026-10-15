import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  computeDropboxContentHash,
  computeSha256,
  testDropboxConnection,
  uploadCapsuleToDropbox,
  verifyDropboxCapsule,
  testGoogleDriveConnection,
  uploadCapsuleToGoogleDrive,
  verifyGoogleDriveCapsule,
} from '../utility/cloud-storage-connectors.mjs';

import { handler as storageConnectorsHandler } from '../netlify/functions/cloud-storage-connectors.mjs';

test('computeDropboxContentHash: matches official Dropbox algorithm', () => {
  // 1. Empty buffer/file must produce sha256 of empty string
  const emptyHash = computeDropboxContentHash(Buffer.alloc(0));
  assert.equal(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  // 2. "hello world" test vector
  const helloHash = computeDropboxContentHash(Buffer.from('hello world'));
  assert.equal(helloHash, 'bc62d4b80d9e36da29c16c5d4d9f11731f36052c72401a76c23c0fb5a9b74423');

  // 3. Multi-block file: 5 MB of 0x41 ('A') -> 4 MB chunk + 1 MB chunk
  const fiveMb = Buffer.alloc(5 * 1024 * 1024, 0x41);
  const chunk1 = crypto.createHash('sha256').update(fiveMb.subarray(0, 4 * 1024 * 1024)).digest();
  const chunk2 = crypto.createHash('sha256').update(fiveMb.subarray(4 * 1024 * 1024)).digest();
  const expectedMultiHash = crypto.createHash('sha256').update(Buffer.concat([chunk1, chunk2])).digest('hex');

  const actualMultiHash = computeDropboxContentHash(fiveMb);
  assert.equal(actualMultiHash, expectedMultiHash);
});

test('testDropboxConnection: simulated and mock fetchImpl', async () => {
  // Simulated connection
  const simRes = await testDropboxConnection({ simulate: true });
  assert.equal(simRes.ok, true);
  assert.equal(simRes.provider, 'dropbox');
  assert.equal(simRes.simulated, true);
  assert.ok(simRes.accountEmail);

  // Mock fetchImpl success
  const mockFetch = async (url) => {
    if (url.includes('get_current_account')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          account_id: 'dbid:AAAH4x-fake',
          email: 'test-user@example.com',
          name: { display_name: 'Test Dropbox User' },
        }),
      };
    }
    if (url.includes('get_space_usage')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          used: 52428800,
          allocation: { allocated: 2147483648 },
        }),
      };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  const realRes = await testDropboxConnection({
    accessToken: 'test-token',
    fetchImpl: mockFetch,
    folderPath: '/CustomVault',
  });
  assert.equal(realRes.ok, true);
  assert.equal(realRes.accountEmail, 'test-user@example.com');
  assert.equal(realRes.displayName, 'Test Dropbox User');
  assert.equal(realRes.usedBytes, 52428800);
  assert.equal(realRes.allocatedBytes, 2147483648);
  assert.equal(realRes.folderPath, '/CustomVault');

  // Error handling
  const failingFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Invalid OAuth token',
  });
  await assert.rejects(
    () => testDropboxConnection({ accessToken: 'bad-token', fetchImpl: failingFetch }),
    /Dropbox account check failed \(401\)/
  );
});

test('uploadCapsuleToDropbox: verifies content_hash and rejects mismatch', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dropbox-test-'));
  const testFile = path.join(tmpDir, 'manifest.json');
  fs.writeFileSync(testFile, JSON.stringify({ capsuleId: 'test-capsule', version: '0.4.1' }), 'utf8');
  const expectedHash = computeDropboxContentHash(testFile);

  // 1. Simulated upload
  const simUpload = await uploadCapsuleToDropbox(tmpDir, { simulate: true });
  assert.equal(simUpload.verified, true);
  assert.equal(simUpload.mode, 'dropbox-api');
  assert.equal(simUpload.contentHashes['manifest.json'], expectedHash);

  // 2. Successful mock upload
  const mockSuccessFetch = async (url) => {
    if (url.includes('files/upload')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'manifest.json',
          path_display: '/Portabase/test-capsule/manifest.json',
          content_hash: expectedHash,
          size: 100,
        }),
      };
    }
    return { ok: false, status: 400 };
  };

  const successRes = await uploadCapsuleToDropbox(tmpDir, {
    accessToken: 'valid-token',
    fetchImpl: mockSuccessFetch,
  });
  assert.equal(successRes.verified, true);
  assert.equal(successRes.contentHashes['manifest.json'], expectedHash);

  // 3. Mismatched content_hash rejection
  const mockMismatchFetch = async (url) => {
    if (url.includes('files/upload')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'manifest.json',
          path_display: '/Portabase/test-capsule/manifest.json',
          content_hash: '0000000000000000000000000000000000000000000000000000000000000000',
          size: 100,
        }),
      };
    }
    return { ok: false, status: 400 };
  };

  await assert.rejects(
    () => uploadCapsuleToDropbox(tmpDir, { accessToken: 'valid-token', fetchImpl: mockMismatchFetch }),
    /Dropbox content_hash mismatch/
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('testGoogleDriveConnection: simulated and mock fetchImpl', async () => {
  // Simulated connection
  const simRes = await testGoogleDriveConnection({ simulate: true });
  assert.equal(simRes.ok, true);
  assert.equal(simRes.provider, 'google-drive');
  assert.equal(simRes.simulated, true);
  assert.ok(simRes.accountEmail);

  // Mock fetchImpl success
  const mockFetch = async (url) => {
    if (url.includes('about')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          user: {
            emailAddress: 'drive-tester@gmail.com',
            displayName: 'Google Drive Tester',
          },
          storageQuota: {
            usage: '1073741824',
            limit: '16106127360',
          },
        }),
      };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  const realRes = await testGoogleDriveConnection({
    accessToken: 'test-token',
    fetchImpl: mockFetch,
    folderPath: 'MyBackups',
  });
  assert.equal(realRes.ok, true);
  assert.equal(realRes.accountEmail, 'drive-tester@gmail.com');
  assert.equal(realRes.displayName, 'Google Drive Tester');
  assert.equal(realRes.usedBytes, 1073741824);
  assert.equal(realRes.allocatedBytes, 16106127360);
  assert.equal(realRes.folderPath, 'MyBackups');

  // Error handling
  const failingFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Invalid Credentials',
  });
  await assert.rejects(
    () => testGoogleDriveConnection({ accessToken: 'bad-token', fetchImpl: failingFetch }),
    /Google Drive about check failed \(401\)/
  );
});

test('uploadCapsuleToGoogleDrive: folder creation and sha256Checksum verification', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-gdrive-test-'));
  const testFile = path.join(tmpDir, 'manifest.json');
  fs.writeFileSync(testFile, JSON.stringify({ capsuleId: 'test-capsule', gdrive: true }), 'utf8');
  const expectedSha256 = computeSha256(testFile);

  // 1. Simulated upload
  const simUpload = await uploadCapsuleToGoogleDrive(tmpDir, { simulate: true });
  assert.equal(simUpload.verified, true);
  assert.equal(simUpload.mode, 'google-drive-api');
  assert.equal(simUpload.sha256Checksums['manifest.json'], expectedSha256);

  // 2. Successful mock upload
  const mockSuccessFetch = async (url, opts = {}) => {
    if (url.includes('/drive/v3/files?q=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ id: 'mock-folder-id', name: 'Portabase' }] }),
      };
    }
    if (url.endsWith('/drive/v3/files') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'mock-subfolder-id' }),
      };
    }
    if (url.includes('upload/drive/v3/files')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'file-123',
          name: 'manifest.json',
          size: '100',
          sha256Checksum: expectedSha256,
        }),
      };
    }
    return { ok: false, status: 400 };
  };

  const successRes = await uploadCapsuleToGoogleDrive(tmpDir, {
    accessToken: 'valid-token',
    fetchImpl: mockSuccessFetch,
  });
  assert.equal(successRes.verified, true);
  assert.equal(successRes.sha256Checksums['manifest.json'], expectedSha256);

  // 3. Mismatched sha256Checksum rejection
  const mockMismatchFetch = async (url, opts = {}) => {
    if (url.includes('/drive/v3/files?q=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ id: 'mock-folder-id' }] }),
      };
    }
    if (url.endsWith('/drive/v3/files') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'mock-subfolder-id' }),
      };
    }
    if (url.includes('upload/drive/v3/files')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'file-123',
          name: 'manifest.json',
          size: '100',
          sha256Checksum: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        }),
      };
    }
    return { ok: false, status: 400 };
  };

  await assert.rejects(
    () => uploadCapsuleToGoogleDrive(tmpDir, { accessToken: 'valid-token', fetchImpl: mockMismatchFetch }),
    /Google Drive sha256Checksum mismatch/
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('cloud-storage-connectors netlify function handler', async () => {
  // 1. OPTIONS CORS check
  const optRes = await storageConnectorsHandler({ httpMethod: 'OPTIONS' });
  assert.equal(optRes.statusCode, 204);

  // 2. GET returns connector catalog
  const getRes = await storageConnectorsHandler({ httpMethod: 'GET' });
  assert.equal(getRes.statusCode, 200);
  const getData = JSON.parse(getRes.body);
  assert.equal(getData.ok, true);
  assert.ok(getData.connectors.dropbox);
  assert.ok(getData.connectors['google-drive']);
  assert.deepEqual(getData.connectors.dropbox.modes, ['direct-api', 'rclone']);
  assert.deepEqual(getData.connectors['google-drive'].modes, ['direct-api', 'rclone']);

  // 3. POST action=test (simulated) for Dropbox
  const postTestDropbox = await storageConnectorsHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      action: 'test',
      provider: 'dropbox',
      simulate: true,
    }),
  });
  assert.equal(postTestDropbox.statusCode, 200);
  const testDropboxData = JSON.parse(postTestDropbox.body);
  assert.equal(testDropboxData.ok, true);
  assert.equal(testDropboxData.simulated, true);
  assert.equal(testDropboxData.provider, 'dropbox');
  assert.ok(testDropboxData.verifiedHash);

  // 4. POST action=test (simulated) for Google Drive
  const postTestGDrive = await storageConnectorsHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      action: 'test',
      provider: 'google-drive',
      simulate: true,
    }),
  });
  assert.equal(postTestGDrive.statusCode, 200);
  const testGDriveData = JSON.parse(postTestGDrive.body);
  assert.equal(testGDriveData.ok, true);
  assert.equal(testGDriveData.simulated, true);
  assert.equal(testGDriveData.provider, 'google-drive');
  assert.ok(testGDriveData.verifiedHash);

  // 5. POST action=upload-capsule (simulated)
  const postUpload = await storageConnectorsHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      action: 'upload-capsule',
      provider: 'dropbox',
      simulate: true,
    }),
  });
  assert.equal(postUpload.statusCode, 200);
  const uploadData = JSON.parse(postUpload.body);
  assert.equal(uploadData.ok, true);
  assert.equal(uploadData.verified, true);
  assert.ok(uploadData.destination.startsWith('dropbox:'));

  // 6. Unknown action returns 400
  const badActionRes = await storageConnectorsHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'non-existent' }),
  });
  assert.equal(badActionRes.statusCode, 400);
});
