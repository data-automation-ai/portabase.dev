import test from 'node:test';
import assert from 'node:assert/strict';
import { privateJobReference, privateJobAttemptKey, readPrivateJobAttempt, canRetryPrivateJob, matchingPrivateJob, PRIVATE_JOB_RETRY_MS } from '../src/lib/private-job-reference.js';

const runnerId = '11111111-1111-4111-8111-111111111111', configRef = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const reference = { version: 2, runnerId, configRef, configRevision: 1, type: 'backup' };
test('opaque file projection rejects private fields, coercion and inactive/foreign runner binding', () => {
  assert.deepEqual(privateJobReference(reference, { id: runnerId }), reference);
  for (const patch of [{ password: 'synthetic' }, { inventory: [] }, { excludeTables: [] }, { requestId }, { configRevision: '1' }, { version: 1 }, { type: 'shell' }, { configRef: '../config' }]) {
    assert.throws(() => privateJobReference({ ...reference, ...patch }, { id: runnerId }));
  }
  assert.throws(() => privateJobReference(reference, { id: configRef }));
  assert.throws(() => privateJobReference(reference, { id: runnerId, revokedAt: '2026-10-05' }));
});
test('retry metadata is account scoped, strictly validated and expires without extending the window', () => {
  assert.notEqual(privateJobAttemptKey('supabase:owner', reference), privateJobAttemptKey('supabase:other', reference));
  const attempt = { requestId, startedAt: 1000 };
  assert.deepEqual(readPrivateJobAttempt({ getItem: () => JSON.stringify(attempt) }, 'test'), attempt);
  assert.throws(() => readPrivateJobAttempt({ getItem: () => JSON.stringify({ ...attempt, token: 'synthetic' }) }, 'test'));
  assert.equal(canRetryPrivateJob(attempt, 999), false);
  assert.equal(canRetryPrivateJob(attempt, 1000 + PRIVATE_JOB_RETRY_MS - 1), true);
  assert.equal(canRetryPrivateJob(attempt, 1000 + PRIVATE_JOB_RETRY_MS), false);
});
test('queue reconciliation requires the exact request, runner, operation and revision', () => {
  const { type, ...payload } = reference;
  const job = { id: 'job_test', version: 2, runnerId, requestId, type, payload, status: 'queued' };
  assert.deepEqual(matchingPrivateJob(job, reference, requestId), { id: 'job_test', status: 'queued' });
  for (const patch of [{ requestId: configRef }, { runnerId: configRef }, { type: 'replay' }, { version: 1 }, { payload: { ...payload, configRevision: 2 } }, { payload: { ...payload, table: 'private' } }]) {
    assert.equal(matchingPrivateJob({ ...job, ...patch }, reference, requestId), null);
  }
});
