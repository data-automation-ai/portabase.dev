import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';

// Retired credential proxy. Never parse request bodies or contact Supabase here.
export function createSupabaseHandler({ authenticate = verifyCloudUser } = {}) {
  return async event => {
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
    try { await authenticate(event); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    return jsonResponse(410, { error: 'private_runner_setup_required',
      message: 'Inspect your source in the private runner workspace, then import its opaque job reference in the dashboard.' });
  };
}
export const handler = createSupabaseHandler();
