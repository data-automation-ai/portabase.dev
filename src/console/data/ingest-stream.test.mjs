import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProgressLine,
  createIngestState,
  applyIngestEvent,
  databaseProgress,
  storageProgress,
  etaSeconds,
} from './ingest-stream.js';

const manifest = {
  phase: 'database-manifest',
  count: 3,
  totalRows: 1000,
  totalBytes: 1000,
  tables: [
    { item: 'public.big', rows: 900, bytes: 900 },
    { item: 'public.small', rows: 100, bytes: 100 },
    { item: 'public.empty', rows: 0, bytes: 0 },
  ],
};

test('parseProgressLine extracts an event and ignores ordinary log noise', () => {
  assert.equal(parseProgressLine('Storage progress: 50/100 objects'), null);
  assert.equal(parseProgressLine(''), null);
  assert.equal(parseProgressLine('@portabase {not json'), null, 'a torn line must not throw');
  const event = parseProgressLine('@portabase {"phase":"database","item":"public.a","rows":5}');
  assert.equal(event.phase, 'database');
  assert.equal(event.item, 'public.a');
});

test('database progress is weighted by bytes, not by table count', () => {
  let state = applyIngestEvent(createIngestState(), manifest);
  assert.equal(databaseProgress(state).ratio, 0);

  // Finishing the two SMALL tables is 2 of 3 tables but only 10% of the bytes.
  state = applyIngestEvent(state, { phase: 'database', item: 'public.small', rows: 100 });
  state = applyIngestEvent(state, { phase: 'database', item: 'public.empty', rows: 0 });
  const mid = databaseProgress(state);
  assert.equal(mid.basis, 'bytes');
  assert.equal(mid.ratio, 0.1, 'two of three tables done must NOT read as 67% when they are 10% of bytes');
  assert.equal(state.tablesDone, 2);

  state = applyIngestEvent(state, { phase: 'database', item: 'public.big', rows: 900 });
  assert.equal(databaseProgress(state).ratio, 1);
});

test('a repeated table event does not double-count progress', () => {
  let state = applyIngestEvent(createIngestState(), manifest);
  state = applyIngestEvent(state, { phase: 'database', item: 'public.big', rows: 900 });
  state = applyIngestEvent(state, { phase: 'database', item: 'public.big', rows: 900 });
  assert.equal(state.tablesDone, 1, 'duplicate events must be idempotent');
  assert.equal(databaseProgress(state).ratio, 0.9);
});

test('a table missing from the capped manifest still advances the counter', () => {
  let state = applyIngestEvent(createIngestState(), manifest);
  state = applyIngestEvent(state, { phase: 'database', item: 'public.not_listed', rows: 7 });
  assert.equal(state.tablesDone, 1);
});

test('database progress falls back to table count when the engine sends no byte estimates', () => {
  let state = applyIngestEvent(createIngestState(), {
    phase: 'database-manifest',
    count: 2,
    tables: [{ item: 'public.a', rows: 1 }, { item: 'public.b', rows: 1 }],
  });
  state = applyIngestEvent(state, { phase: 'database', item: 'public.a', rows: 1 });
  const progress = databaseProgress(state);
  assert.equal(progress.basis, 'count', 'must report the weaker basis rather than imply byte precision');
  assert.equal(progress.ratio, 0.5);
});

test('storage progress tracks completed against total objects', () => {
  let state = createIngestState();
  state = applyIngestEvent(state, { phase: 'storage', item: 'b/1', bytes: 10, completed: 1, total: 4 });
  state = applyIngestEvent(state, { phase: 'storage', item: 'b/2', bytes: 30, completed: 2, total: 4 });
  const progress = storageProgress(state);
  assert.equal(progress.ratio, 0.5);
  assert.equal(state.storage.bytes, 40);
  assert.equal(state.storage.current, 'b/2');
});

test('ratios never exceed 1 even if the engine over-reports', () => {
  let state = applyIngestEvent(createIngestState(), manifest);
  for (const item of ['public.big', 'public.small', 'public.empty', 'public.extra']) {
    state = applyIngestEvent(state, { phase: 'database', item, rows: 1 });
  }
  assert.ok(databaseProgress(state).ratio <= 1);
  state = applyIngestEvent(state, { phase: 'storage', item: 'x', bytes: 1, completed: 99, total: 4 });
  assert.ok(storageProgress(state).ratio <= 1);
});

test('failure is terminal and carries the message', () => {
  let state = applyIngestEvent(createIngestState(), manifest);
  state = applyIngestEvent(state, { phase: 'failed', item: 'pg_dump exited 1' });
  assert.equal(state.status, 'failed');
  assert.equal(state.error, 'pg_dump exited 1');
});

test('done marks the run complete and records capture status', () => {
  let state = applyIngestEvent(createIngestState(), manifest);
  state = applyIngestEvent(state, { phase: 'done', status: 'COMPLETE' });
  assert.equal(state.status, 'done');
  assert.equal(state.captureStatus, 'COMPLETE');
});

test('eta uses observed byte throughput and is null before any signal', () => {
  let state = applyIngestEvent(createIngestState(), manifest);
  state.startedAt = 1000;
  assert.equal(etaSeconds(state, 1000), null, 'no elapsed time yet');
  state = applyIngestEvent(state, { phase: 'database', item: 'public.small', rows: 100 }, 2000);
  state.startedAt = 1000;
  // 100 bytes in 1s => 900 remaining bytes => ~9s
  assert.equal(Math.round(etaSeconds(state, 2000)), 9);
});

test('the reducer does not mutate the previous state object', () => {
  const first = applyIngestEvent(createIngestState(), manifest);
  const snapshot = first.tables.map(t => t.state).join(',');
  const second = applyIngestEvent(first, { phase: 'database', item: 'public.big', rows: 900 });
  assert.equal(first.tables.map(t => t.state).join(','), snapshot, 'previous state must be untouched');
  assert.notEqual(first.doneTableBytes, second.doneTableBytes);
});
