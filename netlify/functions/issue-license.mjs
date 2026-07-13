import { createHash, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { signLicense } from '../../utility/license-format.mjs';
import { resolveServerSecret } from '../shared/secrets.mjs';
import { isPaidEssentialsOrder } from './square-order.mjs';

const PLATFORMS = new Set(['win32', 'darwin', 'linux']);

export function buildLicensePayload({ orderId, platform, issuedAt = new Date().toISOString(), licenseId = randomUUID() }) {
  return {
    licenseVersion: 1,
    licenseId,
    orderId,
    edition: 'essentials',
    platform,
    issuedAt,
    updates: 'lifetime',
    projectAllowance: 1,
    deviceAllowance: 2,
  };
}

async function paidOrder(orderId) {
  const accessToken = await resolveServerSecret('SQUARE_ACCESS_TOKEN', { service: 'square', key: 'access_token' });
  const baseUrl = (process.env.SQUARE_ENV || 'production') === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const response = await fetch(`${baseUrl}/v2/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2026-05-20' } });
  const result = await response.json();
  if (!response.ok || !isPaidEssentialsOrder(result.order)) throw new Error('order_not_paid');
  return result.order;
}

async function claimPlatform(orderId, platform) {
  const store = getStore('portabase-license-claims');
  let claim = await store.get(orderId, { type: 'json', consistency: 'strong' });
  if (!claim) {
    const candidate = buildLicensePayload({ orderId, platform });
    const result = await store.setJSON(orderId, candidate, { onlyIfNew: true });
    claim = result.modified ? candidate : await store.get(orderId, { type: 'json', consistency: 'strong' });
  }
  if (!claim || claim.platform !== platform) throw new Error('platform_already_selected');
  return claim;
}

async function licensePrivateKey() {
  try {
    return await resolveServerSecret('PORTABASE_LICENSE_PRIVATE_KEY', { service: 'portabase', key: 'license_private_key' });
  } catch {
    const encoded = await resolveServerSecret('PORTABASE_LICENSE_PRIVATE_KEY_BASE64', { service: 'portabase', key: 'license_private_key_base64' });
    return Buffer.from(encoded, 'base64').toString('utf8');
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { Allow: 'POST' }, body: 'Method not allowed' };
  try {
    const { orderId = '', platform = '' } = JSON.parse(event.body || '{}');
    if (!/^[A-Za-z0-9_-]{8,192}$/.test(orderId) || !PLATFORMS.has(platform)) return { statusCode: 400, body: 'Invalid license request' };
    await paidOrder(orderId);
    const privateKey = await licensePrivateKey();
    const payload = await claimPlatform(orderId, platform);
    const license = signLicense(payload, privateKey);
    const fingerprint = createHash('sha256').update(payload.licenseId).digest('hex').slice(0, 12);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="PortaBase-${platform}-${fingerprint}.license.json"`,
        'Cache-Control': 'no-store',
      },
      body: `${JSON.stringify(license, null, 2)}\n`,
    };
  } catch (error) {
    const conflict = error.message === 'platform_already_selected';
    console.error(`license_issue_error=${String(error.message || 'configuration').replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    return { statusCode: conflict ? 409 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: conflict ? 'This order is already licensed for a different platform.' : 'License fulfillment is temporarily unavailable. Contact escape@portabase.dev.' }) };
  }
}
