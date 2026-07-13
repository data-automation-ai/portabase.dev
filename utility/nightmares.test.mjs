import test from 'node:test';
import assert from 'node:assert/strict';
import { nightmares } from '../src/data/nightmares.js';

test('nightmare archive contains exactly 42 sourced incidents', () => {
  assert.equal(nightmares.length, 42);
});

test('every nightmare has a unique id and source URL', () => {
  assert.equal(new Set(nightmares.map(item => item.id)).size, 42);
  assert.equal(new Set(nightmares.map(item => item.href)).size, 42);
  for (const item of nightmares) {
    assert.match(item.id, /^N\d{2}$/);
    assert.match(item.href, /^https:\/\//);
    assert.ok(item.title.length >= 20);
    assert.ok(item.body.length >= 80);
    assert.ok(item.verified.length >= 15);
  }
});

test('archive distinguishes firsthand reports from official incidents', () => {
  assert.equal(nightmares.filter(item => item.kind === 'firsthand').length, 23);
  assert.equal(nightmares.filter(item => item.kind === 'official').length, 19);
  assert.deepEqual(new Set(nightmares.map(item => item.kind)), new Set(['firsthand', 'official']));
});
