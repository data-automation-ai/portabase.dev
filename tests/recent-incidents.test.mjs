import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRecentIncidents, loadRecentIncidents } from '../netlify/shared/recent-incidents.mjs';

const now = Date.parse('2026-10-23T12:00:00Z');
const incident = (id, name, impact, created_at) => ({ id, name, impact, created_at, status: 'resolved' });

test('shows only recent relevant major or critical official incidents', () => {
  const incidents = selectRecentIncidents({ incidents: [
    incident('RECENT', 'Projects unable to restore', 'major', '2026-10-22T10:00:00Z'),
    incident('OLDER', 'Database unavailable', 'critical', '2026-05-01T10:00:00Z'),
    incident('MINOR', 'Auth unavailable', 'minor', '2026-10-22T10:00:00Z'),
    incident('OTHER', 'Website typo', 'major', '2026-10-22T10:00:00Z'),
  ] }, now);
  assert.deepEqual(incidents, [{
    id: 'RECENT', title: 'Projects unable to restore', date: '2026-10-22',
    impact: 'major', status: 'resolved', href: 'https://status.supabase.com/incidents/RECENT',
  }]);
});

test('rejects malformed feeds and upstream failures', async () => {
  assert.throws(() => selectRecentIncidents({ message: 'failed' }, now), /invalid_status_feed/);
  await assert.rejects(loadRecentIncidents(async () => ({ ok: false }), now), /status_feed_unavailable/);
});
