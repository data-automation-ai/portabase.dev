// Never infer billing completion from a browser redirect or customer-supplied ID.
// Square's hosted checkout adds a fulfillment to its order, then creates a
// subscription for that order's customer. All lookups start from our saved order.
// https://developer.squareup.com/docs/checkout-api/subscription-plan-checkout
import { squareCredentials, squareFetch } from './square-cloud.mjs';

const DAY = 86_400_000;
const pending = reason => ({ verified: false, reason });

function midnight(date, timezone = 'UTC') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return NaN;
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) return NaN;
  let guess = target;
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const correction = target - shown;
    if (!correction) return guess;
    guess += correction;
  }
  return NaN;
}
function addDays(date, days) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed + days * DAY).toISOString().slice(0, 10) : '';
}
function customerFromOrder(order) {
  const ids = new Set(order.customer_id ? [order.customer_id] : []);
  const fulfillments = (order.fulfillments || []).filter(row => !['CANCELED', 'FAILED'].includes(row.state));
  if (!fulfillments.length) return null;
  for (const row of fulfillments) {
    for (const type of ['pickup_details', 'shipment_details', 'delivery_details', 'in_store_details']) {
      const id = row[type]?.recipient?.customer_id;
      if (id) ids.add(id);
    }
  }
  return ids.size === 1 ? [...ids][0] : null;
}

export async function verifySquareSubscription(record, {
  kind = 'base', request = squareFetch, credentials = squareCredentials, now = Date.now(),
} = {}) {
  const addon = kind === 'addon';
  const orderId = addon ? record.squareAddonOrderId : record.squareOrderId;
  const variationId = addon ? record.squareAddonPlanVariationId : record.squarePlanVariationId;
  const boundId = addon ? record.squareAddonSubscriptionId : record.squareSubscriptionId;
  if (!orderId || !variationId) return pending('checkout_not_bound');
  const { locationId } = await credentials();
  const { order } = await request(`/v2/orders/${encodeURIComponent(orderId)}`);
  if (!order || order.id !== orderId || order.location_id !== locationId || ['CANCELED', 'DRAFT'].includes(order.state)) return pending('checkout_pending');
  const customerId = customerFromOrder(order);
  if (!customerId) return pending('checkout_pending');
  let candidates = [];
  if (boundId) {
    const result = await request(`/v2/subscriptions/${encodeURIComponent(boundId)}`);
    if (result.subscription) candidates = [result.subscription];
  } else {
    let cursor;
    for (let page = 0; page < 10; page++) {
      const result = await request('/v2/subscriptions/search', { method: 'POST', body: {
        query: { filter: { customer_ids: [customerId], location_ids: [locationId] } }, limit: 100, ...(cursor ? { cursor } : {}),
      } });
      candidates.push(...(result.subscriptions || []));
      cursor = result.cursor;
      if (!cursor) break;
    }
    if (cursor) return pending('subscription_search_incomplete');
  }
  const orderCreated = Date.parse(order.created_at);
  candidates = candidates.filter(subscription => subscription.customer_id === customerId
    && subscription.location_id === locationId && subscription.plan_variation_id === variationId
    && (boundId ? subscription.id === boundId
      : Number.isFinite(orderCreated) && Date.parse(subscription.created_at) >= orderCreated));
  if (candidates.length !== 1) return pending(candidates.length ? 'subscription_ambiguous' : 'subscription_pending');
  const subscription = candidates[0];
  // Square schedules cancellation while status is still ACTIVE. Never let an
  // invoice or trial extend access past that provider-confirmed boundary.
  const cancellation = subscription.canceled_date == null ? null
    : midnight(subscription.canceled_date, subscription.timezone || 'UTC');
  if (cancellation !== null && !Number.isFinite(cancellation)) return pending('invalid_cancellation_date');
  const base = {
    squareSubscriptionId: subscription.id, squareCustomerId: customerId,
    squareStatus: subscription.status, squareVersion: subscription.version,
    verifiedBy: 'square_api', squareVerifiedAt: new Date(now).toISOString(),
    cancellationEffectiveAt: cancellation === null ? null : new Date(cancellation).toISOString(),
  };
  if (cancellation !== null && cancellation <= now) return { verified: true, patch: { ...base, status: 'canceled', currentPeriodEnd: null, trialEndsAt: null } };
  if (['CANCELED', 'DEACTIVATED', 'COMPLETED'].includes(subscription.status)) return { verified: true, patch: { ...base, status: 'canceled', currentPeriodEnd: null } };
  if (subscription.status === 'PAUSED') return { verified: true, patch: { ...base, status: 'paused', currentPeriodEnd: null } };
  if (subscription.status !== 'ACTIVE') return { verified: true, patch: { ...base, status: 'verification_pending', currentPeriodEnd: null, trialEndsAt: null } };
  const timezone = subscription.timezone || 'UTC';
  const started = midnight(subscription.start_date, timezone);
  if (!Number.isFinite(started) || started > now) return pending('subscription_pending');
  // The only supported free phase in our catalog is the saved seven-day trial.
  // Add-on plans have no free phase and require a paid invoice.
  const trialDays = addon ? 0 : Number(record.trialDays);
  const trialEnd = trialDays === 7 ? midnight(addDays(subscription.start_date, 7), timezone) : NaN;
  if (Number.isFinite(trialEnd) && trialEnd > now && subscription.card_id) return { verified: true, patch: {
    ...base, status: 'trialing', startedAt: new Date(started).toISOString(),
    trialEndsAt: new Date(Math.min(trialEnd, cancellation ?? Infinity)).toISOString(), currentPeriodEnd: null,
  } };
  // charged_through_date is an INVOICED-through date, not proof of payment.
  const invoiceId = subscription.invoice_ids?.[0];
  if (!invoiceId) return { verified: true, patch: { ...base, status: 'past_due', currentPeriodEnd: null } };
  const { invoice } = await request(`/v2/invoices/${encodeURIComponent(invoiceId)}`);
  const periodEnd = midnight(addDays(subscription.charged_through_date, 1), timezone);
  if (!invoice || invoice.id !== invoiceId || invoice.subscription_id !== subscription.id
    || invoice.location_id !== locationId || invoice.primary_recipient?.customer_id !== customerId) return pending('invoice_mismatch');
  if (invoice.status === 'REFUNDED') return { verified: true, patch: {
    ...base, status: 'payment_refunded', currentPeriodEnd: null, lastInvoiceId: invoice.id, squareInvoiceVersion: invoice.version,
  } };
  if (invoice.status !== 'PAID' || !Number.isFinite(periodEnd) || periodEnd <= now) {
    return { verified: true, patch: { ...base, status: 'past_due', currentPeriodEnd: null } };
  }
  return { verified: true, patch: { ...base, status: 'active', startedAt: new Date(started).toISOString(),
    currentPeriodEnd: new Date(Math.min(periodEnd, cancellation ?? Infinity)).toISOString(), lastInvoiceId: invoice.id, squareInvoiceVersion: invoice.version,
  } };
}
