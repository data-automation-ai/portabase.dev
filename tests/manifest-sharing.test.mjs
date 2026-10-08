import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectSharedManifest, sharedManifestBytes, MAX_SHARED_MANIFEST_BYTES } from '../utility/shared-manifest.mjs';
import { grantManifestSharing, manifestSharingKey, readManifestSharing, revokeManifestSharing, sharedManifestDigest, uploadSharedManifest } from '../netlify/shared/manifest-sharing.mjs';
import { createManifestSharingHandler } from '../netlify/functions/cloud-manifest-sharing.mjs';
import { ownerKey } from '../netlify/shared/agent-store.mjs';
import { safeCloudEvent } from '../netlify/shared/safe-telemetry.mjs';

const A = ownerKey({ cloudVersion: 'supabase', id: 'customer-a' });
const B = ownerKey({ cloudVersion: 'supabase', id: 'customer-b' });
const agent = { id: 'fc9a4248-bb28-49f6-a779-447f349c3397', projectRef: 'abcdefghijklmnopqrst', revokedAt: null };
const otherAgent = { ...agent, id: '58d43067-9698-4e0e-a832-bc315a72abfe' };
const snapshot = { schemaVersion: 1, projectRef: agent.projectRef, capturedAt: '2026-10-05T12:00:00Z', capsuleHash: 'a'.repeat(64), status: 'COMPLETE', counts: { tableCount: 2, objectCount: 1, totalBytes: 42 } };
const inventory = { projectName: 'Customer project', tables: [{ schema: 'public', name: 'orders' }], buckets: [{ name: 'images' }], objects: [{ bucket: 'images', name: 'products/item.jpg' }] };
const now = Date.parse(snapshot.capturedAt);

function memoryStore() {
  const rows = new Map();
  let version = 0;
  return {
    rows,
    async get(key) { return structuredClone(rows.get(key)?.data || null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) || null); },
    async setJSON(key, data, options = {}) {
      const existing = rows.get(key);
      if (options.onlyIfNew && existing || options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
      rows.set(key, { data: structuredClone(data), etag: String(++version) });
      return { modified: true };
    },
  };
}
const digest = (data = snapshot, consent = false) => sharedManifestDigest(data, { projectRef: agent.projectRef, inventoryConsent: consent });
const grant = (store, expectedRevision = 0, data = snapshot, inventoryConsent = false) => grantManifestSharing(A, agent, { expectedRevision, previewDigest: digest(data, inventoryConsent), inventoryConsent }, store, now);
const upload = (store, consent, data = snapshot) => uploadSharedManifest(A, agent, { expectedRevision: consent.revision, grantId: consent.grantId, snapshot: data }, store, now);
const status = code => error => error.status === code;

test('sharing is private by default and consent grants bind the exact canonical preview', async () => {
  const store = memoryStore();
  assert.equal((await readManifestSharing(A, agent.id, store)).enabled, false);
  assert.equal((await readManifestSharing(A, agent.id, store)).inventoryConsent, false);
  await assert.rejects(upload(store, { revision: 0, grantId: 'none' }), status(403));
  const consent = await grant(store);
  assert.equal(consent.snapshot, null);
  assert.equal(consent.inventoryConsent, false);
  await assert.rejects(upload(store, consent, { ...snapshot, status: 'PARTIAL' }), status(409));
  const stored = await upload(store, consent);
  assert.equal(stored.revision, 2);
  assert.deepEqual((await readManifestSharing(A, agent.id, store)).snapshot, projectSharedManifest(snapshot, { projectRef: agent.projectRef }));
  assert.equal(digest(), createHash('sha256').update(sharedManifestBytes(snapshot, { projectRef: agent.projectRef })).digest('hex'));
});

test('inventory requires explicit separate consent, with strict name/type/count limits', async () => {
  const named = { ...snapshot, inventory };
  assert.throws(() => digest(named), /consent/);
  assert.throws(() => projectSharedManifest(named, { projectRef: agent.projectRef, inventoryConsent: 'yes' }), /consent/);
  const store = memoryStore();
  const consent = await grant(store, 0, named, true);
  await upload(store, consent, named);
  assert.deepEqual((await readManifestSharing(A, agent.id, store)).snapshot.inventory, inventory);
  for (const bad of [
    { ...snapshot, capturedAt: ['2026-10-05T12:00:00Z'] },
    { ...snapshot, capturedAt: '2026-02-31T12:00:00Z' },
    { ...snapshot, projectRef: otherAgent.id },
    { ...snapshot, counts: { tableCount: -1 } },
    { ...named, inventory: { tables: Array.from({ length: 201 }, () => ({ schema: 'public', name: 'orders' })) } },
    { ...named, inventory: { projectName: 'x'.repeat(129) } },
    { ...named, inventory: { objects: [{ bucket: 'images', name: '../../private' }] } },
    { ...named, inventory: { projectName: ['array'] } },
    { ...named, inventory: { projectName: 'Bearer private-credential' } },
    { ...named, inventory: { projectName: 'password=private-credential' } },
    { ...named, inventory: { objects: [{ bucket: 'images', name: 'sb_secret_do-not-share' }] } },
  ]) assert.throws(() => digest(bad, true));
});

test('raw manifest fields, secret-shaped name strings and nested diagnostic fields never persist', async () => {
  const store = memoryStore();
  const consent = await grant(store);
  const secret = 'private-credential';
  for (const forbidden of [
    { ...snapshot, password: secret },
    { ...snapshot, errors: [`postgresql://user:${secret}@host/db`] },
    { ...snapshot, counts: { tableCount: 1, accessToken: secret } },
    { ...snapshot, inventory: { projectName: `postgresql://user:${secret}@host/db` } },
    { ...snapshot, inventory: { tables: [{ schema: 'public', name: 'orders', rows: [{ token: secret }] }] } },
    { ...snapshot, inventory: { projectName: 'Bearer private-credential' } },
  ]) await assert.rejects(upload(store, consent, forbidden), status(400));
  assert.equal(JSON.stringify([...store.rows.values()]).includes(secret), false);
  assert.equal((await readManifestSharing(A, agent.id, store)).snapshot, null);
});

test('revoke atomically removes retained contents, blocks stale uploads, and requires fresh consent', async () => {
  const store = memoryStore();
  const consent = await grant(store, 0, { ...snapshot, inventory }, true);
  await upload(store, consent, { ...snapshot, inventory });
  const revoked = await revokeManifestSharing(A, agent.id, store, now);
  assert.equal(revoked.enabled, false);
  assert.equal(revoked.snapshot, null);
  assert.equal(JSON.stringify([...store.rows.values()]).includes('products/item.jpg'), false);
  assert.equal(JSON.stringify([...store.rows.values()]).includes('previewDigest'), false);
  await assert.rejects(upload(store, consent, { ...snapshot, inventory }), status(403));
  await assert.rejects(grant(store, consent.revision), status(409));
  const renewed = await grant(store, revoked.revision);
  assert.notEqual(renewed.grantId, consent.grantId);
  await assert.rejects(upload(store, { ...consent, revision: renewed.revision }), status(409));
  await upload(store, renewed);
});

test('an upload paused across revocation cannot resurrect content', async () => {
  const store = memoryStore();
  const consent = await grant(store);
  let announceRead, resume;
  const readStarted = new Promise(resolve => { announceRead = resolve; });
  const resumed = new Promise(resolve => { resume = resolve; });
  const delayed = { ...store, async getWithMetadata(key) { const current = await store.getWithMetadata(key); announceRead(); await resumed; return current; } };
  const pending = upload(delayed, consent);
  await readStarted;
  await revokeManifestSharing(A, agent.id, store, now);
  resume();
  await assert.rejects(pending, status(409));
  assert.equal((await readManifestSharing(A, agent.id, store)).snapshot, null);
});

test('revocation wins when a pending upload commits first, and tombstones block old initial grants', async () => {
  const store = memoryStore();
  const consent = await grant(store);
  let race = true;
  const concurrent = { ...store, async setJSON(key, value, options) {
    if (race) { race = false; await upload(store, consent); }
    return store.setJSON(key, value, options);
  } };
  await revokeManifestSharing(A, agent.id, concurrent, now);
  assert.equal((await readManifestSharing(A, agent.id, store)).snapshot, null);
  const empty = memoryStore();
  await revokeManifestSharing(A, agent.id, empty, now);
  await assert.rejects(grant(empty), status(409));
});

test('owned account namespace prevents reads and revocations across customers', async () => {
  const store = memoryStore();
  const consent = await grant(store);
  await upload(store, consent);
  assert.equal((await readManifestSharing(B, agent.id, store)).snapshot, null);
  await revokeManifestSharing(B, agent.id, store, now);
  assert.ok((await readManifestSharing(A, agent.id, store)).snapshot);
  await assert.rejects(readManifestSharing(A, '../../outside', store), status(400));
  const row = await store.get(manifestSharingKey(A, agent.id));
  await store.setJSON(manifestSharingKey(A, agent.id), { ...row, owner: B });
  await assert.rejects(readManifestSharing(A, agent.id, store), status(503));
});

function handler(store, user = 'customer-a') {
  return createManifestSharingHandler({
    verifyUser: async () => ({ id: user, cloudVersion: 'supabase' }),
    agents: async owner => owner === A ? [agent] : [otherAgent],
    authenticate: async header => header === 'Bearer pb_agent_test-a' ? { ...agent, owner: A } : header === 'Bearer pb_agent_test-b' ? { ...otherAgent, owner: B } : null,
    read: (owner, id) => readManifestSharing(owner, id, store),
    grant: (owner, owned, body) => grantManifestSharing(owner, owned, body, store, now),
    upload: (owner, owned, body) => uploadSharedManifest(owner, owned, body, store, now),
    revoke: (owner, id) => revokeManifestSharing(owner, id, store, now),
  });
}
const request = (httpMethod, body, authorization = 'Bearer user') => ({ httpMethod, headers: { authorization }, body: JSON.stringify(body) });

test('HTTP endpoint requires owner auth for consent; upload identity cannot choose another owner or agent', async () => {
  const store = memoryStore();
  const consentBody = { agentId: agent.id, expectedRevision: 0, inventoryConsent: false, previewDigest: digest() };
  assert.equal((await handler(store)(request('POST', consentBody, 'Bearer pb_agent_test-a'))).statusCode, 403);
  assert.equal((await handler(store, 'customer-b')(request('POST', consentBody))).statusCode, 403);
  const response = await handler(store)(request('POST', consentBody));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const consent = JSON.parse(response.body);
  const body = { agentId: agent.id, expectedRevision: consent.revision, grantId: consent.grantId, snapshot };
  assert.equal((await handler(store)(request('PUT', body, 'Bearer pb_agent_test-b'))).statusCode, 403);
  assert.equal((await handler(store)(request('PUT', { ...body, owner: B }, 'Bearer pb_agent_test-a'))).statusCode, 400);
  assert.equal((await handler(store)(request('PUT', body, 'Bearer pb_agent_test-a'))).statusCode, 200);
  assert.equal((await handler(store)(request('GET', {}, 'Bearer pb_agent_test-a'))).statusCode, 403);
  assert.equal((await handler(store)(request('PUT', body, 'Bearer pb_agent_revoked'))).statusCode, 401);
});

test('oversize payloads and storage failures return bounded sanitized failures', async () => {
  const store = memoryStore();
  const response = await handler(store)(request('PUT', { snapshot: 'x'.repeat(MAX_SHARED_MANIFEST_BYTES + 2048) }));
  assert.equal(response.statusCode, 413);
  assert.equal(store.rows.size, 0);
  const failure = createManifestSharingHandler({ verifyUser: async () => ({ id: 'customer-a', cloudVersion: 'supabase' }), read: async () => { throw new Error('secret-provider-detail'); } });
  const failed = await failure({ httpMethod: 'GET', queryStringParameters: { agentId: agent.id } });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.includes('secret-provider-detail'), false);
});

test('stored corruption fails closed and ordinary telemetry cannot carry shared inventory', async () => {
  const store = memoryStore();
  const consent = await grant(store);
  await upload(store, consent);
  const key = manifestSharingKey(A, agent.id);
  const row = await store.get(key);
  await store.setJSON(key, { ...row, snapshot: { ...row.snapshot, secret: 'private-value' } });
  await assert.rejects(readManifestSharing(A, agent.id, store), status(503));
  const report = safeCloudEvent({ eventType: 'backup.completed', projectRef: agent.projectRef, occurredAt: snapshot.capturedAt, payload: { manifest: snapshot, inventory, error: 'private-raw-error' } }, agent, now);
  assert.deepEqual(report.payload, {});
});
