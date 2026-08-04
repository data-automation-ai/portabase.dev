#!/usr/bin/env node
// Destination smoke test: pushes a synthetic capsule through the REAL
// transferCapsule() path (upload + checksum verification) for each destination.
//
//   node scripts/test-destinations.mjs --local "D:\\somewhere or \\\\NAS\\share"
//   node scripts/test-destinations.mjs --s3 my-bucket/optional/prefix
//   node scripts/test-destinations.mjs --rclone remotename:Portabase-test
//
// Multiple flags run multiple destinations. No Supabase credentials are needed;
// the capsule is synthetic but structurally identical to a real one.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transferCapsule, writeChecksums } from '../utility/portabase.mjs';

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };

async function makeCapsule(root) {
  const id = `desttest00000000000a-${new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}`;
  const capsuleDir = join(root, id);
  await mkdir(capsuleDir, { recursive: true });
  await writeFile(join(capsuleDir, 'capsule.pbase'), randomBytes(256 * 1024));
  await writeFile(join(capsuleDir, 'capsule.json'), `${JSON.stringify({ formatVersion: 1, id, edition: 'destination-test', note: 'synthetic capsule for destination testing; contains random bytes only' }, null, 2)}\n`);
  await writeFile(join(capsuleDir, 'RECOVER.txt'), 'Synthetic destination-test capsule. Safe to delete.\n');
  await writeChecksums(capsuleDir);
  return capsuleDir;
}

const destinations = [];
if (flag('local')) destinations.push({ label: `local  → ${flag('local')}`, provider: { type: 'local', path: flag('local') } });
if (flag('s3')) {
  const [bucket, ...prefix] = flag('s3').split('/');
  destinations.push({ label: `aws s3 → s3://${flag('s3')}`, provider: { type: 'aws', bucket, prefix: prefix.join('/') } });
}
if (flag('rclone')) {
  const [remote, ...path] = flag('rclone').split(':');
  destinations.push({ label: `rclone → ${flag('rclone')}`, provider: { type: 'rclone', remote, path: path.join(':') || '/Portabase-test' } });
}
if (!destinations.length) {
  console.log('Usage: node scripts/test-destinations.mjs [--local DIR] [--s3 BUCKET[/PREFIX]] [--rclone REMOTE:PATH]');
  process.exit(1);
}

const staging = await mkdtemp(join(tmpdir(), 'portabase-dest-'));
let failures = 0;
try {
  for (const destination of destinations) {
    const capsuleDir = await makeCapsule(staging);
    const started = Date.now();
    try {
      const result = await transferCapsule({ provider: destination.provider }, capsuleDir);
      console.log(`PASS  ${destination.label}`);
      console.log(`      uploaded + checksum-verified in ${((Date.now() - started) / 1000).toFixed(1)}s → ${result.destination}`);
    } catch (error) {
      failures += 1;
      console.log(`FAIL  ${destination.label}`);
      console.log(`      ${error.message}`);
    }
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} destination(s) FAILED` : '\nAll destinations verified.');
process.exit(failures ? 7 : 0);
