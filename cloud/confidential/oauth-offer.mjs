// Refresh pending authorization offers without disconnecting either account.
export function needsOAuthOffer({ connected, link, offeredAt, now = Date.now() }) {
  if (!link) return !connected;
  return !Number.isFinite(offeredAt) || now - offeredAt >= 8 * 60 * 1000;
}
