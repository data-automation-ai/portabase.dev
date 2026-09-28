/**
 * Single-file sqlite backup: copy the persistent .db (VACUUM INTO).
 * On-demand and used by the schedule helper. Not a second store.
 */
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isForbiddenDrivePath } from './sqlite-file.mjs';

export function assertBackupDest(destPath) {
  if (destPath == null || String(destPath).trim() === '') {
    const err = new Error('backup destination is required');
    err.code = 'backup_dest_required';
    throw err;
  }
  const raw = String(destPath).trim();
  if (isForbiddenDrivePath(raw)) {
    const err = new Error('Refusing F: (or /mnt/f) as sqlite backup destination');
    err.code = 'f_drive_refused';
    throw err;
  }
  return resolve(raw);
}

export function timestampedBackupName(at = new Date()) {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `control-plane-${stamp}.db`;
}

export function resolveBackupFile(destPath, { destIsDirectory = false, at } = {}) {
  const dest = assertBackupDest(destPath);
  if (destIsDirectory) return join(dest, timestampedBackupName(at));
  return dest;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Produce a standalone copy of the open database at destPath.
 * Uses VACUUM INTO so WAL is folded into one file.
 */
export function copySqliteFile(db, destPath, { sourcePath } = {}) {
  const dest = assertBackupDest(destPath);
  if (sourcePath && resolve(sourcePath) === dest) {
    const err = new Error('backup destination must not be the live sqlite file');
    err.code = 'backup_overwrite_refused';
    throw err;
  }
  mkdirSync(dirname(dest), { recursive: true });
  try {
    if (statSync(dest).isFile()) rmSync(dest);
  } catch {
    // dest does not exist yet
  }
  db.exec(`VACUUM INTO ${sqlLiteral(dest)}`);
  const st = statSync(dest);
  if (!st.isFile() || st.size <= 0) {
    const err = new Error('backup copy is missing or empty');
    err.code = 'backup_failed';
    throw err;
  }
  return { destPath: dest, bytes: st.size };
}

export function startScheduledBackup({ db, destDir, intervalMs, sourcePath, now = () => new Date() }) {
  const dir = assertBackupDest(destDir);
  const ms = Number(intervalMs);
  if (!Number.isFinite(ms) || ms < 50) {
    const err = new Error('schedule interval must be ≥ 50 ms');
    err.code = 'invalid_interval';
    throw err;
  }

  const run = () => copySqliteFile(db, resolveBackupFile(dir, { destIsDirectory: true, at: now() }), { sourcePath });
  const first = run();
  const timer = setInterval(() => {
    try {
      run();
    } catch (err) {
      console.error('scheduled sqlite backup failed', err?.code || err?.message || err);
    }
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    first,
    intervalMs: ms,
    destDir: dir,
    stop() {
      clearInterval(timer);
    },
  };
}
