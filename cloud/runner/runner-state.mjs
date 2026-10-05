import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validatePrivateDirectory } from './private-config.mjs';

const PROJECT_REF = /^[a-z0-9]{20}$/;
const RUNNER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

export async function openRunnerState({ directory, runnerId, projectRef }) {
  if (!RUNNER_ID.test(runnerId || '') || !PROJECT_REF.test(projectRef || '')) fail('invalid_runner_state');
  const root = await validatePrivateDirectory(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'runner-state.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS runner_binding (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      runner_id TEXT NOT NULL,
      project_ref TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      table_count INTEGER NOT NULL,
      table_bytes INTEGER NOT NULL,
      estimated_rows INTEGER NOT NULL,
      bucket_count INTEGER NOT NULL,
      object_count INTEGER NOT NULL,
      object_bytes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_tables (
      snapshot_id TEXT NOT NULL REFERENCES inventory_snapshots(id) ON DELETE CASCADE,
      table_key TEXT NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      estimated_rows INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      selectable INTEGER NOT NULL CHECK (selectable IN (0, 1)),
      PRIMARY KEY (snapshot_id, table_key)
    );
    CREATE TABLE IF NOT EXISTS inventory_buckets (
      snapshot_id TEXT NOT NULL REFERENCES inventory_snapshots(id) ON DELETE CASCADE,
      bucket_key TEXT NOT NULL,
      object_count INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      PRIMARY KEY (snapshot_id, bucket_key)
    );
    CREATE TABLE IF NOT EXISTS selection_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      inventory_id TEXT NOT NULL,
      config_ref TEXT NOT NULL,
      table_count INTEGER NOT NULL,
      bucket_count INTEGER NOT NULL,
      selected_bytes INTEGER NOT NULL,
      incremental_binary INTEGER NOT NULL CHECK (incremental_binary IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS runner_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      state TEXT NOT NULL,
      detail_json TEXT NOT NULL
    );
  `);
  await chmod(path, 0o600);
  const binding = db.prepare('SELECT runner_id, project_ref FROM runner_binding WHERE singleton = 1').get();
  if (binding && (binding.runner_id !== runnerId || binding.project_ref !== projectRef)) {
    db.close(); fail('runner_state_binding_mismatch');
  }
  if (!binding) db.prepare('INSERT INTO runner_binding(singleton, runner_id, project_ref, created_at) VALUES(1, ?, ?, ?)')
    .run(runnerId, projectRef, new Date().toISOString());

  const recordEvent = (eventType, state, detail = {}) => {
    const json = JSON.stringify(detail);
    if (json.length > 16 * 1024) fail('runner_state_event_too_large');
    db.prepare('INSERT INTO runner_events(occurred_at, event_type, state, detail_json) VALUES(?, ?, ?, ?)')
      .run(new Date().toISOString(), eventType, state, json);
    db.prepare('DELETE FROM runner_events WHERE id NOT IN (SELECT id FROM runner_events ORDER BY id DESC LIMIT 500)').run();
  };

  return {
    path,
    persistInventory(inventory) {
      const id = inventory.inventoryRevision, createdAt = inventory.generatedAt || new Date().toISOString();
      const tableBytes = inventory.tables.reduce((sum, row) => sum + row.bytes, 0);
      const estimatedRows = inventory.tables.reduce((sum, row) => sum + row.rows, 0);
      const objectBytes = inventory.buckets.reduce((sum, row) => sum + row.bytes, 0);
      const objectCount = inventory.buckets.reduce((sum, row) => sum + row.objectCount, 0);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT INTO inventory_snapshots(id, created_at, table_count, table_bytes, estimated_rows, bucket_count, object_count, object_bytes)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(id, createdAt, inventory.tables.length, tableBytes, estimatedRows,
          inventory.buckets.length, objectCount, objectBytes);
        const tableStatement = db.prepare(`INSERT INTO inventory_tables(snapshot_id, table_key, schema_name, table_name, estimated_rows, total_bytes, selectable)
          VALUES(?, ?, ?, ?, ?, ?, ?)`);
        for (const row of inventory.tables) tableStatement.run(id, row.key, row.schema, row.name, row.rows, row.bytes, row.selectable ? 1 : 0);
        const bucketStatement = db.prepare(`INSERT INTO inventory_buckets(snapshot_id, bucket_key, object_count, total_bytes)
          VALUES(?, ?, ?, ?)`);
        for (const row of inventory.buckets) bucketStatement.run(id, row.key, row.objectCount, row.bytes);
        db.prepare('DELETE FROM inventory_snapshots WHERE id NOT IN (SELECT id FROM inventory_snapshots ORDER BY created_at DESC LIMIT 20)').run();
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      recordEvent('source.probed', 'complete', { tableCount: inventory.tables.length, tableBytes, estimatedRows,
        bucketCount: inventory.buckets.length, objectCount, objectBytes });
    },
    persistSelection({ inventoryId, configRef, tableCount, bucketCount, selectedBytes, incrementalBinary }) {
      db.prepare(`INSERT INTO selection_revisions(created_at, inventory_id, config_ref, table_count, bucket_count, selected_bytes, incremental_binary)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(new Date().toISOString(), inventoryId, configRef, tableCount, bucketCount,
        selectedBytes, incrementalBinary ? 1 : 0);
      recordEvent('selection.saved', 'ready', { tableCount, bucketCount, selectedBytes, incrementalBinary });
    },
    recordEvent,
    summary() {
      const latest = db.prepare('SELECT * FROM inventory_snapshots ORDER BY created_at DESC LIMIT 1').get() || null;
      const selections = db.prepare('SELECT COUNT(*) AS count FROM selection_revisions').get().count;
      const events = db.prepare('SELECT occurred_at AS occurredAt, event_type AS eventType, state, detail_json AS detail FROM runner_events ORDER BY id DESC LIMIT 12').all()
        .map(row => ({ ...row, detail: JSON.parse(row.detail) }));
      return { persistent: true, latestInventory: latest, selectionCount: selections, events };
    },
    close() { db.close(); },
  };
}
