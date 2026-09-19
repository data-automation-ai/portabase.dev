/**
 * Cloud telemetry view-model — health signals only.
 * Never includes Storage object names, table rows, or capsule plaintext.
 */

import { FORBIDDEN_INVENTORY_KEY, zkForbiddenFromCloud } from './zero-knowledge.js';

const HEALTH_EVENTS = new Set([
  'backup.completed',
  'backup.failed',
  'backup.started',
  'verify.failed',
  'restore.completed',
  'schedule.missed',
  'agent.heartbeat',
  'alert.escalated',
  'capsule.registered',
]);

const FORBIDDEN_KEYS = FORBIDDEN_INVENTORY_KEY;

export function dayKey(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  const daysAgo = Math.floor((now - t) / 86400e3);
  return Number.isFinite(daysAgo) ? daysAgo : 999;
}

function cleanText(value, fallback = 'event') {
  const text = String(value ?? fallback).slice(0, 160);
  return FORBIDDEN_KEYS.test(text) ? 'health signal (detail stripped)' : text;
}

/** Allowlisted envelope only — extra inventory keys are dropped, never graphed. */
export function sanitizeHealthEvent(event = {}) {
  const projectRef = typeof event.projectRef === 'string' ? event.projectRef : null;
  return {
    id: event.id || null,
    type: HEALTH_EVENTS.has(event.type) ? event.type : 'health.other',
    projectRef: projectRef && !FORBIDDEN_KEYS.test(projectRef) ? projectRef : null,
    occurredAt: event.occurredAt || null,
    level: event.level || 'info',
    summary: cleanText(event.summary || event.type, 'event'),
  };
}

export function buildTelemetryModel(state = {}, now = Date.now()) {
  const capsules = Array.isArray(state.capsules) ? state.capsules : [];
  const events = (Array.isArray(state.events) ? state.events : []).map(sanitizeHealthEvent);
  const agents = Array.isArray(state.agents) ? state.agents : [];

  const success = capsules.filter((c) => c.status === 'COMPLETE').length;
  const failed = capsules.filter((c) => c.status === 'FAILED').length;
  const verified = capsules.filter((c) => c.verified).length;
  const rescueReady = capsules.filter((c) => c.status === 'COMPLETE' && c.verified).length;
  const encryptedBytes = capsules.reduce((sum, c) => sum + (Number(c.sizeBytes) || 0), 0);
  const durations = capsules.map((c) => Number(c.durationMs) || 0).filter(Boolean);
  const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  const driftFail = events.filter((e) => e.type === 'verify.failed').length;
  const driftPass = verified;

  const days = 7;
  const series = Array.from({ length: days }, (_, i) => {
    const age = days - 1 - i;
    const dayCaps = capsules.filter((c) => dayKey(c.createdAt, now) === age);
    const dayEvents = events.filter((e) => dayKey(e.occurredAt, now) === age);
    return {
      label: age === 0 ? 'today' : `${age}d`,
      success: dayCaps.filter((c) => c.status === 'COMPLETE').length
        + dayEvents.filter((e) => e.type === 'backup.completed').length,
      fail: dayCaps.filter((c) => c.status === 'FAILED').length
        + dayEvents.filter((e) => e.type === 'backup.failed' || e.type === 'verify.failed').length,
      durationMs: dayCaps.reduce((sum, c) => sum + (Number(c.durationMs) || 0), 0),
      encryptedBytes: dayCaps.reduce((sum, c) => sum + (Number(c.sizeBytes) || 0), 0),
    };
  });

  return {
    mocked: true,
    privacy: 'health-signals-only',
    totals: {
      success,
      failed,
      verified,
      rescueReady,
      encryptedBytes,
      avgDurationMs,
      agentsOnline: agents.filter((a) => a.status === 'online').length,
      agentsTotal: agents.length,
      driftPass,
      driftFail,
    },
    series,
    timeline: [...events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, 12),
  };
}

export function telemetryForbiddenCopy() {
  return zkForbiddenFromCloud();
}
