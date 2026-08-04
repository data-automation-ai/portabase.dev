/** Server-side product constants (keep in sync with src/lib/product.js). */

export const LAUNCH_PLATFORM = 'supabase';

export const CLOUD_TRIAL_DAYS = 7;
export const CLOUD_CURRENCY = 'USD';
export const CLOUD_PAYMENT_GATEWAY = 'square';
export const CLOUD_MAX_AGENTS = 12;

export const CLOUD_PLANS = Object.freeze({
  'cloud-17': Object.freeze({
    id: 'cloud-17',
    priceMonthlyUsd: 17,
    priceMonthlyCents: 1700,
    cyclesPerDay: 1,
    title: 'Daily Escape',
    cadenceLabel: '1 recovery cycle per 24 hours',
    shortLabel: '$17/mo · 1× / 24h',
  }),
  'cloud-27': Object.freeze({
    id: 'cloud-27',
    priceMonthlyUsd: 27,
    priceMonthlyCents: 2700,
    cyclesPerDay: 3,
    title: 'Triple Escape',
    cadenceLabel: 'up to 3 recovery cycles per day',
    shortLabel: '$27/mo · up to 3× / day',
  }),
});

export const CLOUD_DEFAULT_PLAN_ID = 'cloud-17';
export const CLOUD_PLAN_ID = CLOUD_DEFAULT_PLAN_ID;
export const CLOUD_PRICE_MONTHLY_CENTS = CLOUD_PLANS['cloud-17'].priceMonthlyCents;
export const CLOUD_LIST_PRICE_MONTHLY_CENTS = CLOUD_PLANS['cloud-27'].priceMonthlyCents;
export const CLOUD_INCLUDED_CYCLES_PER_DAY = 1;
export const CLOUD_EXTRA_CYCLE_MONTHLY_CENTS = 0;
export const CLOUD_MAX_EXTRA_CYCLES = 0;

export const STORAGE_POLICY = {
  owner: 'customer',
  includedInCloud: false,
  summary: 'Customer provides capsule storage (S3, Dropbox, or Local Starter ≤100 MB). Portabase Cloud never hosts recovery bytes.',
  localStarterMaxBytes: 100 * 1024 * 1024,
  note: 'Subscription is ops only (console, telemetry, alerts, SMS). Storage bills go to customer provider.',
};

export function getCloudPlan(planId = CLOUD_DEFAULT_PLAN_ID) {
  return CLOUD_PLANS[planId] || CLOUD_PLANS[CLOUD_DEFAULT_PLAN_ID];
}

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

export function subscriptionDescription(planId = CLOUD_DEFAULT_PLAN_ID) {
  const plan = getCloudPlan(planId);
  return `Portabase Cloud for Supabase — ${CLOUD_TRIAL_DAYS}-day trial then $${plan.priceMonthlyUsd}/mo (Square). ${plan.cadenceLabel}. SMS on success/failure. Up to ${CLOUD_MAX_AGENTS} agents. Card required. Customer provides capsule storage.`;
}
