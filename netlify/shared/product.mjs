/** Server-side product constants (keep in sync with src/lib/product.js). */

/** Launch: Supabase projects only. Cognito/AWS Cloud path not offered yet. */
export const LAUNCH_PLATFORM = 'supabase';

export const CLOUD_PRICE_MONTHLY_CENTS = 1700;
export const CLOUD_LIST_PRICE_MONTHLY_CENTS = 3400;
export const CLOUD_TRIAL_DAYS = 7;
export const CLOUD_CURRENCY = 'USD';
export const CLOUD_PAYMENT_GATEWAY = 'square';
export const CLOUD_PLAN_ID = 'cloud-17';
/** Max concurrent agents on the $17 Cloud plan. */
export const CLOUD_MAX_AGENTS = 12;

/** Base: 1 full backup cycle per 24 hours. Extra daily cycles: $10/mo each. */
export const CLOUD_INCLUDED_CYCLES_PER_DAY = 1;
export const CLOUD_EXTRA_CYCLE_MONTHLY_CENTS = 1000;
export const CLOUD_MAX_EXTRA_CYCLES = 23;

export const STORAGE_POLICY = {
  owner: 'customer',
  includedInCloud: false,
  summary: 'Customer provides binary/capsule storage (S3, Dropbox, or Local Starter ≤100 MB on their machine). Portabase Cloud never hosts recovery bytes.',
  localStarterMaxBytes: 100 * 1024 * 1024,
  note: 'Subscription is ops only (console, telemetry, alerts, SMS). Storage bills go to customer provider.',
};

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
  return CLOUD_PRICE_MONTHLY_CENTS + cyclesPerDay(extraCycles).extraMonthlyCents;
}

export function subscriptionDescription(extraCycles = 0) {
  const c = cyclesPerDay(extraCycles);
  return `Portabase Cloud for Supabase — ${CLOUD_TRIAL_DAYS}-day trial then $${CLOUD_PRICE_MONTHLY_CENTS / 100}/mo base (Square) includes ${c.included} backup cycle per 24h. Extra cycles $${CLOUD_EXTRA_CYCLE_MONTHLY_CENTS / 100}/mo each. SMS on success/failure. Up to ${CLOUD_MAX_AGENTS} agents. Card required. Customer provides binary storage.`;
}
