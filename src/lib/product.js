/**
 * Portabase Cloud commercial product constants (browser-safe).
 *
 * Launch target: Supabase projects only (DB, Auth, Storage, Edge Functions).
 * Payment: Square · three storage-cap plans:
 *   $7/mo  — up to 1 GB
 *   $17/mo — up to 10 GB
 *   $37/mo — up to 100 GB
 * Capsule vault: ALWAYS customer-provided — never hosted by Portabase Cloud.
 * Encryption passphrases: customer-side only. Cloud is provably zero-knowledge of keys and capsule contents.
 *
 * Unit of work = an "escape" (capture → encrypt capsule → verify destination).
 * Avoid "backup" in customer-facing copy.
 *
 * Rate limit (Louis): every Square base plan includes **1 transfer / 24h**.
 * Optional add-on raises the rolling window to **3 transfers / 24h**.
 * Add-on prices: $3/mo on $7, $5/mo on $17 and $37. Square catalog IDs still pinned by Louis.
 */

export const LAUNCH_PLATFORM = 'supabase';

export const CLOUD_TRIAL_DAYS = 7;
export const CLOUD_CURRENCY = 'USD';
export const CLOUD_PAYMENT_GATEWAY = 'square';
export const CLOUD_MAX_AGENTS = 12;

/** Verified public install / source URLs. */
export const CLI_INSTALL = Object.freeze({
  npmCommand: 'npm i -g portabase',
  npmUrl: 'https://www.npmjs.com/package/portabase',
  githubCli: 'https://github.com/DataAutomation-ai/portabase-CLI',
  githubOrg: 'https://github.com/DataAutomation-ai',
});

/** @typedef {'cloud-7' | 'cloud-17' | 'cloud-37'} CloudPlanId */

const GB = 1024 * 1024 * 1024;

/** Fixed commercial plans (storage-cap based; no à-la-carte extras). */
export const CLOUD_PLANS = Object.freeze({
  'cloud-7': Object.freeze({
    id: 'cloud-7',
    priceMonthlyUsd: 7,
    priceMonthlyCents: 700,
    storageCapGb: 1,
    storageCapBytes: 1 * GB,
    storageCapLabel: '1 GB',
    escapesPerDay: 1,
    cyclesPerDay: 1,
    title: 'Starter Escape',
    cadenceLabel: 'up to 1 GB of capsule usage',
    shortLabel: '$7/mo · up to 1 GB',
    squareEnvKey: 'SQUARE_CLOUD_PLAN_VARIATION_ID_7',
    smsOptional: false,
  }),
  'cloud-17': Object.freeze({
    id: 'cloud-17',
    priceMonthlyUsd: 17,
    priceMonthlyCents: 1700,
    storageCapGb: 10,
    storageCapBytes: 10 * GB,
    storageCapLabel: '10 GB',
    escapesPerDay: 1,
    cyclesPerDay: 1,
    title: 'Daily Escape',
    cadenceLabel: 'up to 10 GB of capsule usage',
    shortLabel: '$17/mo · up to 10 GB',
    squareEnvKey: 'SQUARE_CLOUD_PLAN_VARIATION_ID',
    smsOptional: true,
  }),
  'cloud-37': Object.freeze({
    id: 'cloud-37',
    priceMonthlyUsd: 37,
    priceMonthlyCents: 3700,
    storageCapGb: 100,
    storageCapBytes: 100 * GB,
    storageCapLabel: '100 GB',
    escapesPerDay: 1,
    cyclesPerDay: 1,
    title: 'Scale Escape',
    cadenceLabel: 'up to 100 GB of capsule usage',
    shortLabel: '$37/mo · up to 100 GB',
    squareEnvKey: 'SQUARE_CLOUD_PLAN_VARIATION_ID_37',
    smsOptional: true,
  }),
});

export const CLOUD_DEFAULT_PLAN_ID = 'cloud-17';
export const CLOUD_PLAN_ID = CLOUD_DEFAULT_PLAN_ID;

/** Legacy Triple Escape ($27) maps to Scale ($37 / 100 GB). */
export const LEGACY_PLAN_ALIASES = Object.freeze({
  'cloud-27': 'cloud-37',
  'cloud-intro-17': 'cloud-17',
});

/** @deprecated use CLOUD_PLANS — kept for older imports */
export const CLOUD_PRICE_MONTHLY_USD = CLOUD_PLANS['cloud-17'].priceMonthlyUsd;
export const CLOUD_PRICE_MONTHLY_CENTS = CLOUD_PLANS['cloud-17'].priceMonthlyCents;
export const CLOUD_LIST_PRICE_MONTHLY_USD = CLOUD_PLANS['cloud-37'].priceMonthlyUsd;
export const CLOUD_LIST_PRICE_MONTHLY_CENTS = CLOUD_PLANS['cloud-37'].priceMonthlyCents;
/** Included on every $7 / $17 / $37 Square plan. */
export const BASE_TRANSFERS_PER_24H = 1;
export const CLOUD_INCLUDED_CYCLES_PER_DAY = BASE_TRANSFERS_PER_24H;
export const TRANSFER_WINDOW_HOURS = 24;

/** Paid add-on raises the rolling 24h allowance from 1 → 3. */
export const ADDON_TRANSFERS_PER_24H = 3;
export const EXTRA_TRANSFERS_ADDON_ID = 'extra-transfers';
export const EXTRA_TRANSFERS_ADDON_TITLE = 'Extra transfers';
/** Louis: $3 on Starter, $5 on Daily / Scale. Env can override a single workspace-wide price. */
export const EXTRA_TRANSFERS_ADDON_BY_PLAN = Object.freeze({
  'cloud-7': Object.freeze({
    monthlyUsd: 3,
    monthlyCents: 300,
    squareEnvKey: 'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7',
  }),
  'cloud-17': Object.freeze({
    monthlyUsd: 5,
    monthlyCents: 500,
    squareEnvKey: 'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_17',
  }),
  'cloud-37': Object.freeze({
    monthlyUsd: 5,
    monthlyCents: 500,
    squareEnvKey: 'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_37',
  }),
});
export const SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_ENV = 'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID';
export const SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_PLACEHOLDER = 'REPLACE_WITH_SQUARE_CATALOG_ID';

function readPositiveUsd(...values) {
  for (const raw of values) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function extraTransfersAddonUsdOverride() {
  let vite = 0;
  try {
    vite = typeof import.meta !== 'undefined' && import.meta.env
      ? readPositiveUsd(import.meta.env.VITE_EXTRA_TRANSFERS_ADDON_MONTHLY_USD)
      : 0;
  } catch {
    vite = 0;
  }
  let node = 0;
  try {
    node = typeof process !== 'undefined' && process.env
      ? readPositiveUsd(process.env.EXTRA_TRANSFERS_ADDON_MONTHLY_USD, process.env.VITE_EXTRA_TRANSFERS_ADDON_MONTHLY_USD)
      : 0;
  } catch {
    node = 0;
  }
  return vite || node || 0;
}

export function extraTransfersAddonForPlan(planId = CLOUD_DEFAULT_PLAN_ID) {
  const plan = getCloudPlan(planId);
  return EXTRA_TRANSFERS_ADDON_BY_PLAN[plan.id] || EXTRA_TRANSFERS_ADDON_BY_PLAN[CLOUD_DEFAULT_PLAN_ID];
}

export function extraTransfersAddonMonthlyUsd(planId = CLOUD_DEFAULT_PLAN_ID) {
  return extraTransfersAddonUsdOverride() || extraTransfersAddonForPlan(planId).monthlyUsd;
}

export function extraTransfersAddonMonthlyCents(planId = CLOUD_DEFAULT_PLAN_ID) {
  return Math.round(extraTransfersAddonMonthlyUsd(planId) * 100);
}

export function extraTransfersAddonPriceIsStub() {
  return false;
}

export function extraTransfersAddonPriceLabel(planId = CLOUD_DEFAULT_PLAN_ID) {
  return `$${extraTransfersAddonMonthlyUsd(planId)}/mo`;
}

/** @deprecated per-cycle extras retired — use EXTRA_TRANSFERS_ADDON_* */
export const CLOUD_EXTRA_CYCLE_MONTHLY_USD = EXTRA_TRANSFERS_ADDON_BY_PLAN['cloud-17'].monthlyUsd;
export const CLOUD_EXTRA_CYCLE_MONTHLY_CENTS = EXTRA_TRANSFERS_ADDON_BY_PLAN['cloud-17'].monthlyCents;
export const CLOUD_MAX_EXTRA_CYCLES = ADDON_TRANSFERS_PER_24H - BASE_TRANSFERS_PER_24H;
export const EXTRA_TRANSFERS_ADDON_MONTHLY_USD = EXTRA_TRANSFERS_ADDON_BY_PLAN['cloud-17'].monthlyUsd;

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
  allowedKinds: ['s3', 'dropbox', 'gdrive', 'local', 'nas', 'azure-blob', 'gcs', 'rclone'],
  labels: {
    s3: 'Amazon S3 (your bucket)',
    dropbox: 'Dropbox',
    gdrive: 'Google Drive',
    local: 'Local Starter (this PC / USB / NAS · ≤100 MB)',
    nas: 'NAS / SMB',
    'azure-blob': 'Azure Blob',
    gcs: 'Google Cloud Storage',
    rclone: 'rclone remote',
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
    'Large fills need staging disk — prefer a cloud runner, not a surprise folder on C:.',
  ],
  upgradeWhen: 'Project grows past ~100 MB capsules, or you need recovery if this computer is gone.',
  upgradeTo: ['Amazon S3', 'Dropbox', 'Google Drive', 'rclone'],
};

export function getCloudPlan(planId = CLOUD_DEFAULT_PLAN_ID) {
  const aliased = LEGACY_PLAN_ALIASES[planId] || planId;
  return CLOUD_PLANS[aliased] || CLOUD_PLANS[CLOUD_DEFAULT_PLAN_ID];
}

export function priceLabel(cents) {
  const amount = cents == null ? CLOUD_PLANS['cloud-17'].priceMonthlyCents : Number(cents);
  return `$${(amount / 100).toFixed(0)}/mo`;
}

export function planPriceRangeLabel() {
  return '$7 / $17 / $37';
}

/** Resolve plan from id or legacy extraCycles (1–2 extras ≈ scale plan). */
export function resolvePlan({ planId, extraCycles } = {}) {
  if (planId && (CLOUD_PLANS[planId] || LEGACY_PLAN_ALIASES[planId])) return getCloudPlan(planId);
  const extra = Math.max(0, Number(extraCycles) || 0);
  if (extra >= 2) return CLOUD_PLANS['cloud-37'];
  return CLOUD_PLANS[CLOUD_DEFAULT_PLAN_ID];
}

export function cyclesPerDay(extraCycles = 0, extraTransfersAddon = false) {
  const plan = resolvePlan({ extraCycles });
  const addon = Boolean(extraTransfersAddon);
  const window = transferWindow({ extraTransfersAddon: addon });
  return {
    included: BASE_TRANSFERS_PER_24H,
    extra: addon ? ADDON_TRANSFERS_PER_24H - BASE_TRANSFERS_PER_24H : 0,
    total: window.allowance,
    extraMonthlyCents: addon ? extraTransfersAddonMonthlyCents() : 0,
    extraTransfersAddon: addon,
    planId: plan.id,
    priceMonthlyCents: plan.priceMonthlyCents,
    storageCapGb: plan.storageCapGb,
  };
}

/**
 * Rolling 24h transfer window for Square Cloud.
 * Base plans: 1. Extra-transfers add-on: 3.
 */
export function transferWindow({
  usedLast24h = 0,
  extraTransfersAddon = false,
  planId = CLOUD_DEFAULT_PLAN_ID,
  now = Date.now(),
} = {}) {
  const used = Math.max(0, Math.floor(Number(usedLast24h) || 0));
  const addon = Boolean(extraTransfersAddon);
  const allowance = addon ? ADDON_TRANSFERS_PER_24H : BASE_TRANSFERS_PER_24H;
  const remaining = Math.max(0, allowance - used);
  const plan = getCloudPlan(planId);
  const addonMeta = extraTransfersAddonForPlan(plan.id);
  return {
    used,
    allowance,
    remaining,
    atLimit: used >= allowance,
    extraTransfersAddon: addon,
    windowHours: TRANSFER_WINDOW_HOURS,
    included: BASE_TRANSFERS_PER_24H,
    addonAllowance: ADDON_TRANSFERS_PER_24H,
    addonId: EXTRA_TRANSFERS_ADDON_ID,
    addonTitle: EXTRA_TRANSFERS_ADDON_TITLE,
    planId: plan.id,
    addonMonthlyUsd: extraTransfersAddonMonthlyUsd(plan.id),
    addonMonthlyCents: extraTransfersAddonMonthlyCents(plan.id),
    addonPriceTbd: false,
    addonPriceLabel: extraTransfersAddonPriceLabel(plan.id),
    squareCatalogEnv: addonMeta.squareEnvKey,
    squareCatalogPlaceholder: SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_PLACEHOLDER,
    asOf: new Date(now).toISOString(),
  };
}

/** Count capsule/job rows whose timestamp falls in the rolling 24h window. */
export function countTransfersLast24h(items, { now = Date.now(), getTime } = {}) {
  const cutoff = Number(now) - TRANSFER_WINDOW_HOURS * 3600e3;
  return (items || []).filter((item) => {
    const t = getTime
      ? getTime(item)
      : Date.parse(item?.createdAt || item?.occurredAt || item?.startedAt || 0);
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}

/** Minimum schedule interval that stays inside the 24h allowance. */
export function minScheduleHours({ extraTransfersAddon } = {}) {
  return extraTransfersAddon ? Math.ceil(TRANSFER_WINDOW_HOURS / ADDON_TRANSFERS_PER_24H) : TRANSFER_WINDOW_HOURS;
}

export function extraTransfersAddonPublic(planId = CLOUD_DEFAULT_PLAN_ID) {
  const plan = getCloudPlan(planId);
  const meta = extraTransfersAddonForPlan(plan.id);
  return {
    id: EXTRA_TRANSFERS_ADDON_ID,
    title: EXTRA_TRANSFERS_ADDON_TITLE,
    transfersPer24h: ADDON_TRANSFERS_PER_24H,
    includedTransfersPer24h: BASE_TRANSFERS_PER_24H,
    windowHours: TRANSFER_WINDOW_HOURS,
    planId: plan.id,
    priceMonthlyUsd: extraTransfersAddonMonthlyUsd(plan.id),
    priceMonthlyCents: extraTransfersAddonMonthlyCents(plan.id),
    priceTbd: false,
    priceLabel: extraTransfersAddonPriceLabel(plan.id),
    pricesByPlan: Object.fromEntries(Object.entries(EXTRA_TRANSFERS_ADDON_BY_PLAN).map(([id, row]) => [id, {
      monthlyUsd: row.monthlyUsd,
      monthlyCents: row.monthlyCents,
      squareEnvKey: row.squareEnvKey,
    }])),
    squareEnvKey: meta.squareEnvKey,
    squareCatalogPlaceholder: SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_PLACEHOLDER,
    note: 'Louis: +$3/mo on $7, +$5/mo on $17 and $37. Pin Square catalog IDs per plan.',
  };
}

export function monthlyTotalCents(extraCyclesOrPlan = 0) {
  if (typeof extraCyclesOrPlan === 'string') {
    return getCloudPlan(extraCyclesOrPlan).priceMonthlyCents;
  }
  return resolvePlan({ extraCycles: extraCyclesOrPlan }).priceMonthlyCents;
}

export function storageUsage(usedBytes, planId = CLOUD_DEFAULT_PLAN_ID) {
  const plan = getCloudPlan(planId);
  const used = Math.max(0, Number(usedBytes) || 0);
  const cap = plan.storageCapBytes;
  const ratio = cap > 0 ? Math.min(1, used / cap) : 0;
  return {
    usedBytes: used,
    capBytes: cap,
    capGb: plan.storageCapGb,
    capLabel: plan.storageCapLabel,
    ratio,
    percent: Math.round(ratio * 100),
    overCap: used > cap,
  };
}

export function whatCloudIncludes(planIdOrExtra = CLOUD_DEFAULT_PLAN_ID) {
  const plan = typeof planIdOrExtra === 'string'
    ? getCloudPlan(planIdOrExtra)
    : resolvePlan({ extraCycles: planIdOrExtra });
  return [
    'Supabase project recovery ops (launch scope)',
    'Hosted ops console (status, alerts, replay, CloudWatch/CloudTrail live)',
    `${plan.cadenceLabel} (plan cap — vault is still yours)`,
    `1 capsule transfer / ${TRANSFER_WINDOW_HOURS} hours included`,
    `Optional Extra transfers add-on: up to ${ADDON_TRANSFERS_PER_24H} / ${TRANSFER_WINDOW_HOURS}h · ${extraTransfersAddonPriceLabel(plan.id)}`,
    plan.smsOptional
      ? 'Optional SMS status on $17+ (Twilio) — status only; never keys, capsule bytes, or customer data'
      : 'SMS status is optional on $17 / $37 — not included on $7',
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
    'Encryption passphrases or Supabase service keys — provably zero-knowledge of customer keys',
    'Capsule ciphertext (never lands in Portabase Cloud)',
    'Managed object store billed by Portabase',
    'Unlimited vault size (choose $7 · 1 GB, $17 · 10 GB, or $37 · 100 GB)',
    'More than 1 transfer / 24h unless the Extra transfers add-on is active',
    'Capsule plaintext, object names, or sealing keys (provably zero-knowledge)',
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

export function publicPlansPayload() {
  return Object.fromEntries(Object.values(CLOUD_PLANS).map((plan) => [plan.id, {
    id: plan.id,
    priceMonthlyCents: plan.priceMonthlyCents,
    storageCapGb: plan.storageCapGb,
    storageCapLabel: plan.storageCapLabel,
    escapesPerDay: BASE_TRANSFERS_PER_24H,
    cyclesPerDay: BASE_TRANSFERS_PER_24H,
    transfersPer24h: BASE_TRANSFERS_PER_24H,
    title: plan.title,
    cadenceLabel: plan.cadenceLabel,
    shortLabel: plan.shortLabel,
  }]));
}
