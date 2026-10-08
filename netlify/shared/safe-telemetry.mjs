import { cloudTelemetryPayload } from '../../utility/cloud-telemetry-payload.mjs';
import { buildTelemetryEvent } from '../../utility/telemetry.mjs';

export const CLOUD_EVENT_MAX_AGE_MS = 90 * 86_400_000;

export function safeCloudEvent(input, agent, now = Date.now()) {
  if (!agent || typeof agent.projectRef !== 'string' || !/^[a-z0-9]{20}$/.test(agent.projectRef)
    || agent.id != null && (typeof agent.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(agent.id))) throw new Error('invalid_event_identity');
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.projectRef !== agent.projectRef) throw new Error('invalid_event');
  const occurred = typeof input.occurredAt === 'string' ? Date.parse(input.occurredAt) : NaN;
  if (!Number.isFinite(occurred) || occurred > now + 300_000 || occurred < now - CLOUD_EVENT_MAX_AGE_MS) throw new Error('invalid_timestamp');
  const source = input.payload ?? {};
  if (typeof source !== 'object' || Array.isArray(source)) throw new Error('invalid_payload');
  const payload = cloudTelemetryPayload(source, occurred);
  // Raw error strings, hostname, nested objects, inventories, and log lines are never persisted.
  return buildTelemetryEvent({
    eventType: input.eventType, projectRef: agent.projectRef, agentId: agent.id,
    occurredAt: new Date(occurred).toISOString(),
    portabaseVersion: typeof input.portabaseVersion === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]{1,20})?$/.test(input.portabaseVersion) ? input.portabaseVersion : 'unknown',
    payload,
  });
}
