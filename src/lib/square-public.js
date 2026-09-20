/**
 * Browser-safe Square checkout contract.
 * Names only — never token values, catalog IDs, or secret material.
 * Fail closed unless a live control-plane payload says ready === true.
 */

export const SQUARE_REQUIRED_VAR_NAMES = Object.freeze([
  'SQUARE_ACCESS_TOKEN',
  'SQUARE_LOCATION_ID',
]);

export const SQUARE_WEBHOOK_VAR_NAMES = Object.freeze([
  'SQUARE_WEBHOOK_SIGNATURE_KEY',
]);

export const SQUARE_CATALOG_PIN_VAR_NAMES = Object.freeze([
  'SQUARE_CLOUD_PLAN_VARIATION_ID_7',
  'SQUARE_CLOUD_PLAN_VARIATION_ID',
  'SQUARE_CLOUD_PLAN_VARIATION_ID_17',
  'SQUARE_CLOUD_PLAN_VARIATION_ID_37',
  'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7',
  'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_17',
  'SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_37',
]);

export const SQUARE_SITE_URL_VAR = 'PORTABASE_SITE_URL';

function namesOnly(list, fallback) {
  if (!Array.isArray(list)) return [...fallback];
  return list
    .map((name) => String(name || '').trim())
    .filter((name) => /^[A-Z][A-Z0-9_]+$/.test(name));
}

function looksLikeSecret(value) {
  const text = String(value || '');
  return /sq0[a-z]|sandbox-|EAAA|sk_|secret|bearer/i.test(text);
}

/**
 * @param {{ live?: object | null, demoMode?: boolean }} opts
 */
export function squareBillingView({ live = null, demoMode = false } = {}) {
  if (demoMode) {
    return {
      ready: false,
      failClosed: true,
      reason: 'demo_is_not_checkout',
      mode: null,
      missing: [...SQUARE_REQUIRED_VAR_NAMES],
      missingWebhook: [...SQUARE_WEBHOOK_VAR_NAMES],
      unsetCatalogPins: [...SQUARE_CATALOG_PIN_VAR_NAMES],
      siteUrlVar: SQUARE_SITE_URL_VAR,
      message: 'Sample UI — Square checkout is not live. Required env (names only): SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID.',
    };
  }

  if (!live || typeof live !== 'object') {
    return {
      ready: false,
      failClosed: true,
      reason: 'square_status_unknown',
      mode: null,
      missing: [...SQUARE_REQUIRED_VAR_NAMES],
      missingWebhook: [...SQUARE_WEBHOOK_VAR_NAMES],
      unsetCatalogPins: [...SQUARE_CATALOG_PIN_VAR_NAMES],
      siteUrlVar: SQUARE_SITE_URL_VAR,
      message: 'Checkout blocked until Square env is confirmed. Required: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID.',
    };
  }

  if (looksLikeSecret(JSON.stringify(live))) {
    return {
      ready: false,
      failClosed: true,
      reason: 'secret_stripped',
      mode: null,
      missing: [...SQUARE_REQUIRED_VAR_NAMES],
      missingWebhook: [...SQUARE_WEBHOOK_VAR_NAMES],
      unsetCatalogPins: [...SQUARE_CATALOG_PIN_VAR_NAMES],
      siteUrlVar: SQUARE_SITE_URL_VAR,
      message: 'Checkout blocked. Square payload contained non-name material and was discarded.',
    };
  }

  const missing = namesOnly(live.missing, SQUARE_REQUIRED_VAR_NAMES);
  const missingWebhook = namesOnly(live.missingWebhook, SQUARE_WEBHOOK_VAR_NAMES);
  const unsetCatalogPins = namesOnly(live.unsetCatalogPins, SQUARE_CATALOG_PIN_VAR_NAMES);
  const ready = live.ready === true && missing.length === 0;
  const mode = live.mode === 'TEST' || live.mode === 'LIVE' ? live.mode : null;
  const message = ready
    ? `Square ${mode || 'LIVE'} checkout is configured.`
    : `Square checkout blocked. Louis must set: ${missing.join(', ') || SQUARE_REQUIRED_VAR_NAMES.join(', ')}.`;

  const view = {
    ready,
    failClosed: !ready,
    reason: ready ? 'ready' : (live.reason || 'missing_square_env'),
    mode,
    missing,
    missingWebhook,
    unsetCatalogPins,
    siteUrlVar: SQUARE_SITE_URL_VAR,
    message,
  };

  const json = JSON.stringify(view);
  if (looksLikeSecret(json)) {
    return {
      ready: false,
      failClosed: true,
      reason: 'secret_stripped',
      mode: null,
      missing: [...SQUARE_REQUIRED_VAR_NAMES],
      missingWebhook: [...SQUARE_WEBHOOK_VAR_NAMES],
      unsetCatalogPins: [...SQUARE_CATALOG_PIN_VAR_NAMES],
      siteUrlVar: SQUARE_SITE_URL_VAR,
      message: 'Checkout blocked. Square payload contained non-name material and was discarded.',
    };
  }
  return view;
}

export function publicSquareStatus(inspect = {}) {
  return squareBillingView({
    live: {
      ready: inspect.ready === true,
      mode: inspect.mode,
      missing: inspect.missing,
      missingWebhook: inspect.missingWebhook,
      unsetCatalogPins: inspect.unsetCatalogPins,
    },
    demoMode: false,
  });
}
