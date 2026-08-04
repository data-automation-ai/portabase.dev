import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AWS_CLOUD_VERSION_ENABLED,
  DEFAULT_CLOUD_VERSION,
  listCloudVersions,
  normalizeCloudVersion,
  isSupabaseOnlyLaunch,
} from '../src/lib/cloud-versions.js';

test('launch flag: AWS Cloud version disabled', () => {
  assert.equal(AWS_CLOUD_VERSION_ENABLED, false);
  assert.equal(isSupabaseOnlyLaunch(), true);
  assert.equal(DEFAULT_CLOUD_VERSION, 'supabase');
});

test('normalize forces aws/cognito to supabase when launch-disabled', () => {
  assert.equal(normalizeCloudVersion('supabase'), 'supabase');
  assert.equal(normalizeCloudVersion('aws'), 'supabase');
  assert.equal(normalizeCloudVersion('cognito'), 'supabase');
  assert.equal(normalizeCloudVersion('AWS'), 'supabase');
  assert.equal(normalizeCloudVersion('nope'), 'supabase');
  assert.equal(normalizeCloudVersion(null, null), null);
});

test('listCloudVersions is Supabase-only at launch', () => {
  const list = listCloudVersions();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'supabase');
  assert.equal(list[0].launch, true);
});

test('subscription store key namespaces by version', () => {
  const userId = 'user-123';
  assert.equal(`supabase:${userId}`, 'supabase:user-123');
  assert.equal(`aws:${userId}`, 'aws:user-123');
  assert.notEqual(`supabase:${userId}`, `aws:${userId}`);
});
