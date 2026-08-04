/**
 * Portabase Cloud API stub (no npm deps — deployable as pure zip).
 * - GET /health
 * - POST /v1/telemetry — agent Bearer token; rejects secret-shaped payloads
 * - ANY /v1/* — Cognito JWT claims from API Gateway authorizer
 */

import { createHash } from 'node:crypto';

const FORBIDDEN = [/password/i, /passphrase/i, /sb_secret_/i, /postgres(ql)?:\/\//i, /private[_-]?key/i];

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function rejectSecrets(value, path = 'root') {
  if (value == null) return;
  if (typeof value === 'string') {
    for (const re of FORBIDDEN) {
      if (re.test(value)) throw new Error(`forbidden_content:${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => rejectSecrets(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.some(re => re.test(k))) throw new Error(`forbidden_key:${k}`);
      rejectSecrets(v, `${path}.${k}`);
    }
  }
}

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path = event.rawPath || event.path || '/';

  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return json(200, {
      ok: true,
      service: 'portabase-cloud-api',
      environment: process.env.ENVIRONMENT,
      cognitoPool: process.env.COGNITO_USER_POOL_ID,
      metricNamespace: process.env.METRIC_NAMESPACE,
    });
  }

  if (method === 'POST' && path.includes('/v1/telemetry')) {
    const auth = event.headers?.authorization || event.headers?.Authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token || token.length < 20) return json(401, { error: 'unauthorized' });

    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    } catch {
      return json(400, { error: 'invalid_json' });
    }

    try {
      rejectSecrets(body);
    } catch (err) {
      return json(400, { error: 'invalid_event', detail: String(err.message) });
    }

    if (!body.eventType || !body.projectRef) {
      return json(400, { error: 'eventType_and_projectRef_required' });
    }

    const tokenFingerprint = createHash('sha256').update(token).digest('hex').slice(0, 12);

    // Production next steps:
    // 1) SHA-256 full token → agents.token_hash lookup in Supabase (service role)
    // 2) insert telemetry_events
    // 3) PutMetricData to Portabase/Cloud
    // 4) enqueue escalation if backup.failed / schedule.missed

    return json(202, {
      ok: true,
      accepted: true,
      eventType: body.eventType,
      projectRef: body.projectRef,
      agentFingerprint: tokenFingerprint,
      note: 'stub_accept — wire Supabase insert + CloudWatch EMF + escalation worker',
    });
  }

  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  return json(200, {
    ok: true,
    path,
    method,
    user: {
      sub: claims.sub || null,
      email: claims.email || null,
    },
    message: 'console_api_stub',
    next: [
      'POST /v1/workspaces',
      'POST /v1/agents',
      'POST /v1/runners',
      'GET /v1/telemetry/events',
      'PUT /v1/alert-policies',
    ],
  });
}
