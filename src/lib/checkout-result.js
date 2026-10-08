/** A successful HTTP response can still mean Square verification is pending. */
export function checkoutResult(result, { addon = null, now = Date.now() } = {}) {
  if (result?.pending || result?.ok !== true) {
    return { confirmed: false, tone: 'warn', message: 'Square verification is pending. Check again to confirm this checkout.' };
  }
  if (result.access?.hasAccess !== true) {
    return { confirmed: false, tone: 'warn', message: 'Checkout was verified, but subscription access is not active. Check your billing status.' };
  }
  if (addon && !(result.subscription?.extraTransfersAddon === true && result.subscription.addonStatus === 'active'
    && result.subscription.addonVerifiedBy === 'square_api' && Date.parse(result.subscription.addonCurrentPeriodEnd) > now)) {
    return { confirmed: false, tone: 'warn', message: 'Your plan is active, but the add-on has not been confirmed. Check again before starting another checkout.' };
  }
  return { confirmed: true, tone: 'ok', message: 'Square verified your subscription. Access is active.' };
}
