import test from 'node:test';
import assert from 'node:assert/strict';
import { providerCommand, safeObjectPath } from './portabase.mjs';

test('safeObjectPath accepts nested object names', () => {
  assert.match(safeObjectPath('avatars/user/photo.jpg'), /avatars.+user.+photo\.jpg/);
});

test('safeObjectPath blocks traversal', () => {
  assert.throws(() => safeObjectPath('../secret.txt'), /Unsafe object path/);
});

test('AWS upload command targets the customer bucket', () => {
  const [command, args] = providerCommand({ provider: { type: 'aws', bucket: 'customer-vault', prefix: 'prod' } }, 'C:\\capsule');
  assert.equal(command, 'aws');
  assert.ok(args.some(value => String(value).includes('s3://customer-vault/prod/')));
});

test('Dropbox upload uses customer rclone remote', () => {
  const [command, args] = providerCommand({ provider: { type: 'dropbox', remote: 'mydropbox', path: '/Portabase' } }, '/tmp/capsule');
  assert.equal(command, 'rclone');
  assert.ok(args.some(value => String(value).startsWith('mydropbox:')));
});
