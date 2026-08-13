/**
 * Ingestion telemetry reducer.
 *
 * The CLI engine emits one JSON line per event when run with `--progress`:
 *   @portabase {"phase":"database-manifest","count":588,"totalBytes":...,"tables":[...]}
 *   @portabase {"phase":"database","item":"public.orders","rows":120345}
 *   @portabase {"phase":"storage","item":"bucket/key","bytes":12,"completed":9,"total":15973}
 *
 * This module turns that stream into view state. It lives apart from the React layer so the
 * weighting maths can be tested directly — a progress meter that lies is worse than none.
 *
 * WEIGHTING: progress is weighted by estimated BYTES (pg_total_relation_size), never by table
 * count. On a real project one table can be 142 MB while 400 others are empty; counting tables
 * would show "400/588 done" with almost no data actually moved.
 */

export const INGEST_PHASES = ['scan', 'database', 'storage', 'functions', 'package', 'encrypt', 'transfer'];

const PHASE_LABEL = {
  scan: 'Scanning source',
  'database-manifest': 'Building table manifest',
  database: 'Database tables',
  storage: 'Storage objects',
  functions: 'Edge Functions',
  package: 'Packaging capsule',
  encrypt: 'Encrypting',
  transfer: 'Transferring to vault',
  done: 'Complete',
  failed: 'Failed',
};

export function phaseLabel(phase) {
  return PHASE_LABEL[phase] || phase;
}

/** Parse one stdout line. Returns null for any line that is not a progress event. */
export function parseProgressLine(line) {
  if (typeof line !== 'string') return null;
  const marker = line.indexOf('@portabase ');
  if (marker === -1) return null;
  try {
    const event = JSON.parse(line.slice(marker + '@portabase '.length));
    return event && typeof event === 'object' && event.phase ? event : null;
  } catch {
    return null; // A torn/partial line must never break the monitor.
  }
}

export function createIngestState() {
  return {
    phase: null,
    startedAt: null,
    updatedAt: null,
    status: 'idle', // idle | running | done | failed
    error: null,
    tables: [],            // [{ key, schema, name, bytes, rows, state, actualRows }]
    tableIndex: new Map(),
    totalTableBytes: 0,
    doneTableBytes: 0,
    tablesDone: 0,
    storage: { completed: 0, total: 0, bytes: 0, current: null },
    functions: { done: 0, current: null },
    log: [],               // recent events, newest first
  };
}

const MAX_LOG = 60;

function pushLog(state, entry) {
  state.log = [entry, ...state.log].slice(0, MAX_LOG);
}

/**
 * Apply one event, returning a NEW state object (React-friendly).
 * Unknown phases are recorded in the log but never throw — the monitor must survive an
 * engine that adds events faster than the console is updated.
 */
export function applyIngestEvent(prev, event, now = Date.now()) {
  if (!event || !event.phase) return prev;
  const state = {
    ...prev,
    tables: prev.tables,
    tableIndex: prev.tableIndex,
    storage: { ...prev.storage },
    functions: { ...prev.functions },
    log: prev.log,
    updatedAt: now,
    startedAt: prev.startedAt ?? now,
    status: prev.status === 'idle' ? 'running' : prev.status,
  };
  const { phase } = event;

  if (phase === 'database-manifest') {
    const tables = (event.tables || []).map(t => {
      const [schema, ...rest] = String(t.item || '').split('.');
      return {
        key: t.item,
        schema,
        name: rest.join('.') || t.item,
        bytes: Number(t.bytes) || 0,
        rows: Number(t.rows) || 0,
        state: 'pending',
        actualRows: null,
      };
    });
    state.tables = tables;
    state.tableIndex = new Map(tables.map((t, i) => [t.key, i]));
    // Prefer the engine's own total (covers tables beyond the 120 it lists individually).
    const listed = tables.reduce((sum, t) => sum + t.bytes, 0);
    state.totalTableBytes = Math.max(Number(event.totalBytes) || 0, listed);
    state.doneTableBytes = 0;
    state.tablesDone = 0;
    state.phase = 'database';
    pushLog(state, { at: now, phase, text: `manifest: ${event.count} tables` });
    return state;
  }

  if (phase === 'database') {
    state.phase = 'database';
    const idx = state.tableIndex.get(event.item);
    if (idx === undefined) {
      // Table absent from the manifest (manifest caps at 120) — still count it as progress.
      state.tablesDone = prev.tablesDone + 1;
    } else {
      const table = state.tables[idx];
      if (table.state !== 'done') {
        const tables = state.tables.slice();
        tables[idx] = { ...table, state: 'done', actualRows: Number(event.rows) || 0 };
        state.tables = tables;
        state.doneTableBytes = prev.doneTableBytes + table.bytes;
        state.tablesDone = prev.tablesDone + 1;
      }
    }
    pushLog(state, { at: now, phase, text: event.item, rows: Number(event.rows) || 0 });
    return state;
  }

  if (phase === 'storage') {
    state.phase = 'storage';
    state.storage = {
      completed: Number(event.completed) || prev.storage.completed,
      total: Number(event.total) || prev.storage.total,
      bytes: prev.storage.bytes + (Number(event.bytes) || 0),
      current: event.item || null,
    };
    pushLog(state, { at: now, phase, text: event.item, bytes: Number(event.bytes) || 0 });
    return state;
  }

  if (phase === 'functions') {
    state.phase = 'functions';
    state.functions = { done: prev.functions.done + 1, current: event.item || null };
    pushLog(state, { at: now, phase, text: event.item });
    return state;
  }

  if (phase === 'scan') {
    state.phase = 'scan';
    pushLog(state, { at: now, phase, text: event.item });
    return state;
  }

  if (phase === 'done') {
    state.phase = 'done';
    state.status = 'done';
    state.captureStatus = event.status || null;
    pushLog(state, { at: now, phase, text: event.status || 'done' });
    return state;
  }

  if (phase === 'failed') {
    state.phase = 'failed';
    state.status = 'failed';
    state.error = event.item || 'Capture failed';
    pushLog(state, { at: now, phase, text: state.error });
    return state;
  }

  state.phase = phase;
  pushLog(state, { at: now, phase, text: event.item || '' });
  return state;
}

/**
 * Byte-weighted completion for the database layer, 0..1.
 * Falls back to table-count ratio only when no byte estimates exist at all (e.g. an engine
 * older than the pg_total_relation_size manifest), and reports which basis was used so the
 * UI can label an estimate honestly instead of implying precision it does not have.
 */
export function databaseProgress(state) {
  if (state.totalTableBytes > 0) {
    return {
      ratio: Math.min(1, state.doneTableBytes / state.totalTableBytes),
      basis: 'bytes',
      done: state.doneTableBytes,
      total: state.totalTableBytes,
    };
  }
  const total = state.tables.length;
  if (!total) return { ratio: 0, basis: 'unknown', done: 0, total: 0 };
  return { ratio: Math.min(1, state.tablesDone / total), basis: 'count', done: state.tablesDone, total };
}

export function storageProgress(state) {
  const { completed, total } = state.storage;
  if (!total) return { ratio: 0, completed, total: 0 };
  return { ratio: Math.min(1, completed / total), completed, total };
}

/** Throughput in bytes/sec over the run so far; null until enough signal to be meaningful. */
export function throughput(state, now = Date.now()) {
  const elapsed = (now - (state.startedAt || now)) / 1000;
  if (elapsed < 1) return null;
  const bytes = state.doneTableBytes + state.storage.bytes;
  if (bytes <= 0) return null;
  return bytes / elapsed;
}

/** Remaining seconds based on observed throughput; null when not yet estimable. */
export function etaSeconds(state, now = Date.now()) {
  const rate = throughput(state, now);
  if (!rate) return null;
  const remaining = Math.max(0, state.totalTableBytes - state.doneTableBytes);
  if (remaining <= 0) return null;
  return remaining / rate;
}
