import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeTelemetryValue,
  buildTelemetryEvent,
  cloudTelemetryConfig,
  emitTelemetry,
} from './telemetry.mjs';

test('cloud request excludes private fields before they cross the network', async t => {
  const oldUrl = process.env.PB_TEST_TELEMETRY_URL;
  const oldToken = process.env.PB_TEST_TELEMETRY_TOKEN;
  process.env.PB_TEST_TELEMETRY_URL = 'https://example.invalid';
  process.env.PB_TEST_TELEMETRY_TOKEN = 'test-token';
  t.after(() => {
    if (oldUrl === undefined) delete process.env.PB_TEST_TELEMETRY_URL; else process.env.PB_TEST_TELEMETRY_URL = oldUrl;
    if (oldToken === undefined) delete process.env.PB_TEST_TELEMETRY_TOKEN; else process.env.PB_TEST_TELEMETRY_TOKEN = oldToken;
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, status: 202 }; });
  const result = await emitTelemetry({ projectRef: 'abcdefghijklmnopqrst', cloud: { enabled: true, endpointEnv: 'PB_TEST_TELEMETRY_URL', tokenEnv: 'PB_TEST_TELEMETRY_TOKEN' } }, {
    eventType: 'backup.completed', hostname: 'private-host', agentId: 'private-agent-name',
    payload: { status: 'COMPLETE', verified: true, errorCount: 0, customerLabel: 'private-customer', capsuleId: 'private-capsule', nested: { value: 'private-details' } },
  });
  assert.equal(result.sent, true);
  assert.equal(requests.length, 1);
  assert.ok(!JSON.stringify(requests).includes('private-'));
  assert.deepEqual(requests[0].payload, { errorCount: 0, status: 'COMPLETE', verified: true });
});

test('telemetry rejects secrets and connection strings', () => {
  assert.throws(() => assertSafeTelemetryValue({ password: 'x' }), /forbidden key/);
  assert.throws(() => assertSafeTelemetryValue('postgresql://user:secret@host/db'), /forbidden content/);
  assert.throws(() => assertSafeTelemetryValue('sb_secret_abc'), /forbidden content/);
  assert.throws(() => assertSafeTelemetryValue({ objectName: 'avatars/x.jpg' }), /forbidden key/);
  assert.throws(() => assertSafeTelemetryValue('buckets/avatars/photo.png'), /object path/);
});

test('telemetry builds allowlisted backup events', () => {
  const event = buildTelemetryEvent({
    eventType: 'backup.completed',
    projectRef: 'abcdefghijklmnopqrst',
    portabaseVersion: '0.4.0',
    payload: { capsuleId: 'cap-1', status: 'COMPLETE', verified: true, errorCount: 0 },
  });
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.eventType, 'backup.completed');
  assert.equal(event.payload.status, 'COMPLETE');
});

test('cloud telemetry is off unless enabled with env credentials', () => {
  assert.equal(cloudTelemetryConfig({ cloud: { enabled: false } }), null);
  assert.equal(cloudTelemetryConfig({ cloud: { enabled: true } }), null);
});

test('managed worker suppresses duplicate Cloud completions while preserving start telemetry and private webhooks', async t => {
  const keys = ['PB_TEST_TELEMETRY_URL', 'PB_TEST_TELEMETRY_TOKEN', 'PB_TEST_WEBHOOK_URL', 'PORTABASE_JOB_COMPLETION_REPORTER'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });
  Object.assign(process.env, { PB_TEST_TELEMETRY_URL: 'https://cloud.example.test', PB_TEST_TELEMETRY_TOKEN: 'synthetic',
    PB_TEST_WEBHOOK_URL: 'https://webhook.example.test', PORTABASE_JOB_COMPLETION_REPORTER: 'server' });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { requests.push({ url, event: JSON.parse(init.body) }); return { ok: true, status: 202 }; });
  const config = { projectRef: 'abcdefghijklmnopqrst', cloud: { enabled: true, endpointEnv: keys[0], tokenEnv: keys[1] }, alerts: { webhookEnv: keys[2] } };
  for (const eventType of ['backup.completed', 'backup.failed', 'verify.completed', 'verify.failed', 'restore.completed', 'restore.failed']) {
    const before = requests.length; await emitTelemetry(config, { eventType });
    assert.deepEqual(requests.slice(before).map(row => row.url), ['https://webhook.example.test']);
  }
  await emitTelemetry(config, { eventType: 'backup.started' });
  assert.equal(requests.filter(row => row.url === 'https://cloud.example.test/api/cloud/telemetry').length, 1);
  delete process.env.PORTABASE_JOB_COMPLETION_REPORTER;
  await emitTelemetry(config, { eventType: 'backup.completed' });
  assert.equal(requests.filter(row => row.url === 'https://cloud.example.test/api/cloud/telemetry').length, 2);
});
