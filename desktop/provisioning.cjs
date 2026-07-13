const MANAGEMENT_API = 'https://api.supabase.com/v1';
const REGIONS = new Set(['ap-east-1','ap-northeast-1','ap-northeast-2','ap-south-1','ap-southeast-1','ap-southeast-2','ca-central-1','eu-central-1','eu-central-2','eu-north-1','eu-west-1','eu-west-2','eu-west-3','sa-east-1','us-east-1','us-east-2','us-west-1','us-west-2']);

function accessToken(value) {
  const token = String(value || '').trim();
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) throw new Error('Enter a valid Supabase Personal Access Token.');
  return token;
}

async function request(endpoint, token, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${MANAGEMENT_API}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${accessToken(token)}`, 'Content-Type': 'application/json', ...(options.headers || {}) }, signal: options.signal || AbortSignal.timeout(30000) });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`Supabase provisioning request failed: ${String(body.message || body.error || body.msg || `HTTP ${response.status}`).slice(0, 300)}`);
  return body;
}

async function listOrganizations(token, fetchImpl) {
  const organizations = await request('/organizations', token, {}, fetchImpl);
  if (!Array.isArray(organizations)) throw new Error('Supabase returned an invalid organization list.');
  return organizations.map(item => ({ id: String(item.id || ''), slug: String(item.slug || item.id || ''), name: String(item.name || item.slug || item.id || '') })).filter(item => item.slug && item.name);
}

async function listProjects(token, fetchImpl) {
  const projects = await request('/projects', token, {}, fetchImpl);
  if (!Array.isArray(projects)) throw new Error('Supabase returned an invalid project list.');
  return projects
    .map(item => ({
      ref: String(item.ref || item.id || ''),
      name: String(item.name || item.ref || ''),
      status: String(item.status || 'UNKNOWN'),
      region: String(item.region || ''),
      organizationId: String(item.organization_id || ''),
    }))
    .filter(item => /^[a-z0-9]{20}$/.test(item.ref) && item.name);
}

function projectInput(input) {
  const name = String(input?.name || '').trim(), organizationSlug = String(input?.organizationSlug || '').trim(), region = String(input?.region || '').trim(), dbPassword = String(input?.dbPassword || '');
  if (name.length < 3 || name.length > 80) throw new Error('Project name must be between 3 and 80 characters.');
  if (!/^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/i.test(organizationSlug)) throw new Error('Choose a Supabase organization.');
  if (!REGIONS.has(region)) throw new Error('Choose a supported Supabase region.');
  if (dbPassword.length < 12 || dbPassword.length > 128) throw new Error('Use a database password between 12 and 128 characters.');
  return { name, organizationSlug, region, dbPassword };
}

async function createProject(token, input, fetchImpl) {
  const clean = projectInput(input);
  const project = await request('/projects', token, { method: 'POST', body: JSON.stringify({ name: clean.name, organization_slug: clean.organizationSlug, db_pass: clean.dbPassword, region: clean.region }) }, fetchImpl);
  const ref = String(project.ref || project.id || '');
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('Supabase created the project but did not return a valid project reference. Open the dashboard to continue.');
  return { ref, url: `https://${ref}.supabase.co`, status: String(project.status || 'CREATING') };
}

function selectAdminKey(keys) {
  if (!Array.isArray(keys)) return '';
  const key = keys.find(item => item.name === 'service_role') || keys.find(item => item.type === 'secret') || keys.find(item => item.name === 'secret');
  return String(key?.api_key || '');
}

async function projectCredentials(token, ref, dbPassword, fetchImpl) {
  const projectRef = String(ref || '').trim();
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('Enter the new 20-character project reference.');
  if (String(dbPassword || '').length < 12) throw new Error('Re-enter the new project database password.');
  const [project, keys] = await Promise.all([request(`/projects/${projectRef}`, token, {}, fetchImpl), request(`/projects/${projectRef}/api-keys?reveal=true`, token, {}, fetchImpl)]);
  const adminKey = selectAdminKey(keys);
  if (!adminKey) throw new Error('The project exists, but its administrator API key is not ready yet. Wait a minute and refresh credentials.');
  const host = String(project.database?.host || `db.${projectRef}.supabase.co`);
  return { ref: projectRef, status: String(project.status || 'UNKNOWN'), url: `https://${projectRef}.supabase.co`, dbUrl: `postgresql://postgres:${encodeURIComponent(String(dbPassword))}@${host}:5432/postgres?sslmode=require`, adminKey };
}

module.exports = { REGIONS, listOrganizations, createProject, projectCredentials, projectInput, selectAdminKey };
