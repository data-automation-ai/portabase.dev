import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {request as httpRequest} from 'node:http';
async function streamedHash(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}

const ATTESTATION_SOCKET='/run/container_launcher/teeserver.sock';
// localhost is the logical HTTP authority; transport is exclusively the
// Confidential Space launcher's Unix socket, never TCP port 80.
export function s3AttestationFetch(_url,options,{request=httpRequest}={}) {
  return new Promise((resolve,reject)=>{
    const fail=()=>reject(Error('s3_attestation_unavailable'));
    const req=request({socketPath:ATTESTATION_SOCKET,path:'/v1/token',method:'POST',headers:{'content-type':'application/json'}},res=>{
      let raw='';res.setEncoding('utf8');
      res.on('data',chunk=>{raw+=chunk;if(raw.length>100000)req.destroy(Error('s3_attestation_unavailable'));});
      res.on('end',()=>resolve({ok:res.statusCode===200,text:async()=>raw}));
      res.on('error',fail);res.on('aborted',fail);
    });
    req.setTimeout(10000,()=>req.destroy(Error('s3_attestation_unavailable')));
    req.on('error',fail);req.end(options.body);
  });
}

const roleSessions=new Map();
export function s3RoleAudience(owner){
  if(!/^[a-f0-9]{64}$/.test(owner||''))throw Error('invalid_s3_owner');
  return `https://portabase.dev/vault/${owner}`;
}
export async function resolveS3Credentials(opts={}) {
  if(!opts.roleArn)return opts;
  if(!/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/.test(opts.roleArn))throw Error('invalid_s3_role');
  if(!/^https:\/\/portabase\.dev\/vault\/[a-f0-9]{64}$/.test(opts.roleAudience||''))throw Error('s3_owner_audience_required');
  if(opts.endpoint)throw Error('invalid_s3_endpoint');
  if(!opts.attestationFetch&&!fs.existsSync(ATTESTATION_SOCKET))throw Error('s3_role_requires_confidential_runner');
  const cacheKey=opts.roleArn+'|'+opts.roleAudience,cached=roleSessions.get(cacheKey);
  if(cached&&cached.expiresAt>Date.now()+5*60_000)return {...opts,...cached.credentials};
  const attestationFetch=opts.attestationFetch||s3AttestationFetch;
  const tokenResponse=await attestationFetch('http://localhost/v1/token',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({audience:opts.roleAudience,token_type:'AWS_PRINCIPALTAGS'})});
  if(!tokenResponse.ok)throw Error('s3_attestation_unavailable');
  const token=(await tokenResponse.text()).trim();
  if(!token||token.length>100_000)throw Error('s3_attestation_invalid');
  const stsFetch=opts.stsFetch||globalThis.fetch;
  const body=new URLSearchParams({Action:'AssumeRoleWithWebIdentity',Version:'2011-06-15',RoleArn:opts.roleArn,
    RoleSessionName:'portabase-capsule-'+Date.now(),WebIdentityToken:token});
  const response=await stsFetch('https://sts.amazonaws.com/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('s3_attested_role_denied');
  const xml=await response.text();
  const field=name=>xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];
  const credentials={accessKeyId:field('AccessKeyId'),secretAccessKey:field('SecretAccessKey'),sessionToken:field('SessionToken')};
  const expiresAt=Date.parse(field('Expiration')||'');
  if(Object.values(credentials).some(value=>!value)||!Number.isFinite(expiresAt))throw Error('s3_role_response_invalid');
  roleSessions.set(cacheKey,{credentials,expiresAt});
  return {...opts,...credentials};
}

export function signS3Request({ method, url, body = Buffer.alloc(0), bodyHash, accessKeyId, secretAccessKey, sessionToken, region = 'us-east-1' }) {
  const parsed = new URL(url);
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  if(bodyHash!==undefined&&!/^[a-f0-9]{64}$/.test(bodyHash))throw Error('invalid_s3_payload_hash');
  const payloadHash = bodyHash||crypto.createHash('sha256').update(body).digest('hex');
  const headers = {
    host: parsed.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;
  const headerKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = headerKeys.map(k => `${k}:${headers[k] || headers[Object.keys(headers).find(h => h.toLowerCase() === k)]}\n`).join('');
  const signedHeaders = headerKeys.join(';');
  const params = new URLSearchParams(parsed.search);
  const paramKeys = Array.from(new Set(params.keys())).sort();
  const canonicalQuery = paramKeys.map(k => {
    return params.getAll(k).sort().map(v => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }).filter(Boolean).join('&');
  const canonicalUri = parsed.pathname || '/';
  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

export function buildS3Url(opts, pathAndQuery = '') {
  const bucket = opts.bucket;
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket||'')||bucket.includes('..'))throw Error('invalid_s3_bucket');
  const region = opts.region || 'us-east-1';
  const endpoint = opts.endpoint;
  const cleanPath = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  if (endpoint) {
    if(opts.roleArn||!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint))throw Error('invalid_s3_endpoint');
    const u = new URL(endpoint);
    return `${u.origin.replace(/\/+$/, '')}/${bucket}${cleanPath}`;
  }
  if(!/^(?:us|eu|ap|sa|ca|me|af|il|mx)-(?:[a-z]+-)+\d$/.test(region))throw Error('invalid_s3_region');
  return `https://${bucket}.s3.${region}.amazonaws.com${cleanPath}`;
}

export async function testS3Connection(opts = {}) {
  if (!opts.bucket || (!opts.roleArn&&(!opts.accessKeyId || !opts.secretAccessKey))) throw new Error('missing_s3_credentials');
  const region = opts.region || 'us-east-1';
  const prefix = opts.prefix ? opts.prefix.replace(/^\/+|\/+$/g, '') : 'Portabase';
  if (opts.simulate === true) return { ok: true, bucket: opts.bucket, region, prefix, simulated: true };
  opts=await resolveS3Credentials(opts);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const url = buildS3Url(opts, `/?list-type=2&max-keys=1&prefix=${encodeURIComponent(prefix + '/')}`);
  const headers = signS3Request({ method: 'GET', url, ...opts });
  const res = await fetchImpl(url, { method: 'GET', headers, redirect:'error' });
  if (!res.ok) throw new Error(`S3 connection test failed (${res.status}): ${await res.text()}`);
  return { ok: true, bucket: opts.bucket, region, prefix };
}

export async function uploadCapsuleToS3(capsuleDir, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const capsuleId = path.basename(capsuleDir);
  const prefix = (opts.prefix || 'Portabase').replace(/^\/+|\/+$/g, '');
  const files = fs.readdirSync(capsuleDir).filter(n => !n.startsWith('.') && fs.statSync(path.join(capsuleDir, n)).isFile());
  if (files.length === 0) throw new Error(`Capsule directory is empty: ${capsuleDir}`);
  const destination = `${opts.type==='r2'?'r2':'s3'}://${opts.bucket}/${prefix}/${capsuleId}`;
  if (opts.simulate === true) {
    const filesUploaded = files.map(name => ({ name, key: `${prefix}/${capsuleId}/${name}`, verified: true }));
    return { destination, verified: true, mode: 's3-api', simulated: true, filesUploaded, sha256Checksums: {} };
  }
  const fileEntries = files.map(name => ({ name, file:path.join(capsuleDir,name), size:fs.statSync(path.join(capsuleDir,name)).size }));
  const totalBytes = fileEntries.reduce((sum, f) => sum + f.size, 0);
  let bytesReceived = 0;
  const filesUploaded = [], sha256Checksums = {};
  for (const { name, file, size } of fileEntries) {
    const signedOpts=await resolveS3Credentials(opts);
    const hash = await streamedHash(file);
    const s3Key = `${prefix}/${capsuleId}/${name}`;
    const url = buildS3Url(opts, `/${encodeURI(s3Key)}`);
    const headers = signS3Request({ method: 'PUT', url, bodyHash:hash, ...signedOpts });
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Length']=String(size);
    const body=size<=8*1024*1024?await fs.promises.readFile(file):fs.createReadStream(file);
    const res = await fetchImpl(url, { method: 'PUT', headers, body, redirect:'error', ...(Buffer.isBuffer(body)?{}:{duplex:'half'}) });
    if (!res.ok) throw new Error(`S3 upload failed for ${name} (${res.status}): ${await res.text()}`);
    const readHeaders = signS3Request({ method: 'GET', url, ...await resolveS3Credentials(opts) });
    const readback = await fetchImpl(url, { method: 'GET', headers: readHeaders, redirect:'error' });
    if (!readback.ok) throw new Error(`S3 readback failed for ${name} (${readback.status})`);
    const remoteHash=crypto.createHash('sha256');let remoteSize=0;
    if(readback.body){for await(const chunk of readback.body){remoteSize+=chunk.length;if(remoteSize>size)throw Error('s3_readback_size_mismatch');remoteHash.update(chunk);}}
    else{const remote=Buffer.from(await readback.arrayBuffer());remoteSize=remote.length;remoteHash.update(remote);}
    if (remoteSize !== size || remoteHash.digest('hex') !== hash)
      throw new Error(`S3 readback checksum mismatch for ${name}`);
    bytesReceived += size;
    opts.onProgress?.({ bytesReceived, totalBytes, verifiedBytes: bytesReceived });
    filesUploaded.push({ name, key: s3Key, size, sha256: hash, verified: true });
    sha256Checksums[name] = hash;
  }
  return { destination, verified: true, mode: 's3-api', filesUploaded, sha256Checksums };
}

export async function verifyS3Capsule(capsuleId, opts = {}) {
  const prefix = (opts.prefix || 'Portabase').replace(/^\/+|\/+$/g, '');
  const destination = `${opts.type==='r2'?'r2':'s3'}://${opts.bucket}/${prefix}/${capsuleId}`;
  if (opts.simulate === true) return { verified: true, destination };
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const keyPrefix = `${prefix}/${capsuleId}/`;
  const url = buildS3Url(opts, `/?list-type=2&prefix=${encodeURIComponent(keyPrefix)}`);
  const headers = signS3Request({ method: 'GET', url, ...await resolveS3Credentials(opts) });
  const res = await fetchImpl(url, { method: 'GET', headers, redirect:'error' });
  if (!res.ok) return { verified: false, error: `S3 list failed (${res.status})` };
  const text = await res.text();
  const keys = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
  const hasPbase = keys.some(k => k.endsWith('/capsule.pbase') || k === 'capsule.pbase');
  const hasJson = keys.some(k => k.endsWith('/capsule.json') || k === 'capsule.json');
  return { verified: hasPbase && hasJson, destination };
}

export async function listS3Capsules(opts = {}) {
  const prefix = (opts.prefix || 'Portabase').replace(/^\/+|\/+$/g, '');
  if (opts.simulate === true) return [{ id: 'sim-capsule', name: 'sim-capsule', path: `s3://${opts.bucket}/${prefix}/sim-capsule` }];
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const folderPrefix = prefix ? `${prefix}/` : '';
  const url = buildS3Url(opts, `/?list-type=2&delimiter=%2F&prefix=${encodeURIComponent(folderPrefix)}`);
  const headers = signS3Request({ method: 'GET', url, ...await resolveS3Credentials(opts) });
  const res = await fetchImpl(url, { method: 'GET', headers, redirect:'error' });
  if (!res.ok) return [];
  const text = await res.text();
  const prefixes = [...text.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/gi)].map(m => m[1]);
  return prefixes.map(p => {
    const id = p.replace(/\/+$/, '').split('/').pop();
    return { id, name: id, path: `${opts.type==='r2'?'r2':'s3'}://${opts.bucket}/${p}` };
  }).filter(c => c.id && !c.id.startsWith('.') && c.id !== prefix).sort((a, b) => b.id.localeCompare(a.id));
}

export async function downloadCapsuleFromS3(capsuleId, targetDir, opts = {}) {
  const prefix = (opts.prefix || 'Portabase').replace(/^\/+|\/+$/g, '');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const keyPrefix = `${prefix}/${capsuleId}/`;
  const url = buildS3Url(opts, `/?list-type=2&prefix=${encodeURIComponent(keyPrefix)}`);
  const headers = signS3Request({ method: 'GET', url, ...await resolveS3Credentials(opts) });
  const res = await fetchImpl(url, { method: 'GET', headers, redirect:'error' });
  if (!res.ok) throw new Error(`S3 list failed (${res.status}): ${await res.text()}`);
  const text = await res.text();
  const keys = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
  if (keys.length === 0) throw new Error(`Capsule ${capsuleId} not found in S3`);
  await fs.promises.mkdir(targetDir, { recursive: true });
  for (const key of keys) {
    const filename = path.basename(key);
    const fileUrl = buildS3Url(opts, `/${encodeURI(key)}`);
    const fileHeaders = signS3Request({ method: 'GET', url: fileUrl, ...await resolveS3Credentials(opts) });
    const fileRes = await fetchImpl(fileUrl, { method: 'GET', headers: fileHeaders, redirect:'error' });
    if (!fileRes.ok) throw new Error(`S3 download failed for ${key} (${fileRes.status})`);
    if(fileRes.body)await pipeline(Readable.fromWeb(fileRes.body),fs.createWriteStream(path.join(targetDir,filename),{flags:'wx',mode:0o600}));
    else await fs.promises.writeFile(path.join(targetDir,filename),Buffer.from(await fileRes.arrayBuffer()),{flag:'wx',mode:0o600});
  }
  const checksumPath = path.join(targetDir, 'checksums.sha256');
  if (fs.existsSync(checksumPath)) {
    const lines = (await fs.promises.readFile(checksumPath, 'utf8')).split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (match) {
        const [, expected, fName] = match;
        const filePath = path.join(targetDir, fName.trim());
        if (!fs.existsSync(filePath)) throw new Error(`Checksum verification failed: missing file ${fName}`);
        const actual = await streamedHash(filePath);
        if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Checksum mismatch on ${fName}: expected ${expected}, got ${actual}`);
      }
    }
  }
  return { downloaded: true, files: keys.map(k => path.basename(k)) };
}

export function ownedS3Configuration(profile){
    if(profile.s3?.endpoint)throw Error('invalid_s3_endpoint');
    const config=Object.fromEntries(['bucket','region','prefix','roleArn','accessKeyId','secretAccessKey'].filter(key=>profile.s3?.[key]!==undefined).map(key=>[key,profile.s3[key]]));
    if(config.roleArn)config.roleAudience=s3RoleAudience(profile.owner);
    return config;
}
export function s3Vault({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return {
    async connect(profile, input = {}) {
      if (!input.bucket || (!input.roleArn&&(!input.accessKeyId || !input.secretAccessKey))) throw new Error('missing_s3_credentials');
      const region = input.region || 'us-east-1';
      const prefix = input.prefix || 'Portabase';
      if(input.endpoint)throw Error('invalid_s3_endpoint');
      const config={bucket:input.bucket,region,prefix,roleArn:input.roleArn,accessKeyId:input.accessKeyId,secretAccessKey:input.secretAccessKey};
      await testS3Connection({...config,...(input.roleArn?{roleAudience:s3RoleAudience(profile.owner)}:{}),fetchImpl});
      profile.s3 = config;
      profile.activeVault = 's3';
      return { connected: true, bucket: input.bucket, region, prefix };
    },
    async provider(profile) {
      if (!profile.s3?.bucket || (!profile.s3?.roleArn&&(!profile.s3?.accessKeyId || !profile.s3?.secretAccessKey))) throw new Error('s3_not_connected');
      const config=ownedS3Configuration(profile);await testS3Connection({ ...config, fetchImpl });
      return { type: 's3', mode: 'api', ...config };
    },
    async capsules(profile) {
      if (!profile.s3?.bucket) return [];
      return await listS3Capsules({ ...ownedS3Configuration(profile), fetchImpl });
    },
  };
}
