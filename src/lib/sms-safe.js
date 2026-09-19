/**
 * Optional SMS status on $17 (and Scale). Status only.
 * Never keys, capsule bytes, customer row data, or passphrases.
 */

import { getCloudPlan } from './product.js';

const FORBIDDEN = [
  /password/i,
  /passphrase/i,
  /service[_-]?role/i,
  /sb_secret_/i,
  /postgres(ql)?:\/\//i,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /\.pbase/i,
];

export function planAllowsOptionalSms(planId) {
  const plan = getCloudPlan(planId);
  return plan.id === 'cloud-17' || plan.id === 'cloud-37';
}

export function assertSmsBodySafe(body) {
  const text = String(body || '');
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      const err = new Error('SMS refused: would include keys, capsule bytes, or customer data');
      err.code = 'sms_unsafe';
      throw err;
    }
  }
  if (text.length > 160) {
    const err = new Error('SMS body too long');
    err.code = 'sms_too_long';
    throw err;
  }
  return text;
}

export function buildSmsStatus({ planId, event = 'job', jobId, status, optIn = true } = {}) {
  if (!planAllowsOptionalSms(planId)) {
    return { sent: false, reason: 'sms_not_on_plan', planId: getCloudPlan(planId).id };
  }
  if (!optIn) {
    return { sent: false, reason: 'sms_opt_out', planId: getCloudPlan(planId).id };
  }
  const code = String(status || 'update').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'update';
  const id = String(jobId || 'job').replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
  const body = assertSmsBodySafe(`Portabase ${event} ${code} · ${id}`);
  return {
    sent: true,
    reason: 'status_only',
    planId: getCloudPlan(planId).id,
    provider: 'twilio',
    body,
    containsKeys: false,
    containsCapsuleBytes: false,
    containsCustomerData: false,
  };
}
