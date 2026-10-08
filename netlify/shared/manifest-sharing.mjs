import { createHash, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { projectSharedManifest, sharedManifestBytes } from '../../utility/shared-manifest.mjs';

export class ManifestSharingError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
const error = (status, code) => { throw new ManifestSharingError(status, code); };
export const manifestSharingStore = () => getStore({ name: 'portabase-manifest-sharing', consistency: 'strong' });
export function manifestSharingKey(owner, agentId) {
  if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/.test(owner) || typeof agentId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(agentId)) error(400, 'invalid_sharing_identity');
  return `owners/${owner}/agents/${agentId}`;
}
export function sharedManifestDigest(input, options) {
  return createHash('sha256').update(sharedManifestBytes(input, options)).digest('hex');
}
function identity(record, owner, agentId) {
  if (record && (record.owner !== owner || record.agentId !== agentId)) error(503, 'manifest_sharing_unavailable');
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) error(400, 'invalid_consent_revision');
  return value;
}
function publicRecord(record) {
  return {
    enabled: record?.enabled === true,
    revision: record?.revision || 0,
    grantId: record?.enabled ? record.grantId : null,
    inventoryConsent: record?.enabled === true && record.inventoryConsent === true,
    previewDigest: record?.enabled ? record.previewDigest : null,
    grantedAt: record?.enabled ? record.grantedAt : null,
    revokedAt: record?.revokedAt || null,
    uploadedAt: record?.enabled ? record.uploadedAt || null : null,
    snapshot: record?.enabled ? record.snapshot || null : null,
  };
}

export async function readManifestSharing(owner, agentId, store = manifestSharingStore()) {
  const record = await store.get(manifestSharingKey(owner, agentId), { type: 'json' });
  identity(record, owner, agentId);
  if (record?.enabled && record.snapshot) {
    try {
      const options = { inventoryConsent: record.inventoryConsent, projectRef: record.projectRef };
      record.snapshot = projectSharedManifest(record.snapshot, options);
      if (sharedManifestDigest(record.snapshot, options) !== record.previewDigest) error(503, 'manifest_sharing_unavailable');
    } catch { error(503, 'manifest_sharing_unavailable'); }
  }
  return publicRecord(record);
}

/** Grant contains only a preview digest. The browser must preview canonical contents before granting. */
export async function grantManifestSharing(owner, agent, input, store = manifestSharingStore(), now = Date.now()) {
  const key = manifestSharingKey(owner, agent.id);
  if (agent.revokedAt || !/^[a-z0-9]{20}$/.test(agent.projectRef)) error(403, 'agent_not_active');
  if (typeof input.inventoryConsent !== 'boolean' || typeof input.previewDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewDigest)) error(400, 'invalid_manifest_consent');
  const expected = revision(input.expectedRevision);
  const current = await store.getWithMetadata(key, { type: 'json' });
  identity(current?.data, owner, agent.id);
  if ((current?.data?.revision || 0) !== expected) error(409, 'consent_changed');
  const record = { owner, agentId: agent.id, projectRef: agent.projectRef, enabled: true, revision: expected + 1, grantId: randomUUID(), inventoryConsent: input.inventoryConsent, previewDigest: input.previewDigest, grantedAt: new Date(now).toISOString(), revokedAt: null, uploadedAt: null, snapshot: null };
  const result = await store.setJSON(key, record, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
  if (!result.modified) error(409, 'consent_changed');
  return publicRecord(record);
}

export async function uploadSharedManifest(owner, agent, input, store = manifestSharingStore(), now = Date.now()) {
  const key = manifestSharingKey(owner, agent.id);
  if (agent.revokedAt) error(403, 'agent_not_active');
  const current = await store.getWithMetadata(key, { type: 'json' });
  const record = current?.data;
  identity(record, owner, agent.id);
  if (!record?.enabled) error(403, 'manifest_sharing_disabled');
  if (record.projectRef !== agent.projectRef || record.grantId !== input.grantId || record.revision !== revision(input.expectedRevision)) error(409, 'consent_changed');
  let snapshot, digest;
  try {
    const options = { inventoryConsent: record.inventoryConsent, projectRef: agent.projectRef };
    snapshot = projectSharedManifest(input.snapshot, options);
    digest = sharedManifestDigest(snapshot, options);
  } catch { error(400, 'invalid_shared_manifest'); }
  if (digest !== record.previewDigest) error(409, 'manifest_preview_changed');
  const next = { ...record, revision: record.revision + 1, uploadedAt: new Date(now).toISOString(), snapshot };
  const result = await store.setJSON(key, next, { onlyIfMatch: current.etag });
  if (!result.modified) error(409, 'consent_changed');
  return { revision: next.revision, uploadedAt: next.uploadedAt, previewDigest: digest };
}

/** Tombstone and removal of active content are one atomic write. Never delete the revision barrier. */
export async function revokeManifestSharing(owner, agentId, store = manifestSharingStore(), now = Date.now()) {
  const key = manifestSharingKey(owner, agentId);
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await store.getWithMetadata(key, { type: 'json' });
    identity(current?.data, owner, agentId);
    if (current?.data?.enabled === false) return publicRecord(current.data);
    const record = { owner, agentId, enabled: false, revision: (current?.data?.revision || 0) + 1, revokedAt: new Date(now).toISOString() };
    const result = await store.setJSON(key, record, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
    if (result.modified) return publicRecord(record);
  }
  error(503, 'manifest_revocation_retry_required');
}
