import test from 'node:test';
import assert from 'node:assert/strict';
import { backupVerification, usageView, usageBytes, usageDuration } from '../src/console/usage-overview.mjs';

test('missing and no-sample uptime never become zero or job runtime', () => {
  const usage = { available: true, recorded: true, jobRuntimeMs: 3600000 };
  assert.equal(usageView({ usage }).runnerHours, null);
  assert.equal(usageView({ usage, runnerUsage: { available: true, status: 'no_samples', runnerRuntimeMs: 0 } }).runnerHours, null);
  assert.equal(usageView({ usage, runnerUsage: { available: true, status: 'measured', runnerRuntimeMs: 7200000 } }).runnerHours, '2.00');
});
test('quota uses charged outbound, decimal GB and active reservations', () => {
  const view = usageView({ usage: { available: true, recorded: true, allowanceBytes: 10e9, chargedBytes: 2e9, outboundBytes: 9e9, baselineBytes: 7e9, reservedBytes: 1e9 } });
  assert.equal(view.usedPercent, 20);
  assert.equal(view.remaining, 7e9);
  assert.equal(usageBytes(10e9), '10 GB');
  assert.equal(usageBytes(null), '—');
  assert.equal(usageDuration(null), '—');
});
test('no recorded history is distinct from measured zero', () => {
  assert.equal(usageView({ usage: { available: true, recorded: false, allowanceBytes: 10e9, chargedBytes: 0 } }).charged, null);
  assert.equal(usageView({ usage: { available: true, recorded: true, allowanceBytes: 10e9, chargedBytes: 0 } }).charged, 0);
});
test('selected scope and failed or incomplete runs cannot claim a full verified backup', () => {
  const complete = { status: 'succeeded', verified: true, manifestVerified: true, completeness: 'complete' };
  assert.equal(backupVerification(complete).title, 'Complete · integrity verified');
  assert.equal(backupVerification({ ...complete, completeness: 'selected' }).title, 'Selected scope verified');
  assert.equal(backupVerification({ ...complete, status: 'failed' }).tone, 'failed');
  assert.equal(backupVerification({ ...complete, manifestVerified: false }).tone, 'pending');
  assert.equal(backupVerification({ ...complete, completeness: 'unverified' }).tone, 'pending');
});
