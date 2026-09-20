import { publicAuthConfigBoth, jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { deriveAccess, getSubscriptionByUserId } from '../shared/subscription-store.mjs';
import { BASE_TRANSFERS_PER_24H, extraTransfersAddonPublic, transferWindow } from '../shared/product.mjs';
import { inspectSquareCheckoutReady } from '../shared/square-ready.mjs';
import { publicSquareStatus } from '../../src/lib/square-public.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });

  try {
    const user = await verifyCloudUser(event);
    // Namespace subscription by version so the same email on two backends does not collide incorrectly
    const storeKey = `${user.cloudVersion}:${user.id}`;
    const record = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id));
    const access = deriveAccess(record);
    const product = await publicAuthConfigBoth();
    return jsonResponse(200, {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        provider: user.provider,
        authProvider: user.authProvider,
        cloudVersion: user.cloudVersion,
      },
      subscription: record
        ? {
          status: record.status,
          plan: record.plan || null,
          trialEndsAt: record.trialEndsAt,
          currentPeriodEnd: record.currentPeriodEnd,
          priceMonthlyCents: record.priceMonthlyCents || 1700,
          squareSubscriptionId: record.squareSubscriptionId || null,
          startedAt: record.startedAt || null,
          cloudVersion: record.cloudVersion || user.cloudVersion,
          storageCapGb: record.storageCapGb || null,
          extraTransfersAddon: Boolean(record.extraTransfersAddon),
          transfersPer24h: transferWindow({ extraTransfersAddon: Boolean(record.extraTransfersAddon) }).allowance,
          cyclesPerDay: record.cyclesPerDay || BASE_TRANSFERS_PER_24H,
        }
        : null,
      access,
      square: publicSquareStatus(inspectSquareCheckoutReady()),
      product: {
        provider: 'dual',
        cloudVersion: user.cloudVersion,
        trialDays: product.trialDays,
        priceMonthlyCents: product.priceMonthlyCents,
        listPriceMonthlyCents: product.listPriceMonthlyCents,
        promoUntil: product.promoUntil,
        versions: {
          supabase: { available: product.versions.supabase.available },
          aws: { available: product.versions.aws.available },
        },
        extraTransfersAddon: extraTransfersAddonPublic(),
      },
    });
  } catch (error) {
    const code = String(error.message || 'unauthorized');
    if (code === 'missing_bearer' || code === 'invalid_token' || code === 'invalid_claims' || code === 'unauthorized' || error.code === 'unauthorized') {
      return jsonResponse(401, { error: 'unauthorized' });
    }
    console.error(`cloud_me_error=${code.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    return jsonResponse(503, { error: 'unavailable' });
  }
}
