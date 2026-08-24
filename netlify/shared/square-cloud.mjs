import { loadSecretsBundle, refuseForeignSquareAccessToken, resolveServerSecret } from './secrets.mjs';
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
/** Default catalog variation = Daily Escape ($17 · 1 escape / 24h). */
export const VARIATION_NAME = 'Portabase Cloud · Daily Escape · 7-day trial → $17/mo (1 escape/24h · BYO storage)';
export const VARIATION_NAME_TRIPLE = 'Portabase Cloud · Triple Escape · 7-day trial → $27/mo (up to 3 escapes/day · BYO storage)';
export const TRIAL_DAYS = CLOUD_TRIAL_DAYS;
export const PRICE_MONTHLY_CENTS = CLOUD_PRICE_MONTHLY_CENTS;
export const PRICE_TRIPLE_MONTHLY_CENTS = CLOUD_PLANS['cloud-27'].priceMonthlyCents;
export { STORAGE_POLICY, getCloudPlan, CLOUD_DEFAULT_PLAN_ID };

async function resolvePortabaseSquareAccessToken() {
  const scoped = await resolveServerSecret(
    'square-portabase-production-access-token',
    { service: 'square', key: 'portabase-production-access-token' },
    { optional: true, allowEnvFallback: false },
  ) || await resolveServerSecret(
    'square-portabase-access-token',
    { service: 'square', key: 'portabase-access-token' },
    { optional: true, allowEnvFallback: false },
  );
  if (scoped) return scoped;
  return resolveServerSecret('SQUARE_ACCESS_TOKEN', { service: 'square', key: 'access_token' });
}

export async function squareCredentials() {
  const bundle = await loadSecretsBundle();
  const [accessToken, locationId] = await Promise.all([
    resolvePortabaseSquareAccessToken(),
    resolveServerSecret('SQUARE_LOCATION_ID', { service: 'square', key: 'location_id' }),
  ]);
  refuseForeignSquareAccessToken(accessToken, bundle);
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

export async function cancelSquareSubscription(subscriptionId) {
  if (!subscriptionId) return { skipped: true, reason: 'no_subscription_id' };
  return squareFetch(`/v2/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { method: 'POST' });
}

export async function refundSquarePayment({ paymentId, amountCents, reason, idempotencyKey }) {
  if (!paymentId) return { skipped: true, reason: 'no_payment_id' };
  const amount = Number(amountCents) || 0;
  if (amount <= 0) return { skipped: true, reason: 'zero_amount' };
  return squareFetch('/v2/refunds', {
    method: 'POST',
    body: {
      idempotency_key: idempotencyKey,
      payment_id: paymentId,
      amount_money: { amount, currency: 'USD' },
      reason: reason || 'Customer self-serve 7-day money-back. Account closed.',
    },
  });
}

export function paymentIsCaptured(payment) {
  const status = String(payment?.status || '').toUpperCase();
  return status === 'COMPLETED' || status === 'CAPTURED';
}

export function findCapturedPayment(payments = []) {
  return payments.find(paymentIsCaptured) || null;
}

/**
 * Square payment-link orders often stay OPEN until PayOrder. Treat a CAPTURED
 * or COMPLETED payment as fulfilled even when the order state is still OPEN,
 * including the $0 trial authorization that puts a card on file.
 */
export function squareCheckoutIsFulfilled({ order, payments, subscription } = {}) {
  const payment = findCapturedPayment(payments || []);
  if (payment) {
    return { ok: true, via: 'payment', payment, amountCents: Number(payment.amount_money?.amount) || 0 };
  }
  const subStatus = String(subscription?.status || '').toUpperCase();
  if (subStatus === 'PENDING' || subStatus === 'ACTIVE') {
    return { ok: true, via: 'subscription', subscription, amountCents: 0 };
  }
  const state = String(order?.state || '').toUpperCase();
  const tenders = Array.isArray(order?.tenders) && order.tenders.length > 0;
  if (state === 'COMPLETED' && tenders) {
    return { ok: true, via: 'order', order, amountCents: Number(order?.total_money?.amount) || 0 };
  }
  return { ok: false, via: null, state: state || null };
}

export async function retrieveCheckoutEvidence(orderId) {
  if (!orderId) return { order: null, payments: [], subscription: null };
  const [orderResp, payResp] = await Promise.all([
    squareFetch(`/v2/orders/${encodeURIComponent(orderId)}`),
    squareFetch(`/v2/payments?order_id=${encodeURIComponent(orderId)}`),
  ]);
  const order = orderResp.order || null;
  const payments = payResp.payments || [];
  let subscription = null;
  const customerId = order?.customer_id || payments[0]?.customer_id || null;
  if (customerId) {
    try {
      const found = await squareFetch('/v2/subscriptions/search', {
        method: 'POST',
        body: { query: { filter: { customer_ids: [customerId] } } },
      });
      subscription = (found.subscriptions || [])[0] || null;
    } catch {
      subscription = null;
    }
  }
  return { order, payments, subscription };
}

/** Refund path: a captured payment with a positive amount. $0 trial auths do not refund. */
export async function findCompletedPaymentForOrder(orderId) {
  if (!orderId) return null;
  const listed = await squareFetch(`/v2/payments?order_id=${encodeURIComponent(orderId)}`);
  const payments = listed.payments || [];
  return payments.find(p => paymentIsCaptured(p) && Number(p.amount_money?.amount) > 0) || null;
}
