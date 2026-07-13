import test from 'node:test';
import assert from 'node:assert/strict';
import { nightmares } from '../src/data/nightmares.js';

test('nightmare archive contains sourced incidents', () => {
  assert.ok(nightmares.length > 0);
});

test('every nightmare has a unique id and source URL', () => {
  assert.equal(new Set(nightmares.map(item => item.id)).size, nightmares.length);
  assert.equal(new Set(nightmares.map(item => item.href)).size, nightmares.length);
  for (const item of nightmares) {
    assert.match(item.id, /^N\d{2}$/);
    assert.match(item.href, /^https:\/\//);
    assert.ok(item.title.length >= 20);
    assert.ok(item.body.length >= 80);
    assert.ok(item.verified.length >= 15);
  }
});

test('archive distinguishes firsthand reports from official incidents', () => {
  assert.ok(nightmares.some(item => item.kind === 'firsthand'));
  assert.ok(nightmares.some(item => item.kind === 'official'));
  assert.deepEqual(new Set(nightmares.map(item => item.kind)), new Set(['firsthand', 'official']));
});
