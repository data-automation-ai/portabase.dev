import { getStore } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { ownerKey } from '../shared/agent-store.mjs';
import { notificationMessage } from '../shared/notification-message.mjs';

const states = new Set(['pending', 'leased', 'sending', 'accepted', 'unknown', 'suppressed', 'failed', 'rejected']);
const receipts = new Set(['accepted', 'sent', 'delivered', 'failed', 'conflicted']);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function createNotificationHistoryHandler({ authenticate = verifyCloudUser, storeFactory = () => getStore({ name: 'portabase-notification-outbox', consistency: 'strong' }) } = {}) {
  return async event => {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });
    let owner;
    try { owner = ownerKey(await authenticate(event)); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    try {
      const store = storeFactory(), prefix = `owners/${owner}/outbox/`;
      const keys = [];
      let truncated = false;
      scan: for await (const page of store.list({ prefix, paginate: true })) {
        for (const blob of page.blobs || []) {
          if (keys.length >= 500) { truncated = true; break scan; }
          if (typeof blob.key !== 'string' || !blob.key.startsWith(prefix) || !/^[a-f0-9]{64}\/(email|sms)$/.test(blob.key.slice(prefix.length))) throw new Error('invalid_history_key');
          keys.push(blob.key);
        }
      }
      const deliveries = [];
      for (let offset = 0; offset < keys.length; offset += 10) {
        const group = keys.slice(offset, offset + 10);
        const rows = await Promise.all(group.map(key => store.get(key, { type: 'json' })));
        rows.forEach((row, i) => {
          if (!row) return;
          const [id, channel] = group[i].slice(prefix.length).split('/');
          if (row.owner !== owner || row.eventId !== id || row.channel !== channel) throw new Error('history_owner_mismatch');
          if (!states.has(row.state) || !notificationMessage({ eventType: row.eventType }, { onSuccess: true, onFailure: true })) throw new Error('invalid_history_record');
          deliveries.push({ id: `${id}:${channel}`, eventType: row.eventType, channel, state: row.state,
            deliveryStatus: receipts.has(row.deliveryStatus) ? row.deliveryStatus : null,
            createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt), lastReceiptAt: timestamp(row.lastReceiptAt) });
        });
      }
      deliveries.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      return jsonResponse(200, { deliveries: deliveries.slice(0, 100), truncated: truncated || deliveries.length > 100 });
    } catch { return jsonResponse(503, { error: 'notification_history_unavailable' }); }
  };
}
export const handler = createNotificationHistoryHandler();
