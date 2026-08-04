import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeTelemetryValue,
  buildTelemetryEvent,
  cloudTelemetryConfig,
} from './telemetry.mjs';

test('telemetry rejects secrets and connection strings', () => {
  assert.throws(() => assertSafeTelemetryValue({ password: 'x' }), /forbidden key/);
  assert.throws(() => assertSafeTelemetryValue('postgresql://user:secret@host/db'), /forbidden content/);
  assert.throws(() => assertSafeTelemetryValue('sb_secret_abc'), /forbidden content/);
});

test('telemetry builds allowlisted backup events', () => {
  const event = buildTelemetryEvent({
    eventType: 'backup.completed',
    projectRef: 'abcdefghijklmnopqrst',
    portabaseVersion: '0.4.0',
    payload: { capsuleId: 'cap-1', status: 'COMPLETE', verified: true, errorCount: 0 },
  });
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.eventType, 'backup.completed');
  assert.equal(event.payload.status, 'COMPLETE');
});

test('cloud telemetry is off unless enabled with env credentials', () => {
  assert.equal(cloudTelemetryConfig({ cloud: { enabled: false } }), null);
  assert.equal(cloudTelemetryConfig({ cloud: { enabled: true } }), null);
});
