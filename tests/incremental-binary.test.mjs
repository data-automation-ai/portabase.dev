import test from 'node:test';
import assert from 'node:assert/strict';
import { isBinaryStorageObject, shouldFetchStorageObject } from '../utility/portabase-core.mjs';

const listing = { size: 100, etag: 'e1', updatedAt: 't1' };
const prior = { size: 100, etag: 'e1', updatedAt: 't1', sha256: 'abc' };

test('binary objects are recognized by type or extension', () => {
  assert.equal(isBinaryStorageObject({ name: 'a.png', contentType: 'image/png' }), true);
  assert.equal(isBinaryStorageObject({ name: 'dump.bin', contentType: '' }), true);
  assert.equal(isBinaryStorageObject({ name: 'notes.txt', contentType: 'text/plain' }), false);
  assert.equal(isBinaryStorageObject({ name: 'rows.json', contentType: 'application/json' }), false);
});

test('incremental binary reuses an unchanged local binary and still fetches everything else', () => {
  assert.deepEqual(shouldFetchStorageObject({
    incrementalBinary: true,
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    listing,
    prior,
    bytesAlreadyLocal: true,
  }), { fetch: false, reason: 'binary-unchanged' });

  assert.equal(shouldFetchStorageObject({
    incrementalBinary: true,
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    listing,
    prior,
    bytesAlreadyLocal: false,
  }).reason, 'binary-unchanged-cache-miss');

  assert.equal(shouldFetchStorageObject({
    incrementalBinary: true,
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    listing: { ...listing, etag: 'e2' },
    prior,
    bytesAlreadyLocal: true,
  }).reason, 'binary-changed');

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
