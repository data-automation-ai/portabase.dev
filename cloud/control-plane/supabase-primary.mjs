/**
 * Hosted Supabase adapter for the Cloud control-plane primary.
 *
 * Write dest is the Portabase Cloud project (portabase.dev), when it exists.
 * ekklokrukxmqlahtonnc is Louis's live business source — never a write dest,
 * never a live pull target from this module.
 */
import { createRequire } from 'node:module';
import { ESSENTIAL_COLLECTIONS, pickAllowedRow, projectEssentialRow } from './forbidden.mjs';

const require = createRequire(import.meta.url);

/** Live business source. Context only. Do not read or write from this module. */
export const LIVE_BUSINESS_SOURCE_REF = 'ekklokrukxmqlahtonnc';

export function assertControlPlanePrimaryUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    const err = new Error('PORTABASE_CLOUD_SUPABASE_URL is required for the hosted primary');
    err.code = 'primary_url_required';
    throw err;
  }
  if (raw.toLowerCase().includes(LIVE_BUSINESS_SOURCE_REF)) {
    const err = new Error(
      `${LIVE_BUSINESS_SOURCE_REF} is a live business source, not the Portabase Cloud control plane. Refusing as primary.`,
    );
    err.code = 'live_business_source_refused';
    throw err;
  }
  return raw;
}

/**
 * In-process primary for tests. This is not a sqlite store.
 */
export function createInjectedPrimary(initial = {}) {
  const tables = Object.fromEntries(ESSENTIAL_COLLECTIONS.map((name) => [name, new Map()]));
  for (const [name, rows] of Object.entries(initial)) {
    if (!tables[name]) continue;
    for (const row of rows) tables[name].set(row.id, { ...row });
  }
  let down = false;

  async function ping() {
    if (down) {
      const err = new Error('primary_unavailable');
      err.code = 'primary_unavailable';
      throw err;
    }
  }

  return {
    kind: 'injected',
    setDown(value) {
      down = Boolean(value);
    },
    isDown() {
      return down;
    },
    async ping() {
      await ping();
    },
    async list(collection) {
      await ping();
      return [...tables[collection].values()].map((row) => ({ ...row }));
    },
    async upsert(collection, row) {
      await ping();
      const next = pickAllowedRow(collection, row);
      tables[collection].set(next.id, { ...next });
      return { ...next };
    },
    async remove(collection, id) {
      await ping();
      tables[collection].delete(id);
    },
    snapshot() {
      return Object.fromEntries(
        ESSENTIAL_COLLECTIONS.map((name) => [name, [...tables[name].values()].map((row) => ({ ...row }))]),
      );
    },
  };
}

export function createSupabasePrimary({ url, serviceKey, schema = 'portabase_cloud' } = {}) {
  const resolvedUrl = assertControlPlanePrimaryUrl(url || process.env.PORTABASE_CLOUD_SUPABASE_URL);
  const key = serviceKey || process.env.PORTABASE_CLOUD_SUPABASE_SERVICE_KEY;
  if (!key) {
    const err = new Error('PORTABASE_CLOUD_SUPABASE_SERVICE_KEY is required for the hosted primary');
    err.code = 'primary_key_required';
    throw err;
  }

  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(resolvedUrl, key, {
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function unwrap(result, op) {
    if (result.error) {
      const err = new Error(result.error.message || op);
      err.code = result.error.code || 'primary_error';
      err.status = result.error.status;
      throw err;
    }
    return result.data;
  }

  return {
    kind: 'supabase',
    url: resolvedUrl,
    schema,
    async ping() {
      const result = await client.from('subscribers').select('id').limit(1);
      await unwrap(result, 'ping');
    },
    async list(collection) {
      const result = await client.from(collection).select('*');
      const rows = await unwrap(result, `list:${collection}`);
      return (rows || []).map((row) => projectEssentialRow(collection, row));
    },
    async upsert(collection, row) {
      const next = pickAllowedRow(collection, row);
      const result = await client.from(collection).upsert(next).select('*').single();
      return pickAllowedRow(collection, await unwrap(result, `upsert:${collection}`));
    },
    async remove(collection, id) {
      const result = await client.from(collection).delete().eq('id', id);
      await unwrap(result, `delete:${collection}`);
    },
  };
}

export function createPrimaryFromEnv() {
  return createSupabasePrimary({
    url: process.env.PORTABASE_CLOUD_SUPABASE_URL,
    serviceKey: process.env.PORTABASE_CLOUD_SUPABASE_SERVICE_KEY,
  });
}
