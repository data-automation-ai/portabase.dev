import test from 'node:test';
import assert from 'node:assert/strict';
import { BYTES_PER_GIB, formatGiB, formatHumanSize } from '../src/lib/human-size.js';

test('capsule sizes use binary GiB not marketing GB', () => {
  assert.equal(BYTES_PER_GIB, 1024 ** 3);
  assert.equal(formatHumanSize(0), '0 B');
  assert.equal(formatHumanSize(2048), '2 KiB');
  assert.equal(formatGiB(BYTES_PER_GIB), '1 GiB');
  assert.equal(formatGiB(10 * BYTES_PER_GIB), '10 GiB');
  assert.match(formatGiB(482_331_904), /0\.449 GiB/);
  assert.doesNotMatch(formatHumanSize(BYTES_PER_GIB), /\bGB\b/);
});
