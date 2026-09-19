import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAllowedTelemetry } from '../utility/cloud-telemetry-fields.mjs';

test('projects one-way telemetry and drops secret-shaped payload keys', () => {
  const out = projectAllowedTelemetry({
    jobId: 'job_1',
    customerId: 'user_1',
    status: 'running',
    phase: 'storage',
    objectCount: 12,
    sizeBytes: 4096,
    dailyMeterBytes: 8192,
    capsuleHash: 'a'.repeat(64),
    destinationKind: 's3',
    runnerId: 'run_1',
    region: 'us-east-1',
    passphrase: 'nope',
    payload: { passphrase: 'nope', objectCount: 12 },
  });
  assert.equal(out.jobId, 'job_1');
  assert.equal(out.destinationKind, 's3');
  assert.equal(out.passphrase, undefined);
  assert.equal(out.payload.passphrase, undefined);
  assert.equal(out.payload.objectCount, 12);
});
