import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROVABLY_ZERO_KNOWLEDGE,
  ZK_COPY,
  assertNoIdentifyingInventory,
  cloudCapsuleView,
  hasServerDecryptPath,
  looksLikeStorageObjectPath,
  stripIdentifyingInventory,
} from '../utility/zero-knowledge.mjs';
import { seedWorkspace } from '../src/console/data/store.js';
import { buildTelemetryEvent } from '../utility/telemetry.mjs';

test('product law flags and copy are explicit', () => {
  assert.equal(PROVABLY_ZERO_KNOWLEDGE, true);
  assert.equal(hasServerDecryptPath(), false);
  assert.match(ZK_COPY.headline, /Provably zero-knowledge/i);
  assert.match(ZK_COPY.cannotSee, /object names/i);
  assert.match(ZK_COPY.architecture, /no server-side decrypt/i);
});

test('demo workspace seed has no Storage object names or secret keys', () => {
  const seed = seedWorkspace({ email: 'demo@portabase.dev' });
  assert.doesNotThrow(() => assertNoIdentifyingInventory(seed));
  const json = JSON.stringify(seed);
  assert.doesNotMatch(json, /s3:\/\//);
  assert.doesNotMatch(json, /avatars\/|secret\.jpg|this-must-not-appear/);
  assert.doesNotMatch(json, /passphrase|service_role/);
});

test('cloud capsule view keeps management metadata and drops inventory', () => {
  const view = cloudCapsuleView({
    id: 'cap_1',
    status: 'COMPLETE',
    sizeBytes: 100,
    objectName: 'avatars/secret.jpg',
    tableRows: [{ id: 1 }],
    layers: { database: true, storage: true, secrets: true },
  });
  assert.equal(view.id, 'cap_1');
  assert.equal(view.sizeBytes, 100);
  assert.equal(view.layers.database, true);
  assert.equal(view.objectName, undefined);
  assert.equal(view.layers.secrets, undefined);
});

test('strip and path detector withhold identifying inventory', () => {
  assert.equal(looksLikeStorageObjectPath('avatars/secret.jpg'), true);
  assert.equal(looksLikeStorageObjectPath('s3'), false);
  const stripped = stripIdentifyingInventory({
    objectName: 'avatars/secret.jpg',
    summary: 'ok',
    nested: { filePath: 'bucket/hidden.bin' },
  });
  assert.equal(stripped.objectName, undefined);
  assert.equal(stripped.nested.filePath, undefined);
  assert.equal(stripped.summary, 'ok');
});

test('Cloud ingest rejects object-name inventory', () => {
  assert.throws(() => buildTelemetryEvent({
    eventType: 'backup.completed',
    projectRef: 'abcdefghijklmnopqrst',
    payload: { objectName: 'avatars/secret.jpg' },
  }), /forbidden key/);
});

test('no Netlify function implements server-side decrypt', () => {
  const dir = join(process.cwd(), 'netlify/functions');
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.mjs')) continue;
    const src = readFileSync(join(dir, name), 'utf8');
    assert.doesNotMatch(name, /decrypt/i);
    assert.doesNotMatch(src, /export async function decryptCapsule|serverSideDecrypt|return plaintext/);
  }
});
