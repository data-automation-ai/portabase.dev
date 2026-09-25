import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSelectionList,
  validateExcludeTableData,
  validateExcludeBuckets,
  buildExcludeTableDataArgs,
  filterExcludedBuckets,
  validateIncludeTableData,
  validateIncludeBuckets,
  filterIncludedBuckets,
  resolveTableDataSelection,
} from '../utility/portabase-core.mjs';

test('parseSelectionList: CSV, arrays, empty/null', () => {
  assert.deepEqual(parseSelectionList('public.big_logs,app.events'), ['public.big_logs', 'app.events']);
  assert.deepEqual(parseSelectionList(' public.a , public.b '), ['public.a', 'public.b']);
  assert.deepEqual(parseSelectionList(['public.a', ' public.b ']), ['public.a', 'public.b']);
  assert.deepEqual(parseSelectionList(''), []);
  assert.deepEqual(parseSelectionList(null), []);
  assert.deepEqual(parseSelectionList(undefined), []);
  assert.deepEqual(parseSelectionList('a,,b,'), ['a', 'b']);
});

test('validateExcludeTableData: accepts well-formed schema.table entries', () => {
  assert.deepEqual(
    validateExcludeTableData('public.big_logs,app_x.event_log2'),
    ['public.big_logs', 'app_x.event_log2'],
  );
  assert.deepEqual(validateExcludeTableData([]), []);
  assert.deepEqual(validateExcludeTableData(null), []);
});

test('validateExcludeTableData: rejects SQL-injection-shaped entry', () => {
  assert.throws(() => validateExcludeTableData('public.x;drop'), /--exclude-table-data/);
});

test('validateExcludeTableData: rejects entries with a space', () => {
  assert.throws(() => validateExcludeTableData('a b'), /--exclude-table-data/);
});

test('validateExcludeTableData: rejects an entry that looks like a flag', () => {
  assert.throws(() => validateExcludeTableData('--foo'), /--exclude-table-data/);
});

test('validateExcludeTableData: rejects missing schema, trailing dot, and quotes', () => {
  assert.throws(() => validateExcludeTableData('justtable'));
  assert.throws(() => validateExcludeTableData('public.'));
  assert.throws(() => validateExcludeTableData('"public"."x"'));
  assert.throws(() => validateExcludeTableData('public.x,public.y;drop table z'));
});

test('validateExcludeBuckets: accepts well-formed bucket ids', () => {
  assert.deepEqual(validateExcludeBuckets('videos,user-uploads.v2'), ['videos', 'user-uploads.v2']);
  assert.deepEqual(validateExcludeBuckets([]), []);
});

test('validateExcludeBuckets: rejects injection-shaped / invalid entries', () => {
  assert.throws(() => validateExcludeBuckets('public.x;drop'), /--exclude-buckets/);
  assert.throws(() => validateExcludeBuckets('a b'), /--exclude-buckets/);
  assert.throws(() => validateExcludeBuckets(''.padEnd(101, 'a')), /--exclude-buckets/);
});

test('buildExcludeTableDataArgs: builds one --exclude-table-data=schema.table per entry', () => {
  assert.deepEqual(
    buildExcludeTableDataArgs(['public.big_logs', 'app.events']),
    ['--exclude-table-data=public.big_logs', '--exclude-table-data=app.events'],
  );
});

test('buildExcludeTableDataArgs: empty list produces no args', () => {
  assert.deepEqual(buildExcludeTableDataArgs([]), []);
  assert.deepEqual(buildExcludeTableDataArgs(), []);
});

test('filterExcludedBuckets: drops only the excluded bucket ids', () => {
  const buckets = [{ id: 'videos' }, { id: 'avatars' }, { id: 'exports' }];
  assert.deepEqual(
    filterExcludedBuckets(buckets, ['videos', 'exports']),
    [{ id: 'avatars' }],
  );
});

test('validateIncludeTableData: accepts schema.table, rejects injection shapes', () => {
  assert.deepEqual(validateIncludeTableData('public.orders,app.events'), ['public.orders', 'app.events']);
  assert.deepEqual(validateIncludeTableData([]), []);
  assert.throws(() => validateIncludeTableData('public.x;drop'), /--include-table-data/);
  assert.throws(() => validateIncludeTableData('justtable'), /--include-table-data/);
});

test('validateIncludeBuckets: accepts ids, rejects injection shapes', () => {
  assert.deepEqual(validateIncludeBuckets('avatars,exports'), ['avatars', 'exports']);
  assert.deepEqual(validateIncludeBuckets(null), []);
  assert.throws(() => validateIncludeBuckets('a b'), /--include-buckets/);
});

test('filterIncludedBuckets: whitelist keeps only listed ids; empty keeps all', () => {
  const buckets = [{ id: 'videos' }, { id: 'avatars' }, { id: 'exports' }];
  assert.deepEqual(filterIncludedBuckets(buckets, ['avatars']), [{ id: 'avatars' }]);
  assert.deepEqual(filterIncludedBuckets(buckets, []), buckets);
});

test('resolveTableDataSelection: include narrows to rows-only set, rest is DDL-only', () => {
  const all = ['public.a', 'public.b', 'public.c'];
  assert.deepEqual(
    resolveTableDataSelection({ allTables: all, include: ['public.a'], exclude: [] }),
    { dataTables: ['public.a'], ddlOnly: ['public.b', 'public.c'], unknown: [] },
  );
});

test('resolveTableDataSelection: empty include falls back to exclude semantics', () => {
  const all = ['public.a', 'public.b'];
  assert.deepEqual(
    resolveTableDataSelection({ allTables: all, include: [], exclude: ['public.b'] }),
    { dataTables: ['public.a'], ddlOnly: ['public.b'], unknown: [] },
  );
});

test('resolveTableDataSelection: conflict throws, unknown includes are reported', () => {
  const all = ['public.a', 'public.b'];
  assert.throws(
    () => resolveTableDataSelection({ allTables: all, include: ['public.a'], exclude: ['public.a'] }),
    /both --include-table-data and --exclude-table-data/,
  );
  assert.deepEqual(
    resolveTableDataSelection({ allTables: all, include: ['public.a', 'public.typo'] }).unknown,
    ['public.typo'],
  );
});

test('filterExcludedBuckets: empty exclude list returns the original buckets unchanged', () => {
  const buckets = [{ id: 'videos' }, { id: 'avatars' }];
  assert.deepEqual(filterExcludedBuckets(buckets, []), buckets);
  assert.deepEqual(filterExcludedBuckets(buckets), buckets);
});

test('filterExcludedBuckets: no matching buckets leaves the list untouched', () => {
  const buckets = [{ id: 'videos' }];
  assert.deepEqual(filterExcludedBuckets(buckets, ['nonexistent']), buckets);
});
