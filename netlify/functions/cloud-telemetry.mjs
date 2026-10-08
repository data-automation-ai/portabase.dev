import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { authenticateAgent } from '../shared/agent-store.mjs';
import { safeCloudEvent } from '../shared/safe-telemetry.mjs';
import { storeLatestReport } from '../shared/runner-reports.mjs';
import { createNotificationOutbox } from '../shared/notification-outbox.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function createTelemetryHandler({ authenticate = authenticateAgent, storeFactory = () => getStore({ name: 'portabase-cloud-telemetry', consistency: 'strong' }), now = () => Date.now(), enqueueNotifications = input => createNotificationOutbox().enqueue(input) } = {}) {
  return async request => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    let agent;
    try { agent = await authenticate(request.headers.get('authorization')); }
    catch { return json(503, { error: 'agent_store_unavailable' }); }
    if (!agent) return json(401, { error: 'unauthorized' });
    let body;
    try { body = await request.text(); } catch { return json(400, { error: 'invalid_body' }); }
    if (Buffer.byteLength(body) > 16_384) return json(413, { error: 'body_too_large' });
    let event;
    try { event = safeCloudEvent(JSON.parse(body), agent, now()); }
    catch { return json(400, { error: 'invalid_event' }); }
    const receivedAt = new Date(now()).toISOString();
    const key = `owners/${agent.owner}/${receivedAt.slice(0, 10)}/${randomUUID()}.json`;
    try {
      const store = storeFactory();
      const record = { owner: agent.owner, receivedAt, event };
      await store.setJSON(key, record);
      await storeLatestReport(store, record);
    } catch { return json(503, { error: 'telemetry_store_unavailable' }); }
    try {
      await enqueueNotifications({ authorization: request.headers.get('authorization'), input: event });
      return json(202, { ok: true, stored: true, eventType: event.eventType });
    } catch {
      // The same occurredAt must be retained on retry so alert enqueueing deduplicates.
      return json(503, { error: 'notification_queue_unavailable', telemetryStored: true });
    }
  };
}
export default createTelemetryHandler();
