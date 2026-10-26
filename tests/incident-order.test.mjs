import test from 'node:test';
import assert from 'node:assert/strict';
import { nightmares } from '../src/data/nightmares.js';
import { discordEvidence } from '../src/data/discord-evidence.js';
import { incidentDate, incidentKey, sortIncidents } from '../src/lib/incident-order.js';

test('every 2026 case remains ahead of older cases in both sort modes', () => {
  for (const mode of ['recent', 'impact']) {
    const ordered = sortIncidents(nightmares, mode);
    const count = nightmares.filter(row => incidentDate(row).startsWith('2026')).length;
    assert.equal(ordered.length, nightmares.length);
    assert.ok(ordered.slice(0, count).every(row => incidentDate(row).startsWith('2026')));
    assert.ok(ordered.slice(count).every(row => !incidentDate(row).startsWith('2026')));
  }
});

test('recency sorts full dates before consequence', () => {
  const rows = [
    { id: 'old', source: 'Report · Aug 31, 2026', tag: 'ACCOUNT BANNED', title: '' },
    { id: 'billing', source: 'Report · Sep 30, 2026', tag: 'PHANTOM BILLING', title: '' },
    { id: 'ban', source: 'Report · Sep 1, 2026', tag: 'ACCOUNT BANNED', title: '' },
    { id: 'newer-ban', source: 'Report · Sep 2, 2026', tag: 'ACCOUNT BANNED', title: '' },
  ];
  assert.deepEqual(sortIncidents(rows).map(row => row.id), ['billing', 'newer-ban', 'ban', 'old']);
  assert.equal(rows[0].id, 'old');
});

test('date ranges use the start date and year, never the latest comment year', () => {
  assert.equal(incidentDate({ source: 'Status · May 8–9, 2026' }), '2026-05-08');
  assert.equal(incidentDate({ source: 'Discussion · 2022–2026' }), '2022-00-00');
  assert.equal(incidentDate({ source: 'Report · May 2026' }), '2026-05-00');
});

test('Reddit permalinks with and without titles identify the same report', () => {
  assert.equal(incidentKey('https://www.reddit.com/r/Supabase/comments/1rle3pn/'), incidentKey('https://www.reddit.com/r/Supabase/comments/1rle3pn/title/'));
});

test('reviewed Discord reports have distinct sources and sort by the original report date', () => {
  assert.equal(discordEvidence.length, 23);
  const keys = discordEvidence.map(row => incidentKey(row.href));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(discordEvidence.every(row => /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(row.href)));
  assert.ok(discordEvidence.every(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.verified.includes('Discord')));
  const ordered = sortIncidents(nightmares);
  assert.deepEqual(ordered.slice(0, 2).map(row => row.date), ['2026-10-26', '2026-10-26']);
  assert.ok(ordered.every((row, i) => i === 0 || incidentDate(ordered[i - 1]) >= incidentDate(row)));
  assert.equal(new Set(nightmares.map(row => incidentKey(row.href))).size, nightmares.length);
});
