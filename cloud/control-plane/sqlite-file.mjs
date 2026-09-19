/**
 * Open or create the single persistent on-disk sqlite replica.
 * Refuses :memory:, file: memory URIs, and F: paths.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

export const SCHEMA_VERSION = '1';

export function isMemorySqlitePath(filePath) {
  const raw = String(filePath || '').trim().toLowerCase();
  if (!raw) return false;
  if (raw === ':memory:') return true;
  if (raw.startsWith('file::memory:') || raw.startsWith('file:memory:')) return true;
  if (/(?:[?&])mode=memory(?:&|$)/i.test(raw)) return true;
  return false;
}

export function isForbiddenDrivePath(filePath) {
  const raw = String(filePath || '').trim();
  return /^[fF]:[\\/]/.test(raw) || /^\/mnt\/f(?=\/|$)/i.test(raw);
}

export function assertPersistentSqlitePath(filePath) {
  if (filePath == null || String(filePath).trim() === '') {
    const err = new Error('PORTABASE_CLOUD_SQLITE_PATH is required — one persistent .db file, not :memory:');
    err.code = 'sqlite_path_required';
    throw err;
  }
  const raw = String(filePath).trim();
  if (isMemorySqlitePath(raw)) {
    const err = new Error('In-memory sqlite is refused. Cloud uses one persistent on-disk file.');
    err.code = 'sqlite_memory_refused';
    throw err;
  }
  if (isForbiddenDrivePath(raw)) {
    const err = new Error('Refusing F: (or /mnt/f) for the control-plane replica');
    err.code = 'f_drive_refused';
    throw err;
  }
  return resolve(raw);
}

export function openPersistentSqlite(filePath) {
  const path = assertPersistentSqlitePath(filePath);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  db.prepare(`
    INSERT INTO replica_meta (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(SCHEMA_VERSION);
  return { db, filePath: path };
}
