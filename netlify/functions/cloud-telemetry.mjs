import { getStore } from '@netlify/blobs';
import { buildTelemetryEvent } from '../../utility/telemetry.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function authorized(request) {
  const expected = process.env.PORTABASE_CLOUD_INGEST_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && match[1] === expected);
}

export default async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!authorized(request)) return json(401, { error: 'unauthorized' });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  let event;
  try {
    event = buildTelemetryEvent(body);
  } catch (error) {
    return json(400, { error: 'invalid_event', detail: error.message });
  }

  try {
    const store = getStore({ name: 'portabase-cloud-telemetry', consistency: 'strong' });
    const day = event.occurredAt.slice(0, 10);
    const key = `${event.projectRef}/${day}/${event.occurredAt}-${event.eventType}-${crypto.randomUUID()}.json`;
    await store.setJSON(key, {
      receivedAt: new Date().toISOString(),
      event,
    });
    return json(202, { ok: true, stored: true, eventType: event.eventType });
  } catch (error) {
    console.error('telemetry_store_failed', error.message);
    return json(503, { error: 'store_unavailable' });
  }
};
