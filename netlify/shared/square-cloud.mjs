import { resolveServerSecret } from './secrets.mjs';
import {
  CLOUD_DEFAULT_PLAN_ID,
  CLOUD_PLANS,
  CLOUD_PRICE_MONTHLY_CENTS,
  CLOUD_TRIAL_DAYS,
  STORAGE_POLICY,
  getCloudPlan,
  subscriptionDescription,
} from './product.mjs';

export const SQUARE_API_VERSION = '2026-05-20';
export const PLAN_NAME = 'Portabase Cloud';
/** Default catalog variation = Daily Escape ($17 · 1 cycle / 24h). */
export const VARIATION_NAME = 'Portabase Cloud · Daily Escape · 7-day trial → $17/mo (1 cycle/24h · BYO storage)';
export const VARIATION_NAME_TRIPLE = 'Portabase Cloud · Triple Escape · 7-day trial → $27/mo (up to 3 cycles/day · BYO storage)';
export const TRIAL_DAYS = CLOUD_TRIAL_DAYS;
export const PRICE_MONTHLY_CENTS = CLOUD_PRICE_MONTHLY_CENTS;
export const PRICE_TRIPLE_MONTHLY_CENTS = CLOUD_PLANS['cloud-27'].priceMonthlyCents;
export { STORAGE_POLICY, getCloudPlan, CLOUD_DEFAULT_PLAN_ID };

export async function squareCredentials() {
  const [accessToken, locationId] = await Promise.all([
    resolveServerSecret('SQUARE_ACCESS_TOKEN', { service: 'square', key: 'access_token' }),
    resolveServerSecret('SQUARE_LOCATION_ID', { service: 'square', key: 'location_id' }),
  ]);
  const env = (process.env.SQUARE_ENV || 'production') === 'sandbox' ? 'sandbox' : 'production';
  const baseUrl = env === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  return { accessToken, locationId, baseUrl, env };
}

export async function squareFetch(path, { method = 'GET', body } = {}) {
  const { accessToken, baseUrl } = await squareCredentials();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result?.errors?.[0]?.detail || result?.errors?.[0]?.code || `http_${response.status}`;
    const err = new Error(detail);
    err.status = response.status;
    err.square = result;
    throw err;
  }
  return result;
}

/**
 * Ensure Catalog plan + variation for a Cloud plan id.
 * @param {'cloud-17'|'cloud-27'} [planId]
 */
export async function ensureCloudPlanVariationId(planId = CLOUD_DEFAULT_PLAN_ID) {
  const plan = getCloudPlan(planId);
  const isTriple = plan.id === 'cloud-27';
  const envKey = isTriple ? 'SQUARE_CLOUD_PLAN_VARIATION_ID_27' : 'SQUARE_CLOUD_PLAN_VARIATION_ID';
  const configured = process.env[envKey] || (!isTriple ? process.env.SQUARE_CLOUD_PLAN_VARIATION_ID : null);
  if (configured) return configured;

  const variationName = isTriple ? VARIATION_NAME_TRIPLE : VARIATION_NAME;
  const listed = await squareFetch('/v2/catalog/list?types=SUBSCRIPTION_PLAN_VARIATION');
  const existing = (listed.objects || []).find(obj =>
    obj.type === 'SUBSCRIPTION_PLAN_VARIATION'
    && obj.subscription_plan_variation_data?.name === variationName
    && obj.present_at_all_locations !== false,
  );
  if (existing?.id) return existing.id;

  const catalogPlanId = `#portabase-cloud-plan`;
  const variationId = isTriple ? `#portabase-cloud-triple-trial` : `#portabase-cloud-daily-trial`;

  const batch = await squareFetch('/v2/catalog/batch-upsert', {
    method: 'POST',
    body: {
      idempotency_key: `portabase-cloud-${plan.id}-v3-${plan.priceMonthlyCents}-byo-storage`,
      batches: [{
        objects: [
          {
            type: 'SUBSCRIPTION_PLAN',
            id: catalogPlanId,
            present_at_all_locations: true,
            subscription_plan_data: {
              name: PLAN_NAME,
              all_items: true,
            },
          },
          {
            type: 'SUBSCRIPTION_PLAN_VARIATION',
            id: variationId,
            present_at_all_locations: true,
            subscription_plan_variation_data: {
              name: variationName,
              subscription_plan_id: catalogPlanId,
              phases: [
                {
                  cadence: 'DAILY',
                  periods: TRIAL_DAYS,
                  ordinal: 0,
                  pricing: {
                    type: 'STATIC',
                    price: { amount: 0, currency: 'USD' },
                  },
                },
                {
                  cadence: 'MONTHLY',
                  ordinal: 1,
                  pricing: {
                    type: 'STATIC',
                    price: { amount: plan.priceMonthlyCents, currency: 'USD' },
                  },
                },
              ],
            },
          },
        ],
      }],
    },
  });

  const createdVariation = (batch.objects || []).find(o => o.type === 'SUBSCRIPTION_PLAN_VARIATION');
  if (!createdVariation?.id) throw new Error('plan_variation_create_failed');
  return createdVariation.id;
}

export function buildSubscriptionPaymentLinkRequest({
  locationId,
  planVariationId,
  attempt,
  siteUrl,
  buyerEmail,
  cognitoSub,
  planId = CLOUD_DEFAULT_PLAN_ID,
}) {
  const plan = getCloudPlan(planId);
  return {
    idempotency_key: attempt,
    description: subscriptionDescription(plan.id),
    quick_pay: {
      name: `Portabase Cloud · ${plan.shortLabel} · up to 12 agents · BYO storage`,
      price_money: { amount: 0, currency: 'USD' },
      location_id: locationId,
    },
    checkout_options: {
      subscription_plan_id: planVariationId,
      redirect_url: `${siteUrl}/app?checkout=complete&attempt=${encodeURIComponent(attempt)}&plan=${plan.id}`,
      ask_for_shipping_address: false,
      allow_tipping: false,
    },
    pre_populated_data: buyerEmail ? { buyer_email: buyerEmail } : undefined,
    payment_note: `portabase-cloud plan=${plan.id} $${plan.priceMonthlyUsd}/mo gateway=square byo_storage=true user=${cognitoSub} attempt=${attempt}`,
  };
}
