/**
 * Live Supabase viewer — 100% browser → customer project.
 * Keys and query results never go to Portabase Cloud.
 */

import { createClient } from '@supabase/supabase-js';

export const LIVE_SESSION_KEY = 'portabase.live-supabase.v1';
export const LIVE_VIEWER_COPY = Object.freeze({
  headline: 'Live Supabase · browser only',
  banner: 'Runs only in your browser. Portabase never receives these keys or query results.',
  contrast:
    'This is your live project — not the capsule. Capsule object names and plaintext stay zero-knowledge on Cloud.',
  persistRisk:
    'sessionStorage is optional and stays on this origin until you wipe. Another script on portabase.dev could read it while this tab is open. Default is memory-only.',
});

export function isPortabaseHost(hostname = '') {
  return /(^|\.)portabase\.dev$/i.test(String(hostname));
}

export function normalizeProjectUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) throw new Error('Paste your Supabase project URL (https://<ref>.supabase.co).');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.origin + (url.pathname === '/' ? '' : url.pathname);
}

export function assertBrowserToSupabaseOnly(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl, typeof window !== 'undefined' ? window.location.origin : 'https://portabase.dev');
  } catch {
    throw new Error('Enter a full project URL, e.g. https://xxxx.supabase.co');
  }
  if (isPortabaseHost(parsed.hostname)) {
    throw new Error('This viewer will not call Portabase Cloud. Paste your Supabase project URL.');
  }
  if (/(?:^|\.)api\.supabase\.com$/i.test(parsed.hostname)) {
    throw new Error('Management API is not used here (no Portabase proxy; CORS fail-closed). Use the CLI on your machine.');
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('Use https for the live project URL.');
  }
  return parsed.href;
}

export function guardedFetch(input, init) {
  const href = typeof input === 'string' ? input : input?.url;
  assertBrowserToSupabaseOnly(href);
  return fetch(input, init);
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

export function createLiveClient({ url, key }) {
  const projectUrl = normalizeProjectUrl(url);
  assertBrowserToSupabaseOnly(projectUrl);
  const secret = String(key || '').trim();
  if (secret.length < 20) throw new Error('Paste an anon or service_role key. It stays in this browser.');
  return createClient(projectUrl, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: memoryStorage(),
    },
    global: { fetch: guardedFetch },
  });
}

export function parsePostgrestCatalog(spec = {}) {
  const columnsFor = (name) => {
    const def = spec.definitions?.[name] || spec.components?.schemas?.[name] || {};
    const props = def.properties || {};
    return Object.entries(props).map(([col, meta]) => ({
      name: col,
      type: meta?.format || meta?.type || 'unknown',
    }));
  };
  const seen = new Map();
  const paths = spec.paths || {};
  for (const [path, ops] of Object.entries(paths)) {
    if (!path.startsWith('/') || path.startsWith('/rpc/')) continue;
    const name = path.replace(/^\//, '').split('/')[0];
    if (!name || name.includes('{')) continue;
    if (!seen.has(name)) {
      seen.set(name, {
        schema: 'public',
        name,
        columns: columnsFor(name),
      });
    }
  }
  if (!seen.size && spec.definitions) {
    for (const name of Object.keys(spec.definitions)) {
      if (name.startsWith('rpc_')) continue;
      seen.set(name, { schema: 'public', name, columns: columnsFor(name) });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchLiveCatalog({ url, key }) {
  const projectUrl = normalizeProjectUrl(url);
  assertBrowserToSupabaseOnly(projectUrl);
  const res = await guardedFetch(`${projectUrl}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/openapi+json',
    },
  });
  if (!res.ok) {
    throw new Error(`Live catalog HTTP ${res.status}. The request stayed in this browser — Portabase did not proxy it.`);
  }
  return parsePostgrestCatalog(await res.json());
}

export async function previewLiveRows(client, { schema = 'public', table, limit = 25 }) {
  if (!client || !table) throw new Error('Pick a table from your live project.');
  const from = schema && schema !== 'public'
    ? client.schema(schema).from(table)
    : client.from(table);
  const { data, error } = await from.select('*').limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function listLiveBuckets(client) {
  const { data, error } = await client.storage.listBuckets();
  if (error) throw new Error(error.message);
  return data || [];
}

export async function listLiveObjects(client, bucketId, path = '') {
  const { data, error } = await client.storage.from(bucketId).list(path, { limit: 80, offset: 0 });
  if (error) throw new Error(error.message);
  return data || [];
}

export function managementApiBlockedReason() {
  return 'api.supabase.com is not called from this page. We do not proxy Management API. Use the CLI on your machine for Edge Function admin if the browser is blocked.';
}

export function liveCliFallback(projectRef = '<ref>') {
  return [
    '# On YOUR machine — not via Portabase Cloud',
    `supabase link --project-ref ${projectRef}`,
    'supabase db dump --schema public',
    'supabase functions list',
    '# Storage + rows: this browser talks to your project URL directly when CORS allows.',
  ].join('\n');
}

export function readLiveSession() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(LIVE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeLiveSession({ url, key, persist }) {
  if (typeof sessionStorage === 'undefined') return { stored: false };
  if (!persist) {
    sessionStorage.removeItem(LIVE_SESSION_KEY);
    return { stored: false, where: 'memory' };
  }
  sessionStorage.setItem(LIVE_SESSION_KEY, JSON.stringify({
    url,
    key,
    savedAt: new Date().toISOString(),
    warning: LIVE_VIEWER_COPY.persistRisk,
  }));
  return { stored: true, where: 'sessionStorage' };
}

export function wipeLiveSession() {
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(LIVE_SESSION_KEY);
  return { wiped: true, postedToCloud: false };
}

export function neverSendLiveSecretsTo() {
  return [
    '/api/cloud',
    '/api/cloud/telemetry',
    '/api/cloud/jobs',
    'portabase.dev APIs',
  ];
}
