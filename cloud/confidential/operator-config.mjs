// Operator tooling only. Never bundle into browser code or runner images.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export const SITE_ID = '794217cc-42ab-4a9f-81da-06a661403573';
export const PROJECT = 'portabase-dev';
export const PROJECT_NUMBER = '495102144848';
export const ACCOUNT = 'rfiddomains@gmail.com';
export const REGION = 'us-central1';
export const AUTH_REF = 'eoiqvdmvgaurlecdzqkp';
export async function operatorConfig() {
  const config = JSON.parse(await readFile(join(process.env.APPDATA, 'netlify/Config/config.json'), 'utf8'));
  const token = config.users?.[config.userId]?.auth?.token;
  if (!token) throw new Error('operator_netlify_login_required');
  const netlify = async (path, options = {}) => {
    const r = await fetch(`https://api.netlify.com/api/v1${path}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...options.headers },
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`netlify_http_${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  const site = await netlify(`/sites/${SITE_ID}`);
  if (site.id !== SITE_ID || site.custom_domain !== 'portabase.dev' || site.name !== 'portabase-dev') throw new Error('site_identity_mismatch');
  const rows = await netlify(`/accounts/${site.account_id}/env?site_id=${SITE_ID}`);
  const value = name => {
    const row = rows.find(x => x.key === name);
    return row?.values?.find(x => x.context === 'production')?.value || row?.values?.find(x => x.context === 'all')?.value;
  };
  const supabase = async (path, options = {}) => {
    const access = value('SUPABASE_MANAGEMENT_TOKEN');
    if (!access) throw new Error('operator_supabase_access_missing');
    const r = await fetch(`https://api.supabase.com/v1${path}`, {
      ...options, headers: { Authorization: `Bearer ${access}`, 'content-type': 'application/json', ...options.headers },
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`supabase_http_${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  return { site, rows, value, netlify, supabase };
}
