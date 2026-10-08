import { deriveAccess } from './subscription-store.mjs';
import { CLOUD_FREE, CLOUD_PLANS, LEGACY_PLAN_ALIASES, getCloudPlan } from './product.mjs';

// No record (or expired/unverified billing) retains the documented free manual
// service. Missing/invalid plan IDs must never resolve to the paid default.
export function runnerAdmission(record, now = Date.now()) {
  const id = LEGACY_PLAN_ALIASES[record?.plan] || record?.plan;
  const paid = Boolean(CLOUD_PLANS[id]) && deriveAccess(record, now).hasAccess;
  const plan = paid ? getCloudPlan(id) : CLOUD_FREE;
  const addon = paid && record.extraTransfersAddon === true && record.addonStatus === 'active'
    && record.addonVerifiedBy === 'square_api' && Boolean(record.squareAddonSubscriptionId)
    && Number.isFinite(Date.parse(record.addonVerifiedAt)) && Date.parse(record.addonVerifiedAt) <= now
    && Date.parse(record.addonCurrentPeriodEnd) > now;
  return { paid, plan, extraTransfersAddon: Boolean(addon) };
}
