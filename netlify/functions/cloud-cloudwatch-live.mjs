/** Retired raw-log proxy. Private diagnostics must stay in the runner.
 * Do not parse caller scopes, assume roles, or retrieve logs before returning.
 * Safe operational reports remain available through the telemetry endpoints.
 */
import { jsonResponse } from '../shared/verify-user.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
  return jsonResponse(410, {
    error: 'private_runner_logs_only',
    message: 'Detailed logs belong in your private runner. Use Telemetry for reported job status.',
  });
}
