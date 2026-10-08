import { getStore } from '@netlify/blobs';
import { safeCloudEvent } from './safe-telemetry.mjs';

export const REPORT_FRESHNESS_MS = 15 * 60_000;
const STATES = new Set(['waiting', 'starting', 'running', 'completed', 'needs_attention']);
const FAILURES = new Set(['backup.failed', 'job.failed', 'verify.failed', 'restore.failed', 'schedule.missed']);
const COMPLETIONS = new Set(['backup.completed', 'job.completed', 'verify.completed', 'restore.completed']);
const STATE_PRIORITY = { needs_attention: 5, completed: 4, running: 3, starting: 2, waiting: 1, unknown: 0 };

function reportedState(event) {
  const payload = event?.payload || {};
  // Failure/completion events take precedence over a contradictory state field.
  if (FAILURES.has(event?.eventType) || ['FAILED', 'PARTIAL', 'failed'].includes(payload.status)) return 'needs_attention';
  if (COMPLETIONS.has(event?.eventType)) return 'completed';
  if (['backup.started', 'job.started', 'job.phase'].includes(event?.eventType)) return 'running';
  return STATES.has(payload.runnerState) ? payload.runnerState : 'unknown';
}

export function latestReportKey(owner, agentId) {
  if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-f0-9-]{36}$/.test(agentId)) throw new Error('invalid_report_identity');
  return `owners/${owner}/latest/${agentId}.json`;
}

/** Compare event time, not delivery time: delayed/replayed events cannot erase a newer report. */
export async function storeLatestReport(store, record) {
  const key = latestReportKey(record.owner, record.event.agentId);
  for (let attempt = 0; attempt < 12; attempt++) {
    const previous = await store.getWithMetadata(key, { type: 'json' });
    const previousTime = Date.parse(previous?.data?.event?.occurredAt);
    const nextTime = Date.parse(record.event.occurredAt);
    // Equal timestamps lack a reliable sequence: preserve failures and terminal results.
    if (previousTime > nextTime || (previousTime === nextTime && STATE_PRIORITY[reportedState(previous.data.event)] >= STATE_PRIORITY[reportedState(record.event)])) return;
    const result = await store.setJSON(key, record, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
    if (result.modified) return;
  }
  throw new Error('latest_report_contention');
}

export function runnerHealth(agent, record, now = Date.now()) {
  const base = { state: 'unknown', lastKnownState: null, freshness: 'missing', lastReportAt: null, receivedAt: null, nextScheduledAt: null };
  if (agent.revokedAt) return { ...base, freshness: 'revoked' };
  if (!record || record.event?.agentId !== agent.id || record.event?.projectRef !== agent.projectRef) return base;
  let event;
  try { event = safeCloudEvent(record.event, agent, now); } catch { return base; }
  const occurred = Date.parse(event.occurredAt);
  const received = Date.parse(record.receivedAt);
  if (!Number.isFinite(received) || received > now + 300_000) return base;
  const payload = event.payload;
  const reported = reportedState(event);
  const recent = now - occurred <= REPORT_FRESHNESS_MS && now - received <= REPORT_FRESHNESS_MS;
  return {
    state: reported === 'needs_attention' || recent ? reported : 'unknown',
    lastKnownState: reported,
    freshness: recent ? 'recent' : 'stale',
    lastReportAt: event.occurredAt,
    receivedAt: new Date(received).toISOString(),
    nextScheduledAt: payload.nextScheduledAt || null,
  };
}

/** Only caller-owned credentials decide which immutable report IDs can be read. */
export async function agentsWithHealth(owner, agents, store = getStore({ name: 'portabase-cloud-telemetry', consistency: 'strong' }), now = Date.now()) {
  return Promise.all(agents.map(async agent => {
    const record = await store.get(latestReportKey(owner, agent.id), { type: 'json' });
    return { ...agent, health: runnerHealth(agent, record?.owner === owner ? record : null, now) };
  }));
}
