import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { CLOUD_MAX_AGENTS } from './product.mjs';
import { RUNNER_ID_RE } from '../../cloud/runner/config-reference.mjs';
import { publicAgentRecord } from './public-records.mjs';

export const AGENT_STORE = 'portabase-cloud-agent-credentials';
export const agentStore = () => getStore({ name: AGENT_STORE, consistency: 'strong' });
const digest = value => createHash('sha256').update(value).digest('hex');
const REF = /^[a-z0-9]{20}$/;
export function ownerKey(user) {
  if (user?.cloudVersion !== 'supabase' || !user?.id) throw new Error('invalid_owner');
  return digest(`supabase:${user.id}`);
}
export function agentKey(owner, slot) {
  if (!/^[a-f0-9]{64}$/.test(owner) || !Number.isInteger(slot) || slot < 0 || slot >= CLOUD_MAX_AGENTS) throw new Error('invalid_agent_key');
  return `owners/${owner}/agents/${slot}`;
}
export function publicAgent(record) {
  return publicAgentRecord(record, Boolean(runnerJobIdentity(record)));
}
function accountKeyFor(user) {
  if (user?.cloudVersion !== 'supabase' || typeof user.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user.id)) throw new Error('invalid_runner_account');
  return `supabase:${user.id}`;
}
/** Server-only delegated identity. Never reconstruct it from caller fields or
 * the one-way owner hash. Legacy telemetry credentials have no job authority. */
export function runnerJobIdentity(record) {
  if (!record || record.revokedAt || record.credentialVersion !== 2 || record.jobAccess !== true
    || !Number.isSafeInteger(record.credentialRevision) || record.credentialRevision < 1
    || typeof record.id !== 'string' || !RUNNER_ID_RE.test(record.id) || typeof record.projectRef !== 'string' || !REF.test(record.projectRef)
    || !Number.isInteger(record.slot) || record.slot < 0 || record.slot >= CLOUD_MAX_AGENTS
    || typeof record.accountKey !== 'string' || !/^supabase:[A-Za-z0-9_-]{1,128}$/.test(record.accountKey)
    || digest(record.accountKey) !== record.owner) return null;
  return { cloudVersion: 'supabase', id: record.accountKey.slice('supabase:'.length) };
}
export async function listAgents(owner, store = agentStore()) {
  const records = await Promise.all(Array.from({ length: CLOUD_MAX_AGENTS }, (_, slot) => store.get(agentKey(owner, slot), { type: 'json' })));
  return records.filter(record => record?.owner === owner).map(publicAgent);
}
export async function createAgent(owner, input, store = agentStore(), { user } = {}) {
  if (typeof input?.projectRef !== 'string' || !REF.test(input.projectRef)) throw Object.assign(new Error('invalid_project_ref'), { status: 400 });
  if (input.name !== undefined && typeof input.name !== 'string') throw Object.assign(new Error('invalid_agent_name'), { status: 400 });
  const name = (input.name || 'Capsule runner').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(name)) throw Object.assign(new Error('invalid_agent_name'), { status: 400 });
  const accountKey = user === undefined ? null : accountKeyFor(user);
  if (accountKey && digest(accountKey) !== owner) throw new Error('invalid_runner_account');
  for (let slot = 0; slot < CLOUD_MAX_AGENTS; slot++) {
    const key = agentKey(owner, slot);
    const current = await store.getWithMetadata(key, { type: 'json' });
    if (current?.data && !current.data.revokedAt) continue;
    const token = `pb_agent_${owner}_${slot}_${randomBytes(32).toString('hex')}`;
    const record = { id: randomUUID(), owner, slot, name, projectRef: input.projectRef, tokenHash: digest(token), tokenHint: token.slice(-4), createdAt: new Date().toISOString(), revokedAt: null,
      ...(accountKey ? { accountKey, credentialVersion: 2, credentialRevision: 1, jobAccess: true } : {}) };
    const result = await store.setJSON(key, record, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
    if (result.modified) return { agent: publicAgent(record), token };
  }
  throw Object.assign(new Error('agent_limit_reached'), { status: 409 });
}
/** Explicit owner-authorized upgrade/rotation preserves all existing runner and
 * private-job identities. Losing the response requires another owner rotation;
 * the old token is never returned or silently kept valid. */
export async function rotateAgent(owner, input, user, store = agentStore()) {
  const keys = ['id', 'expectedRevision', 'enableJobAccess'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length
    || Object.keys(input).some(key => !keys.includes(key)) || typeof input.id !== 'string' || !RUNNER_ID_RE.test(input.id)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.enableJobAccess !== true) {
    throw Object.assign(new Error('invalid_agent_rotation'), { status: 400 });
  }
  const accountKey = accountKeyFor(user);
  if (digest(accountKey) !== owner) throw new Error('invalid_runner_account');
  for (let slot = 0; slot < CLOUD_MAX_AGENTS; slot++) {
    const key = agentKey(owner, slot), current = await store.getWithMetadata(key, { type: 'json' });
    if (current?.data?.id !== input.id || current.data.owner !== owner) continue;
    const record = current.data, revision = record.credentialRevision ?? 0;
    if (record.revokedAt) throw Object.assign(new Error('agent_revoked'), { status: 409 });
    if (!Number.isSafeInteger(revision) || revision !== input.expectedRevision || revision >= Number.MAX_SAFE_INTEGER
      || record.slot !== slot || typeof record.projectRef !== 'string' || !REF.test(record.projectRef)
      || record.accountKey !== undefined && record.accountKey !== accountKey) throw Object.assign(new Error('agent_changed_retry'), { status: 409 });
    const token = `pb_agent_${owner}_${slot}_${randomBytes(32).toString('hex')}`;
    const next = { ...record, accountKey, credentialVersion: 2, credentialRevision: revision + 1, jobAccess: true,
      tokenHash: digest(token), tokenHint: token.slice(-4), rotatedAt: new Date().toISOString() };
    if (!(await store.setJSON(key, next, { onlyIfMatch: current.etag })).modified) throw Object.assign(new Error('agent_changed_retry'), { status: 409 });
    return { agent: publicAgent(next), token };
  }
  throw Object.assign(new Error('agent_not_found'), { status: 404 });
}
export async function revokeAgent(owner, id, store = agentStore()) {
  for (let slot = 0; slot < CLOUD_MAX_AGENTS; slot++) {
    const key = agentKey(owner, slot);
    const current = await store.getWithMetadata(key, { type: 'json' });
    if (current?.data?.id !== id || current.data.owner !== owner) continue;
    if (current.data.revokedAt) return publicAgent(current.data);
    const record = { ...current.data, revokedAt: new Date().toISOString() };
    const result = await store.setJSON(key, record, { onlyIfMatch: current.etag });
    if (!result.modified) throw Object.assign(new Error('agent_changed_retry'), { status: 409 });
    return publicAgent(record);
  }
  throw Object.assign(new Error('agent_not_found'), { status: 404 });
}
export async function authenticateAgent(authorization, store = agentStore()) {
  const token = String(authorization || '').match(/^Bearer (pb_agent_([a-f0-9]{64})_(\d{1,2})_([a-f0-9]{64}))$/)?.slice(1);
  if (!token || Number(token[2]) >= CLOUD_MAX_AGENTS) return null;
  const record = await store.get(agentKey(token[1], Number(token[2])), { type: 'json' });
  if (!record || record.revokedAt || record.owner !== token[1] || record.slot !== Number(token[2])
    || typeof record.id !== 'string' || !RUNNER_ID_RE.test(record.id) || typeof record.projectRef !== 'string' || !REF.test(record.projectRef)
    || typeof record.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.tokenHash)) return null;
  return timingSafeEqual(Buffer.from(record.tokenHash, 'hex'), Buffer.from(digest(token[0]), 'hex')) ? record : null;
}
