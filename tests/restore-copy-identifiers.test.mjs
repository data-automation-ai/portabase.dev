import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureDataSqlTables, filterDataSqlByTables } from '../utility/portabase-core.mjs';

test('selection measures and removes unquoted and mixed-quoted COPY blocks', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-copy-identifiers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'data.sql'), target = join(dir, 'filtered.sql');
  await writeFile(source, [
    'COPY public.omitted (id) FROM stdin;', 'private-row', '\\.',
    'COPY "public".kept (id) FROM stdin;', 'retained-row', '\\.',
    'COPY public."also_omitted" (id) FROM stdin;', 'another-private-row', '\\.', '',
  ].join('\n'));
  const measured = await measureDataSqlTables(source);
  assert.deepEqual(measured.map(row => `${row.schema}.${row.table}`), ['public.omitted', 'public.kept', 'public.also_omitted']);
  assert.ok(measured.every(row => row.bytes > 0));
  await filterDataSqlByTables(source, target, new Set(['public.kept']));
  const filtered = await readFile(target, 'utf8');
  assert.match(filtered, /retained-row/);
  assert.doesNotMatch(filtered, /private-row|omitted/);
});
