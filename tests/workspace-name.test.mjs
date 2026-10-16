import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorkspaceName, sanitizeWorkspaceName } from '../src/console/data/store.js';

test('deriveWorkspaceName never names free/personal email providers as recovery', () => {
  // Free consumer email with handle
  assert.equal(deriveWorkspaceName({ email: 'alice@gmail.com' }), "alice's workspace");
  assert.equal(deriveWorkspaceName({ email: 'bob@outlook.com' }), "bob's workspace");
  assert.equal(deriveWorkspaceName({ email: 'carol@yahoo.com' }), "carol's workspace");
  assert.equal(deriveWorkspaceName({ email: 'dave@icloud.com' }), "dave's workspace");
  assert.equal(deriveWorkspaceName({ email: 'eve@proton.me' }), "eve's workspace");

  // User with custom domain
  assert.equal(deriveWorkspaceName({ email: 'ops@acmeprod.com' }), 'acmeprod workspace');

  // User with full name
  assert.equal(deriveWorkspaceName({ email: 'rfiddomains@gmail.com', name: 'Louis Capece' }), "Louis Capece's workspace");

  // Fallback
  assert.equal(deriveWorkspaceName({}), 'Portabase Workspace');
});

test('sanitizeWorkspaceName automatically fixes legacy recovery names from cached localStorage', () => {
  assert.equal(
    sanitizeWorkspaceName('gmail recovery', { email: 'rfiddomains@gmail.com', name: 'Louis Capece' }),
    "Louis Capece's workspace"
  );
  assert.equal(
    sanitizeWorkspaceName('gmail recovery', { email: 'rfiddomains@gmail.com' }),
    "rfiddomains's workspace"
  );
  assert.equal(
    sanitizeWorkspaceName('outlook recovery', { email: 'user@outlook.com' }),
    "user's workspace"
  );
  assert.equal(
    sanitizeWorkspaceName('Production recovery', {}),
    'Portabase Workspace'
  );
  assert.equal(
    sanitizeWorkspaceName('My Custom Team', {}),
    'My Custom Team'
  );
});
