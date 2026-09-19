/**
 * Square checkout readiness — names only, never secret values.
 * Prefer LIVE (production). TEST = sandbox.
 */

export const SQUARE_REQUIRED_VARS = Object.freeze([
  'SQUARE_ACCESS_TOKEN',
  'SQUARE_LOCATION_ID',
]);

export const SQUARE_WEBHOOK_VARS = Object.freeze([
  'SQUARE_WEBHOOK_SIGNATURE_KEY',
]);

export const SQUARE_CATALOG_PIN_VARS = Object.freeze([
  'SQUARE_CLOUD_PLAN_VARIATION_ID_7',
  'SQUARE_CLOUD_PLAN_VARIATION_ID',
  'SQUARE_CLOUD_PLAN_VARIATION_ID_17',
  'SQUARE_CLOUD_PLAN_VARIATION_ID_37',
  'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7',
  'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_17',
  'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_37',
]);

export function squareMode(env = process.env) {
  const raw = String(env.SQUARE_ENVIRONMENT || env.SQUARE_ENV || 'production').toLowerCase();
  return raw === 'sandbox' ? 'TEST' : 'LIVE';
}

function present(env, name) {
  return Boolean(String(env[name] || '').trim());
}

export function inspectSquareCheckoutReady(env = process.env) {
  const missingRequired = SQUARE_REQUIRED_VARS.filter((name) => !present(env, name));
  const missingWebhook = SQUARE_WEBHOOK_VARS.filter((name) => !present(env, name));
  const unsetPins = SQUARE_CATALOG_PIN_VARS.filter((name) => !present(env, name));
  const mode = squareMode(env);
  return {
    ready: missingRequired.length === 0,
    mode,
    preferLive: true,
    missing: missingRequired,
    missingWebhook,
    unsetCatalogPins: unsetPins,
    siteUrlVar: 'PORTABASE_SITE_URL',
    siteUrlSet: present(env, 'PORTABASE_SITE_URL'),
    note: mode === 'TEST'
      ? 'SQUARE_ENVIRONMENT=sandbox (TEST). Set production (or omit) for LIVE.'
      : 'SQUARE_ENVIRONMENT defaults to production (LIVE). Set sandbox only for TEST.',
  };
}

export function squareBlockedPayload(inspect = inspectSquareCheckoutReady()) {
  return {
    error: 'checkout_blocked',
    reason: 'missing_square_env',
    missing: inspect.missing,
    missingWebhook: inspect.missingWebhook,
    unsetCatalogPins: inspect.unsetCatalogPins,
    mode: inspect.mode,
    message: inspect.ready
      ? `Square ${inspect.mode} checkout failed. Confirm catalog pins: ${inspect.unsetCatalogPins.join(', ') || 'none'}.`
      : `Square ${inspect.mode} checkout blocked until Louis sets Netlify / secrets-bundle: ${inspect.missing.join(', ')}.`,
  };
}
