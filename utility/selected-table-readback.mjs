import { createReadStream } from 'node:fs';
import { createDataSqlPolicy, DATA_SQL_HEADER_BYTES } from './data-sql-policy.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const validName = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(value);
const key = row => JSON.stringify([row.schema, row.table]);
const quoted = name => `"${name.replaceAll('"', '""')}"`;

function selectedTables(plan) {
  if (!Array.isArray(plan?.tables) || plan.tables.length > 5000) fail('selected_readback_invalid_plan');
  const seen = new Set(), selected = [];
  for (const row of plan.tables) {
    if (!row || typeof row !== 'object' || !validName(row.schema) || !validName(row.table)
      || typeof row.selected !== 'boolean' || seen.has(key(row))) fail('selected_readback_invalid_plan');
    seen.add(key(row));
    if (row.selected) selected.push({ schema: row.schema, table: row.table });
  }
  return selected;
}

/** Count text COPY records without retaining or decoding row contents. Headers
 * are bounded; inside a row only its first three bytes survive between chunks,
 * enough to recognize the exact LF/CRLF COPY terminator. */
async function expectedCounts(dataSqlPath, selected) {
  const policy = createDataSqlPolicy(), wanted = new Set(selected.map(key)), counts = new Map();
  let current = null, rowCount = 0, lineBytes = 0, prefix = Buffer.alloc(0);
  function finishLine() {
    if (current) {
      const terminator = prefix[0] === 0x5c && prefix[1] === 0x2e
        && (lineBytes === 2 || lineBytes === 3 && prefix[2] === 0x0d);
      const entry = policy.line(terminator ? '\\.' : '');
      if (entry.kind === 'terminator') {
        if (wanted.has(key(current))) counts.set(key(current), rowCount);
        current = null; rowCount = 0;
      } else {
        rowCount++;
        if (!Number.isSafeInteger(rowCount)) fail('selected_readback_count_overflow');
      }
    } else {
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(prefix).replace(/\r$/, ''); }
      catch { fail('selected_readback_invalid_sql'); }
      const entry = policy.line(text);
      if (entry.kind === 'copy') current = entry.table;
    }
    prefix = Buffer.alloc(0); lineBytes = 0;
  }
  try {
    for await (const chunk of createReadStream(dataSqlPath)) {
      for (let offset = 0; offset < chunk.length;) {
        const newline = chunk.indexOf(10, offset), end = newline < 0 ? chunk.length : newline;
        const limit = current ? 3 : DATA_SQL_HEADER_BYTES + 1;
        if (prefix.length < limit) prefix = Buffer.concat([prefix, chunk.subarray(offset, Math.min(end, offset + limit - prefix.length))]);
        lineBytes += end - offset;
        if (!Number.isSafeInteger(lineBytes) || !current && lineBytes > DATA_SQL_HEADER_BYTES) fail('selected_readback_invalid_sql');
        if (newline >= 0) finishLine();
        offset = newline < 0 ? chunk.length : newline + 1;
      }
    }
    if (lineBytes) finishLine();
    policy.finish();
  } catch (error) {
    if (error?.code === 'selected_readback_count_overflow') throw error;
    fail('selected_readback_invalid_sql');
  }
  return counts;
}

function countValue(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

/** queryCount(sql) returns one trimmed PostgreSQL count(*)::text string, or
 * throws. Caller owns target authentication and uses this only after restore.
 * Counts do not establish row-content equality or application functionality. */
export async function verifySelectedTableRows({ dataSqlPath, plan, queryCount } = {}) {
  if (typeof queryCount !== 'function') fail('selected_readback_query_required');
  const selected = selectedTables(plan);
  if (!selected.length) return { verified: true, skipped: true, comparison: 'row-counts-only', selectedTableCount: 0, tables: [] };
  const counts = await expectedCounts(dataSqlPath, selected);
  const missing = selected.some(row => !counts.has(key(row)));
  const tables = [];
  for (const row of selected) {
    const expectedRows = counts.get(key(row));
    if (missing) {
      tables.push({ ...row, expectedRows: expectedRows ?? null, actualRows: null, verified: false,
        reason: expectedRows === undefined ? 'missing_copy_block' : 'not_queried' });
      continue;
    }
    let actualRows, reason;
    try {
      actualRows = countValue(await queryCount(`SELECT count(*)::text FROM ${quoted(row.schema)}.${quoted(row.table)};`));
      if (actualRows === null) reason = 'invalid_count';
      else if (actualRows !== expectedRows) reason = 'row_count_mismatch';
    } catch { actualRows = null; reason = 'query_failed'; }
    tables.push({ ...row, expectedRows, actualRows, verified: !reason, ...(reason ? { reason } : {}) });
  }
  return { verified: tables.every(row => row.verified), comparison: 'row-counts-only', selectedTableCount: selected.length, tables };
}
