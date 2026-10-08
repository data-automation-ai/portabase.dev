// Deliberately limited pg_dump text-COPY grammar for selective row restore.
// This is not a general SQL parser. Unsupported dump forms must fail closed.
const fail = () => { throw Object.assign(new Error('Unsupported data SQL for selective restore.'), { code: 'unsupported_capsule_sql' }); };
export const DATA_SQL_HEADER_BYTES = 64 * 1024;
const name = '[A-Za-z_][A-Za-z0-9_$]{0,127}';
const identifier = `(?:"${name}"|${name})`;
const column = '(?:"(?:[^"\\x00-\\x1f\\x7f]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)';
const copy = new RegExp(`^COPY (${identifier})\\.(${identifier}) \\((${column}(?:, ${column})*)\\) FROM stdin;$`);
const sequence = new RegExp(`^SELECT pg_catalog\\.setval\\('(${identifier}\\.${identifier})', (-?[0-9]{1,19}), (true|false)\\);$`);
const normalize = text => text.startsWith('"') ? text.slice(1, -1) : text.toLowerCase();

export function parseDataCopyHeader(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > DATA_SQL_HEADER_BYTES) return null;
  const match = copy.exec(line);
  return match ? { schema: normalize(match[1]), table: normalize(match[2]) } : null;
}

const settings = new Set([
  'SET statement_timeout = 0;', 'SET lock_timeout = 0;',
  'SET idle_in_transaction_session_timeout = 0;', 'SET transaction_timeout = 0;',
  "SET client_encoding = 'UTF8';", 'SET standard_conforming_strings = on;',
  "SELECT pg_catalog.set_config('search_path', '', false);",
  'SET check_function_bodies = false;', 'SET xmloption = content;',
  'SET client_min_messages = warning;', 'SET row_security = off;',
  'SET session_replication_role = replica;', 'RESET ALL;',
]);

/** Validate only complete lines outside COPY blocks. A bounded reader may call
 * this directly while discarding COPY row bytes without materializing them. */
export function createDataSqlPreamblePolicy() {
  let restriction = null;
  return {
    line(line) {
      if (typeof line !== 'string' || Buffer.byteLength(line) > DATA_SQL_HEADER_BYTES || /[\x00-\x08\x0b-\x1f\x7f]/.test(line)) fail();
      if (!line.trim() || line.startsWith('--') || settings.has(line)) return;
      const marker = /^\\(restrict|unrestrict) ([A-Za-z0-9]{1,128})$/.exec(line);
      if (marker) {
        if (marker[1] === 'restrict') { if (restriction) fail(); restriction = marker[2]; }
        else { if (restriction !== marker[2]) fail(); restriction = null; }
        return;
      }
      const setval = sequence.exec(line);
      if (setval) {
        const value = BigInt(setval[2]);
        if (value >= -9223372036854775808n && value <= 9223372036854775807n) return;
      }
      fail();
    },
    finish() { if (restriction) fail(); },
  };
}

export function createDataSqlPolicy() {
  const preamble = createDataSqlPreamblePolicy(), seen = new Set();
  let current = null;
  return {
    line(line) {
      if (current) {
        const table = current;
        if (line === '\\.') { current = null; return { kind: 'terminator', table }; }
        return { kind: 'row', table };
      }
      const table = parseDataCopyHeader(line);
      if (table) {
        const key = `${table.schema}.${table.table}`;
        if (seen.has(key)) fail();
        seen.add(key); current = table;
        return { kind: 'copy', table };
      }
      preamble.line(line);
      return { kind: 'preamble' };
    },
    finish() { if (current) fail(); preamble.finish(); },
  };
}
