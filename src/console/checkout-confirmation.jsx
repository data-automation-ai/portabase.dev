import React, { useEffect, useMemo, useState } from 'react';
import { confirmCheckout } from '../lib/cloud-api.js';
import { createCheckoutConfirmation } from '../lib/checkout-confirmation.js';

export function CheckoutConfirmation({ checkout, onVerified }) {
  const controller = useMemo(() => createCheckoutConfirmation({ ...checkout, confirm: confirmCheckout }),
    [checkout.attempt, checkout.version, checkout.addon]);
  const [state, setState] = useState(() => controller.snapshot());
  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    setState(controller.snapshot());
    controller.retry();
    return unsubscribe;
  }, [controller]);
  useEffect(() => { if (state.status === 'verified') onVerified(state.result); }, [state, onVerified]);
  const headings = { verifying: 'Verifying checkout', pending: 'Checkout confirmation pending', unavailable: 'Checkout confirmation unavailable', verified: 'Checkout verified' };
  return <section className={`pb-callout ${state.status === 'unavailable' ? 'danger' : ''}`} aria-label="Checkout confirmation" aria-live="polite" aria-busy={state.status === 'verifying'}>
    <div>
      <strong>{headings[state.status]}</strong>
      <p>{state.message}</p>
      {state.status !== 'verified' && <p>Keep this page or its URL until verification finishes. Checking again confirms the existing checkout and does not create another purchase.</p>}
      {state.status !== 'verified' && state.retryable !== false && <button type="button" className="pb-btn" disabled={state.status === 'verifying'} onClick={() => controller.retry()}>
        {state.status === 'verifying' ? 'Checking checkout…' : 'Check again'}
      </button>}
    </div>
  </section>;
}
