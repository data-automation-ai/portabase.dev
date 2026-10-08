import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/cloud-cloudwatch-live.mjs';
import { handler as auditHandler } from '../netlify/functions/cloud-audit-trail.mjs';

test('retired log endpoint never reads credentials, caller scopes or raw bodies', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected provider call'); };
  try {
    for (const httpMethod of ['GET', 'POST', 'PUT', 'DELETE']) {
      const event = { httpMethod };
      for (const field of ['body', 'headers', 'queryStringParameters', 'isBase64Encoded']) {
        Object.defineProperty(event, field, { get() { throw new Error(`read forbidden ${field}`); } });
      }
      const response = await handler(event);
      assert.equal(response.statusCode, 410);
      assert.deepEqual(JSON.parse(response.body), {
        error: 'private_runner_logs_only',
        message: 'Detailed logs belong in your private runner. Use Telemetry for reported job status.',
      });
    }
    assert.equal((await handler({ httpMethod: 'OPTIONS' })).statusCode, 204);
  } finally { globalThis.fetch = originalFetch; }
});

test('retired audit endpoint refuses caller role scopes without reading or forwarding them', async () => {
  for (const httpMethod of ['GET', 'POST', 'PUT', 'DELETE']) {
    const event = { httpMethod };
    for (const field of ['body', 'headers', 'queryStringParameters', 'isBase64Encoded']) {
      Object.defineProperty(event, field, { get() { throw new Error(`read forbidden ${field}`); } });
    }
    const response = await auditHandler(event);
    assert.equal(response.statusCode, 410);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'customer_audit_only',
      message: 'Review AWS audit history in your own AWS account. Use Telemetry for reported runner status.',
    });
  }
  assert.equal((await auditHandler({ httpMethod: 'OPTIONS' })).statusCode, 204);
});
