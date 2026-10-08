import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RECOVERY_ACK_ITEMS,
  REQUIRED_ACK_KEYS,
  isRecoveryAckComplete,
} from '../src/data/recovery-acknowledgments.js';

test('ack data: unique keys, red/amber carry checkbox + capture instructions, green is automatic', () => {
  const keys = RECOVERY_ACK_ITEMS.map((row) => row.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate keys');
  for (const row of RECOVERY_ACK_ITEMS) {
    assert.match(row.level, /^(red|amber|green)$/, row.key);
    assert.ok(row.item && row.restore && row.capture, `${row.key} missing copy`);
    if (row.level === 'green') assert.equal(row.ack, undefined, `${row.key}: green rows are informational`);
    else assert.ok(row.ack, `${row.key}: red/amber rows need an acknowledgment label`);
  }
  const levels = new Set(RECOVERY_ACK_ITEMS.map((row) => row.level));
  for (const need of ['red', 'amber', 'green']) assert.equal(levels.has(need), true, `no ${need} row`);
});

test('red rows say record it now, on paper if necessary; vault row names the capture path', () => {
  const red = RECOVERY_ACK_ITEMS.filter((row) => row.level === 'red');
  assert.ok(red.length >= 1, 'no red row');
  assert.match(red.map((row) => row.capture).join(' '), /on paper if necessary/i);
  const vault = RECOVERY_ACK_ITEMS.find((row) => row.key === 'vault-root-key');
  assert.equal(vault.level, 'red');
  assert.match(vault.capture, /pgsodium/);
  assert.match(vault.restore, /never be decrypted/i);
});

test('required keys are exactly the red + amber rows; green is not gated', () => {
  const expected = RECOVERY_ACK_ITEMS.filter((row) => row.level !== 'green').map((row) => row.key);
  assert.deepEqual([...REQUIRED_ACK_KEYS].sort(), expected.sort());
  const greens = RECOVERY_ACK_ITEMS.filter((row) => row.level === 'green').map((row) => row.key);
  for (const g of greens) assert.equal(REQUIRED_ACK_KEYS.includes(g), false, g);
});

test('gate: incomplete until every red/amber box is checked', () => {
  assert.equal(isRecoveryAckComplete(new Set()), false);
  assert.equal(isRecoveryAckComplete(null), false);
  const partial = new Set(REQUIRED_ACK_KEYS.slice(1));
  assert.equal(isRecoveryAckComplete(partial), false);
  assert.equal(isRecoveryAckComplete(new Set(REQUIRED_ACK_KEYS)), true);
  assert.equal(isRecoveryAckComplete(REQUIRED_ACK_KEYS), true, 'accepts arrays');
  const withGreen = new Set([...REQUIRED_ACK_KEYS, 'api-keys-jwt']);
  assert.equal(isRecoveryAckComplete(withGreen), true, 'extra informational checks do not block');
});

test('component shades rows red/amber/green and marks red as immediate attention', () => {
  const src = readFileSync(new URL('../src/recovery-ack.jsx', import.meta.url), 'utf8');
  assert.match(src, /className=\{`ack-\$\{row\.level\}`\}/, 'row shaded by level');
  assert.match(src, /ack-flag ack-flag-\$\{row\.level\}/);
  assert.match(src, /ack-dot green/);
  assert.match(src, /ack-dot amber/);
  assert.match(src, /ack-dot red/);
  assert.match(src, /Immediate attention/);
  assert.match(src, /on paper if necessary/);
  assert.match(src, /portabase\.recovery-ack\.v1/);
  assert.match(src, /Nothing to do/, 'green rows render as automatic');
});

test('signup is gated: email submit and the Google OAuth button require the full checklist', () => {
  const src = readFileSync(new URL('../src/auth-pages.jsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ isRecoveryAckComplete \} from '\.\/data\/recovery-acknowledgments\.js'/);
  assert.match(src, /import \{ RecoveryAcknowledgments, recordRecoveryAck \} from '\.\/recovery-ack\.jsx'/);
  assert.match(src, /<RecoveryAcknowledgments checked=\{acks\} onToggle=\{toggleAck\} \/>/);
  assert.match(src, /if \(!ackComplete\) return;/, 'email signup halts without full acknowledgment');
  assert.match(src, /disabled=\{busy \|\| !ackComplete\}/, 'submit button gated');
  const blocked = src.match(/blocked=\{!ackComplete\}/g) || [];
  assert.equal(blocked.length, 1, 'the Google OAuth button is gated');
  assert.match(src, /recordRecoveryAck\(acks\)/, 'acknowledgment is recorded');
  assert.match(src, /Acknowledge every red and amber item above to enable sign-up\./);
});
