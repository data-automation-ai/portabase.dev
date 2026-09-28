import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelemetryModel,
  sanitizeHealthEvent,
  telemetryForbiddenCopy,
} from '../src/lib/telemetry-view.js';

test('sanitizeHealthEvent drops inventory keys and redacts identifying summaries', () => {
  const clean = sanitizeHealthEvent({
    id: 'evt_1',
    type: 'backup.completed',
    projectRef: 'abcdefghijklmnopqr',
    occurredAt: '2026-09-18T12:00:00.000Z',
    level: 'ok',
    summary: 'Capsule verified · S3',
    objectName: 'avatars/secret.jpg',
    tableRows: [{ email: 'a@b.c' }],
  });
  const json = JSON.stringify(clean);
  assert.equal(clean.type, 'backup.completed');
  assert.equal(clean.summary, 'Capsule verified · S3');
  assert.equal(clean.objectName, undefined);
  assert.doesNotMatch(json, /avatars|secret\.jpg|tableRows|email/);

  const redacted = sanitizeHealthEvent({
    type: 'backup.failed',
    summary: 'failed objectPath buckets/avatars/photo.png',
  });
  assert.equal(redacted.summary, 'health signal (detail stripped)');
  assert.equal(redacted.type, 'backup.failed');
});

test('buildTelemetryModel is health-signals-only aggregates over 7 days', () => {
  const now = Date.parse('2026-09-18T18:00:00.000Z');
  const model = buildTelemetryModel({
    capsules: [
      { status: 'COMPLETE', verified: true, sizeBytes: 1000, durationMs: 2000, createdAt: '2026-09-18T10:00:00.000Z' },
      { status: 'FAILED', verified: false, sizeBytes: 0, durationMs: 500, createdAt: '2026-09-16T10:00:00.000Z' },
    ],
    events: [
      { id: 'e1', type: 'backup.completed', occurredAt: '2026-09-18T10:00:00.000Z', summary: 'ok', projectRef: 'ref1', level: 'ok' },
      { id: 'e2', type: 'verify.failed', occurredAt: '2026-09-16T10:00:00.000Z', summary: 'checksum', projectRef: 'ref1', level: 'error' },
      { id: 'e3', type: 'backup.failed', occurredAt: '2026-09-16T11:00:00.000Z', summary: 'destination_unreachable', objectName: 'nope.bin', level: 'error' },
    ],
    agents: [{ status: 'online' }, { status: 'degraded' }],
  }, now);

  assert.equal(model.privacy, 'health-signals-only');
  assert.equal(model.series.length, 7);
  assert.equal(model.totals.success, 1);
  assert.equal(model.totals.failed, 1);
  assert.equal(model.totals.rescueReady, 1);
  assert.equal(model.totals.encryptedBytes, 1000);
  assert.equal(model.totals.avgDurationMs, 1250);
  assert.equal(model.totals.agentsOnline, 1);
  assert.equal(model.totals.driftFail, 1);
  assert.doesNotMatch(JSON.stringify(model), /nope\.bin|objectName|tableRows/);
  assert.ok(telemetryForbiddenCopy().some((item) => /object names/i.test(item)));
  assert.ok(telemetryForbiddenCopy().some((item) => /plaintext/i.test(item)));
});
