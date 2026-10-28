import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const roleSessions=new Map();
export async function resolveS3Credentials(opts={}) {
  if(!opts.roleArn)return opts;
  if(!/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/.test(opts.roleArn))throw Error('invalid_s3_role');
  if(process.env.PORTABASE_CONFIDENTIAL_RUNNER!=='1'&&!opts.attestationFetch)throw Error('s3_role_requires_confidential_runner');
  const cached=roleSessions.get(opts.roleArn);
  if(cached&&cached.expiresAt>Date.now()+5*60_000)return {...opts,...cached.credentials};
  const attestationFetch=opts.attestationFetch||globalThis.fetch;
  const tokenResponse=await attestationFetch('http://localhost/v1/token',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({audience:'https://portabase.dev',token_type:'AWS_PRINCIPALTAGS'})});
  if(!tokenResponse.ok)throw Error('s3_attestation_unavailable');
  const token=(await tokenResponse.text()).trim();
  if(!token||token.length>100_000)throw Error('s3_attestation_invalid');
  const stsFetch=opts.stsFetch||globalThis.fetch;
  const body=new URLSearchParams({Action:'AssumeRoleWithWebIdentity',Version:'2011-06-15',RoleArn:opts.roleArn,
    RoleSessionName:'portabase-capsule-'+Date.now(),WebIdentityToken:token});
  const response=await stsFetch('https://sts.amazonaws.com/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!response.ok)throw Error('s3_attested_role_denied');
  const xml=await response.text();
  const field=name=>xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];
  const credentials={accessKeyId:field('AccessKeyId'),secretAccessKey:field('SecretAccessKey'),sessionToken:field('SessionToken')};
  const expiresAt=Date.parse(field('Expiration')||'');
  if(Object.values(credentials).some(value=>!value)||!Number.isFinite(expiresAt))throw Error('s3_role_response_invalid');
  roleSessions.set(opts.roleArn,{credentials,expiresAt});
  return {...opts,...credentials};
}

export function signS3Request({ method, url, body = Buffer.alloc(0), accessKeyId, secretAccessKey, sessionToken, region = 'us-east-1' }) {
  const parsed = new URL(url);
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
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
  const region = opts.region || 'us-east-1';
  const endpoint = opts.endpoint;
  const cleanPath = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  if (endpoint) {
    const base = endpoint.includes('://') ? endpoint : `https://${endpoint}`;
    const u = new URL(base);
    if (u.hostname.includes(bucket)) return `${u.origin}${cleanPath}`;
    return `${u.origin.replace(/\/+$/, '')}/${bucket}${cleanPath}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com${cleanPath}`;
}

export async function testS3Connection(opts = {}) {
  if (!opts.bucket || (!opts.roleArn&&(!opts.accessKeyId || !opts.secretAccessKey))) throw new Error('missing_s3_credentials');
  const region = opts.region || 'us-east-1';
  const prefix = opts.prefix ? opts.prefix.replace(/^\/+|\/+$/g, '') : 'Portabase';
  if (opts.simulate === true) return { ok: true, bucket: opts.bucket, region, prefix, simulated: true };
  opts=await resolveS3Credentials(opts);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const url = buildS3Url(opts, `/?list-type=2&max-keys=1&prefix=${encodeURIComponent(prefix)}`);
  const headers = signS3Request({ method: 'GET', url, ...opts });
  const res = await fetchImpl(url, { method: 'GET', headers });
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
  const fileBuffers = files.map(name => ({ name, buf: fs.readFileSync(path.join(capsuleDir, name)) }));
  const totalBytes = fileBuffers.reduce((sum, f) => sum + f.buf.length, 0);
  let bytesReceived = 0;
  const filesUploaded = [], sha256Checksums = {};
  for (const { name, buf } of fileBuffers) {
    const signedOpts=await resolveS3Credentials(opts);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const s3Key = `${prefix}/${capsuleId}/${name}`;
    const url = buildS3Url(opts, `/${encodeURI(s3Key)}`);
    const headers = signS3Request({ method: 'PUT', url, body: buf, ...signedOpts });
    headers['Content-Type'] = 'application/octet-stream';
    const res = await fetchImpl(url, { method: 'PUT', headers, body: buf });
    if (!res.ok) throw new Error(`S3 upload failed for ${name} (${res.status}): ${await res.text()}`);
    const readHeaders = signS3Request({ method: 'GET', url, ...await resolveS3Credentials(opts) });
    const readback = await fetchImpl(url, { method: 'GET', headers: readHeaders });
    if (!readback.ok) throw new Error(`S3 readback failed for ${name} (${readback.status})`);
    const remote = Buffer.from(await readback.arrayBuffer());
    if (remote.length !== buf.length || crypto.createHash('sha256').update(remote).digest('hex') !== hash)
      throw new Error(`S3 readback checksum mismatch for ${name}`);
    bytesReceived += buf.length;
    opts.onProgress?.({ bytesReceived, totalBytes, verifiedBytes: bytesReceived });
    filesUploaded.push({ name, key: s3Key, size: buf.length, sha256: hash, verified: true });
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
  const res = await fetchImpl(url, { method: 'GET', headers });
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
  const res = await fetchImpl(url, { method: 'GET', headers });
  if (!res.ok) return [];
  const text = await res.text();
  const prefixes = [...text.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/gi)].map(m => m[1]);
  return prefixes.map(p => {
    const id = p.replace(/\/+$/, '').split('/').pop();
    return { id, name: id, path: `${opts.type==='r2'?'r2':'s3'}://${opts.bucket}/${p}` };
  }).filter(c => c.id && c.id !== prefix).sort((a, b) => b.id.localeCompare(a.id));
}

export async function downloadCapsuleFromS3(capsuleId, targetDir, opts = {}) {
  const prefix = (opts.prefix || 'Portabase').replace(/^\/+|\/+$/g, '');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const keyPrefix = `${prefix}/${capsuleId}/`;
  const url = buildS3Url(opts, `/?list-type=2&prefix=${encodeURIComponent(keyPrefix)}`);
  const headers = signS3Request({ method: 'GET', url, ...await resolveS3Credentials(opts) });
  const res = await fetchImpl(url, { method: 'GET', headers });
  if (!res.ok) throw new Error(`S3 list failed (${res.status}): ${await res.text()}`);
  const text = await res.text();
  const keys = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
  if (keys.length === 0) throw new Error(`Capsule ${capsuleId} not found in S3`);
  await fs.promises.mkdir(targetDir, { recursive: true });
  for (const key of keys) {
    const filename = path.basename(key);
    const fileUrl = buildS3Url(opts, `/${encodeURI(key)}`);
    const fileHeaders = signS3Request({ method: 'GET', url: fileUrl, ...await resolveS3Credentials(opts) });
    const fileRes = await fetchImpl(fileUrl, { method: 'GET', headers: fileHeaders });
    if (!fileRes.ok) throw new Error(`S3 download failed for ${key} (${fileRes.status})`);
    const buf = Buffer.from(await fileRes.arrayBuffer());
    await fs.promises.writeFile(path.join(targetDir, filename), buf);
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
        const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Checksum mismatch on ${fName}: expected ${expected}, got ${actual}`);
      }
    }
  }
  return { downloaded: true, files: keys.map(k => path.basename(k)) };
}

export function s3Vault({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return {
    async connect(profile, input = {}) {
      if (!input.bucket || (!input.roleArn&&(!input.accessKeyId || !input.secretAccessKey))) throw new Error('missing_s3_credentials');
      const region = input.region || 'us-east-1';
      const prefix = input.prefix || 'Portabase';
      const endpoint = input.endpoint || undefined;
      await testS3Connection({ bucket: input.bucket, region, prefix, endpoint, roleArn:input.roleArn,accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey, fetchImpl });
      profile.s3 = { bucket: input.bucket, region, prefix, endpoint, roleArn:input.roleArn,accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey };
      profile.activeVault = 's3';
      return { connected: true, bucket: input.bucket, region, prefix };
    },
    async provider(profile) {
      if (!profile.s3?.bucket || (!profile.s3?.roleArn&&(!profile.s3?.accessKeyId || !profile.s3?.secretAccessKey))) throw new Error('s3_not_connected');
      await testS3Connection({ ...profile.s3, fetchImpl });
      return { type: 's3', mode: 'api', ...profile.s3 };
    },
    async capsules(profile) {
      if (!profile.s3?.bucket) return [];
      return await listS3Capsules({ ...profile.s3, fetchImpl });
    },
  };
}
