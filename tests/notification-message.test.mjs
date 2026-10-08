import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationMessage } from '../netlify/shared/notification-message.mjs';

test('alerts require explicit event-category consent', () => {
  assert.equal(notificationMessage({ eventType: 'backup.failed' }), null);
  assert.equal(notificationMessage({ eventType: 'backup.completed' }, { onFailure: true }), null);
  assert.equal(notificationMessage({ eventType: 'backup.failed' }, { onFailure: 'true' }), null);
  assert.equal(notificationMessage({ eventType: 'agent.heartbeat' }, { onSuccess: true }), null);
});
test('private payloads cannot enter email or SMS messages', () => {
  const event = { eventType: 'backup.failed', projectRef: 'private-project', hostname: 'private-host', payload: { error: 'password=secret', table: 'customers', manifest: 'private-manifest' } };
  const message = notificationMessage(event, { onFailure: true });
  assert.ok(message);
  for (const secret of ['private-project', 'private-host', 'password', 'customers', 'private-manifest']) assert.ok(!JSON.stringify(message).includes(secret));
});
test('a completion report does not claim proven recovery', () => {
  assert.match(notificationMessage({ eventType: 'backup.completed' }, { onSuccess: true }).text, /does not confirm a tested restore/);
  assert.equal(notificationMessage({ eventType: '__proto__' }, { onSuccess: true }), null);
});
