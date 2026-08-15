import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { CLOUD_MONEY_BACK_DAYS } from '../shared/product.mjs';
import {
  cancelSquareSubscription,
  findCompletedPaymentForOrder,
  refundSquarePayment,
} from '../shared/square-cloud.mjs';
import {
  deriveAccess,
  getSubscriptionByUserId,
  moneyBackEligible,
  saveSubscription,
} from '../shared/subscription-store.mjs';

/**
 * Customer-triggered 7-day money-back: refund any first paid charge and close Cloud access.
 * Capsules in the customer's vault are not touched.
 */
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  let user;
  try {
    user = await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized', message: 'Sign in before requesting a refund.' });
  }

  const storeKey = `${user.cloudVersion}:${user.id}`;
  const record = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id));
  const eligible = moneyBackEligible(record, new Date(), CLOUD_MONEY_BACK_DAYS);
  if (!eligible.ok) {
    return jsonResponse(409, {
      error: 'not_eligible',
      reason: eligible.reason,
      message: eligible.reason === 'window_closed'
        ? 'The 7-day money-back window has closed. Cancel at period end from Square or contact escape@portabase.dev.'
        : eligible.reason === 'already_closed'
          ? 'This Cloud account is already closed.'
          : 'No refundable Cloud subscription on this account.',
    });
  }

  const now = new Date().toISOString();
  let refund = { skipped: true, reason: 'trial_no_charge' };
  let paymentId = record.lastPaymentId || null;
  let amountCents = Number(record.lastPaymentAmountCents) || 0;

  try {
    if (!paymentId && record.squareOrderId) {
      const found = await findCompletedPaymentForOrder(record.squareOrderId);
      if (found) {
        paymentId = found.id;
        amountCents = Number(found.amount_money?.amount) || 0;
      }
    }
    if (eligible.reason === 'paid_window' && paymentId && amountCents > 0) {
      refund = await refundSquarePayment({
        paymentId,
        amountCents,
        idempotencyKey: `self-refund-${storeKey}-${paymentId}`,
        reason: 'Customer self-serve 7-day money-back. Cloud account closed.',
      });
    }
  } catch (error) {
    return jsonResponse(502, {
      error: 'refund_failed',
      message: error.message || 'Square refund failed. No account change was saved.',
    });
  }

  try {
    if (record.squareSubscriptionId) {
      await cancelSquareSubscription(record.squareSubscriptionId);
    }
  } catch (error) {
    return jsonResponse(502, {
      error: 'cancel_failed',
      message: error.message || 'Square cancel failed after refund. Contact escape@portabase.dev.',
      refunded: !refund.skipped,
    });
  }

  const closed = await saveSubscription({
    ...record,
    userId: record.userId || storeKey,
    status: refund.skipped ? 'closed' : 'refunded',
    closedAt: now,
    refundedAt: refund.skipped ? null : now,
    closeReason: 'customer_self_refund',
    lastPaymentId: paymentId || record.lastPaymentId || null,
    lastPaymentAmountCents: amountCents || record.lastPaymentAmountCents || 0,
  });

  return jsonResponse(200, {
    ok: true,
    closed: true,
    refunded: !refund.skipped,
    refundAmountCents: refund.skipped ? 0 : amountCents,
    access: deriveAccess(closed),
    message: refund.skipped
      ? 'Trial canceled. Cloud access is closed. Capsules in your vault are untouched.'
      : 'Refund issued. Cloud access is closed. Capsules in your vault are untouched.',
  });
}
