import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOperatorTime, formatOperatorTimeShort, jobDurationMs, OPERATOR_TIMEZONE } from '../src/lib/operator-time.js';

test('operator timestamps use America/New_York and stay empty-safe', () => {
  assert.equal(OPERATOR_TIMEZONE, 'America/New_York');
  assert.equal(formatOperatorTime(null).label, '—');
  const t = formatOperatorTime('2026-09-20T16:00:00.000Z', { now: Date.parse('2026-09-20T19:00:00.000Z') });
  assert.match(t.absolute, /EDT|EST/);
  assert.match(t.relative, /3h ago/);
  assert.match(t.label, /3h ago/);
  assert.match(formatOperatorTimeShort('2026-09-20T16:00:00.000Z'), /Sun|9\/20/);
});

test('job duration is finished minus started', () => {
  assert.equal(jobDurationMs('2026-09-20T12:00:00.000Z', '2026-09-20T12:10:00.000Z'), 600000);
  assert.equal(jobDurationMs(null, '2026-09-20T12:10:00.000Z'), 0);
});
