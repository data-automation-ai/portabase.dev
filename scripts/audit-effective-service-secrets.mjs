// Read-only operator audit. No secret values are printed or written to disk.
// Verify AWS STS/account before running with an explicit authorized profile.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { findBundleValue } from '../netlify/shared/secrets.mjs';

const config = JSON.parse(await readFile(join(process.env.APPDATA, 'netlify/Config/config.json'), 'utf8'));
const token = config.users?.[config.userId]?.auth?.token;
if (!token) throw new Error('netlify_auth_missing');
async function netlify(path) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`netlify_http_${response.status}`);
  return response.json();
}
const site = await netlify('/sites/794217cc-42ab-4a9f-81da-06a661403573');
if (site.name !== 'portabase-dev' || site.custom_domain !== 'portabase.dev') throw new Error('site_binding_mismatch');
const rows = await netlify(`/accounts/${site.account_id}/env?site_id=${site.id}&context_name=production&scope=functions`);
if (!Array.isArray(rows)) throw new Error('invalid_env_response');
function fallback(name) {
  const row = rows.find(item => item.key === name);
  if (!row || row.scopes && !row.scopes.includes('functions')) return null;
  return row.values?.find(item => item.context === 'production')?.value || row.values?.find(item => item.context === 'all')?.value || null;
}
let bundle = null;
try {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(new GetSecretValueCommand({ SecretId: fallback('SECRETS_BUNDLE_ID') || 'secrets-bundle' }));
  bundle = JSON.parse(response.SecretString || Buffer.from(response.SecretBinary || '').toString('utf8'));
  console.log(JSON.stringify({ awsBundleRead: true, region: 'us-east-1', evidence: 'operator_profile_not_deployed_runtime' }));
} catch { console.log(JSON.stringify({ awsBundleRead: false, reason: 'unavailable_or_unparseable' })); }
function selected(envName, service, key, legacy) {
  const aws = bundle && findBundleValue(bundle, { service, key, envName });
  const local = fallback(envName) || (legacy ? fallback(legacy) : null);
  console.log(JSON.stringify({ variable: envName, awsRecordPresent: Boolean(aws), fallbackPresent: Boolean(local), selectedSource: aws ? 'aws' : local ? 'netlify' : 'missing' }));
  return aws || local;
}
const access = selected('PORTABASE_SQUARE_ACCESS_TOKEN', 'portabase-square', 'access_token', 'SQUARE_ACCESS_TOKEN');
const location = selected('PORTABASE_SQUARE_LOCATION_ID', 'portabase-square', 'location_id', 'SQUARE_LOCATION_ID');
for (const [name, service, key] of [
  ['PORTABASE_MAILGUN_API_KEY', 'portabase-mailgun', 'api_key'],
  ['PORTABASE_MAILGUN_DOMAIN', 'portabase-mailgun', 'domain'],
  ['PORTABASE_MAILGUN_FROM', 'portabase-mailgun', 'from'],
  ['PORTABASE_TWILIO_ACCOUNT_SID', 'portabase-twilio', 'account_sid'],
  ['PORTABASE_TWILIO_AUTH_TOKEN', 'portabase-twilio', 'auth_token'],
  ['PORTABASE_TWILIO_MESSAGING_SERVICE_SID', 'portabase-twilio', 'messaging_service_sid'],
]) selected(name, service, key);
if (access && location) {
  const mode = (fallback('SQUARE_ENVIRONMENT') || fallback('SQUARE_ENV')) === 'sandbox' ? 'sandbox' : 'production';
  const host = mode === 'sandbox' ? 'connect.squareupsandbox.com' : 'connect.squareup.com';
  const response = await fetch(`https://${host}/v2/locations/${encodeURIComponent(location)}`, {
    headers: { Authorization: `Bearer ${access}`, 'Square-Version': '2026-05-20' },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ squareEffectiveProbe: { mode, httpStatus: response.status,
    configuredLocationMatches: body.location?.id === location, active: body.location?.status === 'ACTIVE' } }));
}
