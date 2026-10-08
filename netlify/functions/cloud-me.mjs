import { publicAuthConfigBoth, jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { deriveAccess, getSubscriptionForUser } from '../shared/subscription-store.mjs';
import { extraTransfersAddonPublic, transferWindow } from '../shared/product.mjs';
import { runnerAdmission } from '../shared/runner-admission.mjs';
import { inspectSquareCheckoutReady } from '../shared/square-ready.mjs';
import { publicSquareStatus } from '../../src/lib/square-public.js';

export function createMeHandler({ authenticate = verifyCloudUser, subscription = getSubscriptionForUser,
  authConfig = publicAuthConfigBoth, squareStatus = () => publicSquareStatus(inspectSquareCheckoutReady()), clock = Date.now } = {}) {
return async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });

  try {
    const user = await authenticate(event);
    const record = await subscription(user);
    const now = clock();
    const access = deriveAccess(record, now);
    const admission = runnerAdmission(record, now);
    // Free includes one manual backup per 24h; it has no scheduled service.
    const transfers = admission.paid ? transferWindow({ planId: admission.plan.id, extraTransfersAddon: admission.extraTransfersAddon, now }).allowance : 1;
    const product = await authConfig();
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
      subscription: {
          status: record?.status || 'none',
          plan: admission.plan.id,
          planId: admission.plan.id,
          billingPlan: record?.plan || null,
          hasBillingRecord: Boolean(record),
          trialEndsAt: record?.trialEndsAt || null,
          currentPeriodEnd: record?.currentPeriodEnd || null,
          cancellationEffectiveAt: typeof record?.cancellationEffectiveAt === 'string'
            && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.cancellationEffectiveAt)
            && Number.isFinite(Date.parse(record.cancellationEffectiveAt))
            && new Date(record.cancellationEffectiveAt).toISOString() === record.cancellationEffectiveAt
            ? record.cancellationEffectiveAt : null,
          priceMonthlyCents: record?.priceMonthlyCents ?? admission.plan.priceMonthlyCents,
          squareSubscriptionId: record?.squareSubscriptionId || null,
          startedAt: record?.startedAt || null,
          cloudVersion: record?.cloudVersion || user.cloudVersion,
          storageCapGb: admission.plan.storageCapGb,
          storageCapBytes: admission.plan.storageCapBytes,
          extraTransfersAddon: admission.extraTransfersAddon,
          transfersPer24h: transfers,
          scheduled: admission.paid && admission.plan.scheduled,
          scheduledTransfersPer24h: admission.paid ? transfers : 0,
          cyclesPerDay: admission.paid ? transfers : 0,
        },
      access,
      square: squareStatus(),
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
        extraTransfersAddon: extraTransfersAddonPublic(admission.plan.id),
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
};
}
export const handler = createMeHandler();
