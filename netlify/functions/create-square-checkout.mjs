import { resolveServerSecret } from '../shared/secrets.mjs';

const API_VERSION = '2026-05-20';

export function buildSquarePaymentLinkRequest({ locationId, attempt, siteUrl }) {
  return {
    idempotency_key: attempt,
    description: 'Downloadable Supabase backup and recovery software for one project and one selected platform: Windows, macOS, or Linux',
    order: {
      location_id: locationId,
      reference_id: `portabase:${attempt}`,
      line_items: [{ name: 'PortaBase Essentials — One-Platform Software License', quantity: '1', base_price_money: { amount: 14700, currency: 'USD' } }],
    },
    checkout_options: { redirect_url: `${siteUrl}/thanks`, allow_tipping: false, ask_for_shipping_address: false },
    payment_note: 'Lifetime PortaBase software license for one Supabase project; choose Windows, macOS, or Linux during fulfillment',
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { Allow: 'POST' }, body: 'Method not allowed' };
  try {
    const [accessToken, locationId] = await Promise.all([
      resolveServerSecret('SQUARE_ACCESS_TOKEN', { service: 'square', key: 'access_token' }),
      resolveServerSecret('SQUARE_LOCATION_ID', { service: 'square', key: 'location_id' }),
    ]);
    const siteUrl = (process.env.PORTABASE_SITE_URL || process.env.URL || 'https://portabase.dev').replace(/\/$/, '');
    const attempt = event.headers['x-portabase-attempt'] || crypto.randomUUID();
    const baseUrl = (process.env.SQUARE_ENV || 'production') === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
    const response = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Square-Version': API_VERSION },
      body: JSON.stringify(buildSquarePaymentLinkRequest({ locationId, attempt, siteUrl })),
    });
    const result = await response.json();
    if (!response.ok || !result.payment_link?.url || !result.payment_link?.order_id) throw new Error(`square_http_${response.status}`);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ url: result.payment_link.url, orderId: result.payment_link.order_id }) };
  } catch (error) {
    console.error(`square_checkout_error=${String(error.message || 'configuration').replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    return { statusCode: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Secure checkout is temporarily unavailable. Please contact escape@portabase.dev.' }) };
  }
}
