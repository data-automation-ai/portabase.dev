import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CAPTURE_LOG_PATH = 'logs/capture.json';
const COMPONENTS = new Set(['database', 'storage', 'functions', 'auth']);
const FINAL_STATES = new Set(['COMPLETE', 'PARTIAL', 'SELECTIVE', 'TRIAL']);
const COUNT_FIELDS = ['count', 'availableCount', 'bucketCount', 'objectCount', 'totalBytes', 'omittedObjectCount', 'omittedBytes', 'downloaded', 'cacheHits', 'skippedUnchanged', 'deltaReused'];
const SUMMARY_FIELDS = ['tables', 'rows', 'authUsers', 'policies', 'databaseFunctions', 'triggers'];

/** Private capsule diagnostics only. No console interception, telemetry, names, or raw errors. */
export function createCaptureLog({ now = () => Date.now(), maxRecords = 32 } = {}) {
  if (!Number.isInteger(maxRecords) || maxRecords < 2 || maxRecords > 128) throw new Error('invalid_capture_log_limit');
  const records = [];
  let droppedRecords = 0;
  let finished = false;
  const starts = new Map();
  function timestamp() { return new Date(now()).toISOString(); }
  function componentName(component) {
    if (!COMPONENTS.has(component)) throw new Error('invalid_capture_log_component');
    return component;
  }
  function append(record) {
    if (finished) throw new Error('capture_log_already_finished');
    // Reserve one slot for the final capture outcome even when detail is truncated.
    if (records.length >= maxRecords - 1) { droppedRecords++; return; }
    records.push({ sequence: records.length + 1, at: timestamp(), ...record });
  }
  append({ event: 'capture.started' });
  return {
    start(component) {
      componentName(component);
      starts.set(component, now());
      append({ event: 'component.started', component });
    },
    skip(component) {
      append({ event: 'component.skipped', component: componentName(component), outcome: 'skipped' });
    },
    complete(component, result = {}) {
      componentName(component);
      const counts = {};
      for (const key of COUNT_FIELDS) if (Number.isSafeInteger(result?.[key]) && result[key] >= 0) counts[key] = result[key];
      const summary = {};
      for (const key of SUMMARY_FIELDS) if (Number.isSafeInteger(result?.summary?.[key]) && result.summary[key] >= 0) summary[key] = result.summary[key];
      const record = {
        event: 'component.finished', component,
        outcome: result?.skipped === true ? 'skipped' : result?.complete === true ? 'complete' : 'partial',
        limited: result?.limited === true, inventoryOnly: result?.inventoryOnly === true,
        counts, summary,
      };
      if (typeof result?.summary?.approximateRows === 'boolean') record.approximateRows = result.summary.approximateRows;
      const duration = now() - starts.get(component);
      if (Number.isSafeInteger(duration) && duration >= 0) record.durationMs = duration;
      append(record);
    },
    fail(component) {
      // Deliberately accept no Error object: provider output can contain secrets.
      append({ event: 'component.failed', component: componentName(component), outcome: 'failed', errorCode: 'capture_failed' });
    },
    async write(rawDir, status) {
      if (finished) throw new Error('capture_log_already_finished');
      if (!FINAL_STATES.has(status)) throw new Error('invalid_capture_log_status');
      records.push({ sequence: records.length + 1, at: timestamp(), event: 'capture.finished', status });
      finished = true;
      const document = {
        formatVersion: 1,
        scope: 'capture-before-archive',
        excludes: ['archive-packaging', 'encryption', 'upload', 'destination-verification'],
        truncated: droppedRecords > 0,
        droppedRecords,
        records,
      };
      const bytes = `${JSON.stringify(document, null, 2)}\n`;
      await mkdir(join(rawDir, 'logs'), { recursive: true, mode: 0o700 });
      await writeFile(join(rawDir, CAPTURE_LOG_PATH), bytes, { flag: 'wx', mode: 0o600 });
      return { path: CAPTURE_LOG_PATH, formatVersion: 1, scope: document.scope, sha256: createHash('sha256').update(bytes).digest('hex') };
    },
  };
}
