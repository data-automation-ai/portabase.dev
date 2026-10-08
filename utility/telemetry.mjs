import { cloudTelemetryPayload } from './cloud-telemetry-payload.mjs';
/**
 * Opt-in Portabase Cloud / webhook telemetry.
 * Never include secrets, passphrases, capsule bytes, or connection strings.
 */

import { FORBIDDEN_INVENTORY_KEY, looksLikeStorageObjectPath } from './zero-knowledge.mjs';

const FORBIDDEN = [
  /password/i,
  /passphrase/i,
  /service[_-]?role/i,
  /sb_secret_/i,
  /private[_-]?key/i,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /postgres(ql)?:\/\/[^\s]+:[^\s]+@/i,
];

const EVENT_TYPES = new Set([
  'agent.heartbeat',
  'backup.started',
  'backup.completed',
  'backup.failed',
  'verify.failed',
  'verify.completed',
  'restore.completed',
  'restore.failed',
  'schedule.missed',
  'job.started',
  'job.phase',
  'job.completed',
  'job.failed',
  'meter.daily',
]);

export function assertSafeTelemetryValue(value, path = 'root') {
  if (value == null) return value;
  if (typeof value === 'string') {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(value)) throw new Error(`Telemetry rejected forbidden content at ${path}`);
    }
    if (value.length > 2000) throw new Error(`Telemetry field too long at ${path}`);
    if (looksLikeStorageObjectPath(value)) throw new Error(`Telemetry rejected Storage object path at ${path}`);
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => assertSafeTelemetryValue(item, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN.some(pattern => pattern.test(key)) || FORBIDDEN_INVENTORY_KEY.test(key)) {
        throw new Error(`Telemetry rejected forbidden key ${key}`);
      }
      out[key] = assertSafeTelemetryValue(child, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`Telemetry rejected unsupported type at ${path}`);
}

export function buildTelemetryEvent({
  eventType,
  projectRef,
  agentId = null,
  hostname = null,
  portabaseVersion,
  payload = {},
  occurredAt = new Date().toISOString(),
} = {}) {
  if (!EVENT_TYPES.has(eventType)) throw new Error(`Unknown telemetry eventType: ${eventType}`);
  if (!projectRef || typeof projectRef !== 'string') throw new Error('Telemetry requires projectRef.');
  const event = {
    schemaVersion: 1,
    eventType,
    occurredAt,
    agentId: agentId || null,
    projectRef,
    hostname: hostname || null,
    portabaseVersion: portabaseVersion || 'unknown',
    payload: assertSafeTelemetryValue(payload, 'payload') || {},
  };
  return assertSafeTelemetryValue(event, 'event');
}

export function cloudTelemetryConfig(config = {}) {
  const cloud = config.cloud || {};
  if (cloud.enabled !== true) return null;
  const endpoint = process.env[cloud.endpointEnv || 'PORTABASE_CLOUD_URL'];
  const token = process.env[cloud.tokenEnv || 'PORTABASE_CLOUD_TOKEN'];
  if (!endpoint || !token) return null;
  return {
    endpoint: endpoint.replace(/\/$/, ''),
    token,
    agentId: cloud.agentId || process.env.PORTABASE_CLOUD_AGENT_ID || null,
  };
}

export async function emitTelemetry(config, event = {}, options = {}) {
  const built = buildTelemetryEvent({
    ...event,
    projectRef: event.projectRef || config.projectRef,
    agentId: event.agentId || config.cloud?.agentId || null,
    hostname: event.hostname || process.env.PORTABASE_HOSTNAME || null,
  });

  const cloud = cloudTelemetryConfig(config);
  const webhookEnv = config.alerts?.webhookEnv;
  const webhookUrl = webhookEnv ? process.env[webhookEnv] : null;
  const targets = [];
  const serverCompletion = process.env.PORTABASE_JOB_COMPLETION_REPORTER === 'server'
    && ['backup.completed', 'backup.failed', 'verify.completed', 'verify.failed', 'restore.completed', 'restore.failed'].includes(built.eventType);
  if (cloud && !serverCompletion) targets.push({ url: `${cloud.endpoint}/api/cloud/telemetry`, token: cloud.token, cloud: true });
  if (webhookUrl) targets.push({ url: webhookUrl, token: null });
  if (!targets.length) return { sent: false, reason: 'telemetry_disabled' };

  const results = [];
  for (const target of targets) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (target.token) headers.Authorization = `Bearer ${target.token}`;
      const response = await fetch(target.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(target.cloud ? {
          schemaVersion: built.schemaVersion,
          eventType: built.eventType,
          occurredAt: built.occurredAt,
          projectRef: built.projectRef,
          portabaseVersion: /^\d+\.\d+\.\d+(?:-[a-z0-9.-]{1,20})?$/.test(built.portabaseVersion) ? built.portabaseVersion : 'unknown',
          payload: cloudTelemetryPayload(built.payload, Date.parse(built.occurredAt)),
        } : built),
        signal: AbortSignal.timeout(options.timeoutMs || 10000),
      });
      results.push({ url: target.url, ok: response.ok, status: response.status });
    } catch (error) {
      results.push({ url: target.url, ok: false, error: error.message });
    }
  }
  return { sent: results.some(result => result.ok), results, event: built };
}
