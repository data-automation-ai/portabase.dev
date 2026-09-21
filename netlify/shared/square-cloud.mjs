import { resolveServerSecret } from './secrets.mjs';
import {
  CLOUD_DEFAULT_PLAN_ID,
  CLOUD_PLANS,
  CLOUD_PRICE_MONTHLY_CENTS,
  CLOUD_TRIAL_DAYS,
  EXTRA_TRANSFERS_ADDON_ID,
  EXTRA_TRANSFERS_ADDON_TITLE,
  SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_ENV,
  STORAGE_POLICY,
  extraTransfersAddonForPlan,
  extraTransfersAddonMonthlyCents,
  extraTransfersAddonPriceLabel,
  extraTransfersAddonPublic,
  getCloudPlan,
  subscriptionDescription,
} from './product.mjs';

export const SQUARE_API_VERSION = '2026-05-20';
export const PLAN_NAME = 'Portabase Cloud';
export const VARIATION_NAMES = Object.freeze({
  'cloud-7': 'Portabase Cloud · Starter Escape · 7-day trial → $7/mo (one DB · up to 10 GB · 1 capsule/24h · BYO storage)',
  'cloud-17': 'Portabase Cloud · Daily Escape · 7-day trial → $17/mo (unlimited DBs · up to 25 GB · 3 capsules/day · BYO storage)',
  'cloud-37': 'Portabase Cloud · Scale Escape · legacy hidden · $37/mo (up to 100 GB · BYO storage)',
});
export const ADDON_VARIATION_NAMES = Object.freeze({
  'cloud-7': 'Portabase Cloud · Extra transfers · up to 3 / 24h · +$3/mo (Starter)',
  'cloud-17': 'Portabase Cloud · Extra transfers · up to 3 / 24h · +$5/mo (Daily)',
  'cloud-37': 'Portabase Cloud · Extra transfers · up to 3 / 24h · +$5/mo (Scale)',
});
export const ADDON_VARIATION_NAME = ADDON_VARIATION_NAMES['cloud-17'];
export const TRIAL_DAYS = CLOUD_TRIAL_DAYS;
export const PRICE_MONTHLY_CENTS = CLOUD_PRICE_MONTHLY_CENTS;
export { STORAGE_POLICY, getCloudPlan, CLOUD_DEFAULT_PLAN_ID, CLOUD_PLANS };

export async function squareCredentials() {
  const [accessToken, locationId] = await Promise.all([
    resolveServerSecret('SQUARE_ACCESS_TOKEN', { service: 'square', key: 'access_token' }),
    resolveServerSecret('SQUARE_LOCATION_ID', { service: 'square', key: 'location_id' }),
  ]);
  const rawEnv = process.env.SQUARE_ENVIRONMENT || process.env.SQUARE_ENV || 'production';
  const env = rawEnv === 'sandbox' ? 'sandbox' : 'production';
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

function variationEnv(planId) {
  const plan = getCloudPlan(planId);
  const key = plan.squareEnvKey;
  return process.env[key]
    || (plan.id === 'cloud-17' ? (process.env.SQUARE_CLOUD_PLAN_VARIATION_ID || process.env.SQUARE_CLOUD_PLAN_VARIATION_ID_17) : null)
    || (plan.id === 'cloud-7' ? process.env.SQUARE_CLOUD_PLAN_VARIATION_ID_7 : null)
    || (plan.id === 'cloud-37' ? process.env.SQUARE_CLOUD_PLAN_VARIATION_ID_37 : null);
}

/**
 * Ensure Catalog plan + variation for a Cloud plan id.
 * @param {'cloud-7'|'cloud-17'|'cloud-37'} [planId]
 */
export async function ensureCloudPlanVariationId(planId = CLOUD_DEFAULT_PLAN_ID) {
  const plan = getCloudPlan(planId);
  const configured = variationEnv(plan.id);
  if (configured) return configured;

  const variationName = VARIATION_NAMES[plan.id] || VARIATION_NAMES[CLOUD_DEFAULT_PLAN_ID];
  const listed = await squareFetch('/v2/catalog/list?types=SUBSCRIPTION_PLAN_VARIATION');
  const existing = (listed.objects || []).find(obj =>
    obj.type === 'SUBSCRIPTION_PLAN_VARIATION'
    && obj.subscription_plan_variation_data?.name === variationName
    && obj.present_at_all_locations !== false,
  );
  if (existing?.id) return existing.id;

  const catalogPlanId = `#portabase-cloud-plan`;
  const variationId = `#portabase-cloud-${plan.id}-trial`;

  const batch = await squareFetch('/v2/catalog/batch-upsert', {
    method: 'POST',
    body: {
      idempotency_key: `portabase-cloud-${plan.id}-v4-${plan.priceMonthlyCents}-byo-storage`,
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

/** Square catalog ID for Extra transfers add-on. Louis pins SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID[_7|_17|_37]. */
export async function ensureExtraTransfersAddonVariationId(planId = CLOUD_DEFAULT_PLAN_ID) {
  const plan = getCloudPlan(planId);
  const meta = extraTransfersAddonForPlan(plan.id);
  const configured = process.env[meta.squareEnvKey]
    || process.env[SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_ENV]
    || process.env.SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID;
  if (configured && configured !== 'REPLACE_WITH_SQUARE_CATALOG_ID') return configured;

  const variationName = ADDON_VARIATION_NAMES[plan.id] || ADDON_VARIATION_NAME;
  const listed = await squareFetch('/v2/catalog/list?types=SUBSCRIPTION_PLAN_VARIATION');
  const existing = (listed.objects || []).find(obj =>
    obj.type === 'SUBSCRIPTION_PLAN_VARIATION'
    && obj.subscription_plan_variation_data?.name === variationName
    && obj.present_at_all_locations !== false,
  );
  if (existing?.id) return existing.id;

  const cents = extraTransfersAddonMonthlyCents(plan.id);
  const catalogPlanId = `#portabase-cloud-extra-transfers`;
  const variationId = `#portabase-cloud-extra-transfers-${plan.id}`;
  const batch = await squareFetch('/v2/catalog/batch-upsert', {
    method: 'POST',
    body: {
      idempotency_key: `portabase-cloud-extra-transfers-${plan.id}-v1-${cents}`,
      batches: [{
        objects: [
          {
            type: 'SUBSCRIPTION_PLAN',
            id: catalogPlanId,
            present_at_all_locations: true,
            subscription_plan_data: {
              name: `${PLAN_NAME} · ${EXTRA_TRANSFERS_ADDON_TITLE}`,
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
                  cadence: 'MONTHLY',
                  ordinal: 0,
                  pricing: {
                    type: 'STATIC',
                    price: { amount: cents, currency: 'USD' },
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
  if (!createdVariation?.id) throw new Error('addon_variation_create_failed');
  return createdVariation.id;
}

export function buildAddonPaymentLinkRequest({
  locationId,
  planVariationId,
  attempt,
  siteUrl,
  buyerEmail,
  cognitoSub,
  planId = CLOUD_DEFAULT_PLAN_ID,
}) {
  const plan = getCloudPlan(planId);
  const addon = extraTransfersAddonPublic(plan.id);
  return {
    idempotency_key: attempt,
    description: `Portabase Cloud Extra transfers add-on — up to 3 transfers / 24h · ${extraTransfersAddonPriceLabel(plan.id)} on ${plan.shortLabel}.`,
    quick_pay: {
      name: `Portabase Cloud · Extra transfers · ${addon.priceLabel}`,
      price_money: { amount: 0, currency: 'USD' },
      location_id: locationId,
    },
    checkout_options: {
      subscription_plan_id: planVariationId,
      redirect_url: `${siteUrl}/app?checkout=complete&addon=${EXTRA_TRANSFERS_ADDON_ID}&attempt=${encodeURIComponent(attempt)}`,
      ask_for_shipping_address: false,
      allow_tipping: false,
    },
    pre_populated_data: buyerEmail ? { buyer_email: buyerEmail } : undefined,
    payment_note: `portabase-cloud addon=${EXTRA_TRANSFERS_ADDON_ID} gateway=square user=${cognitoSub} attempt=${attempt}`,
  };
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
    payment_note: `portabase-cloud plan=${plan.id} $${plan.priceMonthlyUsd}/mo cap=${plan.storageCapLabel} gateway=square byo_storage=true user=${cognitoSub} attempt=${attempt}`,
  };
}
