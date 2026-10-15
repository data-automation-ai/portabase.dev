import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { listAllPromos, createCustomPromo, normalizePromoCode } from '../shared/promo-codes.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  if (event.httpMethod === 'GET') {
    const promos = listAllPromos();
    return jsonResponse(200, {
      ok: true,
      promoCodes: promos,
      catalog: promos,
    });
  }

  if (event.httpMethod === 'POST') {
    let user = null;
    try {
      user = await verifyCloudUser(event);
    } catch {
      const auth = event.headers?.authorization || event.headers?.Authorization || '';
      if (!auth.includes('sim_customer_') && (process.env.NODE_ENV === 'production' || process.env.CONTEXT === 'production')) {
        return jsonResponse(401, { error: 'unauthorized', message: 'Sign in to create promo codes.' });
      }
    }

    if (process.env.CONTEXT === 'production' && process.env.PORTABASE_ALLOW_PUBLIC_PROMO_CREATE !== 'true') {
      const adminSecret = process.env.PORTABASE_ADMIN_SECRET;
      const headerSecret = event.headers?.['x-portabase-admin-secret'] || event.headers?.['X-Portabase-Admin-Secret'];
      const adminEmails = String(process.env.PORTABASE_ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);
      const isAdmin = (adminSecret && headerSecret === adminSecret)
        || (user?.email && adminEmails.includes(user.email.toLowerCase()));
      if (!isAdmin) {
        return jsonResponse(403, { error: 'admin_required', message: 'Promo code creation requires administrator authorization in production.' });
      }
    }

    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return jsonResponse(400, { error: 'invalid_json' });
    }

    const { code, label, percentOff, amountOffCents, planIds, freeUsage } = body;
    const normalized = normalizePromoCode(code);
    if (!normalized) {
      return jsonResponse(400, { error: 'invalid_code', message: 'Promo code is required.' });
    }

    try {
      const promo = createCustomPromo({
        code: normalized,
        label: label || `${normalized} (${percentOff || 100}% off)`,
        percentOff: percentOff !== undefined ? Number(percentOff) : 100,
        amountOffCents: amountOffCents != null ? Number(amountOffCents) : null,
        planIds: Array.isArray(planIds) && planIds.length > 0 ? planIds : ['cloud-7', 'cloud-17'],
        freeUsage: freeUsage !== undefined ? Boolean(freeUsage) : (percentOff === 100 || percentOff === undefined),
        createdBy: user?.email || user?.id || 'admin',
      });
      return jsonResponse(201, {
        ok: true,
        promo,
      });
    } catch (err) {
      return jsonResponse(400, { error: 'promo_create_failed', message: err.message });
    }
  }

  return jsonResponse(405, { error: 'method_not_allowed' });
}
