import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTelemetryEvents,
  recentDayStrings,
  telemetryPrefixesFor,
} from '../netlify/functions/cloud-telemetry-events.mjs';

const REF_A = 'abcdefghijklmnopqrst';
const OWNER_A = 'a'.repeat(64);
const OWNER_B = 'b'.repeat(64);
const NOW = new Date('2026-10-03T12:00:00.000Z').getTime();

function record(eventType, occurredAt, payload = {}) {
  return {
    owner: OWNER_A,
    receivedAt: '2026-10-03T12:00:01.000Z',
    event: {
      schemaVersion: 1,
      eventType,
      occurredAt,
      projectRef: REF_A,
      portabaseVersion: '0.4.1',
      payload,
    },
  };
}

function fakes(files) {
  const map = new Map(Object.entries(files));
  return {
    async listKeys(prefix) {
      return [...map.keys()].filter(key => key.startsWith(prefix)).sort();
    },
    async getRecord(key) {
      if (!map.has(key)) return null;
      return map.get(key);
    },
  };
}

test('prefixes cover each own account day, newest first', () => {
  const prefixes = telemetryPrefixesFor(OWNER_A, 2, NOW);
  assert.deepEqual(prefixes, [
    `owners/${OWNER_A}/2026-10-03/`,
    `owners/${OWNER_A}/2026-10-02/`,
  ]);
});

test('invalid owners never become prefixes', () => {
  assert.deepEqual(telemetryPrefixesFor(['short', 'ABCDEFGHIJKLMNOPQRST', 123, null], 1, NOW), []);
  assert.deepEqual(telemetryPrefixesFor('not-an-array-but-valid-' + REF_A, 1, NOW), []);
});

test('another account cannot read reports even with the same project reference', async () => {
  const { listKeys, getRecord } = fakes({
    [`owners/${OWNER_A}/2026-10-03/a.json`]: record('backup.completed', '2026-10-03T10:00:00.000Z'),
    [`owners/${OWNER_B}/2026-10-03/b.json`]: record('backup.completed', '2026-10-03T11:00:00.000Z'),
  });
  const { events } = await collectTelemetryEvents({ owner: OWNER_A, days: 1, listKeys, getRecord, now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].projectRef, REF_A);
});

test('events outside the day window are excluded', async () => {
  const { listKeys, getRecord } = fakes({
    [`owners/${OWNER_A}/2026-10-03/a.json`]: record('backup.completed', '2026-10-03T10:00:00.000Z'),
    [`owners/${OWNER_A}/2026-09-20/old.json`]: record('backup.completed', '2026-09-20T10:00:00.000Z'),
  });
  const { events, prefixesScanned } = await collectTelemetryEvents({ owner: OWNER_A, days: 7, listKeys, getRecord, now: NOW });
  assert.equal(events.length, 1);
  assert.equal(prefixesScanned, 7);
});

test('days are capped at 30', async () => {
  const { listKeys, getRecord } = fakes({});
  const { prefixesScanned } = await collectTelemetryEvents({ owner: OWNER_A, days: 999, listKeys, getRecord, now: NOW });
  assert.equal(prefixesScanned, 30);
});

test('secret-shaped records are skipped entirely, safe ones pass through', async () => {
  const { listKeys, getRecord } = fakes({
    [`owners/${OWNER_A}/2026-10-03/ok.json`]: record('backup.completed', '2026-10-03T10:00:00.000Z', { status: 'COMPLETE', errorCount: 0 }),
    [`owners/${OWNER_A}/2026-10-03/leak.json`]: record('backup.completed', '2026-10-03T10:00:00.000Z', { status: 'COMPLETE', passphrase: 'hunter2-hunter2-hunter2' }),
    [`owners/${OWNER_A}/2026-10-03/evil.json`]: { receivedAt: 'x', event: { eventType: 'backup.completed', service_role: 'key' } },
  });
  const { events } = await collectTelemetryEvents({ owner: OWNER_A, days: 1, listKeys, getRecord, now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.status, 'COMPLETE');
});

test('missing and malformed records are skipped without failing the read', async () => {
  const { listKeys, getRecord } = fakes({
    [`owners/${OWNER_A}/2026-10-03/ok.json`]: record('agent.heartbeat', '2026-10-03T10:00:00.000Z'),
    [`owners/${OWNER_A}/2026-10-03/junk.json`]: 'not-an-object',
    [`owners/${OWNER_A}/2026-10-03/noevent.json`]: { receivedAt: 'x' },
  });
  const missing = async (prefix) => [...(await listKeys(prefix)), `owners/${OWNER_A}/2026-10-03/gone.json`];
  const { events } = await collectTelemetryEvents({ owner: OWNER_A, days: 1, listKeys: missing, getRecord, now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'agent.heartbeat');
});

test('events come back newest first', async () => {
  const { listKeys, getRecord } = fakes({
    [`owners/${OWNER_A}/2026-10-03/old.json`]: record('job.completed', '2026-10-03T08:00:00.000Z'),
    [`owners/${OWNER_A}/2026-10-03/new.json`]: record('job.completed', '2026-10-03T11:00:00.000Z'),
  });
  const { events } = await collectTelemetryEvents({ owner: OWNER_A, days: 1, listKeys, getRecord, now: NOW });
  assert.deepEqual(events.map(e => e.occurredAt), ['2026-10-03T11:00:00.000Z', '2026-10-03T08:00:00.000Z']);
});

test('recentDayStrings walks back one day at a time', () => {
  assert.deepEqual(recentDayStrings(3, NOW), ['2026-10-03', '2026-10-02', '2026-10-01']);
});
