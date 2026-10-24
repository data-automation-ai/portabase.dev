import { createHash } from 'node:crypto';
const AUTH_URL = 'https://eoiqvdmvgaurlecdzqkp.supabase.co';
const PUBLISHABLE = 'sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL';
export const ownerHash = id => createHash('sha256').update(id).digest('hex');
export async function customerIdentity(authorization, fetchImpl = fetch) {
  if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_.-]{50,8192}$/.test(authorization)) throw new Error('sign_in_required');
  const r = await fetchImpl(`${AUTH_URL}/auth/v1/user`, { headers: { Authorization: authorization, apikey: PUBLISHABLE },
    redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('sign_in_required');
  const user = await r.json();
  if (!/^[a-f0-9-]{36}$/i.test(user.id || '') || !user.email_confirmed_at) throw new Error('verified_account_required');
  return { id: user.id, owner: ownerHash(user.id) };
}
