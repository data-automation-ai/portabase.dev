import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterDataSqlByTables, measureDataSqlTables } from '../utility/portabase-core.mjs';
import { createDataSqlPolicy, parseDataCopyHeader } from '../utility/data-sql-policy.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'portabase-selective-sql-test-'));
  try { await run({ source: join(root, 'source.sql'), target: join(root, 'selected.sql') }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const block = (table, row = '1\tvalue') => `COPY ${table} (id, "value") FROM stdin;\n${row}\n\\.\n`;
const safePreamble = [
  '-- PostgreSQL database dump', '\\restrict TestToken123', 'SET session_replication_role = replica;',
  'SET statement_timeout = 0;', 'SET lock_timeout = 0;', 'SET idle_in_transaction_session_timeout = 0;',
  'SET transaction_timeout = 0;', "SET client_encoding = 'UTF8';", 'SET standard_conforming_strings = on;',
  "SELECT pg_catalog.set_config('search_path', '', false);", 'SET check_function_bodies = false;',
  'SET xmloption = content;', 'SET client_min_messages = warning;', 'SET row_security = off;',
].join('\n') + '\n';
const safeSuffix = `SELECT pg_catalog.setval('"public"."items_id_seq"', 2, true);\nRESET ALL;\n\\unrestrict TestToken123\n`;

test('selective filtering preserves selected COPY bytes for quoted/unquoted identifiers and literal row contents', async () => fixture(async ({ source, target }) => {
  const selected = block('public.items', '1\t\\N\n2\tINSERT INTO other VALUES (1);');
  await writeFile(source, safePreamble + selected + block('"public"."excluded"', 'private-row') + safeSuffix);
  await filterDataSqlByTables(source, target, new Set(['public.items']));
  assert.equal(await readFile(target, 'utf8'), safePreamble + selected + safeSuffix);
  const measured = await measureDataSqlTables(source);
  assert.equal(measured[0].bytes, Buffer.byteLength(selected));
  assert.deepEqual(measured.map(row => `${row.schema}.${row.table}`), ['public.items', 'public.excluded']);
}));

test('quoted column escapes are supported and unquoted table case follows PostgreSQL semantics', () => {
  assert.deepEqual(parseDataCopyHeader('COPY Public.Items ("quote""column", "column space", id) FROM stdin;'), { schema: 'public', table: 'items' });
  assert.deepEqual(parseDataCopyHeader('COPY "Public"."Items" (id) FROM stdin;'), { schema: 'Public', table: 'Items' });
  for (const header of ["COPY public.items (id) FROM PROGRAM 'whoami';", "COPY public.items (id) FROM '/tmp/file';",
    'COPY public.items (id) FROM stdin; SELECT 1;', 'COPY public.items (id) FROM stdin WITH (FORMAT csv);',
    'COPY public.items (id) TO stdout;', 'COPY public.items (id);', 'COPY public.items () FROM stdin;']) assert.equal(parseDataCopyHeader(header), null);
});

test('unsupported SQL and psql commands outside COPY cannot bypass table selection', async () => {
  const attacks = [
    'INSERT INTO public.excluded VALUES (1);', 'UPDATE public.excluded SET id=1;', 'DELETE FROM public.excluded;',
    'SELECT pg_catalog.set_config(\'search_path\', \'attacker\', false);', 'SET session_preload_libraries = evil;',
    'SET standard_conforming_strings = off;', 'SET statement_timeout = 0; INSERT INTO public.excluded VALUES (1);',
    'RESET ALL; SELECT 1;', '\\! whoami', '\\include private.sql', '\\connect other', '\\copy public.items FROM stdin',
    "SELECT pg_catalog.setval('public.seq', (SELECT evil()), true);", "SELECT pg_catalog.setval('public.seq', 9223372036854775808, true);",
    "SELECT pg_catalog.setval('public.seq', 2, true); INSERT INTO public.excluded VALUES (1);", '/* comment */ INSERT INTO public.excluded VALUES (1);',
    'COPY public.items (id) FROM stdin; SELECT 1;', 'COPY public.items (id) FROM PROGRAM \'whoami\';', '\\.',
  ];
  for (const attack of attacks) await fixture(async ({ source, target }) => {
    await writeFile(source, block('public.items') + attack + '\n');
    await assert.rejects(filterDataSqlByTables(source, target, new Set()), { code: 'unsupported_capsule_sql' }, attack);
    await assert.rejects(access(target), { code: 'ENOENT' });
    await assert.rejects(measureDataSqlTables(source), { code: 'unsupported_capsule_sql' }, attack);
  });
});

test('truncated, duplicate COPY and mismatched restrict markers reject even for deselected tables', async () => {
  for (const sql of [
    'COPY public.items (id) FROM stdin;\n1\n', block('public.items') + block('"public"."items"'),
    '\\restrict token\n' + block('public.items'), '\\unrestrict token\n',
    '\\restrict token\n\\unrestrict different\n', '\\restrict token\n\\restrict token\n',
  ]) await fixture(async ({ source, target }) => {
    await writeFile(source, sql);
    await assert.rejects(filterDataSqlByTables(source, target, new Set()), { code: 'unsupported_capsule_sql' });
    await assert.rejects(access(target), { code: 'ENOENT' });
    await assert.rejects(measureDataSqlTables(source), { code: 'unsupported_capsule_sql' });
  });
});

test('safe grammar does not reinterpret row text as SQL, and a zero-table plan keeps only supported preamble', async () => fixture(async ({ source, target }) => {
  await writeFile(source, safePreamble + block('public.items', '\\! literal-copy-data') + safeSuffix);
  await filterDataSqlByTables(source, target, new Set());
  assert.equal(await readFile(target, 'utf8'), safePreamble + safeSuffix);
  const policy = createDataSqlPolicy();
  policy.line('COPY public.items (id) FROM stdin;');
  assert.equal(policy.line('INSERT INTO other VALUES (1);').kind, 'row');
  policy.line('\\.');policy.finish();
}));

test('output ownership is exclusive: rejection never removes a preexisting target', async () => fixture(async ({ source, target }) => {
  await writeFile(source, 'INSERT INTO public.items VALUES (1);\n');
  await writeFile(target, 'existing private output');
  await assert.rejects(filterDataSqlByTables(source, target, new Set()), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), 'existing private output');
}));
