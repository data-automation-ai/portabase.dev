// Read-only provider audit. Secrets stay in memory; output contains names/status only.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const siteId = '794217cc-42ab-4a9f-81da-06a661403573';
const config = JSON.parse(await readFile(join(process.env.APPDATA, 'netlify/Config/config.json'), 'utf8'));
const token = config.users?.[config.userId]?.auth?.token;
if (!token) throw new Error('netlify_auth_missing');
async function netlify(path) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`netlify_http_${response.status}`);
  return response.json();
}
const site = await netlify(`/sites/${siteId}`);
if (site.id !== siteId || site.name !== 'portabase-dev' || site.custom_domain !== 'portabase.dev') throw new Error('site_binding_mismatch');
console.log(JSON.stringify({ site: site.name, domain: site.custom_domain, deployed: site.published_deploy?.id }));
const rows = await netlify(`/accounts/${site.account_id}/env?site_id=${siteId}&context_name=production&scope=functions`);
if (!Array.isArray(rows)) throw new Error('unexpected_env_response');
const relevant = /SQUARE|TWILIO|SMS|EMAIL|RESEND|MAILGUN|CLOUDFLARE|SUPABASE|SECRETS_BUNDLE/;
for (const row of rows.filter(row => relevant.test(row.key))) {
  console.log(JSON.stringify({ variable: row.key, scopes: row.scopes, contexts: (row.values || []).map(item => ({ context: item.context, present: Boolean(item.value) })) }));
}
function value(name) {
  const row = rows.find(item => item.key === name);
  if (!row || row.scopes && !row.scopes.includes('functions')) return null;
  return row.values?.find(item => item.context === 'production')?.value || row.values?.find(item => item.context === 'all')?.value || null;
}
const accessToken = value('SQUARE_ACCESS_TOKEN');
const locationId = value('SQUARE_LOCATION_ID');
if (accessToken && locationId) {
  const mode = value('SQUARE_ENVIRONMENT') || value('SQUARE_ENV') || 'production';
  const base = mode === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const response = await fetch(`${base}/v2/locations/${encodeURIComponent(locationId)}`, { headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': '2026-05-20' } });
  const data = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ square: { mode, httpStatus: response.status, configuredLocationMatches: data.location?.id === locationId, locationActive: data.location?.status === 'ACTIVE', merchantBound: Boolean(data.location?.merchant_id), cardProcessing: data.location?.capabilities?.includes('CREDIT_CARD_PROCESSING') || false, errorCodes: data.errors?.map(error => error.code) } }));
} else console.log(JSON.stringify({ square: { accessTokenPresent: Boolean(accessToken), locationPresent: Boolean(locationId), verified: false } }));
