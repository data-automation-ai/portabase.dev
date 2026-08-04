/**
 * Portabase Cloud commercial product constants (browser-safe).
 *
 * Launch target: Supabase projects only (DB, Auth, Storage, Edge Functions).
 * Payment: Square · two plans:
 *   $17/mo — 1 escape per 24 hours
 *   $27/mo — up to 3 escapes per day
 * SMS: success + failure texts at run time (manage numbers in console).
 * Binary/capsule storage: ALWAYS customer-provided — never hosted by Portabase Cloud.
 *
 * Unit of work = an "escape" (capture → encrypt capsule → verify destination).
 * Avoid "backup" in customer-facing copy.
 */

export const LAUNCH_PLATFORM = 'supabase';

export const CLOUD_TRIAL_DAYS = 7;
export const CLOUD_CURRENCY = 'USD';
export const CLOUD_PAYMENT_GATEWAY = 'square';
export const CLOUD_MAX_AGENTS = 12;

/** @typedef {'cloud-17' | 'cloud-27'} CloudPlanId */

/** Fixed commercial plans (no à-la-carte cycle add-ons). */
export const CLOUD_PLANS = Object.freeze({
  'cloud-17': Object.freeze({
    id: 'cloud-17',
    priceMonthlyUsd: 17,
    priceMonthlyCents: 1700,
    escapesPerDay: 1,
    cyclesPerDay: 1, // alias — prefer escapesPerDay in product copy
    title: 'Daily Escape',
    cadenceLabel: '1 escape per 24 hours',
    shortLabel: '$17/mo · 1 escape / 24h',
  }),
  'cloud-27': Object.freeze({
    id: 'cloud-27',
    priceMonthlyUsd: 27,
    priceMonthlyCents: 2700,
    escapesPerDay: 3,
    cyclesPerDay: 3,
    title: 'Triple Escape',
    cadenceLabel: 'up to 3 escapes per day',
    shortLabel: '$27/mo · up to 3 escapes / day',
  }),
});

export const CLOUD_DEFAULT_PLAN_ID = 'cloud-17';
export const CLOUD_PLAN_ID = CLOUD_DEFAULT_PLAN_ID;

/** @deprecated use CLOUD_PLANS — kept for older imports */
export const CLOUD_PRICE_MONTHLY_USD = CLOUD_PLANS['cloud-17'].priceMonthlyUsd;
export const CLOUD_PRICE_MONTHLY_CENTS = CLOUD_PLANS['cloud-17'].priceMonthlyCents;
export const CLOUD_LIST_PRICE_MONTHLY_USD = 27;
export const CLOUD_LIST_PRICE_MONTHLY_CENTS = 2700;
export const CLOUD_INCLUDED_CYCLES_PER_DAY = 1;
export const CLOUD_EXTRA_CYCLE_MONTHLY_USD = 0;
export const CLOUD_EXTRA_CYCLE_MONTHLY_CENTS = 0;
export const CLOUD_MAX_EXTRA_CYCLES = 0;

export const SMS_DEFAULTS = {
  onFailure: true,
  onSuccess: true,
  maxNumbersBase: 3,
  quietHoursOptional: true,
};

export const STORAGE_POLICY = {
  owner: 'customer',
  includedInCloud: false,
  summary: 'You provide capsule storage. Portabase Cloud does not host recovery capsules.',
  allowedKinds: ['s3', 'dropbox', 'gdrive', 'local', 'nas', 'azure-blob', 'gcs'],
  labels: {
    s3: 'Amazon S3 (your bucket)',
    dropbox: 'Dropbox',
    gdrive: 'Google Drive',
    local: 'Local Starter (this PC / USB / NAS · ≤100 MB)',
    nas: 'NAS / SMB',
    'azure-blob': 'Azure Blob',
    gcs: 'Google Cloud Storage',
  },
};

export const LOCAL_STARTER = {
  id: 'local-starter',
  maxBytes: 100 * 1024 * 1024,
  maxLabel: '100 MB',
  title: 'Local Starter vault',
  summary:
    'No S3 or Dropbox yet? Keep encrypted capsules on this computer (or a USB/NAS folder) while each capsule stays ≤ 100 MB.',
  risks: [
    'Same disk as the laptop can die in the same fire, theft, or disk failure as the machine running the job.',
    'Not a substitute for off-machine storage for production Escape.',
  ],
  upgradeWhen: 'Project grows past ~100 MB capsules, or you need recovery if this computer is gone.',
  upgradeTo: ['Amazon S3', 'Dropbox'],
};

export function getCloudPlan(planId = CLOUD_DEFAULT_PLAN_ID) {
  return CLOUD_PLANS[planId] || CLOUD_PLANS[CLOUD_DEFAULT_PLAN_ID];
}

export function priceLabel(cents) {
  const amount = cents == null ? CLOUD_PLANS['cloud-17'].priceMonthlyCents : Number(cents);
  return `$${(amount / 100).toFixed(0)}/mo`;
}

/** Resolve plan from id or legacy extraCycles (1–2 extras ≈ thrice plan). */
export function resolvePlan({ planId, extraCycles } = {}) {
  if (planId && CLOUD_PLANS[planId]) return CLOUD_PLANS[planId];
  const extra = Math.max(0, Number(extraCycles) || 0);
  if (extra >= 2) return CLOUD_PLANS['cloud-27'];
  return CLOUD_PLANS['cloud-17'];
}

export function cyclesPerDay(extraCycles = 0) {
  const plan = resolvePlan({ extraCycles });
  return {
    included: plan.cyclesPerDay,
    extra: 0,
    total: plan.cyclesPerDay,
    extraMonthlyCents: 0,
    planId: plan.id,
    priceMonthlyCents: plan.priceMonthlyCents,
  };
}

export function monthlyTotalCents(extraCyclesOrPlan = 0) {
  if (typeof extraCyclesOrPlan === 'string') {
    return getCloudPlan(extraCyclesOrPlan).priceMonthlyCents;
  }
  return resolvePlan({ extraCycles: extraCyclesOrPlan }).priceMonthlyCents;
}

export function whatCloudIncludes(planIdOrExtra = CLOUD_DEFAULT_PLAN_ID) {
  const plan = typeof planIdOrExtra === 'string'
    ? getCloudPlan(planIdOrExtra)
    : resolvePlan({ extraCycles: planIdOrExtra });
  return [
    'Supabase project recovery ops (launch scope)',
    'Hosted ops console (status, alerts, replay, CloudWatch/CloudTrail live)',
    plan.cadenceLabel,
    'SMS on success and failure at run time (manage numbers in console)',
    `Up to ${CLOUD_MAX_AGENTS} agents (telemetry runners)`,
    'Opt-in agent health metadata only',
    'Multi-person alert chains (SMS / email / Slack)',
    `7-day trial then ${priceLabel(plan.priceMonthlyCents)} via Square (card required)`,
  ];
}

export function agentSlotsUsed(count) {
  const used = Math.max(0, Number(count) || 0);
  return {
    used,
    max: CLOUD_MAX_AGENTS,
    remaining: Math.max(0, CLOUD_MAX_AGENTS - used),
    atLimit: used >= CLOUD_MAX_AGENTS,
  };
}

export function whatCloudDoesNotInclude() {
  return [
    'Capsule storage (you bring S3, Drive, Dropbox, NAS, Local Starter, etc.)',
    'Encryption passphrases or Supabase service keys',
    'Capsule ciphertext (never lands in Portabase Cloud)',
    'Managed object store billed by Portabase',
    'Unlimited escapes (choose $17 · 1 escape/24h or $27 · up to 3 escapes/day)',
  ];
}

export function smsManagementFeatures() {
  return [
    { id: 'on_failure', label: 'Text on run failure', defaultOn: true },
    { id: 'on_success', label: 'Text on run success', defaultOn: true },
    { id: 'numbers', label: 'Manage phone numbers (E.164)', defaultOn: true },
    { id: 'verify', label: 'Verify numbers before they can receive alerts', defaultOn: true },
    { id: 'quiet', label: 'Optional quiet hours (success only)', defaultOn: false },
    { id: 'test', label: 'Send test SMS', defaultOn: true },
    { id: 'history', label: 'Delivery history (sent / failed / suppressed)', defaultOn: true },
    { id: 'project_scope', label: 'Per-project or workspace-wide SMS', defaultOn: true },
  ];
}
