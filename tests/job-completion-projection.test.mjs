import test from 'node:test';
import assert from 'node:assert/strict';
import { jobCompletionEvent } from '../netlify/shared/job-completion-events.mjs';

const now = Date.parse('2026-10-04T12:00:00.000Z');
const runner = { owner: 'a'.repeat(64), id: '11111111-1111-4111-8111-111111111111', projectRef: 'abcdefghijklmnopqrst' };
const base = { version: 2, id: 'job_synthetic', runnerId: runner.id, workerId: runner.id,
  payload: { runnerId: runner.id, privateManifest: 'private-database-table' }, finishedAt: new Date(now).toISOString(),
  safeError: 'private-provider-diagnostic', status: 'succeeded' };

test('all terminal operations project fixed status without claiming recovery proof or leaking diagnostics', () => {
  for (const [type, prefix] of [['backup', 'backup'], ['verify', 'verify'], ['replay', 'restore']]) {
    for (const status of ['succeeded', 'failed']) {
      const event = jobCompletionEvent({ ...base, type, status }, runner, now);
      assert.equal(event.eventType, `${prefix}.${status === 'succeeded' ? 'completed' : 'failed'}`);
      assert.equal(event.occurredAt, base.finishedAt);
      assert.equal(event.payload.verified, undefined);
      assert.doesNotMatch(JSON.stringify(event), /private-database-table|private-provider-diagnostic/);
    }
  }
});

test('foreign, revoked, nonterminal and unsupported job completions are refused', () => {
  for (const patch of [{ version: 1 }, { runnerId: 'foreign' }, { workerId: 'foreign' },
    { payload: { runnerId: 'foreign' } }, { status: 'running' }, { type: 'unknown' }, { id: '../escape' }]) {
    assert.throws(() => jobCompletionEvent({ ...base, type: 'backup', ...patch }, runner, now));
  }
  assert.throws(() => jobCompletionEvent({ ...base, type: 'backup' }, { ...runner, revokedAt: base.finishedAt }, now));
});
