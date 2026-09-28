import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSmsBodySafe, buildSmsStatus, planAllowsOptionalSms } from '../src/lib/sms-safe.js';

test('optional SMS is a $17 / $37 feature', () => {
  assert.equal(planAllowsOptionalSms('cloud-7'), false);
  assert.equal(planAllowsOptionalSms('cloud-17'), true);
  assert.equal(planAllowsOptionalSms('cloud-37'), true);
});

test('SMS body is status only and refuses secrets', () => {
  const sms = buildSmsStatus({ planId: 'cloud-17', event: 'job', jobId: 'job_1', status: 'ok' });
  assert.equal(sms.sent, true);
  assert.match(sms.body, /Portabase/);
  assert.equal(sms.containsKeys, false);
  assert.equal(buildSmsStatus({ planId: 'cloud-7', status: 'ok' }).sent, false);
  assert.throws(() => assertSmsBodySafe('passphrase=super-secret-value'), { code: 'sms_unsafe' });
  assert.throws(() => assertSmsBodySafe('restore from capsule.pbase'), { code: 'sms_unsafe' });
});
