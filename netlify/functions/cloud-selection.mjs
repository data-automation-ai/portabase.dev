import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';

// Legacy records remain untouched. New selections belong to the private runner;
// this endpoint neither reads nor writes retained inventories.
export function createSelectionHandler({ authenticate = verifyCloudUser } = {}) {
  return async event => {
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (!['GET', 'PUT'].includes(event.httpMethod)) return jsonResponse(405, { error: 'method_not_allowed' });
    try { await authenticate(event); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    return jsonResponse(410, { error: 'private_runner_setup_required',
      message: 'Review and save selections in the private runner workspace. Existing legacy records have not been migrated or deleted.' });
  };
}
export const handler = createSelectionHandler();
