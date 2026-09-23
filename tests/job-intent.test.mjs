import test from 'node:test';
import assert from 'node:assert/strict';
import { claimNextJob, finishJob, manualBackupBlocked, parseJobRequest } from '../cloud/runner/job-intent.mjs';
import { CLOUD_FREE, CLOUD_PLANS } from '../netlify/shared/product.mjs';

const REF = 'ekklokrukxmqlahtonnc';

test('backup intent keeps labels and refuses secrets', () => {
  const ok = parseJobRequest({
    type: 'backup',
    projectRef: REF,
    destinationKind: 's3',
    excludeTables: ['public.logs'],
    excludeBuckets: ['avatars'],
    note: 'manual',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.projectRef, REF);
  assert.equal(ok.payload.incrementalBinary, false);
  assert.deepEqual(ok.payload.excludeTables, ['public.logs']);
  const incremental = parseJobRequest({ type: 'backup', projectRef: REF, incrementalBinary: true });
  assert.equal(incremental.payload.incrementalBinary, true);
  assert.equal(parseJobRequest({ type: 'backup', projectRef: REF, incrementalBinary: 'yes' }).error, 'invalid_incremental_binary');
  assert.equal(parseJobRequest({ type: 'verify', incrementalBinary: true }).error, 'incremental_binary_backup_only');
  assert.equal(parseJobRequest({ type: 'backup' }).error, 'missing_project_ref');
  assert.equal(parseJobRequest({
    type: 'backup',
    projectRef: REF,
    passphrase: 'correct horse battery',
  }).error, 'zero_knowledge_forbidden');
  assert.equal(parseJobRequest({
    type: 'backup',
    projectRef: REF,
    excludeBuckets: ['photos/secret.jpg'],
  }).error, 'invalid_exclude_bucket_entry');
  assert.equal(parseJobRequest({
    type: 'backup',
    projectRef: REF,
    note: 'postgres://user:pw@host/db',
  }).error, 'zero_knowledge_forbidden');
});

test('claim takes the oldest queued job and finish records status only', () => {
  const jobs = [
    { id: 'job_new', status: 'queued', createdAt: '2026-09-23T02:00:00.000Z' },
    { id: 'job_old', status: 'queued', createdAt: '2026-09-23T01:00:00.000Z' },
  ];
  const claimed = claimNextJob(jobs, { workerId: 'user_1', now: '2026-09-23T03:00:00.000Z' });
  assert.equal(claimed.job.id, 'job_old');
  assert.equal(claimed.job.status, 'running');
  const done = finishJob(claimed.jobs, { jobId: 'job_old', status: 'succeeded', now: '2026-09-23T04:00:00.000Z' });
  assert.equal(done.job.status, 'succeeded');
  assert.equal(done.job.safeError, null);
  assert.equal(finishJob(done.jobs, { jobId: 'job_old', status: 'failed' }).error, 'job_not_running');
});

test('Cloud Free can queue one manual backup and still has no schedule', () => {
  assert.equal(CLOUD_FREE.scheduled, false);
  assert.equal(CLOUD_FREE.transfersPer24h, 0);
  assert.equal(manualBackupBlocked({ plan: CLOUD_FREE, usedLast24h: 0, atLimit: true }), false);
  assert.equal(manualBackupBlocked({ plan: CLOUD_FREE, usedLast24h: 1, atLimit: true }), true);
  assert.equal(manualBackupBlocked({ plan: CLOUD_PLANS['cloud-17'], usedLast24h: 3, atLimit: true }), true);
  assert.equal(manualBackupBlocked({ plan: CLOUD_PLANS['cloud-17'], usedLast24h: 0, atLimit: false }), false);
});
