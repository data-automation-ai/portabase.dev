import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createNotificationOutbox } from '../netlify/shared/notification-outbox.mjs';
import { createNotificationTransport } from '../netlify/shared/notification-transports.mjs';
import { createTwilioReceiptHandler } from '../netlify/shared/notification-receipts.mjs';
import { createNotificationHistoryHandler } from '../netlify/functions/cloud-notification-history.mjs';
import { ownerKey } from '../netlify/shared/agent-store.mjs';

test('runner event reaches accepted then signed delivered history without persisting message content', async () => {
  const user = { id: 'integration-owner', cloudVersion: 'supabase' }, owner = ownerKey(user);
  const now = Date.parse('2026-10-05T12:00:00Z'), rows = new Map(); let revision = 0, requests = 0;
  const store = {
    async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
    async get(key) { return structuredClone(rows.get(key)?.data || null); },
    async setJSON(key, data, condition = {}) {
      const old = rows.get(key);
      if (condition.onlyIfNew && old || condition.onlyIfMatch && old?.etag !== condition.onlyIfMatch) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++revision) }); return { modified: true };
    },
    async *list({ prefix }) { yield { blobs: [...rows.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  };
  const agent = { owner, id: 'runner-integration', projectRef: 'abcdefghijklmnopqrst' };
  const outbox = createNotificationOutbox({ store, clock: () => now, authenticate: async () => agent,
    agentActive: async () => true,
    getPreferences: async () => ({ owner, revision: 1, preferences: { sms: { onFailure: true }, email: { onFailure: false } } }),
    getDestination: async (_, channel) => channel === 'sms' ? { owner, channel, id: 'verified-phone', revision: 1,
      address: '+12025550123', verifiedAt: '2026-10-05T11:00:00Z' } : null,
  });
  const input = { eventType: 'backup.failed', projectRef: agent.projectRef, occurredAt: new Date(now).toISOString(),
    payload: { error: 'private-database-password', filename: 'private-inventory.csv' } };
  const entries = await outbox.enqueue({ authorization: 'synthetic', input });
  const reference = entries.find(row => row.channel === 'sms');
  const accountSid = `AC${'a'.repeat(32)}`, messageSid = `SM${'b'.repeat(32)}`;
  const config = { accountSid, authToken: 'synthetic-auth', messagingServiceSid: `MG${'c'.repeat(32)}`,
    url: 'https://portabase.dev/api/notifications/twilio-receipt' };
  const transport = createNotificationTransport({ twilio: { ...config, statusCallback: config.url }, fetchImpl: async (_, request) => {
    requests++; assert.equal(request.body.get('To'), '+12025550123');
    assert.equal(request.body.get('StatusCallback'), config.url);
    assert.ok(!request.body.get('Body').includes('private-'));
    return { ok: true, status: 201, json: async () => ({ sid: messageSid, status: 'queued' }) };
  } });
  await outbox.deliver(await outbox.claim(reference), transport);
  const history = createNotificationHistoryHandler({ authenticate: async () => user, storeFactory: () => store });
  const readSms = async () => {
    const response = await history({ httpMethod: 'GET' }); assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes('private-')); assert.ok(!response.body.includes('+12025550123'));
    return JSON.parse(response.body).deliveries.find(row => row.channel === 'sms');
  };
  assert.equal((await readSms()).state, 'accepted');
  assert.notEqual((await readSms()).deliveryStatus, 'delivered');
  const fields = { AccountSid: accountSid, MessageSid: messageSid, MessageStatus: 'delivered', To: '+12025550123' };
  const signed = Object.keys(fields).sort().reduce((text, key) => text + key + fields[key], config.url);
  const event = { httpMethod: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded',
    'x-twilio-signature': createHmac('sha1', config.authToken).update(signed).digest('base64') }, body: new URLSearchParams(fields).toString() };
  const receipt = createTwilioReceiptHandler({ configuration: async () => config, store: () => store, clock: () => now });
  assert.equal((await receipt(event)).statusCode, 200);
  assert.equal((await receipt(event)).statusCode, 200);
  assert.equal((await readSms()).deliveryStatus, 'delivered');
  await outbox.enqueue({ authorization: 'synthetic', input });
  assert.equal(await outbox.claim(reference), null); assert.equal(requests, 1);
  const persisted = JSON.stringify([...rows.values()]);
  for (const value of ['private-database-password', 'private-inventory.csv', '+12025550123', 'synthetic-auth']) assert.ok(!persisted.includes(value));
  const foreignHistory = createNotificationHistoryHandler({ authenticate: async () => ({ ...user, id: 'foreign' }), storeFactory: () => store });
  assert.deepEqual(JSON.parse((await foreignHistory({ httpMethod: 'GET' })).body).deliveries, []);
});
