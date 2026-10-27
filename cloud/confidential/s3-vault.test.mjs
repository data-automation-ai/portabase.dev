import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  signS3Request,
  testS3Connection,
  uploadCapsuleToS3,
  verifyS3Capsule,
  listS3Capsules,
  downloadCapsuleFromS3,
  s3Vault,
} from './s3-vault.mjs';

test('signS3Request generates valid AWS SigV4 authorization header', () => {
  const headers = signS3Request({
    method: 'GET',
    url: 'https://test-bucket.s3.us-east-1.amazonaws.com/?list-type=2&max-keys=1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
  });
  assert.ok(headers.Authorization.startsWith('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/'));
  assert.ok(headers.Authorization.includes('SignedHeaders=host;x-amz-content-sha256;x-amz-date'));
  assert.ok(headers.Authorization.includes('Signature='));
  assert.equal(headers['x-amz-content-sha256'], crypto.createHash('sha256').update('').digest('hex'));
});

test('testS3Connection validates credentials and calls S3 API', async () => {
  await assert.rejects(testS3Connection({}), /missing_s3_credentials/);

  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => '<ListBucketResult></ListBucketResult>' };
  };

  const res = await testS3Connection({
    bucket: 'my-capsule-bucket',
    region: 'eu-central-1',
    accessKeyId: 'AKIA123',
    secretAccessKey: 'sec123',
    fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(res.bucket, 'my-capsule-bucket');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('list-type=2'));
  assert.ok(calls[0].options.headers.Authorization.includes('AKIA123'));
});

test('uploadCapsuleToS3 uploads files with SHA-256 payload verification', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 's3-upload-test-'));
  try {
    await fs.promises.writeFile(path.join(tmpDir, 'capsule.json'), '{"version":1}');
    await fs.promises.writeFile(path.join(tmpDir, 'capsule.pbase'), 'encrypted-payload-data');

    const uploaded = [];
    let progressReported = null;
    const fetchImpl = async (url, options) => {
      uploaded.push({ url, headers: options.headers, body: options.body });
      return { ok: true, text: async () => '' };
    };

    const res = await uploadCapsuleToS3(tmpDir, {
      bucket: 'my-capsule-bucket',
      accessKeyId: 'AKIA123',
      secretAccessKey: 'sec123',
      onProgress: p => { progressReported = p; },
      fetchImpl,
    });

    assert.equal(res.verified, true);
    assert.equal(res.mode, 's3-api');
    assert.equal(uploaded.length, 2);
    assert.ok(progressReported);
    assert.equal(progressReported.bytesReceived, progressReported.totalBytes);

    // Each upload had x-amz-content-sha256 matching body hash
    for (const item of uploaded) {
      const expectedSha = crypto.createHash('sha256').update(item.body).digest('hex');
      assert.equal(item.headers['x-amz-content-sha256'], expectedSha);
    }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

test('verifyS3Capsule checks existence of capsule.pbase and capsule.json', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => `
      <ListBucketResult>
        <Contents><Key>Portabase/capsule-1/capsule.json</Key></Contents>
        <Contents><Key>Portabase/capsule-1/capsule.pbase</Key></Contents>
      </ListBucketResult>
    `,
  });

  const res = await verifyS3Capsule('capsule-1', {
    bucket: 'my-bucket',
    accessKeyId: 'AKIA123',
    secretAccessKey: 'sec123',
    fetchImpl,
  });
  assert.equal(res.verified, true);

  const missingFetch = async () => ({
    ok: true,
    text: async () => `<ListBucketResult><Contents><Key>Portabase/capsule-1/capsule.json</Key></Contents></ListBucketResult>`,
  });
  const missingRes = await verifyS3Capsule('capsule-1', {
    bucket: 'my-bucket',
    accessKeyId: 'AKIA123',
    secretAccessKey: 'sec123',
    fetchImpl: missingFetch,
  });
  assert.equal(missingRes.verified, false);
});

test('listS3Capsules parses XML common prefixes and returns newest first', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => `
      <ListBucketResult>
        <CommonPrefixes><Prefix>Portabase/2026-10-25T10-00-00Z/</Prefix></CommonPrefixes>
        <CommonPrefixes><Prefix>Portabase/2026-10-27T12-00-00Z/</Prefix></CommonPrefixes>
        <CommonPrefixes><Prefix>Portabase/2026-10-26T11-00-00Z/</Prefix></CommonPrefixes>
      </ListBucketResult>
    `,
  });

  const list = await listS3Capsules({
    bucket: 'my-bucket',
    accessKeyId: 'AKIA123',
    secretAccessKey: 'sec123',
    fetchImpl,
  });
  assert.equal(list.length, 3);
  assert.equal(list[0].id, '2026-10-27T12-00-00Z');
  assert.equal(list[1].id, '2026-10-26T11-00-00Z');
  assert.equal(list[2].id, '2026-10-25T10-00-00Z');
});

test('downloadCapsuleFromS3 downloads and cryptographically verifies checksums.sha256', async () => {
  const targetDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 's3-download-test-'));
  try {
    const jsonContent = '{"version":1}';
    const jsonSha = crypto.createHash('sha256').update(jsonContent).digest('hex');
    const checksumContent = `${jsonSha}  capsule.json\n`;

    const fetchImpl = async url => {
      if (url.includes('list-type=2')) {
        return {
          ok: true,
          text: async () => `
            <ListBucketResult>
              <Contents><Key>Portabase/capsule-1/capsule.json</Key></Contents>
              <Contents><Key>Portabase/capsule-1/checksums.sha256</Key></Contents>
            </ListBucketResult>
          `,
        };
      }
      if (url.endsWith('capsule.json')) {
        return { ok: true, arrayBuffer: async () => Buffer.from(jsonContent) };
      }
      if (url.endsWith('checksums.sha256')) {
        return { ok: true, arrayBuffer: async () => Buffer.from(checksumContent) };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const res = await downloadCapsuleFromS3('capsule-1', targetDir, {
      bucket: 'my-bucket',
      accessKeyId: 'AKIA123',
      secretAccessKey: 'sec123',
      fetchImpl,
    });
    assert.equal(res.downloaded, true);
    assert.equal(fs.readFileSync(path.join(targetDir, 'capsule.json'), 'utf8'), jsonContent);
  } finally {
    await fs.promises.rm(targetDir, { recursive: true, force: true });
  }
});

test('s3Vault manages enclave profile connection and provider configuration', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => '<ListBucketResult></ListBucketResult>',
  });
  const vault = s3Vault({ fetchImpl });
  const profile = {};

  const connected = await vault.connect(profile, {
    bucket: 'vault-bucket',
    region: 'us-west-2',
    accessKeyId: 'AKIA_KEY',
    secretAccessKey: 'SECRET_KEY',
  });
  assert.equal(connected.connected, true);
  assert.equal(profile.activeVault, 's3');
  assert.equal(profile.s3.bucket, 'vault-bucket');

  const prov = await vault.provider(profile);
  assert.equal(prov.type, 's3');
  assert.equal(prov.mode, 'api');
  assert.equal(prov.bucket, 'vault-bucket');
});
