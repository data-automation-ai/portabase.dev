import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { packDirectoryTarGz } from '../utility/portabase-core.mjs';

async function fixture(t, relativePath) {
  const root = await mkdtemp(join(tmpdir(), 'pb-tar-unicode-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'raw');
  const parts = relativePath.split('/');
  await mkdir(join(source, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(join(source, ...parts), 'synthetic');
  return { source, archive: join(root, 'fixture.tar.gz') };
}

test('ustar preserves valid multibyte prefix and filename without field corruption', async t => {
  const name = `${'é'.repeat(60)}/${'界'.repeat(30)}.txt`;
  const { source, archive } = await fixture(t, name);
  await packDirectoryTarGz(source, archive);
  const tar = gunzipSync(await readFile(archive));
  const field = (start, end) => tar.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
  assert.equal(`${field(345, 500)}/${field(0, 100)}`, name);
  assert.equal(field(100, 108), '0000644');
  assert.equal(field(257, 263), 'ustar');
  assert.equal(tar.subarray(512, 521).toString(), 'synthetic');
});

for (const [label, name] of [
  ['oversized multibyte basename', `dir/${'界'.repeat(35)}.txt`],
  ['oversized multibyte prefix', `${'é'.repeat(80)}/file.txt`],
]) {
  test(`ustar rejects ${label} before creating an archive`, async t => {
    const { source, archive } = await fixture(t, name);
    await assert.rejects(packDirectoryTarGz(source, archive), /Path too long for ustar/);
    await assert.rejects(access(archive), { code: 'ENOENT' });
  });
}
