import { withBlobs } from '../shared/subscription-store.mjs';
/** Retired customer CloudTrail proxy. AWS audit details stay customer-controlled.
 * Never parse caller roles or retrieve raw audit events in the ordinary backend.
 */
import { jsonResponse } from '../shared/verify-user.mjs';

async function lambdaHandler(event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
  return jsonResponse(410, {
    error: 'customer_audit_only',
    message: 'Review AWS audit history in your own AWS account. Use Telemetry for reported runner status.',
  });
}

export const handler = withBlobs(lambdaHandler);
