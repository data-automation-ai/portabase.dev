import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { encryptFile, decryptFile } from '../../utility/capsule-crypto.mjs';

/** Cloud-only, tiny synthetic round trip using the existing capsule crypto engine.
 * This is not a database capture, off-site delivery or application restore drill.
 */
export async function runSyntheticCapsule(payload) {
  if (process.platform !== 'linux') throw new Error('cloud_linux_required');
  if (!/^[A-Za-z0-9_-]{43}$/.test(payload?.sample || '') || !/^[A-Za-z0-9_-]{43}$/.test(payload?.passphrase || '')) {
    throw new Error('invalid_synthetic_payload');
  }
  const dir = await mkdtemp('/tmp/portabase-confidential-proof-');
  try {
    const source = join(dir, 'synthetic.bin'), capsule = join(dir, 'capsule.pbase'), restored = join(dir, 'restored.bin');
    const sample = Buffer.from(payload.sample, 'base64url');
    await writeFile(source, sample, { flag: 'wx', mode: 0o600 });
    const metadata = await encryptFile(source, capsule, payload.passphrase, 'synthetic-confidential-proof-v1');
    await decryptFile(capsule, restored, payload.passphrase, metadata);
    const result = await readFile(restored);
    if (!result.equals(sample)) throw new Error('round_trip_mismatch');
    return { syntheticRoundTrip: true, bytes: sample.length,
      restoredSha256: createHash('sha256').update(result).digest('hex'),
      ciphertextSha256: metadata.ciphertextSha256,
      databaseBackupTested: false, offsiteDeliveryTested: false, applicationRestoreTested: false };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
