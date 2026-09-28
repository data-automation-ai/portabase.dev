/**
 * S3: Cloud selection (which Supabase project / tables / buckets a customer
 * wants a capsule to cover) — pure validation plus thin Netlify Blobs helpers.
 * Store: 'portabase-cloud-selections', key `sel:v1:{uid}`.
 */
import { getStore } from '@netlify/blobs';
import { findForbiddenField } from '../../cloud/control-plane/forbidden.mjs';
import { CLOUD_FREE, CLOUD_PLANS, LEGACY_PLAN_ALIASES, getCloudPlan } from './product.mjs';

export const SELECTION_STORE_NAME = 'portabase-cloud-selections';

const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const TABLE_RE = /^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_][A-Za-z0-9_$]*$/;
const BUCKET_RE = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_EXCLUDE_TABLES = 5000;
const MAX_EXCLUDE_BUCKETS = 1000;
const MAX_PROJECT_NAME_LEN = 200;

export function selectionKey(uid) {
  return `sel:v1:${uid}`;
}

export function selectionStore() {
  return getStore({ name: SELECTION_STORE_NAME, consistency: 'strong' });
}

/** Whether planId names a real plan (customer-facing or not, including legacy aliases and free). */
export function planExists(planId) {
  if (!planId) return false;
  if (planId === CLOUD_FREE.id) return true;
  const aliased = LEGACY_PLAN_ALIASES[planId] || planId;
  return Boolean(CLOUD_PLANS[aliased]);
}

function validateProjectRef(projectRef, plan) {
  if (projectRef === undefined || projectRef === null) {
    return { ok: false, error: 'missing_project_ref', field: 'projectRef' };
  }
  const refs = Array.isArray(projectRef) ? projectRef : [projectRef];
  if (refs.length === 0) {
    return { ok: false, error: 'missing_project_ref', field: 'projectRef' };
  }
  for (const ref of refs) {
    if (typeof ref !== 'string' || !PROJECT_REF_RE.test(ref)) {
      return { ok: false, error: 'invalid_project_ref', field: 'projectRef' };
    }
  }
  const maxDb = plan.databasesUnlimited ? Infinity : Math.max(1, Number(plan.databases) || 1);
  if (refs.length > maxDb) {
    return { ok: false, error: 'db_limit_exceeded', field: 'projectRef' };
  }
  return { ok: true, value: projectRef };
}

function validateStringArray(list, { field, re, max, errorPrefix }) {
  if (list === undefined) return { ok: true, value: [] };
  if (!Array.isArray(list)) return { ok: false, error: `invalid_${errorPrefix}`, field };
  if (list.length > max) return { ok: false, error: `too_many_${errorPrefix}`, field };
  for (const item of list) {
    if (typeof item !== 'string' || !re.test(item)) {
      return { ok: false, error: `invalid_${errorPrefix}_entry`, field };
    }
  }
  return { ok: true, value: list.slice() };
}

/**
 * Pure validator. `plan` must be the server-resolved plan object (from
 * netlify/shared/product.mjs `getCloudPlan`) — never trust a client-supplied
 * plan object. Returns { ok:true, selection } or { ok:false, error, field }.
 */
export function validateSelection(input, plan) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid_body', field: 'body' };
  }
  if (!plan || !plan.id || !planExists(plan.id)) {
    return { ok: false, error: 'invalid_plan', field: 'planId' };
  }
  const forbidden = findForbiddenField(input);
  if (forbidden) {
    return { ok: false, error: 'forbidden_field', field: forbidden };
  }

  const version = input.version === undefined ? 1 : input.version;
  if (version !== 1) {
    return { ok: false, error: 'invalid_version', field: 'version' };
  }

  const refCheck = validateProjectRef(input.projectRef, plan);
  if (!refCheck.ok) return refCheck;

  const tablesCheck = validateStringArray(input.excludeTables, {
    field: 'excludeTables',
    re: TABLE_RE,
    max: MAX_EXCLUDE_TABLES,
    errorPrefix: 'exclude_table',
  });
  if (!tablesCheck.ok) return tablesCheck;

  const bucketsCheck = validateStringArray(input.excludeBuckets, {
    field: 'excludeBuckets',
    re: BUCKET_RE,
    max: MAX_EXCLUDE_BUCKETS,
    errorPrefix: 'exclude_bucket',
  });
  if (!bucketsCheck.ok) return bucketsCheck;

  // Cap is server-authoritative — the client's capBytes (if any) is ignored outright.
  const capBytes = Number(plan.storageCapBytes);
  if (!Number.isFinite(capBytes) || capBytes < 0) {
    return { ok: false, error: 'invalid_plan_cap', field: 'planId' };
  }

  let estimateBytes = 0;
  if (input.estimateBytes !== undefined) {
    const n = Number(input.estimateBytes);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'invalid_estimate_bytes', field: 'estimateBytes' };
    }
    if (n > capBytes) {
      return { ok: false, error: 'over_cap', field: 'estimateBytes' };
    }
    estimateBytes = n;
  }

  let projectName;
  if (input.projectName !== undefined) {
    if (typeof input.projectName !== 'string' || input.projectName.length > MAX_PROJECT_NAME_LEN) {
      return { ok: false, error: 'invalid_project_name', field: 'projectName' };
    }
    projectName = input.projectName;
  }

  let measuredAt;
  if (input.measuredAt !== undefined) {
    if (typeof input.measuredAt !== 'string' || Number.isNaN(Date.parse(input.measuredAt))) {
      return { ok: false, error: 'invalid_measured_at', field: 'measuredAt' };
    }
    measuredAt = input.measuredAt;
  }

  const selection = {
    version: 1,
    planId: plan.id,
    projectRef: refCheck.value,
    excludeTables: tablesCheck.value,
    excludeBuckets: bucketsCheck.value,
    estimateBytes,
    capBytes,
  };
  if (projectName !== undefined) selection.projectName = projectName;
  if (measuredAt !== undefined) selection.measuredAt = measuredAt;

  return { ok: true, selection };
}

/** @param {ReturnType<typeof selectionStore>} [storeInstance] injectable for tests */
export async function getSelection(uid, storeInstance = selectionStore()) {
  if (!uid) return null;
  try {
    return (await storeInstance.get(selectionKey(uid), { type: 'json' })) || null;
  } catch {
    return null;
  }
}

/** @param {ReturnType<typeof selectionStore>} [storeInstance] injectable for tests */
export async function putSelection(uid, selection, storeInstance = selectionStore()) {
  if (!uid) throw new Error('missing_uid');
  const record = { ...selection, savedAt: new Date().toISOString() };
  await storeInstance.setJSON(selectionKey(uid), record);
  return record;
}

export { getCloudPlan };
