import crypto from 'node:crypto';
import { normalizePromoCode, lookupPromo } from './promo-codes.mjs';

export function hashTestPromoCode(raw) {
  const norm = normalizePromoCode(raw);
  return crypto.createHash('sha256').update(norm).digest('hex');
}

export function testPromoCodeMatches(inputCode, expectedHashOrCode, catalog) {
  const norm = normalizePromoCode(inputCode);
  if (!norm) return false;

  // 1. Direct match with expectedHashOrCode
  if (expectedHashOrCode) {
    const expectedNorm = normalizePromoCode(expectedHashOrCode);
    if (norm === expectedNorm) return true;
    const inputHash = hashTestPromoCode(norm);
    if (inputHash.toLowerCase() === String(expectedHashOrCode).trim().toLowerCase()) return true;
  }

  // 2. Check environment variable PORTABASE_TEST_PROMO_CODE_SHA256
  const envHash = process.env.PORTABASE_TEST_PROMO_CODE_SHA256;
  if (envHash) {
    const inputHash = hashTestPromoCode(norm);
    if (inputHash.toLowerCase() === String(envHash).trim().toLowerCase()) return true;
  }

  // 3. Check catalog / custom promos (FREE100, PORTABASEFREE, etc.)
  const promo = lookupPromo(norm, catalog);
  if (promo && (promo.freeUsage || promo.percentOff === 100)) {
    return true;
  }

  return false;
}

export function testPromoEmailAllowed(email, env = process.env) {
  if (!email || typeof email !== 'string') return false;
  const cleanEmail = email.trim().toLowerCase();
  const allowed = env.PORTABASE_TEST_PROMO_ALLOWED_EMAILS;
  if (!allowed || allowed === '*' || allowed.trim() === '') return true;
  const list = allowed.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(cleanEmail) || list.includes('*');
}

export function testPromoAccessDays(env = process.env) {
  const days = parseInt(env.PORTABASE_TEST_PROMO_DAYS || '30', 10);
  return Number.isSafeInteger(days) && days > 0 ? days : 30;
}

export function testPromoEndsAt(fromDate = new Date(), days = 30) {
  const start = fromDate instanceof Date ? fromDate.getTime() : new Date(fromDate).getTime();
  const d = Number.isSafeInteger(days) && days > 0 ? days : 30;
  return new Date(start + d * 24 * 60 * 60 * 1000).toISOString();
}

export function testPromoWasRedeemed(record) {
  if (!record || typeof record !== 'object') return false;
  return Boolean(
    record.testPromoRedeemedAt
    || record.promoCode
    || record.paymentGateway === 'promo_code'
    || record.paymentGateway === 'test_promo'
    || record.verifiedBy === 'promo_code'
  );
}
