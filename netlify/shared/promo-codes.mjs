import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function normalizePromoCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function defaultPromoCatalog() {
  return [
    {
      code: 'FREE30',
      label: '30 Days Free Usage Promo',
      percentOff: 100,
      amountOffCents: null,
      planIds: ['cloud-7', 'cloud-17', 'cloud-37', '*'],
      freeUsage: true,
      durationDays: 30,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      code: 'FREE30DAYS',
      label: '30 Days Free Usage Promo',
      percentOff: 100,
      amountOffCents: null,
      planIds: ['cloud-7', 'cloud-17', 'cloud-37', '*'],
      freeUsage: true,
      durationDays: 30,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      code: 'FREE100',
      label: '100% Free Usage Promo',
      percentOff: 100,
      amountOffCents: null,
      planIds: ['cloud-7', 'cloud-17'],
      freeUsage: true,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      code: 'PORTABASEFREE',
      label: 'Portabase Free Usage Tier',
      percentOff: 100,
      amountOffCents: null,
      planIds: ['cloud-7', 'cloud-17'],
      freeUsage: true,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
}

export function parsePromoCatalog(raw) {
  if (!raw) return defaultPromoCatalog();
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return Object.values(parsed);
    } catch {
      // return default
    }
  } else if (typeof raw === 'object') {
    return Object.values(raw);
  }
  return defaultPromoCatalog();
}

const memoryCustomPromos = new Map();
const localPromosFile = path.join(os.tmpdir(), '.portabase-local-promos.json');

function loadCustomPromosFromDisk() {
  try {
    if (fs.existsSync(localPromosFile)) {
      const raw = fs.readFileSync(localPromosFile, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.code) memoryCustomPromos.set(item.code, item);
        }
      }
    }
  } catch {
    // ignore
  }
}

function persistCustomPromosToDisk() {
  try {
    const list = Array.from(memoryCustomPromos.values());
    fs.writeFileSync(localPromosFile, JSON.stringify(list, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

loadCustomPromosFromDisk();

export function listAllPromos(env = process.env) {
  loadCustomPromosFromDisk();
  const catalog = defaultPromoCatalog();
  const byCode = new Map();
  for (const item of catalog) {
    byCode.set(item.code, item);
  }
  for (const [code, item] of memoryCustomPromos.entries()) {
    byCode.set(code, item);
  }
  return Array.from(byCode.values());
}

export function lookupPromo(code, catalog) {
  const norm = normalizePromoCode(code);
  if (!norm) return null;
  const list = catalog ? parsePromoCatalog(catalog) : listAllPromos();
  return list.find(p => normalizePromoCode(p.code) === norm) || null;
}

export function applyPromoCode({ planId, baseCents = 0, code, catalog }) {
  const promo = lookupPromo(code, catalog);
  const base = Number(baseCents) || 0;
  if (!promo) {
    return {
      ok: false,
      error: 'invalid_promo_code',
      baseCents: base,
      priceMonthlyCents: base,
      discountCents: 0,
      freeUsage: false,
    };
  }
  if (Array.isArray(promo.planIds) && promo.planIds.length > 0) {
    if (!promo.planIds.includes('*') && !promo.planIds.includes(planId)) {
      return {
        ok: false,
        error: 'promo_not_eligible_for_plan',
        promo,
        baseCents: base,
        priceMonthlyCents: base,
        discountCents: 0,
        freeUsage: false,
      };
    }
  }
  let discountCents = 0;
  let priceMonthlyCents = base;
  if (promo.freeUsage || promo.percentOff === 100) {
    discountCents = base;
    priceMonthlyCents = 0;
  } else if (promo.percentOff != null && promo.percentOff > 0) {
    discountCents = Math.round(base * (Number(promo.percentOff) / 100));
    priceMonthlyCents = Math.max(0, base - discountCents);
  } else if (promo.amountOffCents != null && promo.amountOffCents > 0) {
    discountCents = Math.min(base, Number(promo.amountOffCents));
    priceMonthlyCents = Math.max(0, base - discountCents);
  }
  return {
    ok: true,
    promo,
    baseCents: base,
    discountCents,
    priceMonthlyCents,
    freeUsage: priceMonthlyCents === 0,
    durationDays: promo.durationDays || (priceMonthlyCents === 0 ? 30 : null),
  };
}

export function createCustomPromo({
  code,
  label,
  percentOff = 100,
  amountOffCents = null,
  planIds = ['cloud-7', 'cloud-17'],
  freeUsage = true,
  createdBy = null,
} = {}) {
  const norm = normalizePromoCode(code);
  if (!norm) throw new Error('Promo code is required');
  const promo = {
    code: norm,
    label: String(label || `${norm} (${percentOff}% off)`).trim(),
    percentOff: Number(percentOff) || 100,
    amountOffCents: amountOffCents != null ? Number(amountOffCents) : null,
    planIds: Array.isArray(planIds) ? planIds : ['cloud-7', 'cloud-17'],
    freeUsage: Boolean(freeUsage || percentOff === 100),
    createdBy: createdBy || 'admin',
    createdAt: new Date().toISOString(),
    active: true,
  };
  memoryCustomPromos.set(norm, promo);
  persistCustomPromosToDisk();
  return promo;
}
