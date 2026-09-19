import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_DECRYPT,
  allowlistedCapsuleMeta,
  assertPassphraseStaysLocal,
  classifyLocalFile,
  cliOpenHints,
  inspectLocalFile,
  inspectNeverShows,
} from '../src/lib/capsule-inspect.js';

function fakeFile(name, text = '') {
  return {
    name,
    size: Buffer.byteLength(text),
    text: async () => text,
  };
}

test('browser decrypt is honestly unsupported', () => {
  assert.equal(BROWSER_DECRYPT.supported, false);
  assert.match(BROWSER_DECRYPT.reason, /scrypt|stream/i);
  assert.match(BROWSER_DECRYPT.useInstead, /verify --.*decrypt/);
});

test('allowlistedCapsuleMeta keeps layer flags and strips inventory', () => {
  const meta = allowlistedCapsuleMeta({
    id: 'cap_1',
    status: 'COMPLETE',
    objectName: 'avatars/secret.jpg',
    tableRows: [{ id: 1 }],
    contents: {
      database: { complete: true },
      storage: { complete: true },
      functions: { complete: false },
      auth: { complete: true },
      tables: ['users', 'orders'],
    },
    encryption: { format: 'portabase-aes256gcm-v1' },
  });
  const json = JSON.stringify(meta);
  assert.equal(meta.id, 'cap_1');
  assert.equal(meta.layers.database, true);
  assert.equal(meta.layers.storage, true);
  assert.equal(meta.plaintextIncluded, false);
  assert.equal(meta.secretsIncluded, false);
  assert.doesNotMatch(json, /avatars|secret\.jpg|users|orders|tableRows/);
});

test('inspectLocalFile reads capsule.json metadata only and refuses unknown files', async () => {
  const json = await inspectLocalFile(fakeFile('capsule.json', JSON.stringify({
    id: 'cap_local',
    status: 'COMPLETE',
    contents: { database: { complete: true } },
    objectName: 'bucket/hidden.bin',
  })));
  assert.equal(json.opened, true);
  assert.equal(json.meta.id, 'cap_local');
  assert.equal(json.meta.layers.database, true);
  assert.doesNotMatch(JSON.stringify(json), /hidden\.bin/);

  const sealed = await inspectLocalFile(fakeFile('capsule.pbase', 'ciphertext'));
  assert.equal(sealed.kind, 'pbase');
  assert.equal(sealed.opened, false);
  assert.equal(sealed.decrypt.supported, false);

  await assert.rejects(() => inspectLocalFile(fakeFile('notes.txt', 'hi')), /cannot open/i);
  assert.equal(classifyLocalFile({ name: 'x.pbase', size: 9 }).kind, 'pbase');
});

test('CLI open path never embeds a passphrase and never-shows inventory', () => {
  const hints = cliOpenHints('./capsules/demo');
  assert.match(hints, /PORTABASE_ENCRYPTION_PASSPHRASE/);
  assert.match(hints, /verify --capsule \.\/capsules\/demo --decrypt/);
  assert.match(hints, /never sees the passphrase/);
  assert.doesNotMatch(hints, /correct horse/);
  assert.equal(assertPassphraseStaysLocal('sixteen chars ok!!').postedToCloud, false);
  assert.throws(() => assertPassphraseStaysLocal('short'), /16/);
  assert.ok(inspectNeverShows().some((item) => /object names/i.test(item)));
});
