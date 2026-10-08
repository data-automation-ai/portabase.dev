import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { containedPath, payloadStorage, verifyStoragePayloads } from './recovery-options.mjs';

export function parseStorageDestination(value, owner) {
  const match = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(value || '');
  if (!match || match[1].includes('..') || !/^\d{12}$/.test(owner || '')) {
    throw new Error('--storage-to-s3 requires s3://bucket/prefix and --s3-expected-owner <12-digit account ID>.');
  }
  const prefix = (match[2] || '').replace(/\/+$/, '');
  if (prefix.split('/').some(part => part === '.' || part === '..') || /[\\\x00-\x1f?#]/.test(prefix)) throw new Error('Invalid S3 prefix.');
  return { bucket: match[1], prefix, owner };
}

// Do not echo AWS command stderr: providers can include object keys and credentials.
export function awsCommand(args, { hashOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('aws', args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' } });
    const hash = hashOutput ? createHash('sha256') : null;
    const chunks = [];
    let bytes = 0;
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (hash) hash.update(chunk);
      else if (bytes < 1024 * 1024) chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', () => reject(new Error('AWS CLI could not start. Install/configure it on the runner.')));
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`AWS ${args[0]} ${args[1]} failed (exit ${code}). Check runner permissions, region, and destination.`));
      resolve(hash ? { sha256: hash.digest('hex'), bytes } : Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export async function preflightStorageS3(destination, command = awsCommand) {
  const identity = JSON.parse(await command(['sts', 'get-caller-identity', '--output', 'json']));
  if (!/^\d{12}$/.test(identity.Account || '')) throw new Error('AWS identity was not verified.');
  await command(['s3api', 'head-bucket', '--bucket', destination.bucket, '--expected-bucket-owner', destination.owner]);
  return { callerAccount: identity.Account, bucketOwner: destination.owner, bucket: destination.bucket };
}

export async function restoreStorageS3({ extracted, storage, destination, capsuleId, command = awsCommand, runId = randomUUID() }) {
  const selected = payloadStorage(storage);
  await verifyStoragePayloads(extracted, selected);
  const root = [destination.prefix, encodeURIComponent(capsuleId), runId].filter(Boolean).join('/');
  const mapping = { formatVersion: 1, capsuleId, destination: `s3://${destination.bucket}/${root}`,
    createdAt: new Date().toISOString(), storageServingRestored: false, objects: [], omitted: [] };
  for (const bucket of storage.buckets || []) {
    for (const object of bucket.objects || []) {
      if (object.includedInCapsule === false && object.payloadLocation !== 'baseline') {
        mapping.omitted.push({ bucket: bucket.id, name: object.name, size: object.size, reason: object.omissionReason });
        continue;
      }
      // A per-run namespace avoids overwriting an earlier customer's restore.
      const key = `${root}/objects/${encodeURIComponent(bucket.id)}/${object.name.split('/').map(encodeURIComponent).join('/')}`;
      const uri = `s3://${destination.bucket}/${key}`;
      const source = containedPath(join(extracted, 'storage'), `${bucket.id}/${object.name}`);
      await command(['s3', 'cp', source, uri, '--only-show-errors', '--sse', 'AES256', '--content-type', object.contentType || 'application/octet-stream']);
      const readback = await command(['s3', 'cp', uri, '-', '--only-show-errors'], { hashOutput: true });
      if (readback.sha256 !== object.sha256 || readback.bytes !== Number(object.size)) throw new Error('S3 read-back checksum or size mismatch.');
      mapping.objects.push({ bucket: bucket.id, name: object.name, size: object.size, sha256: object.sha256, s3Uri: uri, verified: true });
    }
  }
  const manifestPath = join(extracted, 'storage-s3-mapping.json');
  await writeFile(manifestPath, `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600 });
  const mappingUri = `s3://${destination.bucket}/${root}/storage-s3-mapping.json`;
  await command(['s3', 'cp', manifestPath, mappingUri, '--only-show-errors', '--sse', 'AES256', '--content-type', 'application/json']);
  const { hashFile } = await import('./capsule-crypto.mjs');
  const readback = await command(['s3', 'cp', mappingUri, '-', '--only-show-errors'], { hashOutput: true });
  if (readback.sha256 !== await hashFile(manifestPath)) throw new Error('S3 mapping manifest checksum mismatch.');
  return { verified: true, destination: 's3', storageServingRestored: false, objectCount: mapping.objects.length,
    hashesVerified: mapping.objects.length, omittedObjectCount: mapping.omitted.length, mappingUri, mapping };
}
