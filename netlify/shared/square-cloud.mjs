import { resolveServerSecret } from './secrets.mjs';
import {
  CLOUD_PRICE_MONTHLY_CENTS,
  CLOUD_TRIAL_DAYS,
  STORAGE_POLICY,
  subscriptionDescription,
} from './product.mjs';

export const SQUARE_API_VERSION = '2026-05-20';
export const PLAN_NAME = 'Portabase Cloud';
export const VARIATION_NAME = 'Portabase Cloud · 7-day trial → $17/mo (BYO storage)';
export const TRIAL_DAYS = CLOUD_TRIAL_DAYS;
export const PRICE_MONTHLY_CENTS = CLOUD_PRICE_MONTHLY_CENTS;
export { STORAGE_POLICY };

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

/** Ensure Catalog plan + variation (free 7-day phase then $17/mo). Returns plan variation id. */
export async function ensureCloudPlanVariationId() {
  const configured = process.env.SQUARE_CLOUD_PLAN_VARIATION_ID;
  if (configured) return configured;

  const listed = await squareFetch('/v2/catalog/list?types=SUBSCRIPTION_PLAN_VARIATION');
  const existing = (listed.objects || []).find(obj =>
    obj.type === 'SUBSCRIPTION_PLAN_VARIATION'
    && obj.subscription_plan_variation_data?.name === VARIATION_NAME
    && obj.present_at_all_locations !== false,
  );
  if (existing?.id) return existing.id;

  const planId = `#portabase-cloud-plan`;
  const variationId = `#portabase-cloud-intro-trial`;

  const batch = await squareFetch('/v2/catalog/batch-upsert', {
    method: 'POST',
    body: {
      // Bump key when commercial terms change (price, trial, BYO storage note)
      idempotency_key: `portabase-cloud-plan-v2-${PRICE_MONTHLY_CENTS}-byo-storage`,
      batches: [{
        objects: [
          {
            type: 'SUBSCRIPTION_PLAN',
            id: planId,
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
              name: VARIATION_NAME,
              subscription_plan_id: planId,
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
                    price: { amount: PRICE_MONTHLY_CENTS, currency: 'USD' },
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
}) {
  return {
    idempotency_key: attempt,
    description: subscriptionDescription(),
    // Square Checkout = payment gateway for Cloud subscription (card on file)
    quick_pay: {
      name: 'Portabase Cloud · $17/mo · up to 12 agents · BYO storage',
      price_money: { amount: 0, currency: 'USD' },
      location_id: locationId,
    },
    checkout_options: {
      subscription_plan_id: planVariationId,
      redirect_url: `${siteUrl}/app?checkout=complete&attempt=${encodeURIComponent(attempt)}`,
      ask_for_shipping_address: false,
      allow_tipping: false,
    },
    pre_populated_data: buyerEmail ? { buyer_email: buyerEmail } : undefined,
    payment_note: `portabase-cloud $17/mo gateway=square byo_storage=true user=${cognitoSub} attempt=${attempt}`,
  };
}
