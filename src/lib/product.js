/**
 * Portabase Cloud commercial product constants (browser-safe).
 *
 * Launch target: Supabase projects only (DB, Auth, Storage, Edge Functions).
 * Payment: Square · $17/mo base = 1 backup cycle / 24h · extra cycles $10/mo each.
 * SMS: success + failure texts at run time (manage numbers in console).
 * Binary/capsule storage: ALWAYS customer-provided — never hosted by Portabase Cloud.
 */

export const LAUNCH_PLATFORM = 'supabase';

export const CLOUD_PRICE_MONTHLY_USD = 17;
export const CLOUD_PRICE_MONTHLY_CENTS = 1700;
export const CLOUD_LIST_PRICE_MONTHLY_USD = 34;
export const CLOUD_LIST_PRICE_MONTHLY_CENTS = 3400;
export const CLOUD_TRIAL_DAYS = 7;
export const CLOUD_CURRENCY = 'USD';
export const CLOUD_PAYMENT_GATEWAY = 'square';
export const CLOUD_PLAN_ID = 'cloud-17';
/** Max concurrent agents (telemetry runners) on the $17 Cloud plan. */
export const CLOUD_MAX_AGENTS = 12;

/** Base plan includes one full backup cycle per rolling 24 hours (per workspace). */
export const CLOUD_INCLUDED_CYCLES_PER_DAY = 1;
/** Each additional daily cycle add-on (monthly fee). */
export const CLOUD_EXTRA_CYCLE_MONTHLY_USD = 10;
export const CLOUD_EXTRA_CYCLE_MONTHLY_CENTS = 1000;
/** Soft cap on purchased extra cycles (ops / abuse). */
export const CLOUD_MAX_EXTRA_CYCLES = 23;

/** SMS product defaults */
export const SMS_DEFAULTS = {
  onFailure: true,
  onSuccess: true,
  maxNumbersBase: 3,
  quietHoursOptional: true,
};

/** Storage policy — product non-negotiable */
export const STORAGE_POLICY = {
  owner: 'customer',
  includedInCloud: false,
  summary: 'You provide binary storage. Portabase Cloud does not host recovery capsules.',
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

/**
 * Local Starter vault — no third-party object store required.
 * Encrypted capsules land on a folder the operator owns (laptop, USB, NAS path).
 * Soft product limit steers multi‑GB projects toward real Escape (S3/Dropbox).
 */
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

export function priceLabel(cents = CLOUD_PRICE_MONTHLY_CENTS) {
  return `$${(cents / 100).toFixed(0)}/mo`;
}

export function cyclesPerDay(extraCycles = 0) {
  const extra = Math.max(0, Math.min(CLOUD_MAX_EXTRA_CYCLES, Number(extraCycles) || 0));
  return {
    included: CLOUD_INCLUDED_CYCLES_PER_DAY,
    extra,
    total: CLOUD_INCLUDED_CYCLES_PER_DAY + extra,
    extraMonthlyCents: extra * CLOUD_EXTRA_CYCLE_MONTHLY_CENTS,
  };
}

export function monthlyTotalCents(extraCycles = 0) {
  const c = cyclesPerDay(extraCycles);
  return CLOUD_PRICE_MONTHLY_CENTS + c.extraMonthlyCents;
}

export function whatCloudIncludes(extraCycles = 0) {
  const c = cyclesPerDay(extraCycles);
  return [
    'Supabase project recovery ops (launch scope)',
    'Hosted ops console (status, alerts, replay, CloudWatch/CloudTrail live)',
    `${c.total} backup cycle${c.total === 1 ? '' : 's'} per 24 hours (${c.included} included · ${c.extra} add-on)`,
    'SMS on success and failure at run time (manage numbers in console)',
    `Up to ${CLOUD_MAX_AGENTS} agents (telemetry runners)`,
    'Opt-in agent health metadata only',
    'Multi-person alert chains (SMS / email / Slack)',
    '7-day trial then ' + priceLabel() + ' base via Square (card required)',
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
    'Binary / capsule storage (you bring S3, Drive, Dropbox, NAS, etc.)',
    'Encryption passphrases or Supabase service keys',
    'Capsule ciphertext (never lands in Portabase Cloud)',
    'Managed object store billed by Portabase',
    'Unlimited backup frequency (base = 1 cycle / 24h; extras $10/mo each)',
  ];
}

/** SMS product checklist (management surface) */
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
