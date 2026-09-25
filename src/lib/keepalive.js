/**
 * Keepalive ping helpers — pure functions, no secrets stored.
 *
 * The browser calls the customer's own Supabase project directly with the
 * publishable anon key they paste on the Keepalive page. Nothing is posted
 * to Portabase Cloud APIs. Anon keys are publishable by design; service-role
 * keys and database passwords must never enter this flow.
 */

export function normalizeProjectRef(ref = '') {
  const clean = String(ref || '').trim().toLowerCase();
  if (/^[a-z0-9]{20}$/.test(clean)) return clean;
  return null;
}

export function keepaliveUrl(ref) {
  const clean = normalizeProjectRef(ref);
  if (!clean) return null;
  return `https://${clean}.supabase.co/rest/v1/keepalive?select=id&limit=1`;
}

export function interpretPingResponse(status, body) {
  if (status === 200 && Array.isArray(body) && body.length > 0) {
    return { ok: true, state: 'alive', detail: 'keepalive table answered — project is awake.' };
  }
  if (status === 200) {
    return { ok: false, state: 'empty', detail: 'Table reachable but has no rows. Insert the keepalive row, then ping again.' };
  }
  if (status === 401 || status === 403) {
    return { ok: false, state: 'denied', detail: 'Project answered but refused anon reads — check the anon key and the keepalive SELECT policy.' };
  }
  if (status === 404) {
    return { ok: false, state: 'missing', detail: 'No keepalive table at this project. Create it first (see /docs/keepalive).' };
  }
  return { ok: false, state: 'error', detail: `Unexpected response (HTTP ${status}). The project may be paused or unreachable.` };
}

export async function pingKeepalive({ ref, anonKey, fetchImpl = fetch }) {
  const url = keepaliveUrl(ref);
  if (!url) throw new Error('Enter a valid 20-character project ref.');
  if (!String(anonKey || '').trim()) throw new Error('Paste your publishable anon key — it stays in this browser.');
  const res = await fetchImpl(url, { headers: { apikey: String(anonKey).trim() } });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, ...interpretPingResponse(res.status, body) };
}

export function cronSnippet(ref, anonKey) {
  const clean = normalizeProjectRef(ref) || 'YOUR-REF';
  const key = String(anonKey || '').trim() || 'YOUR-ANON-KEY';
  return [
    `0 6 * * * curl -s "https://${clean}.supabase.co/rest/v1/keepalive?select=id&limit=1" -H "apikey: ${key}" >/dev/null 2>&1`,
  ].join('\n');
}

export function schtasksSnippet(ref, anonKey) {
  const clean = normalizeProjectRef(ref) || 'YOUR-REF';
  const key = String(anonKey || '').trim() || 'YOUR-ANON-KEY';
  return `schtasks /create /tn SupabaseKeepalive /tr "curl -s \\"https://${clean}.supabase.co/rest/v1/keepalive?select=id&limit=1\\" -H \\"apikey: ${key}\\"" /sc daily /st 06:00`;
}
