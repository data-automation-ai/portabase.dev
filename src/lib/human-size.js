/**
 * Human-readable binary sizes for capsule telemetry.
 * Dashboard copy uses GiB (1024^3), never decimal GB marketing units.
 */

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;
const TIB = 1024 * GIB;

function finiteBytes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Compact binary size: B / KiB / MiB / GiB / TiB. */
export function formatHumanSize(bytes) {
  const n = finiteBytes(bytes);
  if (!n) return '0 B';
  if (n < KIB) return `${Math.round(n)} B`;
  if (n < MIB) return `${trim(n / KIB)} KiB`;
  if (n < GIB) return `${trim(n / MIB)} MiB`;
  if (n < TIB) return `${trim(n / GIB, n >= 10 * GIB ? 2 : 3)} GiB`;
  return `${trim(n / TIB, 2)} TiB`;
}

/** Always GiB, for plan / capsule cards. */
export function formatGiB(bytes, digits = 3) {
  const n = finiteBytes(bytes);
  if (!n) return '0 GiB';
  const raw = (n / GIB).toFixed(digits);
  return `${raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')} GiB`;
}

function trim(value, digits = value >= 10 ? 1 : 2) {
  const fixed = value.toFixed(digits);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

export const BYTES_PER_GIB = GIB;
