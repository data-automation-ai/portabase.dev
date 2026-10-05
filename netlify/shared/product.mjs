/** Server-side product constants (keep in sync with src/lib/product.js). */

export const LAUNCH_PLATFORM = 'supabase';

export const CLOUD_TRIAL_DAYS = 7;
export const CLOUD_MONEY_BACK_DAYS = 7;
export const CLOUD_CURRENCY = 'USD';
export const CLOUD_PAYMENT_GATEWAY = 'square';
export const CLOUD_MAX_AGENTS = 12;

const GB = 1024 * 1024 * 1024;

const MB = 1024 * 1024;

export const CLOUD_PLANS = Object.freeze({
  'cloud-7': Object.freeze({
    id: 'cloud-7',
    priceMonthlyUsd: 7,
    priceMonthlyCents: 700,
    storageCapGb: 10,
    storageCapBytes: 10 * GB,
    storageCapLabel: '10 GB',
    databases: 1,
    databasesUnlimited: false,
    databasesLabel: 'one database',
    transfersPer24h: 1,
    escapesPerDay: 1,
    cyclesPerDay: 1,
    scheduled: true,
    customerFacing: true,
    title: 'Starter Escape',
    cadenceLabel: 'one database · up to 10 GB · 1 capsule / 24h',
    shortLabel: '$7/mo · 1 DB · 10 GB',
    squareEnvKey: 'SQUARE_CLOUD_PLAN_VARIATION_ID_7',
    smsOptional: false,
  }),
  'cloud-17': Object.freeze({
    id: 'cloud-17',
    priceMonthlyUsd: 17,
    priceMonthlyCents: 1700,
    storageCapGb: 25,
    storageCapBytes: 25 * GB,
    storageCapLabel: '25 GB',
    databases: null,
    databasesUnlimited: true,
    databasesLabel: 'unlimited databases',
    transfersPer24h: 3,
    escapesPerDay: 3,
    cyclesPerDay: 3,
    scheduled: true,
    customerFacing: true,
    title: 'Daily Escape',
    cadenceLabel: 'unlimited databases · up to 25 GB · 3 capsules / day',
    shortLabel: '$17/mo · unlimited DB · 25 GB',
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
    databases: null,
    databasesUnlimited: true,
    databasesLabel: 'unlimited databases',
    transfersPer24h: 3,
    escapesPerDay: 3,
    cyclesPerDay: 3,
    scheduled: true,
    customerFacing: false,
    title: 'Scale Escape',
    cadenceLabel: 'legacy hidden plan · not offered on new checkouts',
    shortLabel: '$37/mo · legacy',
    squareEnvKey: 'SQUARE_CLOUD_PLAN_VARIATION_ID_37',
    smsOptional: true,
  }),
});

export const CLOUD_FREE = Object.freeze({
  id: 'cloud-free',
  priceMonthlyUsd: 0,
  priceMonthlyCents: 0,
  title: 'Cloud Free',
  projects: 1,
  storageCapMb: 100,
  storageCapGb: 100 / 1024,
  storageCapBytes: 100 * MB,
  storageCapLabel: '100 MB',
  scheduled: false,
  smsOptional: false,
  transfersPer24h: 0,
  shortLabel: 'Free · 100 MB · manual only',
  summary: '100 MB. Dashboard and manual runs. No scheduled service.',
});

export function publicCloudPlans() {
  return Object.values(CLOUD_PLANS).filter((plan) => plan.customerFacing !== false);
}

export const CLOUD_DEFAULT_PLAN_ID = 'cloud-17';
export const CLOUD_PLAN_ID = CLOUD_DEFAULT_PLAN_ID;
export const LEGACY_PLAN_ALIASES = Object.freeze({
  'cloud-27': 'cloud-17',
  'cloud-intro-17': 'cloud-17',
});
export const CLOUD_PRICE_MONTHLY_CENTS = CLOUD_PLANS['cloud-17'].priceMonthlyCents;
export const CLOUD_LIST_PRICE_MONTHLY_CENTS = CLOUD_PLANS['cloud-17'].priceMonthlyCents;
export const BASE_TRANSFERS_PER_24H = 1;
export const CLOUD_INCLUDED_CYCLES_PER_DAY = BASE_TRANSFERS_PER_24H;
export const TRANSFER_WINDOW_HOURS = 24;
export const ADDON_TRANSFERS_PER_24H = 3;
export const EXTRA_TRANSFERS_ADDON_ID = 'extra-transfers';
export const EXTRA_TRANSFERS_ADDON_TITLE = 'Extra transfers';
export const EXTRA_TRANSFERS_ADDON_BY_PLAN = Object.freeze({
  'cloud-7': Object.freeze({ monthlyUsd: 3, monthlyCents: 300, squareEnvKey: 'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7' }),
  'cloud-17': Object.freeze({ monthlyUsd: 5, monthlyCents: 500, squareEnvKey: 'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_17' }),
  'cloud-37': Object.freeze({ monthlyUsd: 5, monthlyCents: 500, squareEnvKey: 'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_37' }),
});
export const SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_ENV = 'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID';
export const SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_PLACEHOLDER = 'REPLACE_WITH_SQUARE_CATALOG_ID';
export const CLOUD_EXTRA_CYCLE_MONTHLY_CENTS = EXTRA_TRANSFERS_ADDON_BY_PLAN['cloud-17'].monthlyCents;
export const CLOUD_MAX_EXTRA_CYCLES = ADDON_TRANSFERS_PER_24H - BASE_TRANSFERS_PER_24H;

function extraTransfersAddonUsdOverride() {
  const n = Number(process.env.EXTRA_TRANSFERS_ADDON_MONTHLY_USD || process.env.VITE_EXTRA_TRANSFERS_ADDON_MONTHLY_USD || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
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

export function transferWindow({
  usedLast24h = 0,
  extraTransfersAddon = false,
  planId = CLOUD_DEFAULT_PLAN_ID,
  now = Date.now(),
} = {}) {
  const used = Math.max(0, Math.floor(Number(usedLast24h) || 0));
  const addon = Boolean(extraTransfersAddon);
  const plan = getCloudPlan(planId);
  const included = planTransfersPer24h(plan.id);
  const allowance = planTransfersPer24h(plan.id, { extraTransfersAddon: addon });
  const addonMeta = extraTransfersAddonForPlan(plan.id);
  return {
    used,
    allowance,
    remaining: Math.max(0, allowance - used),
    atLimit: used >= allowance,
    extraTransfersAddon: addon,
    windowHours: TRANSFER_WINDOW_HOURS,
    included,
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

export function countTransfersLast24h(items, { now = Date.now(), getTime } = {}) {
  const cutoff = Number(now) - TRANSFER_WINDOW_HOURS * 3600e3;
  return (items || []).filter((item) => {
    const t = getTime
      ? getTime(item)
      : Date.parse(item?.createdAt || item?.occurredAt || item?.startedAt || 0);
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}

export function minScheduleHours({ extraTransfersAddon, planId = CLOUD_DEFAULT_PLAN_ID } = {}) {
  const n = Math.max(1, planTransfersPer24h(planId, { extraTransfersAddon }));
  return Math.ceil(TRANSFER_WINDOW_HOURS / n);
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
    note: 'Legacy Extra transfers add-on. $17 already includes 3 capsules / day. Hidden from public cards.',
  };
}

export const STORAGE_POLICY = {
  owner: 'customer',
  includedInCloud: false,
  summary: 'Customer provides capsule storage (S3, Dropbox, or Local Starter ≤100 MB). Portabase Cloud never hosts recovery bytes.',
  localStarterMaxBytes: 100 * 1024 * 1024,
  note: 'Subscription is ops only (console, telemetry, alerts, SMS). Storage bills go to customer provider. Cloud is designed to be blind to encryption passphrases and capsule contents — status and hashes only.',
};

export function getCloudPlan(planId = CLOUD_DEFAULT_PLAN_ID) {
  if (planId === 'cloud-free' || planId === CLOUD_FREE.id) return CLOUD_FREE;
  const aliased = LEGACY_PLAN_ALIASES[planId] || planId;
  return CLOUD_PLANS[aliased] || CLOUD_PLANS[CLOUD_DEFAULT_PLAN_ID];
}

export function resolveMeterPlan(planId = CLOUD_DEFAULT_PLAN_ID) {
  return getCloudPlan(planId);
}

export function publicPlanCards() {
  return [CLOUD_FREE, ...publicCloudPlans()];
}

export function planTransfersPer24h(planId = CLOUD_DEFAULT_PLAN_ID, { extraTransfersAddon } = {}) {
  const plan = getCloudPlan(planId);
  const included = Math.max(0, Number(plan.transfersPer24h || plan.escapesPerDay || BASE_TRANSFERS_PER_24H) || 0);
  if (extraTransfersAddon) return Math.max(included, ADDON_TRANSFERS_PER_24H);
  return included;
}

export function resolvePlan({ planId, extraCycles } = {}) {
  if (planId && (CLOUD_PLANS[planId] || LEGACY_PLAN_ALIASES[planId])) return getCloudPlan(planId);
  const extra = Math.max(0, Number(extraCycles) || 0);
  if (extra >= 2) return CLOUD_PLANS['cloud-17'];
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

export function monthlyTotalCents(extraCyclesOrPlan = 0) {
  if (typeof extraCyclesOrPlan === 'string') {
    return getCloudPlan(extraCyclesOrPlan).priceMonthlyCents;
  }
  return resolvePlan({ extraCycles: extraCyclesOrPlan }).priceMonthlyCents;
}

export function subscriptionDescription(planId = CLOUD_DEFAULT_PLAN_ID) {
  const plan = getCloudPlan(planId);
  return `Portabase Cloud for Supabase — ${CLOUD_TRIAL_DAYS}-day trial then $${plan.priceMonthlyUsd}/mo (Square). ${plan.cadenceLabel}. Customer provides capsule storage. Portabase has zero knowledge of encryption keys.`;
}

export function publicPlansPayload() {
  return Object.fromEntries(Object.values(CLOUD_PLANS).map((plan) => [plan.id, {
    id: plan.id,
    priceMonthlyCents: plan.priceMonthlyCents,
    storageCapGb: plan.storageCapGb,
    storageCapLabel: plan.storageCapLabel,
    escapesPerDay: plan.escapesPerDay,
    cyclesPerDay: plan.cyclesPerDay,
    transfersPer24h: plan.transfersPer24h,
    customerFacing: plan.customerFacing !== false,
    title: plan.title,
    cadenceLabel: plan.cadenceLabel,
    shortLabel: plan.shortLabel,
  }]));
}
