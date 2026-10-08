/**
 * GET /api/cloud/telemetry-events — live runner telemetry for the signed-in user.
 * Reads the telemetry blob store written by POST /api/cloud/telemetry, scoped
 * to an account namespace derived from the verified identity. Project references
 * supplied by customers never grant access to another account's reports.
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { ownerKey } from '../shared/agent-store.mjs';
import { findForbiddenField } from '../../cloud/control-plane/forbidden.mjs';
import { projectAllowedTelemetry } from '../../utility/cloud-telemetry-fields.mjs';
import { safeCloudEvent } from '../shared/safe-telemetry.mjs';
import { publicTimestamp } from '../shared/public-records.mjs';

export const TELEMETRY_STORE_NAME = 'portabase-cloud-telemetry';
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const MAX_KEYS_PER_PREFIX = 200;
const MAX_EVENTS = 500;

export function telemetryStore() {
  return getStore({ name: TELEMETRY_STORE_NAME, consistency: 'strong' });
}

/** YYYY-MM-DD day strings for the last `days` days, newest first. */
export function recentDayStrings(days, now = Date.now()) {
  const out = [];
  const base = new Date(now);
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Blob prefixes to scan, derived ONLY from the verified account identity. */
export function telemetryPrefixesFor(owner, days, now = Date.now()) {
  if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/.test(owner)) return [];
  return recentDayStrings(days, now).map(day => `owners/${owner}/${day}/`);
}

/**
 * Pure core: list + fetch + sanitize. Stores are injected so tests never
 * touch Netlify Blobs.
 */
export async function collectTelemetryEvents({
  owner,
  days = DEFAULT_DAYS,
  listKeys,
  getRecord,
  now = Date.now(),
}) {
  const safeDays = Number.isInteger(days) && days >= 1 ? Math.min(days, MAX_DAYS) : DEFAULT_DAYS;
  const prefixes = telemetryPrefixesFor(owner, safeDays, now);
  const events = [];
  let truncated = false;
  outer: for (const prefix of prefixes) {
    const keys = await listKeys(prefix);
    const capped = keys.slice(0, MAX_KEYS_PER_PREFIX);
    if (keys.length > capped.length) truncated = true;
    for (const key of capped) {
      if (events.length >= MAX_EVENTS) {
        truncated = true;
        break outer;
      }
      if (!key.startsWith(prefix)) continue;
      const record = await getRecord(key);
      if (!record || typeof record !== 'object') continue;
      if (record.owner !== owner) continue;
      if (findForbiddenField(record)) continue;
      const event = record.event && typeof record.event === 'object' ? record.event : null;
      if (!event) continue;
      let safeEvent;
      try { safeEvent = safeCloudEvent(event, { projectRef: event.projectRef, id: event.agentId }, now); }
      catch { continue; }
      events.push({
        receivedAt: publicTimestamp(record.receivedAt),
        ...projectAllowedTelemetry(safeEvent),
      });
    }
  }
  events.sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
  return { events, truncated, prefixesScanned: prefixes.length };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });

  let user;
  try {
    user = await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  let owner;
  try { owner = ownerKey(user); } catch { return jsonResponse(401, { error: 'unauthorized' }); }

  const params = event.queryStringParameters || {};
  const days = params.days === undefined ? DEFAULT_DAYS : Number(params.days);

  try {
  const store = telemetryStore();
  const { events, truncated, prefixesScanned } = await collectTelemetryEvents({
    owner,
    days,
    listKeys: async (prefix) => {
      const keys = [];
      for await (const page of store.list({ prefix, paginate: true })) {
        keys.push(...page.blobs.map(blob => blob.key));
        if (keys.length > MAX_KEYS_PER_PREFIX) break;
      }
      return keys;
    },
    getRecord: (key) => store.get(key, { type: 'json' }),
  });

  return jsonResponse(200, {
    ok: true,
    source: 'live',
    events,
    count: events.length,
    truncated,
    prefixesScanned,
  });
  } catch { return jsonResponse(503, { error: 'telemetry_store_unavailable' }); }
}
