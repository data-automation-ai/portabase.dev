import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { engineJobs } from './engine-jobs.mjs';

test('no-vault capture and verified restore report times and delete temporary staging', async () => {
  const sourceRef = 'abcdefghijklmnopqrst';
  const targetRef = 'bcdefghijklmnopqrstu';
  const owner = 'a'.repeat(64);
  const passphrase = 'b'.repeat(43);
  const seen = [];
  const access = () => ({
    inspect: async ref => ref === targetRef ? { blank: true, measuredBytes: 0 } : { measuredBytes: 1024 },
    credentials: async ref => ({ ref, readOnly: false, managementToken: 'test-token', databaseUrl: 'test-db', serviceKey: 'test-key' }),
  });
  const run = async (args, env, root, _maxBytes, progress) => {
    seen.push({ args, root });
    if (args[0] === 'backup') {
      progress('database');
      await mkdir(join(root, 'capsules', 'test-capsule'), { recursive: true });
      await mkdir(join(root, 'status'), { recursive: true });
      await writeFile(join(root, 'capsules', 'test-capsule', 'payload'), 'encrypted-test-bytes');
      await writeFile(join(root, 'status', 'latest.json'), JSON.stringify({
        state: 'COMPLETE', capsule: 'test-capsule', sizeBytes: 20, capsuleHash: 'test-hash',
      }));
    } else {
      progress('database');
      assert.equal((await readFile(join(seen[0].root, 'capsules', 'test-capsule', 'payload'), 'utf8')), 'encrypted-test-bytes');
      await mkdir(join(root, 'evidence'), { recursive: true });
      await writeFile(join(root, 'evidence', 'restore.json'), JSON.stringify({ status: 'RECOVERY_DATA_PATH_VERIFIED' }));
    }
  };
  const jobs = engineJobs({ run, access, platform: 'linux' });
  const base = { owner, sourceRef, targetRef, sourceToken: 'source-test-token', targetToken: 'target-test-token',
    passphrase, maxBytes: 20 * 1024 ** 3 };
  const capture = await jobs.start({ ...base, operation: 'backup' });
  const captured = await jobs.wait(owner, capture.id);
  assert.equal(captured.state, 'complete');
  assert.equal(captured.result.destinationKind, 'temporary_runner');
  assert.ok(captured.phaseTimings.some(row => row.phase === 'database'));
  assert.ok(captured.durationMs >= 0);
  const restore = await jobs.start({ ...base, operation: 'restore', capsuleId: capture.id });
  const restored = await jobs.wait(owner, restore.id);
  assert.equal(restored.state, 'complete');
  assert.equal(restored.result.restoreVerified, true);
  assert.equal(restored.result.databaseContentIdentityVerified, false);
  assert.equal(jobs.status(owner, capture.id).result.temporaryCapsuleRetained, false);
  await assert.rejects(stat(seen[0].root), { code: 'ENOENT' });
  await assert.rejects(stat(seen[1].root), { code: 'ENOENT' });
});
