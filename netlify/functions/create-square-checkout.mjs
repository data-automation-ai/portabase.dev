/**
 * LEGACY endpoint — the $147 one-time Essentials license is retired.
 * Commercial path is Portabase Cloud ($17/mo via cloud-subscribe + Square).
 * Kept so old clients get a clear error instead of a wrong checkout.
 */

export function buildSquarePaymentLinkRequest() {
  throw new Error('legacy_147_checkout_retired');
}

export async function handler(event) {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET, POST' }, body: 'Method not allowed' };
  }
  const siteUrl = (process.env.PORTABASE_SITE_URL || process.env.URL || 'https://portabase.dev').replace(/\/$/, '');
  const body = {
    error: 'legacy_checkout_retired',
    message:
      'The $147 one-time Essentials license is retired. Recovery engine is free (Apache-2.0 open source). Portabase Cloud is $17/mo base via Square after a 7-day trial — you bring capsule storage.',
    openSource: 'https://github.com/DataAutomation-ai',
    cloud: `${siteUrl}/cloud`,
    subscribe: `${siteUrl}/login?mode=signup&next=/app/account?tab=billing`,
    priceMonthlyUsd: 17,
  };
  return {
    statusCode: 410,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
