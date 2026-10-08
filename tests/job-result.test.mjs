import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jobResultFromRecord, jobResultRecord, publicJobResult, readPrivateBackupResult } from '../cloud/runner/job-result.mjs';

const HASH = 'a'.repeat(64);
const MANIFEST_HASH = 'b'.repeat(64);
const RESULT = Object.freeze({
  schemaVersion: 1,
  capsuleId: 'abcdefghijklmnopqrst-20261005T120000Z',
  status: 'COMPLETE',
  capsuleHash: HASH,
  manifestHash: MANIFEST_HASH,
  sizeBytes: 4096,
  objectCount: 12,
  durationMs: 2500,
  destinationKind: 's3',
  destinationVerified: true,
  completedAt: '2026-10-05T12:00:00.000Z',
});

test('safe job result is an exact fixed projection', () => {
  assert.deepEqual(publicJobResult(RESULT), RESULT);
  assert.deepEqual(jobResultFromRecord({ privatePath: 'C:/private', ...jobResultRecord(RESULT) }), RESULT);
  for (const invalid of [
    { ...RESULT, passphrase: 'must-stay-private' },
    { ...RESULT, capsuleHash: 'not-a-hash' },
    { ...RESULT, sizeBytes: -1 },
    { ...RESULT, capsuleId: '../escape' },
    { ...RESULT, destinationKind: 'unknown-provider' },
  ]) assert.throws(() => publicJobResult(invalid), { code: 'invalid_job_result' });
});

test('private status reader binds project and start time then emits no private fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portabase-safe-result-'));
  const statusDirectory = join(root, 'status');
  await mkdir(statusDirectory);
  await writeFile(join(statusDirectory, 'latest.json'), JSON.stringify({
    state: RESULT.status,
    capsule: RESULT.capsuleId,
    projectRef: 'abcdefghijklmnopqrst',
    capsuleHash: HASH,
    manifestHash: MANIFEST_HASH,
    sizeBytes: RESULT.sizeBytes,
    objectCount: RESULT.objectCount,
    durationMs: RESULT.durationMs,
    destinationVerified: true,
    completedAt: RESULT.completedAt,
    destination: 's3://private-bucket/private-prefix',
    errors: ['private diagnostic'],
    passphrase: 'must-stay-private',
  }));
  const result = await readPrivateBackupResult({ statusDirectory, projectRef: 'abcdefghijklmnopqrst',
    destinationKind: 'aws', startedAt: Date.parse('2026-10-05T11:59:59.000Z') });
  assert.deepEqual(result, RESULT);
  assert.doesNotMatch(JSON.stringify(result), /private|passphrase|bucket|errors/);
  await assert.rejects(readPrivateBackupResult({ statusDirectory, projectRef: 'bcdefghijklmnopqrstu0',
    destinationKind: 's3', startedAt: Date.parse('2026-10-05T11:59:59.000Z') }));
});
