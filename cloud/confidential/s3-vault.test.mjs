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
  resolveS3Credentials,
  s3AttestationFetch,
  buildS3Url,
  s3RoleAudience,
  ownedS3Configuration,
} from './s3-vault.mjs';

test('S3 attestation uses launcher Unix socket with bounded failures, never TCP',async()=>{
  const {EventEmitter}=await import('node:events');
  for(const mode of ['success','denied','oversize','timeout']){
    let requestOptions,body,timeout;
    const request=(options,callback)=>{
      requestOptions=options;const req=new EventEmitter();
      req.setTimeout=(ms,handler)=>{assert.equal(ms,10000);timeout=handler;};
      req.destroy=error=>req.emit('error',error);
      req.end=value=>{body=JSON.parse(value);queueMicrotask(()=>{
        if(mode==='timeout'){timeout();return;}
        const res=new EventEmitter();res.statusCode=mode==='denied'?403:200;res.setEncoding=()=>{};
        callback(res);res.emit('data',mode==='oversize'?'x'.repeat(100001):'signed-token');res.emit('end');
      });};return req;
    };
    const pending=s3AttestationFetch('http://localhost/v1/token',{body:JSON.stringify({audience:'https://portabase.dev',token_type:'AWS_PRINCIPALTAGS'})},{request});
    if(['oversize','timeout'].includes(mode))await assert.rejects(pending,/attestation_unavailable/);
    else{const response=await pending;assert.equal(response.ok,mode==='success');assert.equal(await response.text(),'signed-token');}
    assert.equal(requestOptions.socketPath,'/run/container_launcher/teeserver.sock');assert.equal(requestOptions.path,'/v1/token');
    assert.equal(requestOptions.hostname,undefined);assert.equal(body.token_type,'AWS_PRINCIPALTAGS');
  }
});

test('attested S3 role resolves short-lived credentials without customer keys', async()=>{
  const roleArn='arn:aws:iam::123456789012:role/test-capsule-vault';
  const calls=[];
  const roleAudience=s3RoleAudience('a'.repeat(64));
  const result=await resolveS3Credentials({roleArn,roleAudience,
    attestationFetch:async(url,request)=>{calls.push([url,JSON.parse(request.body)]);return {ok:true,text:async()=> 'signed-attestation-token'};},
    stsFetch:async(url,request)=>{calls.push([url,new URLSearchParams(request.body).get('RoleArn')]);return {ok:true,text:async()=>`<Credentials><AccessKeyId>temporary-id</AccessKeyId><SecretAccessKey>temporary-secret</SecretAccessKey><SessionToken>temporary-session</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials>`};}});
  assert.equal(result.accessKeyId,'temporary-id');
  assert.equal(result.sessionToken,'temporary-session');
  assert.deepEqual(calls[0],["http://localhost/v1/token",{audience:roleAudience,token_type:'AWS_PRINCIPALTAGS'}]);
  assert.deepEqual(calls[1],['https://sts.amazonaws.com/',roleArn]);
});

test('role credentials cannot be reused by another owner and endpoint substitutions are rejected',async()=>{
  const roleArn='arn:aws:iam::123456789012:role/test-capsule-vault';
  const configured=ownedS3Configuration({owner:'b'.repeat(64),s3:{bucket:'fixture',roleArn,roleAudience:s3RoleAudience('a'.repeat(64)),owner:'a'.repeat(64)}});
  assert.equal(configured.roleAudience,s3RoleAudience('b'.repeat(64)));assert.equal(configured.owner,undefined);
  let denied=false;
  await assert.rejects(resolveS3Credentials({roleArn,roleAudience:s3RoleAudience('b'.repeat(64)),
    attestationFetch:async(_url,request)=>{assert.equal(JSON.parse(request.body).audience,s3RoleAudience('b'.repeat(64)));return {ok:true,text:async()=>'other-owner-token'};},
    stsFetch:async()=>{denied=true;return {ok:false};}}),/attested_role_denied/);
  assert.equal(denied,true); // Must not return the first owner's cached session.
  for(const endpoint of ['http://127.0.0.1','https://attacker.example','https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com']){
    await assert.rejects(s3Vault().connect({owner:'a'.repeat(64)},{bucket:'fixture',roleArn,endpoint}),/invalid_s3_endpoint/);
    assert.throws(()=>buildS3Url({bucket:'fixture',roleArn,endpoint}),/invalid_s3_endpoint/);
  }
  assert.throws(()=>buildS3Url({bucket:'fixture',region:'us-east-1.attacker.example'}),/invalid_s3_region/);
  assert.throws(()=>buildS3Url({bucket:'fixture@attacker.example'}),/invalid_s3_bucket/);
});

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

test('S3 connection probe stays within the capsule prefix IAM wildcard',async()=>{
  for(const prefix of ['Portabase/capsules','/Portabase/capsules/']){
    const result=await testS3Connection({bucket:'fixture',prefix,accessKeyId:'fixture',secretAccessKey:'fixture',
      fetchImpl:async(url,options)=>{
        const query=new URL(url).searchParams;
        // Mirrors an IAM ListBucket condition restricted to Portabase/capsules/*.
        assert.equal(query.get('prefix'),'Portabase/capsules/');
        assert.equal(query.get('max-keys'),'1');assert.equal(options.redirect,'error');
        return {ok:query.get('prefix').startsWith('Portabase/capsules/'),text:async()=>'<ListBucketResult/>'};
      }});
    assert.equal(result.ok,true);
  }
});

test('uploadCapsuleToS3 uploads files with SHA-256 payload verification', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 's3-upload-test-'));
  try {
    await fs.promises.writeFile(path.join(tmpDir, 'capsule.json'), '{"version":1}');
    await fs.promises.writeFile(path.join(tmpDir, 'capsule.pbase'), 'encrypted-payload-data');

    const uploaded = [];
    const objects = new Map();
    let progressReported = null;
    const fetchImpl = async (url, options) => {
      if (options.method === 'GET') return { ok: true, arrayBuffer: async () => objects.get(url) };
      uploaded.push({ url, headers: options.headers, body: options.body });
      objects.set(url, options.body);
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

test('uploadCapsuleToS3 rejects a corrupted remote readback', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 's3-readback-test-'));
  try {
    await fs.promises.writeFile(path.join(tmpDir, 'capsule.pbase'), 'encrypted-payload-data');
    await assert.rejects(uploadCapsuleToS3(tmpDir, {
      bucket: 'my-capsule-bucket', accessKeyId: 'AKIA123', secretAccessKey: 'sec123',
      fetchImpl: async (_url, options) => options.method === 'GET'
        ? { ok: true, arrayBuffer: async () => Buffer.from('corrupted') }
        : { ok: true, text: async () => '' },
    }), /readback checksum mismatch/);
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
