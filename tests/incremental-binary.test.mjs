import test from 'node:test';
import assert from 'node:assert/strict';
import { isBinaryStorageObject, isDifferentialFile, shouldFetchStorageObject } from '../utility/portabase-core.mjs';

const older = '2026-01-01T00:00:00.000Z';
const same = '2026-01-01T00:00:00.000Z';
const newer = '2026-02-01T00:00:00.000Z';

test('binary objects are recognized by type or extension', () => {
  assert.equal(isBinaryStorageObject({ name: 'a.png', contentType: 'image/png' }), true);
  assert.equal(isBinaryStorageObject({ name: 'dump.bin', contentType: '' }), true);
  assert.equal(isBinaryStorageObject({ name: 'notes.txt', contentType: 'text/plain' }), false);
  assert.equal(isBinaryStorageObject({ name: 'rows.json', contentType: 'application/json' }), false);
});

test('a greater date stamp is differential and the decision is the whole file', () => {
  const prior = { size: 100, etag: 'e1', updatedAt: older, sha256: 'abc' };
  assert.equal(isDifferentialFile({ updatedAt: newer }, prior), true);
  assert.equal(isDifferentialFile({ updatedAt: same }, prior), false);
  assert.equal(isDifferentialFile({ updatedAt: '2025-12-01T00:00:00.000Z' }, prior), false);
  assert.equal(isDifferentialFile({ updatedAt: newer, etag: 'e1' }, prior), true);

  const differential = shouldFetchStorageObject({
    incrementalBinary: true,
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    listing: { size: 100, etag: 'e1', updatedAt: newer },
    prior,
    bytesAlreadyLocal: true,
  });
  assert.equal(differential.fetch, true);
  assert.equal(differential.reason, 'binary-differential');
  assert.equal(differential.wholeFile, true);

  const unchanged = shouldFetchStorageObject({
    incrementalBinary: true,
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    listing: { size: 50, etag: 'different', updatedAt: same },
    prior,
    bytesAlreadyLocal: true,
  });
  assert.deepEqual(unchanged, { fetch: false, reason: 'binary-unchanged', wholeFile: true });

  assert.equal(shouldFetchStorageObject({
    incrementalBinary: true,
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    listing: { size: 100, etag: 'e1', updatedAt: same },
    prior,
    bytesAlreadyLocal: false,
  }).reason, 'binary-unchanged-cache-miss');

  assert.equal(shouldFetchStorageObject({
    incrementalBinary: true,
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    listing: { updatedAt: null },
    prior,
    bytesAlreadyLocal: true,
  }).reason, 'binary-differential');
});

test('non-binaries and the flag off are not differential reuse', () => {
  const prior = { updatedAt: older };
  const listing = { updatedAt: same };
  assert.equal(shouldFetchStorageObject({
    incrementalBinary: true,
    name: 'readme.txt',
    contentType: 'text/plain',
    listing,
    prior,
    bytesAlreadyLocal: true,
  }).reason, 'not-binary');
  assert.equal(shouldFetchStorageObject({
    incrementalBinary: false,
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    listing,
    prior,
    bytesAlreadyLocal: true,
  }).reason, 'incremental-off');
});
