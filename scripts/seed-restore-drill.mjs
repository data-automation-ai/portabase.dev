#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';

const base = String(process.env.SUPABASE_URL || '').replace(/\/(rest|storage)\/v1\/?$/, '');
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(base) || key.length < 20) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');

const headers = { apikey: key };
async function request(path, options = {}, accepted = [200, 201]) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!accepted.includes(response.status)) throw new Error(`${path} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  try { return text ? JSON.parse(text) : {}; } catch { return text; }
}

const userList = await request('/auth/v1/admin/users?page=1&per_page=1000');
const users = Array.isArray(userList?.users) ? userList.users : [];
if (users.some(user => user?.user_metadata?.fixture === 'portabase_restore_drill')) throw new Error('Synthetic Auth user already exists; refusing to overwrite the fixture.');

const authUser = await request('/auth/v1/admin/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'portabase-restore-drill@example.invalid', password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { fixture: 'portabase_restore_drill' } }),
});

const buckets = [
  { id: 'portabase-drill-private', name: 'portabase-drill-private', public: false, file_size_limit: 1048576, allowed_mime_types: ['text/plain', 'application/json'] },
  { id: 'portabase-drill-media', name: 'portabase-drill-media', public: false, file_size_limit: 1048576, allowed_mime_types: ['text/plain', 'application/json', 'image/svg+xml'] },
];
for (const bucket of buckets) await request('/storage/v1/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bucket) });

const objects = [
  ['portabase-drill-private', 'notes/readme.txt', 'PortaBase restore drill\n', 'text/plain'],
  ['portabase-drill-private', 'orders/sample.json', '{"order":"20000000-0000-4000-8000-000000000001","status":"paid"}\n', 'application/json'],
  ['portabase-drill-private', 'nested/deep/check.txt', 'nested-object-ok\n', 'text/plain'],
  ['portabase-drill-media', 'status.json', '{"fixture":"portabase_restore_drill","ok":true}\n', 'application/json'],
  ['portabase-drill-media', 'hello.txt', 'hello from customer-owned storage\n', 'text/plain'],
  ['portabase-drill-media', 'pixel.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#3ecf8e"/></svg>\n', 'image/svg+xml'],
];
for (const [bucket, name, body, contentType] of objects) {
  await request(`/storage/v1/object/${bucket}/${name.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'false' }, body });
}

console.log(JSON.stringify({
  authUserCreated: Boolean(authUser?.id),
  buckets: buckets.map(bucket => bucket.id),
  objects: objects.map(([bucket, name, body, contentType]) => ({ bucket, name, bytes: Buffer.byteLength(body), contentType, sha256: createHash('sha256').update(body).digest('hex') })),
}, null, 2));
