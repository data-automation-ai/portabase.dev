const test = require('node:test');
const assert = require('node:assert/strict');
const { projectInput, selectAdminKey, listOrganizations, createProject, projectCredentials } = require('../desktop/provisioning.cjs');

function response(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
}

test('provisioning validates customer-controlled project inputs', () => {
  assert.equal(projectInput({ name: 'Recovery', organizationSlug: 'my-org', region: 'us-east-1', dbPassword: 'very-long-password' }).region, 'us-east-1');
  assert.throws(() => projectInput({ name: 'x', organizationSlug: 'my-org', region: 'us-east-1', dbPassword: 'very-long-password' }), /Project name/);
  assert.throws(() => projectInput({ name: 'Recovery', organizationSlug: 'my-org', region: 'moon-1', dbPassword: 'very-long-password' }), /region/);
});

test('provisioning selects either legacy service-role or modern secret key', () => {
  assert.equal(selectAdminKey([{ name: 'anon', api_key: 'public' }, { name: 'service_role', api_key: 'admin' }]), 'admin');
  assert.equal(selectAdminKey([{ type: 'publishable', api_key: 'public' }, { type: 'secret', api_key: 'secret' }]), 'secret');
});

test('organization discovery returns only safe display fields', async () => {
  const found = await listOrganizations('a'.repeat(24), () => response([{ id: '1', slug: 'my-org', name: 'Mine', secret: 'omit' }]));
  assert.deepEqual(found, [{ id: '1', slug: 'my-org', name: 'Mine' }]);
});

test('project creation sends credentials only to Supabase Management API request body', async () => {
  let request;
  const created = await createProject('a'.repeat(24), { name: 'Recovery', organizationSlug: 'my-org', region: 'us-east-1', dbPassword: 'very-long-password' }, async (url, options) => {
    request = { url, options };
    return response({ ref: 'abcdefghijklmnopqrst', status: 'COMING_UP' });
  });
  assert.equal(request.url, 'https://api.supabase.com/v1/projects');
  assert.equal(JSON.parse(request.options.body).db_pass, 'very-long-password');
  assert.deepEqual(created, { ref: 'abcdefghijklmnopqrst', url: 'https://abcdefghijklmnopqrst.supabase.co', status: 'COMING_UP' });
});

test('credential preparation builds a TLS database URL and returns an administrator key', async () => {
  const fetcher = url => url.includes('api-keys') ? response([{ type: 'secret', api_key: 'sb_secret_example' }]) : response({ status: 'ACTIVE_HEALTHY', database: { host: 'db.example.supabase.co' } });
  const result = await projectCredentials('a'.repeat(24), 'abcdefghijklmnopqrst', 'very-long-password', fetcher);
  assert.equal(result.adminKey, 'sb_secret_example');
  assert.match(result.dbUrl, /^postgresql:\/\/postgres:very-long-password@db\.example\.supabase\.co:5432\/postgres\?sslmode=require$/);
});
