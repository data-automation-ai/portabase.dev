import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchInventory,
  isValidRef,
  isValidToken,
  listProjects,
  SupabaseMgmtError,
} from '../netlify/shared/supabase-mgmt.mjs';

const SENTINEL_TOKEN = 'sbp_SENTINEL_TOKEN_MUST_NEVER_LEAK_0000000000';
const VALID_REF = 'abcdefghijklmnopqrst';

function jsonFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function capturedConsole() {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  console.error = (...args) => lines.push(args.map(String).join(' '));
  return {
    lines,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

test('isValidToken accepts sbp_ tokens and JWT-shaped tokens, rejects junk', () => {
  assert.equal(isValidToken(SENTINEL_TOKEN), true);
  assert.equal(isValidToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzYXNpZ25hdHVyZQ'), true);
  assert.equal(isValidToken('a.b.c'), false); // segments too short to be JWT-ish
  assert.equal(isValidToken('not a token with spaces'), false);
  assert.equal(isValidToken(''), false);
  assert.equal(isValidToken('x'.repeat(600)), false);
  assert.equal(isValidToken(null), false);
});

test('isValidRef enforces 20-char lowercase-alnum shape', () => {
  assert.equal(isValidRef(VALID_REF), true);
  assert.equal(isValidRef('too-short'), false);
  assert.equal(isValidRef('UPPERCASE0000000000'), false);
  assert.equal(isValidRef('abcdefghijklmnopqrst; DROP TABLE x'), false);
  assert.equal(isValidRef(''), false);
  assert.equal(isValidRef(undefined), false);
});

test('listProjects maps ref/name/region/status from id or ref', async () => {
  const fetchImpl = jsonFetch(200, [
    { id: 'p1ref00000000000000', name: 'App One', region: 'us-east-1', status: 'ACTIVE_HEALTHY' },
    { ref: 'p2ref00000000000000', name: 'App Two', region: 'eu-west-1', status: 'PAUSED' },
  ]);
  const projects = await listProjects(SENTINEL_TOKEN, fetchImpl);
  assert.deepEqual(projects, [
    { ref: 'p1ref00000000000000', name: 'App One', region: 'us-east-1', status: 'ACTIVE_HEALTHY' },
    { ref: 'p2ref00000000000000', name: 'App Two', region: 'eu-west-1', status: 'PAUSED' },
  ]);
});

test('listProjects rejects a malformed token without calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonFetch(200, [])(); };
  await assert.rejects(() => listProjects('not a real token', fetchImpl), SupabaseMgmtError);
  assert.equal(called, false);
});

test('fetchInventory rejects a bad ref without calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonFetch(200, [])(); };
  await assert.rejects(
    () => fetchInventory(SENTINEL_TOKEN, 'DROP TABLE users;--', fetchImpl),
    SupabaseMgmtError,
  );
  assert.equal(called, false);
});

test('fetchInventory rejects a bad token without calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonFetch(200, [])(); };
  await assert.rejects(
    () => fetchInventory('bad token', VALID_REF, fetchImpl),
    SupabaseMgmtError,
  );
  assert.equal(called, false);
});

test('fetchInventory coerces bigint-as-string rows and sums tables/buckets/db size', async () => {
  let call = 0;
  const responses = [
    // tables query
    [{ result: JSON.stringify([
      { schema: 'public', name: 'orders', rows: '842', sizeBytes: '19292160' },
      { schema: 'auth', name: 'users', rows: '12', sizeBytes: '8192' },
    ]) }],
    // buckets query
    [{ result: JSON.stringify([
      { id: 'avatars', objectCount: '184', totalBytes: '13215744' },
      { id: 'empty-bucket', objectCount: '0', totalBytes: '0' },
    ]) }],
    // db size query
    [{ result: '104857600' }],
  ];
  const fetchImpl = async () => {
    const body = responses[call];
    call += 1;
    return { ok: true, status: 200, json: async () => body };
  };

  const inventory = await fetchInventory(SENTINEL_TOKEN, VALID_REF, fetchImpl);

  assert.equal(inventory.tables.length, 2);
  assert.equal(inventory.tables[0].rows, 842);
  assert.equal(typeof inventory.tables[0].rows, 'number');
  assert.equal(inventory.tables[0].sizeBytes, 19292160);
  assert.equal(inventory.tables[1].schema, 'auth');
  assert.equal(inventory.buckets.length, 2);
  assert.equal(inventory.buckets[0].objectCount, 184);
  assert.equal(typeof inventory.buckets[0].totalBytes, 'number');
  assert.equal(inventory.databaseBytes, 104857600);
  assert.equal(typeof inventory.databaseBytes, 'number');
});

test('error mapping: 401/403 -> token_rejected, 404 -> project_not_found, 429 -> rate_limited, other -> upstream_error', async () => {
  const cases = [
    [401, 'token_rejected'],
    [403, 'token_rejected'],
    [404, 'project_not_found'],
    [429, 'rate_limited'],
    [500, 'upstream_error'],
  ];
  for (const [status, expectedCode] of cases) {
    const fetchImpl = async () => ({ ok: false, status, json: async () => ({}) });
    await assert.rejects(
      () => listProjects(SENTINEL_TOKEN, fetchImpl),
      (err) => err instanceof SupabaseMgmtError && err.code === expectedCode,
    );
  }
});

test('a sentinel token never appears in a thrown error message, JSON output, or console output', async () => {
  const cap = capturedConsole();
  try {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ message: `token ${SENTINEL_TOKEN} rejected` }) });
    let caught = null;
    try {
      await listProjects(SENTINEL_TOKEN, fetchImpl);
    } catch (err) {
      caught = err;
      console.error('listProjects failed', err.code);
    }
    assert.ok(caught instanceof SupabaseMgmtError);
    assert.doesNotMatch(JSON.stringify({ message: caught.message, code: caught.code }), new RegExp(SENTINEL_TOKEN));
    assert.doesNotMatch(cap.lines.join('\n'), new RegExp(SENTINEL_TOKEN));
  } finally {
    cap.restore();
  }
});

test('a sentinel token never appears in the fetchInventory success/error path console output', async () => {
  const cap = capturedConsole();
  try {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => [{ result: '[]' }] });
    const inventory = await fetchInventory(SENTINEL_TOKEN, VALID_REF, fetchImpl);
    console.log('inventory fetched', JSON.stringify(inventory));
    assert.doesNotMatch(cap.lines.join('\n'), new RegExp(SENTINEL_TOKEN));
    assert.doesNotMatch(JSON.stringify(inventory), new RegExp(SENTINEL_TOKEN));
  } finally {
    cap.restore();
  }
});
