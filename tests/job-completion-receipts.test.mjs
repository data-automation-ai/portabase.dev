import test from 'node:test';
import assert from 'node:assert/strict';
import { storeJobCompletionReceipt, readJobCompletionReceipt } from '../netlify/shared/job-completion-receipts.mjs';

const owner = 'a'.repeat(64), runnerId = '11111111-1111-4111-8111-111111111111';
const job = { id: 'job_receipt', version: 2, runnerId, workerId: runnerId, type: 'replay',
  payload: { version: 2, runnerId, configRef: '22222222-2222-4222-8222-222222222222', configRevision: 1 },
  status: 'succeeded', safeError: null, createdAt: '2026-10-04T10:00:00.000Z',
  claimedAt: '2026-10-04T10:01:00.000Z', finishedAt: '2026-10-04T10:02:00.000Z' };
function storage() {
  const rows = new Map();
  return { rows, get: async key => rows.get(key) ?? null,
    setJSON: async (key, value) => {
      if (rows.has(key)) return { modified: false };
      rows.set(key, structuredClone(value)); return { modified: true };
    } };
}

test('immutable receipt survives queue removal and rejects conflicting terminal outcomes', async () => {
  const db = storage();
  await storeJobCompletionReceipt(db, owner, job);
  await storeJobCompletionReceipt(db, owner, job);
  assert.equal(db.rows.size, 1);
  assert.deepEqual(await readJobCompletionReceipt(db, owner, runnerId, job.id), job);
  await assert.rejects(storeJobCompletionReceipt(db, owner, { ...job, status: 'failed', safeError: 'engine_failed' }));
  assert.equal((await readJobCompletionReceipt(db, owner, runnerId, job.id)).status, 'succeeded');
});

test('receipt reads isolate owner and runner and reject tampered records', async () => {
  const db = storage(); await storeJobCompletionReceipt(db, owner, job);
  assert.equal(await readJobCompletionReceipt(db, 'b'.repeat(64), runnerId, job.id), null);
  assert.equal(await readJobCompletionReceipt(db, owner, '33333333-3333-4333-8333-333333333333', job.id), null);
  const key = [...db.rows.keys()][0];
  db.rows.get(key).job.payload.privateKey = 'synthetic-private-value';
  await assert.rejects(readJobCompletionReceipt(db, owner, runnerId, job.id));
});

test('queued results and unapproved diagnostics cannot become durable completion receipts', async () => {
  for (const patch of [{ status: 'queued' }, { status: 'failed', safeError: 'raw-provider-detail' },
    { workerId: 'foreign' }, { finishedAt: 'invalid' }]) {
    const db = storage();
    await assert.rejects(storeJobCompletionReceipt(db, owner, { ...job, ...patch }));
    assert.equal(db.rows.size, 0);
  }
});
