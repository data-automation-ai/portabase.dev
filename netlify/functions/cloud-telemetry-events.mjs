/**
 * GET /api/cloud/telemetry-events — live runner telemetry for the signed-in user.
 * Reads the telemetry blob store written by POST /api/cloud/telemetry, scoped
 * to the projectRefs in the user's own Cloud selection. Never returns keys,
 * capsule bytes, or records outside the user's selection.
 */
import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { getSelection } from '../shared/selection-store.mjs';
import { findForbiddenField } from '../../cloud/control-plane/forbidden.mjs';
import { projectAllowedTelemetry } from '../../utility/cloud-telemetry-fields.mjs';

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

/** Blob prefixes to scan, derived ONLY from the user's own selection refs. */
export function telemetryPrefixesFor(projectRefs, days, now = Date.now()) {
  const refs = [...new Set(
    (Array.isArray(projectRefs) ? projectRefs : [projectRefs])
      .filter(ref => typeof ref === 'string' && /^[a-z0-9]{20}$/.test(ref)),
  )];
  const prefixes = [];
  for (const ref of refs) {
    for (const day of recentDayStrings(days, now)) {
      prefixes.push(`${ref}/${day}/`);
    }
  }
  return prefixes;
}

/**
 * Pure core: list + fetch + sanitize. Stores are injected so tests never
 * touch Netlify Blobs.
 */
export async function collectTelemetryEvents({
  projectRefs,
  days = DEFAULT_DAYS,
  listKeys,
  getRecord,
  now = Date.now(),
}) {
  const safeDays = Number.isInteger(days) && days >= 1 ? Math.min(days, MAX_DAYS) : DEFAULT_DAYS;
  const prefixes = telemetryPrefixesFor(projectRefs, safeDays, now);
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
      let record = null;
      try {
        record = await getRecord(key);
      } catch {
        continue;
      }
      if (!record || typeof record !== 'object') continue;
      if (findForbiddenField(record)) continue;
      const event = record.event && typeof record.event === 'object' ? record.event : null;
      if (!event) continue;
      events.push({
        receivedAt: typeof record.receivedAt === 'string' ? record.receivedAt : null,
        ...projectAllowedTelemetry(event),
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

  const storeKey = `${user.cloudVersion}:${user.id}`;
  let selection = null;
  try {
    selection = (await getSelection(storeKey)) || (await getSelection(user.id));
  } catch {
    selection = null;
  }
  const projectRefs = selection?.projectRef;
  if (!projectRefs || (Array.isArray(projectRefs) && !projectRefs.length)) {
    return jsonResponse(200, { ok: true, source: 'live', events: [], count: 0, truncated: false });
  }

  const params = event.queryStringParameters || {};
  const days = params.days === undefined ? DEFAULT_DAYS : Number(params.days);

  const store = telemetryStore();
  const { events, truncated, prefixesScanned } = await collectTelemetryEvents({
    projectRefs,
    days,
    listKeys: async (prefix) => {
      const page = await store.list({ prefix });
      return (page?.blobs || []).map(blob => blob.key).filter(Boolean);
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
}
