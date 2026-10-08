import test from 'node:test';
import assert from 'node:assert/strict';
import { engineArgvForJob } from '../cloud/runner/worker.mjs';

test('a private plan cannot silently become an unfiltered replay command', () => {
  const job = { type: 'replay', payload: { capsulePath: 'private/capsule', targetRef: 'bcdefghijklmnopqrstu0' } };
  for (const restorePlan of [{ planPath: 'private/plan.json' }, {}, null]) {
    assert.throws(() => engineArgvForJob(job, { restorePlan }), { code: 'private_restore_execution_unavailable' });
  }
});
