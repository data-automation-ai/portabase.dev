import {runtimePolicy,managedStarterReady} from '../shared/runtime-policy.mjs';
import { publicAuthConfigBoth, jsonResponse } from '../shared/verify-user.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });

  try {
    const auth = await publicAuthConfigBoth();
    let managedStarterEnabled=false;try{managedStarterEnabled=managedStarterReady(await runtimePolicy());}catch{}
    return jsonResponse(200, { ok: true, auth, commerce:{managedStarterEnabled} });
  } catch (error) {
    console.error(`auth_config_error=${String(error.message || 'error').replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    return jsonResponse(503, { ok: false, error: 'unavailable' });
  }
}
