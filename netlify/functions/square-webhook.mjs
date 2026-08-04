import { WebhooksHelper } from 'square';
import { resolveServerSecret } from '../shared/secrets.mjs';
import {
  getSubscriptionByUserId,
  getUserIdBySquareOrder,
  getUserIdBySquareSubscription,
  saveSubscription,
  trialEndsAtFrom,
} from '../shared/subscription-store.mjs';
import { PRICE_MONTHLY_CENTS, TRIAL_DAYS } from '../shared/square-cloud.mjs';

async function markTrialing({ userId, squareSubscriptionId, squareOrderId, squareCustomerId }) {
  if (!userId) return;
  const existing = (await getSubscriptionByUserId(userId)) || {};
  const now = new Date().toISOString();
  const startedAt = existing.startedAt && existing.status !== 'checkout_pending' ? existing.startedAt : now;
  await saveSubscription({
    ...existing,
    userId,
    supabaseUserId: existing.supabaseUserId || userId,
    authProvider: existing.authProvider || 'supabase',
    status: 'trialing',
    trialDays: TRIAL_DAYS,
    priceMonthlyCents: existing.priceMonthlyCents || PRICE_MONTHLY_CENTS,
    startedAt,
    trialEndsAt: existing.trialEndsAt || trialEndsAtFrom(startedAt, TRIAL_DAYS),
    squareSubscriptionId: squareSubscriptionId || existing.squareSubscriptionId || null,
    squareOrderId: squareOrderId || existing.squareOrderId || null,
    squareCustomerId: squareCustomerId || existing.squareCustomerId || null,
    createdAt: existing.createdAt || now,
  });
}

async function markActive(userId, patch = {}) {
  if (!userId) return;
  const existing = (await getSubscriptionByUserId(userId)) || {};
  await saveSubscription({
    ...existing,
    userId,
    status: 'active',
    ...patch,
    createdAt: existing.createdAt || new Date().toISOString(),
  });
}

async function markCanceled(userId, patch = {}) {
  if (!userId) return;
  const existing = (await getSubscriptionByUserId(userId)) || {};
  await saveSubscription({
    ...existing,
    userId,
    status: 'canceled',
    ...patch,
    canceledAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString(),
  });
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { Allow: 'POST' }, body: 'Method not allowed' };
  try {
    const signatureKey = await resolveServerSecret('SQUARE_WEBHOOK_SIGNATURE_KEY', { service: 'square', key: 'webhook_signature_key' });
    const siteUrl = (process.env.PORTABASE_SITE_URL || process.env.URL || 'https://portabase.dev').replace(/\/$/, '');
    const notificationUrl = `${siteUrl}/api/square/webhook`;
    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    const valid = await WebhooksHelper.verifySignature({
      requestBody: body,
      signatureHeader: event.headers['x-square-hmacsha256-signature'] || '',
      signatureKey,
      notificationUrl,
    });
    if (!valid) return { statusCode: 403, body: 'Webhook rejected' };

    const squareEvent = JSON.parse(body);
    const type = squareEvent.type;

    if (['payment.created', 'payment.updated'].includes(type)) {
      const payment = squareEvent.data?.object?.payment;
      if (payment?.status === 'COMPLETED') {
        console.log(`square_fulfillment=payment_confirmed order=${payment.order_id || 'unknown'}`);
        const userId = await getUserIdBySquareOrder(payment.order_id);
        if (userId) {
          await markTrialing({
            userId,
            squareOrderId: payment.order_id,
            squareCustomerId: payment.customer_id,
          });
        }
      }
    }

    if (type === 'subscription.created' || type === 'subscription.updated') {
      const subscription = squareEvent.data?.object?.subscription
        || squareEvent.data?.object
        || {};
      const subscriptionId = subscription.id;
      const status = String(subscription.status || '').toUpperCase();
      const userId = await getUserIdBySquareSubscription(subscriptionId);
      if (!userId) {
        console.log(`square_subscription_event type=${type} id=${subscriptionId || 'none'} status=${status} unmapped`);
      } else if (status === 'ACTIVE' || status === 'PENDING') {
        const isTrialLike = status === 'PENDING' || (status === 'ACTIVE' && !subscription.charged_through_date);
        if (isTrialLike) {
          await markTrialing({
            userId,
            squareSubscriptionId: subscriptionId,
            squareCustomerId: subscription.customer_id,
          });
        } else {
          await markActive(userId, {
            squareSubscriptionId: subscriptionId,
            squareCustomerId: subscription.customer_id,
            currentPeriodEnd: subscription.charged_through_date || null,
          });
        }
        console.log(`square_subscription_mapped id=${subscriptionId} status=${status} user=${userId}`);
      } else if (['CANCELED', 'DEACTIVATED', 'FAILED'].includes(status)) {
        await markCanceled(userId, {
          squareSubscriptionId: subscriptionId,
          squareStatus: status,
        });
      }
    }

    if (type === 'invoice.payment_made') {
      const invoice = squareEvent.data?.object?.invoice || {};
      const subscriptionId = invoice.subscription_id;
      const userId = await getUserIdBySquareSubscription(subscriptionId);
      if (userId) {
        await markActive(userId, {
          squareSubscriptionId: subscriptionId,
          lastInvoiceId: invoice.id || null,
          currentPeriodEnd: invoice.period_end || null,
        });
        console.log(`square_invoice_paid user=${userId} invoice=${invoice.id || 'unknown'}`);
      }
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true }) };
  } catch {
    console.error('square_webhook_error=signature_or_configuration');
    return { statusCode: 400, body: 'Webhook rejected' };
  }
}
