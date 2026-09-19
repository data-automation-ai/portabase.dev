/**
 * Two-layer Cloud control-plane store.
 *
 *   Primary: hosted Supabase (Portabase Cloud project)
 *   Replica: ONE persistent on-disk sqlite file
 *
 * If the primary is down: reads and writes continue on the sqlite file.
 * Writes are queued in sync_outbox and replayed when the primary returns.
 *
 * Not a Netlify Function store (ephemeral disk). Not :memory:.
 */
import { randomUUID } from 'node:crypto';
import { copySqliteFile, startScheduledBackup } from './backup.mjs';
import { ESSENTIAL_COLLECTIONS, allowedFields, pickAllowedRow, projectEssentialRow } from './forbidden.mjs';
import { openPersistentSqlite } from './sqlite-file.mjs';

function isoNow() {
  return new Date().toISOString();
}

function withIds(collection, row, now) {
  const next = { ...row };
  if (!next.id) next.id = `${collection.slice(0, 3)}_${randomUUID()}`;
  if (collection !== 'capsule_hashes') {
    if (!next.created_at) next.created_at = now;
    if (collection !== 'jobs' || next.updated_at === undefined) {
      next.updated_at = now;
    }
  } else if (!next.created_at) {
    next.created_at = now;
  }
  if (collection === 'jobs') {
    if (!next.updated_at) next.updated_at = now;
    if (!next.status) next.status = 'queued';
  }
  if (collection === 'capsule_hashes' && !next.algorithm) next.algorithm = 'sha256';
  if (collection === 'subscribers') {
    next.email = String(next.email).trim().toLowerCase();
    if (!next.status) next.status = 'none';
  }
  if (collection === 'promo_codes') {
    next.code = String(next.code).trim().toUpperCase();
  }
  if (collection === 'jobs' && !String(next.type || '').trim()) {
    const err = new Error('jobs.type is required');
    err.code = 'invalid_type';
    err.status = 400;
    throw err;
  }
  return pickAllowedRow(collection, next);
}

function bindRow(collection, row) {
  const out = {};
  for (const key of allowedFields(collection)) {
    out[key] = row[key] === undefined ? null : row[key];
  }
  return out;
}

function rowFromSqlite(row) {
  if (!row) return null;
  return { ...row };
}

export function createControlPlaneStore({ filePath, primary, now = isoNow } = {}) {
  if (!primary) {
    const err = new Error('primary adapter is required (hosted Supabase or an injected test double)');
    err.code = 'primary_required';
    throw err;
  }
  const { db, filePath: resolvedPath } = openPersistentSqlite(filePath);
  db.prepare(`
    INSERT INTO replica_meta (key, value) VALUES ('opened_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(now());

  const listStmt = Object.fromEntries(
    ESSENTIAL_COLLECTIONS.map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY created_at DESC`)]),
  );
  const getStmt = Object.fromEntries(
    ESSENTIAL_COLLECTIONS.map((name) => [name, db.prepare(`SELECT * FROM ${name} WHERE id = ?`)]),
  );
  const deleteStmt = Object.fromEntries(
    ESSENTIAL_COLLECTIONS.map((name) => [name, db.prepare(`DELETE FROM ${name} WHERE id = ?`)]),
  );

  const upsertSql = {
    subscribers: `INSERT INTO subscribers (id, email, user_id, status, plan_id, created_at, updated_at)
      VALUES (@id, @email, @user_id, @status, @plan_id, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email, user_id = excluded.user_id, status = excluded.status,
        plan_id = excluded.plan_id, updated_at = excluded.updated_at`,
    promo_codes: `INSERT INTO promo_codes (id, code, plan_id, percent_off, expires_at, created_at, updated_at)
      VALUES (@id, @code, @plan_id, @percent_off, @expires_at, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code, plan_id = excluded.plan_id, percent_off = excluded.percent_off,
        expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    billing_metadata: `INSERT INTO billing_metadata (id, subscriber_id, square_customer_id, square_subscription_id, trial_ends_at, current_period_end, price_monthly_cents, created_at, updated_at)
      VALUES (@id, @subscriber_id, @square_customer_id, @square_subscription_id, @trial_ends_at, @current_period_end, @price_monthly_cents, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        subscriber_id = excluded.subscriber_id, square_customer_id = excluded.square_customer_id,
        square_subscription_id = excluded.square_subscription_id, trial_ends_at = excluded.trial_ends_at,
        current_period_end = excluded.current_period_end, price_monthly_cents = excluded.price_monthly_cents,
        updated_at = excluded.updated_at`,
    jobs: `INSERT INTO jobs (id, type, status, project_ref, capsule_hash, created_at, updated_at)
      VALUES (@id, @type, @status, @project_ref, @capsule_hash, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type, status = excluded.status, project_ref = excluded.project_ref,
        capsule_hash = excluded.capsule_hash, updated_at = excluded.updated_at`,
    capsule_hashes: `INSERT INTO capsule_hashes (id, hash, algorithm, created_at)
      VALUES (@id, @hash, @algorithm, @created_at)
      ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, algorithm = excluded.algorithm`,
  };
  const upsertStmt = Object.fromEntries(
    ESSENTIAL_COLLECTIONS.map((name) => [name, db.prepare(upsertSql[name])]),
  );

  const enqueueStmt = db.prepare(`
    INSERT INTO sync_outbox (id, collection, op, row_id, payload_json, created_at, attempts, last_error)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
  `);
  const outboxListStmt = db.prepare('SELECT * FROM sync_outbox ORDER BY created_at ASC');
  const outboxDeleteStmt = db.prepare('DELETE FROM sync_outbox WHERE id = ?');
  const outboxErrorStmt = db.prepare('UPDATE sync_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?');
  const metaSetStmt = db.prepare(`
    INSERT INTO replica_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const metaGetStmt = db.prepare('SELECT value FROM replica_meta WHERE key = ?');
  const idsStmt = Object.fromEntries(
    ESSENTIAL_COLLECTIONS.map((name) => [name, db.prepare(`SELECT id FROM ${name}`)]),
  );

  function writeLocal(collection, row) {
    upsertStmt[collection].run(bindRow(collection, row));
  }

  function enqueue(collection, op, row) {
    enqueueStmt.run(randomUUID(), collection, op, row.id, JSON.stringify(row), now());
  }

  async function primaryUp() {
    try {
      await primary.ping();
      return true;
    } catch {
      return false;
    }
  }

  async function list(collection) {
    if (!ESSENTIAL_COLLECTIONS.includes(collection)) {
      const err = new Error(`Unknown collection: ${collection}`);
      err.code = 'unknown_collection';
      throw err;
    }
    if (await primaryUp()) {
      try {
        const rows = await primary.list(collection);
        for (const row of rows) writeLocal(collection, projectEssentialRow(collection, row));
        return rows.map((row) => ({ ...row }));
      } catch {
        // fall through to replica
      }
    }
    return listStmt[collection].all().map(rowFromSqlite);
  }

  async function get(collection, id) {
    const rows = await list(collection);
    return rows.find((row) => row.id === id) || null;
  }

  async function write(collection, row, { op = 'upsert' } = {}) {
    const record = withIds(collection, row, now());
    writeLocal(collection, record);

    if (await primaryUp()) {
      try {
        if (op === 'delete') {
          await primary.remove(collection, record.id);
          deleteStmt[collection].run(record.id);
        } else {
          await primary.upsert(collection, record);
        }
        return { record, source: 'primary', queued: false };
      } catch {
        enqueue(collection, op, record);
        return { record, source: 'sqlite', queued: true };
      }
    }

    enqueue(collection, op, record);
    return { record, source: 'sqlite', queued: true };
  }

  async function syncBack() {
    if (!(await primaryUp())) {
      const err = new Error('primary_unavailable');
      err.code = 'primary_unavailable';
      throw err;
    }
    const pending = outboxListStmt.all();
    let applied = 0;
    let failed = 0;
    for (const item of pending) {
      const payload = JSON.parse(item.payload_json);
      try {
        if (item.op === 'delete') {
          await primary.remove(item.collection, item.row_id);
        } else {
          await primary.upsert(item.collection, payload);
        }
        outboxDeleteStmt.run(item.id);
        applied += 1;
      } catch (err) {
        outboxErrorStmt.run(String(err.message || err), item.id);
        failed += 1;
      }
    }
    metaSetStmt.run('last_sync_at', now());
    return { applied, failed, remaining: outboxListStmt.all().length };
  }

  async function replicate() {
    if (!(await primaryUp())) {
      const err = new Error('primary_unavailable');
      err.code = 'primary_unavailable';
      throw err;
    }
    const pending = outboxListStmt.all();
    if (pending.length) {
      await syncBack();
    }
    const counts = {};
    for (const collection of ESSENTIAL_COLLECTIONS) {
      const rows = await primary.list(collection);
      const keep = new Set(rows.map((row) => row.id));
      for (const { id } of idsStmt[collection].all()) {
        if (!keep.has(id)) deleteStmt[collection].run(id);
      }
      for (const row of rows) writeLocal(collection, projectEssentialRow(collection, row));
      counts[collection] = rows.length;
    }
    metaSetStmt.run('last_replicate_at', now());
    return { counts };
  }

  function backup(destPath) {
    const result = copySqliteFile(db, destPath, { sourcePath: resolvedPath });
    metaSetStmt.run('last_backup_at', now());
    return result;
  }

  function scheduleBackup({ destDir, intervalMs }) {
    return startScheduledBackup({ db, destDir, intervalMs, sourcePath: resolvedPath });
  }

  function outbox() {
    return outboxListStmt.all().map(rowFromSqlite);
  }

  function meta(key) {
    const row = metaGetStmt.get(key);
    return row ? row.value : null;
  }

  async function health() {
    const up = await primaryUp();
    return {
      primary: up ? 'up' : 'down',
      sqlitePath: resolvedPath,
      outboxCount: outbox().length,
      schemaVersion: meta('schema_version'),
      lastReplicateAt: meta('last_replicate_at'),
      lastSyncAt: meta('last_sync_at'),
      lastBackupAt: meta('last_backup_at'),
    };
  }

  function close() {
    db.close();
  }

  return {
    filePath: resolvedPath,
    db,
    list,
    get,
    write,
    replicate,
    syncBack,
    backup,
    scheduleBackup,
    outbox,
    meta,
    health,
    close,
  };
}
