import { checkoutResult } from './checkout-result.js';

/** Retries only the existing confirmation. This controller cannot create a checkout. */
export function createCheckoutConfirmation({ attempt, version, addon, confirm }) {
  let snapshot = { status: 'verifying', message: 'Checking this checkout with Square.' };
  let pending = null;
  const listeners = new Set();
  const publish = value => { snapshot = value; for (const listener of listeners) listener(value); };
  return {
    snapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    retry() {
      if (pending) return pending;
      if (snapshot.status === 'verified') return Promise.resolve(snapshot);
      if (!attempt) {
        publish({ status: 'unavailable', message: 'This return link is missing its checkout reference. Open the original checkout return link to check its status.', retryable: false });
        return Promise.resolve(snapshot);
      }
      publish({ status: 'verifying', message: 'Checking this checkout with Square.' });
      pending = Promise.resolve().then(() => confirm({ attempt, version, addon })).then(result => {
        const outcome = checkoutResult(result, { addon });
        publish({ status: outcome.confirmed ? 'verified' : 'pending', message: outcome.message, result, retryable: !outcome.confirmed });
        return snapshot;
      }).catch(() => {
        publish({ status: 'unavailable', message: 'Checkout confirmation is unavailable. Check again when the connection returns. Your existing checkout reference has been kept.', retryable: true });
        return snapshot;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}

export function preservePendingCheckout(path, checkout) {
  if (!checkout || checkout.verified) return path;
  const url = new URL(path, 'https://portabase.dev');
  url.searchParams.set('checkout', 'complete');
  if (checkout.attempt) url.searchParams.set('attempt', checkout.attempt);
  if (checkout.addon) url.searchParams.set('addon', checkout.addon);
  return `${url.pathname}${url.search}${url.hash}`;
}
