// Keep server-owned order/plan bindings for the last eight checkout tabs.
const fields = ['checkoutAttempt', 'checkoutKind', 'pendingAddon', 'checkoutUrl',
  'squarePaymentLinkId', 'squareOrderId', 'squarePlanVariationId',
  'squareAddonOrderId', 'squareAddonPlanVariationId', 'plan', 'planId',
  'trialDays', 'priceMonthlyCents', 'storageCapGb', 'paymentGateway'];
const snapshot = record => Object.fromEntries(fields.map(key => [key, record[key] ?? null]));

export function rememberCheckout(existing, candidate) {
  const history = [...(existing?.checkoutAttempts || [])];
  if (existing?.checkoutAttempt && !history.some(row => row.checkoutAttempt === existing.checkoutAttempt)) history.push(snapshot(existing));
  const checkoutAttempts = [...history.filter(row => row.checkoutAttempt !== candidate.checkoutAttempt), snapshot(candidate)].slice(-8);
  return { ...candidate, checkoutAttempts };
}

export function checkoutForAttempt(record, attempt) {
  if (!attempt || typeof attempt !== 'string') return null;
  if (record.checkoutAttempt === attempt) return record;
  if (['closed', 'refunded', 'canceled'].includes(record.status)) return null;
  const saved = record.checkoutAttempts?.find(row => row.checkoutAttempt === attempt);
  if (!saved) return null;
  const addon = Boolean(saved.pendingAddon);
  return { ...record, ...saved,
    ...(addon ? { squareAddonSubscriptionId: null } : {
      status: 'checkout_pending', squareSubscriptionId: null, squareVersion: null,
      squareInvoiceVersion: null, lastInvoiceId: null, verifiedBy: null,
      currentPeriodEnd: null, trialEndsAt: null,
      promoCode: null, testPromoRedeemedAt: null, testAccessEndsAt: null,
    }),
  };
}
