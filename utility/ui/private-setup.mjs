import { randomUUID, createHash } from 'node:crypto';
import { lstat, mkdir, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { RUNNER_ID_RE } from '../../cloud/runner/config-reference.mjs';
import { loadPrivateEngineConfig, resolvePrivateJob } from '../../cloud/runner/private-config.mjs';

export const PRIVATE_SETUP_MAX_BYTES = 256 * 1024;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const count = value => Number.isSafeInteger(value) && value >= 0;
function projectDatabase(database) {
  if (database?.ok !== true) fail('inventory_unavailable', 409);
  const tables = database.data?.tables;
  if (!Array.isArray(tables) || tables.length > 5000) fail('invalid_inventory', 409);
  const projected = [];
  const keys = new Set();
  for (const table of tables) {
    if (!table || typeof table.schema !== 'string' || typeof table.name !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(table.schema) || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(table.name)
      || `${table.schema}.${table.name}`.length > 256 || !count(table.bytes)
      || !['structure + rows', 'rows', 'structure', 'recreated'].includes(table.capsule)) fail('invalid_inventory', 409);
    const key = `${table.schema}.${table.name}`;
    if (keys.has(key)) fail('invalid_inventory', 409);
    keys.add(key);
    projected.push({ key, schema: table.schema, name: table.name, rows: count(table.rows) ? table.rows : 0,
      bytes: table.bytes, selectable: table.capsule === 'structure + rows' || table.capsule === 'rows' });
  }
  return { tables: projected, databaseBytes: count(database.data?.databaseBytes) ? database.data.databaseBytes
    : projected.reduce((sum, row) => sum + row.bytes, 0), estimatedRows: projected.reduce((sum, row) => sum + row.rows, 0) };
}
function projectStorage(storage) {
  if (storage?.ok !== true) fail('inventory_unavailable', 409);
  const buckets = storage.data?.buckets;
  if (!Array.isArray(buckets) || buckets.length > 1000) fail('invalid_inventory', 409);
  const projected = [], keys = new Set();
  for (const bucket of buckets) {
    if (!bucket || typeof bucket.id !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(bucket.id)
      || !count(bucket.totalBytes) || !count(bucket.objectCount) || keys.has(bucket.id)) fail('invalid_inventory', 409);
    keys.add(bucket.id);
    projected.push({ key: bucket.id, bytes: bucket.totalBytes, objectCount: bucket.objectCount });
  }
  return { buckets: projected, objectBytes: projected.reduce((sum, row) => sum + row.bytes, 0),
    objectCount: projected.reduce((sum, row) => sum + row.objectCount, 0) };
}
function projectInventory(snapshot, projectRef) {
  if (snapshot?.project?.ref !== projectRef) fail('inventory_unavailable', 409);
  const database = projectDatabase(snapshot.database), storage = projectStorage(snapshot.storage);
  const projected = { generatedAt: snapshot.generatedAt || new Date().toISOString(), tables: database.tables, buckets: storage.buckets };
  if (Buffer.byteLength(JSON.stringify(projected)) > PRIVATE_SETUP_MAX_BYTES
    || !count([...projected.tables, ...projected.buckets].reduce((sum, row) => sum + row.bytes, 0))) fail('inventory_too_large', 413);
  projected.overview = {
    databaseBytes: database.databaseBytes,
    tableBytes: projected.tables.reduce((sum, row) => sum + row.bytes, 0),
    estimatedRows: database.estimatedRows,
    objectBytes: storage.objectBytes,
    objectCount: storage.objectCount,
    functionCount: snapshot.functions?.ok === true && Array.isArray(snapshot.functions.data) ? snapshot.functions.data.length : null,
  };
  return projected;
}
function chosen(value, allowed) {
  if (!Array.isArray(value) || value.length > allowed.length || new Set(value).size !== value.length
    || value.some(item => typeof item !== 'string' || !allowed.includes(item))) fail('invalid_selection');
  return new Set(value);
}

/** No network, queue or engine execution. Each save creates a new immutable ref. */
async function scratchStatus(config) {
  let path = resolve(config.root, config.value.backupDirectory);
  for (;;) {
    try { if ((await lstat(path)).isDirectory()) break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(path);
    if (parent === path) fail('private_scratch_unavailable', 409);
    path = parent;
  }
  const status = await statfs(path);
  const freeBytes = Number(status.bavail) * Number(status.bsize);
  const totalBytes = Number(status.blocks) * Number(status.bsize);
  if (!Number.isSafeInteger(freeBytes) || freeBytes < 0 || !Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    fail('private_scratch_unavailable', 409);
  }
  const linuxRunner = process.platform === 'linux';
  return {
    authoritative: linuxRunner,
    runtimePlatform: process.platform,
    runtimeArchitecture: process.arch,
    freeBytes: linuxRunner ? freeBytes : null,
    totalBytes: linuxRunner ? totalBytes : null,
    planningMultiplier: 3, fixedReserveBytes: 512 * 1024 * 1024,
    model: 'raw capture + archive + encrypted capsule overlap',
    ...(!linuxRunner ? { reason: 'linux_runner_required' } : {}),
  };
}

export async function createPrivateSetup({ directory, runnerId, projectRef, engineConfigPath, collect, stateStore }) {
  if (typeof runnerId !== 'string' || !RUNNER_ID_RE.test(runnerId) || typeof collect !== 'function') fail('private_setup_required');
  const options = { directory, projectRef, engineConfigPath };
  await loadPrivateEngineConfig(options);
  let current = null, generation = 0, saving = false;
  return {
    async bootstrap() {
      const config = await loadPrivateEngineConfig(options);
      return { runnerId, projectRef, scratch: await scratchStatus(config), state: stateStore?.summary() || { persistent: false } };
    },
    async inspect(onProgress = null) {
      if (saving) fail('private_setup_busy', 409);
      const thisGeneration = ++generation;
      current = null; // a failed or overlapping refresh invalidates every prior save token
      try {
        const config = await loadPrivateEngineConfig(options);
        const progress = event => {
          if (typeof onProgress !== 'function' || generation !== thisGeneration || !event?.type) return;
          if (event.result?.ok !== true) return onProgress({ type: event.type, ok: false });
          if (event.type === 'database') {
            const database = projectDatabase(event.result);
            return onProgress({ type: 'database', ok: true, tables: database.tables,
              overview: { databaseBytes: database.databaseBytes, estimatedRows: database.estimatedRows } });
          }
          if (event.type === 'storage') {
            const storage = projectStorage(event.result);
            return onProgress({ type: 'storage', ok: true, buckets: storage.buckets,
              overview: { objectBytes: storage.objectBytes, objectCount: storage.objectCount } });
          }
          if (event.type === 'functions') {
            const rows = event.result.data;
            if (!Array.isArray(rows) || rows.length > 1000) fail('invalid_inventory', 409);
            return onProgress({ type: 'functions', ok: true, functionCount: rows.length });
          }
        };
        const inventory = projectInventory(await collect(config.value, progress), projectRef);
        if (generation !== thisGeneration) fail('inventory_changed', 409);
        current = { ...inventory, inventoryRevision: randomUUID(), configDigest: config.digest };
        stateStore?.persistInventory(current);
        return { runnerId, projectRef, ...inventory, inventoryRevision: current.inventoryRevision,
          scratch: await scratchStatus(config), state: stateStore?.summary() || { persistent: false } };
      } catch { current = null; fail('inventory_unavailable', 409); }
    },
    async save(body) {
      const keys = ['inventoryRevision', 'selectedTables', 'selectedBuckets', 'incrementalBinary', 'confirmEmpty'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))
        || typeof body.incrementalBinary !== 'boolean' || typeof body.confirmEmpty !== 'boolean') fail('invalid_selection');
      if (!current || body.inventoryRevision !== current.inventoryRevision) fail('inventory_changed', 409);
      const snapshot = current;
      const tables = snapshot.tables.filter(row => row.selectable).map(row => row.key), buckets = snapshot.buckets.map(row => row.key);
      const selectedTables = chosen(body.selectedTables, tables), selectedBuckets = chosen(body.selectedBuckets, buckets);
      if (!selectedTables.size && !selectedBuckets.size && !body.confirmEmpty) fail('empty_selection_confirmation_required');
      current = null; // consume before any await; one inspected selection authorizes one revision
      saving = true;
      try {
      const config = await loadPrivateEngineConfig(options);
      if (config.digest !== snapshot.configDigest) fail('inventory_changed', 409);
      const configRef = randomUUID();
      const reference = { version: 2, runnerId, configRef, configRevision: 1 };
      const engineBytes = `${JSON.stringify(config.value, null, 2)}\n`;
      const record = { ...reference, operation: 'backup', projectRef, engineConfigPath: `${configRef}/engine-1.json`,
        engineConfigSha256: createHash('sha256').update(engineBytes).digest('hex'),
        excludeTables: tables.filter(key => !selectedTables.has(key)), excludeBuckets: buckets.filter(key => !selectedBuckets.has(key)),
        incrementalBinary: body.incrementalBinary };
      const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
      if (Buffer.byteLength(recordBytes) > PRIVATE_SETUP_MAX_BYTES || Buffer.byteLength(engineBytes) > PRIVATE_SETUP_MAX_BYTES) fail('private_config_too_large', 413);
      // A fresh random directory and exclusive files never overwrite an earlier revision.
      const revisionDirectory = join(config.root, configRef);
      await mkdir(revisionDirectory, { mode: 0o700 });
      await writeFile(join(revisionDirectory, 'engine-1.json'), engineBytes, { flag: 'wx', mode: 0o600 });
      await writeFile(join(revisionDirectory, '1.json'), recordBytes, { flag: 'wx', mode: 0o600 });
      await resolvePrivateJob({ type: 'backup', payload: reference }, { directory: config.root, runnerId, projectRef });
      const selectedBytes = snapshot.tables.filter(row => selectedTables.has(row.key)).reduce((sum, row) => sum + row.bytes, 0)
        + snapshot.buckets.filter(row => selectedBuckets.has(row.key)).reduce((sum, row) => sum + row.bytes, 0);
      stateStore?.persistSelection({ inventoryId: snapshot.inventoryRevision, configRef,
        tableCount: selectedTables.size, bucketCount: selectedBuckets.size, selectedBytes,
        incrementalBinary: body.incrementalBinary });
      return { saved: true, intent: { ...reference, type: 'backup' } };
      } finally { saving = false; }
    },
  };
}
