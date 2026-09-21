/**
 * Planning-only storage cost signals. Not a quote, invoice, or AWS Price List API result.
 * Used so doctor can say "this volume is 2 TiB — snapshot storage will not be free."
 */

export const COST_SIGNALS = Object.freeze({
  currency: 'USD',
  asOf: '2026-09',
  regionHint: 'us-east-1 list-price style',
  disclaimer: 'Signal only — not a quote, not a bill, not reserved-instance math.',
  ebsSnapshotGiBMonth: 0.05,
  s3StandardGiBMonth: 0.023,
  rdsBackupGiBMonth: 0.095,
  ecrStorageGiBMonth: 0.10,
});

export function estimateMonthlyUsd(sizeGiB, rateKey) {
  const size = Number(sizeGiB) || 0;
  const rate = COST_SIGNALS[rateKey];
  if (typeof rate !== 'number') {
    return {
      usd: null,
      hint: true,
      notAQuote: true,
      disclaimer: COST_SIGNALS.disclaimer,
    };
  }
  return {
    usd: Math.round(size * rate * 100) / 100,
    rateGiBMonth: rate,
    currency: COST_SIGNALS.currency,
    asOf: COST_SIGNALS.asOf,
    hint: true,
    notAQuote: true,
    disclaimer: COST_SIGNALS.disclaimer,
  };
}
