import { saveSubscription } from './subscription-store.mjs';
import { verifySquareSubscription } from './square-subscription-proof.mjs';
import { ADDON_TRANSFERS_PER_24H, BASE_TRANSFERS_PER_24H } from './product.mjs';

const terminal = new Set(['refunded', 'closed', 'canceled']);

// Webhook bodies only trigger a fresh provider read; they never grant access.
export async function reconcileSubscription(record, {
  kind = 'base', verify = verifySquareSubscription, save = saveSubscription, now = Date.now(),
} = {}) {
  if (terminal.has(record.status)) return { verified: true, record, unchanged: true };
  const proof = await verify(record, { kind });
  if (!proof.verified) return proof;
  const patch = proof.patch;
  if (kind === 'base' && record.squareSubscriptionId === patch.squareSubscriptionId
    && ((Number.isFinite(record.squareVersion) && patch.squareVersion < record.squareVersion)
      || (record.lastInvoiceId === patch.lastInvoiceId && Number.isFinite(record.squareInvoiceVersion)
        && patch.squareInvoiceVersion < record.squareInvoiceVersion))) {
    return { verified: true, record, unchanged: true };
  }
  let next;
  if (kind === 'addon') {
    const enabled = patch.status === 'active' && Date.parse(patch.currentPeriodEnd) > now;
    next = {
      ...record, squareAddonSubscriptionId: patch.squareSubscriptionId,
      addonStatus: patch.status, addonVerifiedBy: patch.verifiedBy,
      addonVerifiedAt: patch.squareVerifiedAt, addonCurrentPeriodEnd: patch.currentPeriodEnd,
      extraTransfersAddon: enabled,
      transfersPer24h: enabled ? ADDON_TRANSFERS_PER_24H : BASE_TRANSFERS_PER_24H,
      cyclesPerDay: enabled ? ADDON_TRANSFERS_PER_24H : BASE_TRANSFERS_PER_24H,
      ...(enabled ? { pendingAddon: null, checkoutKind: null } : {}),
    };
  } else {
    next = { ...record, ...patch };
  }
  // Save compares the revision from BEFORE the remote read. A cancellation,
  // refund or replacement checkout in the meantime invalidates this proof.
  return { verified: true, record: await save(next) };
}
