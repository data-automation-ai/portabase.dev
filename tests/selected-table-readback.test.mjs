import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { verifySelectedTableRows } from '../utility/selected-table-readback.mjs';

const row = (schema, table, selected = true) => ({ schema, table, selected });
const copy = (schema, table, rows = []) => `COPY "${schema}"."${table}" (id) FROM stdin;\n${rows.map(value => value + '\n').join('')}\\.\n`;
async function fixture(t, sql) {
  const directory = await mkdtemp(join(tmpdir(), 'portabase-row-readback-test-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}portabase-row-readback-test-`));
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'data.sql'); await writeFile(path, sql); return path;
}

test('selected Auth/platform tables and zero-row tables receive exact quoted count queries', async t => {
  const dataSqlPath = await fixture(t, copy('auth', 'sessions', ['secret-a', 'secret-b']) + copy('storage', 'buckets') + copy('public', 'Orders', ['customer-row']) + copy('private', 'excluded', ['hidden-row']));
  const queries = [], results = ['2', '0', '1'];
  const report = await verifySelectedTableRows({ dataSqlPath, plan: { tables: [row('auth', 'sessions'), row('storage', 'buckets'), row('public', 'Orders'), row('private', 'excluded', false)] },
    queryCount: async sql => { queries.push(sql); return results.shift(); } });
  assert.equal(report.verified, true);assert.equal(report.comparison, 'row-counts-only');
  assert.deepEqual(queries, ['SELECT count(*)::text FROM "auth"."sessions";', 'SELECT count(*)::text FROM "storage"."buckets";', 'SELECT count(*)::text FROM "public"."Orders";']);
  assert.deepEqual(report.tables.map(value => value.expectedRows), [2, 0, 1]);
  assert.doesNotMatch(JSON.stringify(report), /secret-a|secret-b|customer-row|hidden-row|excluded|private/);
});

test('streaming handles large COPY rows, CRLF, escaped terminator text and unquoted identifiers', async t => {
  const dataSqlPath = await fixture(t, ['COPY Auth.Sessions (id) FROM stdin;', 'x'.repeat(256 * 1024), '\\\\.', '\u072e', '', '\\.', ''].join('\r\n'));
  const report = await verifySelectedTableRows({ dataSqlPath, plan: { tables: [row('auth', 'sessions')] }, queryCount: async () => '4' });
  assert.equal(report.verified, true);assert.equal(report.tables[0].expectedRows, 4);
});

test('missing selected COPY blocks fail before all target queries, while empty selection makes no query', async t => {
  const dataSqlPath = await fixture(t, copy('public', 'known', ['1']));let queries = 0;
  const queryCount = async () => { queries++; return '0'; };
  const result = await verifySelectedTableRows({ dataSqlPath, plan: { tables: [row('public', 'known'), row('auth', 'missing')] }, queryCount });
  assert.equal(result.verified, false);assert.equal(queries, 0);
  assert.deepEqual(result.tables.map(value => value.reason), ['not_queried', 'missing_copy_block']);
  const empty = await verifySelectedTableRows({ dataSqlPath: 'not-opened', plan: { tables: [row('public', 'known', false)] }, queryCount });
  assert.equal(empty.verified, true);assert.equal(empty.skipped, true);assert.deepEqual(empty.tables, []);assert.equal(queries, 0);
});

test('mismatches, malformed/unsafe counts and query failures produce private failure evidence without raw diagnostics', async t => {
  const dataSqlPath = await fixture(t, copy('auth', 'sessions', ['private-content']));
  const plan = { tables: [row('auth', 'sessions')] };
  for (const value of [null, undefined, 1, {}, '-1', '1.0', '1e0', '01', ' 1', '1\n', '9007199254740992', 'NaN', 'Infinity']) {
    const result = await verifySelectedTableRows({ dataSqlPath, plan, queryCount: async () => value });
    assert.equal(result.verified, false);assert.equal(result.tables[0].reason, 'invalid_count');
  }
  const mismatch = await verifySelectedTableRows({ dataSqlPath, plan, queryCount: async () => '0' });
  assert.equal(mismatch.verified, false);assert.equal(mismatch.tables[0].reason, 'row_count_mismatch');
  const failed = await verifySelectedTableRows({ dataSqlPath, plan, queryCount: async () => { throw new Error('private database password'); } });
  assert.equal(failed.verified, false);assert.equal(failed.tables[0].reason, 'query_failed');
  assert.doesNotMatch(JSON.stringify(failed), /password|private-content/);
});

test('unsupported SQL, malformed/truncated COPY, duplicate blocks and invalid plan identifiers never query', async t => {
  let queries = 0;const queryCount = async () => { queries++; return '0'; };
  for (const sql of [
    copy('auth', 'sessions') + 'INSERT INTO auth.sessions VALUES (1);\n',
    'COPY auth.sessions (id) FROM stdin;\n1\n', 'COPY auth.sessions (id) FROM PROGRAM \'whoami\';\n',
    copy('auth', 'sessions') + copy('auth', 'sessions'), '--' + 'x'.repeat(65536) + '\n',
  ]) {
    const dataSqlPath = await fixture(t, sql);
    await assert.rejects(verifySelectedTableRows({ dataSqlPath, plan: { tables: [row('auth', 'sessions')] }, queryCount }), { code: 'selected_readback_invalid_sql' });
  }
  const dataSqlPath = await fixture(t, copy('auth', 'sessions'));
  for (const tables of [[row('auth', 'sessions; DROP TABLE x')], [row('auth', 'sessions'), row('auth', 'sessions')], [{ ...row('auth', 'sessions'), selected: 'true' }]])
    await assert.rejects(verifySelectedTableRows({ dataSqlPath, plan: { tables }, queryCount }), { code: 'selected_readback_invalid_plan' });
  assert.equal(queries, 0);
});
