import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { getSubscriptionForUser, saveSubscription, deriveAccess } from '../shared/subscription-store.mjs';
import { cancelSquareSubscription } from '../shared/square-cloud.mjs';
import { verifySquareSubscription } from '../shared/square-subscription-proof.mjs';

const terminal = new Set(['canceled', 'closed', 'refunded']);
const sameBilling = (a, b) => a && b && a.userId === b.userId
  && a.checkoutAttempt === b.checkoutAttempt && a.squareOrderId === b.squareOrderId
  && a.squareSubscriptionId === b.squareSubscriptionId
  && a.squareAddonSubscriptionId === b.squareAddonSubscriptionId;

/** Cancel renewal, without refunding or deleting private runner data. Provider
 * IDs come only from the authenticated account. No POST result grants access:
 * current provider reads and the subscription revision guard remain required. */
export function createCancellationHandler({ authenticate = verifyCloudUser,
  subscription = getSubscriptionForUser, verify = verifySquareSubscription,
  cancel = cancelSquareSubscription, save = saveSubscription, clock = Date.now } = {}) {
  return async event => {
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
    let user;
    try { user = await authenticate(event); } catch { return jsonResponse(401, { error: 'unauthorized' }); }
    let body;
    try {
      if (Buffer.byteLength(event.body || '') > 128) return jsonResponse(413, { error: 'body_too_large' });
      body = JSON.parse(event.body || '{}');
    } catch { return jsonResponse(400, { error: 'invalid_json' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || body.confirm !== true) return jsonResponse(400, { error: 'confirmation_required' });
    let changed = false;
    try {
      const record = await subscription(user);
      if (!record || record.userId !== `${user.cloudVersion}:${user.id}` || !record.squareSubscriptionId) {
        return jsonResponse(409, { error: 'subscription_not_bound' });
      }
      // Include the separately billed add-on: canceling only the base must not
      // leave the customer's transfer add-on renewing silently.
      const kinds = record.squareAddonSubscriptionId ? ['base', 'addon'] : ['base'];
      for (const kind of kinds) {
        const proof = await verify(record, { kind, now: clock() });
        const id = kind === 'base' ? record.squareSubscriptionId : record.squareAddonSubscriptionId;
        if (!proof.verified || proof.patch?.squareSubscriptionId !== id) throw new Error('unverified_subscription');
        const current = await subscription(user);
        if (!sameBilling(record, current)) throw new Error('billing_changed');
        if (!terminal.has(proof.patch.status) && !proof.patch.cancellationEffectiveAt) {
          // A transport failure can follow an accepted provider write. Retries
          // first read current Square state above instead of assuming failure.
          changed = true;
          await cancel(id);
        }
      }
      const latest = await subscription(user);
      if (!sameBilling(record, latest)) throw new Error('billing_changed');
      const base = await verify(latest, { kind: 'base', now: clock() });
      if (!base.verified || base.patch?.squareSubscriptionId !== record.squareSubscriptionId
        || !terminal.has(base.patch.status) && !base.patch.cancellationEffectiveAt) throw new Error('cancellation_unconfirmed');
      let addon = null;
      if (record.squareAddonSubscriptionId) {
        addon = await verify(latest, { kind: 'addon', now: clock() });
        if (!addon.verified || addon.patch?.squareSubscriptionId !== record.squareAddonSubscriptionId
          || !terminal.has(addon.patch.status) && !addon.patch.cancellationEffectiveAt) throw new Error('cancellation_unconfirmed');
      }
      // Preserve permanent closure performed concurrently with cancellation.
      // save() rejects a newer revision, including a replacement checkout.
      const next = { ...latest, ...(terminal.has(latest.status) ? {} : base.patch),
        ...(addon ? { addonCancellationEffectiveAt: addon.patch.cancellationEffectiveAt || null,
          addonStatus: addon.patch.status, addonCurrentPeriodEnd: addon.patch.currentPeriodEnd,
          extraTransfersAddon: addon.patch.status === 'active' && Date.parse(addon.patch.currentPeriodEnd) > clock(),
        } : {}) };
      const saved = await save(next);
      return jsonResponse(200, { ok: true, cancellationConfirmed: true,
        cancellationEffectiveAt: base.patch.cancellationEffectiveAt || null,
        addonCancellationEffectiveAt: addon?.patch.cancellationEffectiveAt || null,
        status: terminal.has(saved.status) ? 'canceled' : 'cancellation_scheduled',
        hasAccess: deriveAccess(saved, clock()).hasAccess });
    } catch {
      return jsonResponse(503, { error: 'cancellation_reconciliation_required',
        providerMayHaveChanged: changed,
        message: 'Cancellation could not be fully confirmed. Refresh and retry to check its current status.' });
    }
  };
}
export const handler = createCancellationHandler();
