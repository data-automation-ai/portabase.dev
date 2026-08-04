import { resolveServerSecret } from '../shared/secrets.mjs';

/**
 * Legacy $147 Essentials order detector — for historical license fulfillment only.
 * New commercial checkout is Cloud subscription ($17/mo), not this product.
 */
export function isPaidEssentialsOrder(order) {
  const line = order?.line_items?.find(item => item.name === 'Portabase Essentials — One-Platform Software License');
  return order?.state === 'COMPLETED'
    && line?.quantity === '1'
    && line?.base_price_money?.amount === 14700
    && line?.base_price_money?.currency === 'USD'
    && order?.total_money?.amount === 14700
    && order?.total_money?.currency === 'USD';
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { Allow: 'GET' }, body: 'Method not allowed' };
  const orderId = event.queryStringParameters?.order_id || '';
  if (!/^[A-Za-z0-9_-]{8,192}$/.test(orderId)) return { statusCode: 400, body: 'Invalid order' };
  try {
    const accessToken = await resolveServerSecret('SQUARE_ACCESS_TOKEN', { service: 'square', key: 'access_token' });
    const baseUrl = (process.env.SQUARE_ENV || 'production') === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
    const response = await fetch(`${baseUrl}/v2/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2026-05-20' } });
    const result = await response.json();
    const order = result.order;
    const paid = response.ok && isPaidEssentialsOrder(order);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ paid }) };
  } catch {
    return { statusCode: 404, headers: { 'Cache-Control': 'no-store' }, body: 'Order not found' };
  }
}
