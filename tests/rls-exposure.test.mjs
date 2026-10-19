import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isServiceRoleKey } from '../src/lib/live-supabase.js';

test('isServiceRoleKey identifies service_role vs anon and publishable keys', () => {
  assert.equal(isServiceRoleKey(''), false);
  assert.equal(isServiceRoleKey(null), false);
  assert.equal(isServiceRoleKey('sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL'), false);

  // Generate synthetic base64 anon JWT
  const anonPayload = Buffer.from(JSON.stringify({ role: 'anon', exp: 1999999999 })).toString('base64url');
  const anonJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${anonPayload}.fakesig`;
  assert.equal(isServiceRoleKey(anonJwt), false);

  // Generate synthetic base64 service_role JWT
  const servicePayload = Buffer.from(JSON.stringify({ role: 'service_role', exp: 1999999999 })).toString('base64url');
  const serviceJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${servicePayload}.fakesig`;
  assert.equal(isServiceRoleKey(serviceJwt), true);
});

test('control plane schemas lock down anon access and alter default privileges', () => {
  const schema1 = readFileSync(new URL('../supabase/cloud/0001_control_plane.sql', import.meta.url), 'utf8');
  assert.match(schema1, /alter table portabase_cloud\.profiles enable row level security;/);
  assert.match(schema1, /revoke all on schema portabase_cloud from public, anon, authenticated;/);
  assert.match(schema1, /revoke all on all tables in schema portabase_cloud from public, anon, authenticated;/);
  assert.match(schema1, /revoke all on all sequences in schema portabase_cloud from public, anon, authenticated;/);
  assert.match(schema1, /alter default privileges in schema portabase_cloud revoke all on tables from public, anon, authenticated;/);

  const schema3 = readFileSync(new URL('../supabase/cloud/0003_essentials.sql', import.meta.url), 'utf8');
  assert.match(schema3, /alter table portabase_cloud\.subscribers enable row level security;/);
  assert.match(schema3, /revoke all on schema portabase_cloud from public, anon, authenticated;/);
  assert.match(schema3, /revoke all on all tables in schema portabase_cloud from public, anon, authenticated;/);
  assert.match(schema3, /alter default privileges in schema portabase_cloud revoke all on tables from public, anon, authenticated;/);
});

test('portabase CLI wires rls-check and inspects RLS enforcement in doctor', () => {
  const help = spawnSync(process.execPath, ['utility/portabase.mjs', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /rls-check\s+Audit table RLS enforcement/);

  const cliSrc = readFileSync(new URL('../utility/portabase.mjs', import.meta.url), 'utf8');
  assert.match(cliSrc, /async function rlsCheckCommand\(\)/);
  assert.match(cliSrc, /else if \(command === 'rls-check'\) await rlsCheckCommand\(\);/);
  assert.match(cliSrc, /RLS OFF · ANON EXPOSED/);
  assert.match(cliSrc, /Make sure anon access is not available to RLS tables/);
});

test('supabase viewer renders live anon exposure status and protection badges', () => {
  const viewerSrc = readFileSync(new URL('../src/console/supabase-viewer.jsx', import.meta.url), 'utf8');
  assert.match(viewerSrc, /Public Anon Access Active/);
  assert.match(viewerSrc, /Anon Access Blocked/);
  assert.match(viewerSrc, /Service Role Preview/);
});
