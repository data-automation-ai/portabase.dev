import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { enforceJobCapsuleLimit, jobCapsuleLimit, JOB_CAPSULE_LIMIT_ENV } from '../utility/job-capsule-limit.mjs';
import { transferCapsule } from '../utility/portabase.mjs';

async function fixture(t) {
  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const root = await mkdtemp(join(tmpdir(), 'portabase-byte-gate-'));
  t.after(async () => {
    const target = resolve(root), base = resolve(tmpdir());
    assert.ok(target.startsWith(`${base}${sep}`) && basename(target).startsWith('portabase-byte-gate-'));
    await rm(target, { recursive: true, force: true });
  });
  const capsule = join(root, 'capsule');
  await mkdir(join(capsule, 'nested'), { recursive: true });
  await writeFile(join(capsule, 'capsule.pbase'), Buffer.alloc(8));
  await writeFile(join(capsule, 'capsule.json'), '{}');
  await writeFile(join(capsule, 'nested', 'RECOVER.txt'), 'help');
  return { root, capsule, bytes: 14 };
}
function setCap(t, value) {
  const prior = process.env[JOB_CAPSULE_LIMIT_ENV];
  if (value === undefined) delete process.env[JOB_CAPSULE_LIMIT_ENV];
  else process.env[JOB_CAPSULE_LIMIT_ENV] = value;
  t.after(() => { if (prior === undefined) delete process.env[JOB_CAPSULE_LIMIT_ENV]; else process.env[JOB_CAPSULE_LIMIT_ENV] = prior; });
}
function mockTransports(t) {
  const calls = [];
  const spawn = childProcess.spawn, spawnSync = childProcess.spawnSync;
  childProcess.spawn = (command, args) => {
    calls.push({ operation: 'spawn', command, args });
    const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 0)); return child;
  };
  childProcess.spawnSync = (command, args) => {
    calls.push({ operation: 'spawnSync', command, args });
    return { status: 0, stdout: ['where.exe', 'which'].includes(command) ? 'fixture-provider\n' : '', stderr: '' };
  };
  syncBuiltinESMExports();
  t.after(() => { childProcess.spawn = spawn; childProcess.spawnSync = spawnSync; syncBuiltinESMExports(); });
  return calls;
}
const providers = [
  { type: 'aws', bucket: 'synthetic-no-network', prefix: 'fixture' },
  ...['dropbox', 'google-drive', 'rclone'].map(type => ({ type, remote: 'synthetic-no-network', path: 'fixture' })),
];

test('caps require canonical nonnegative safe integers; only absence disables enforcement', () => {
  assert.equal(jobCapsuleLimit({}), null);
  for (const value of ['0', '1', String(Number.MAX_SAFE_INTEGER)]) assert.equal(jobCapsuleLimit({ [JOB_CAPSULE_LIMIT_ENV]: value }), Number(value));
  for (const value of ['', ' ', '01', '-1', '-0', '+1', '1.0', '1e3', '1\n', ' 1', 'Infinity', 'NaN', '9007199254740992', null, 7]) {
    assert.throws(() => jobCapsuleLimit({ [JOB_CAPSULE_LIMIT_ENV]: value }), { code: 'invalid_job_capsule_limit' });
  }
});
test('complete ciphertext plus nested sidecars counts at exact boundary, not just capsule.pbase', async t => {
  const { capsule, bytes } = await fixture(t);
  assert.deepEqual(await enforceJobCapsuleLimit(capsule, { env: { [JOB_CAPSULE_LIMIT_ENV]: String(bytes) } }), { bytes, files: 3, maxBytes: bytes });
  for (const maxBytes of ['0', '8', '13']) await assert.rejects(enforceJobCapsuleLimit(capsule, { env: { [JOB_CAPSULE_LIMIT_ENV]: maxBytes } }), { code: 'job_capsule_limit_exceeded' });
  // An absent managed limit never touches or changes the standalone source path.
  assert.equal(await enforceJobCapsuleLimit('unused', { env: {}, filesystem: {} }), null);
});
test('actual transfer entry blocks every remote transport and local copy before side effects', async t => {
  const { root, capsule } = await fixture(t), calls = mockTransports(t);
  setCap(t, '13');
  const destination = join(root, 'vault');
  for (const provider of [...providers, { type: 'local', path: destination, maxBytes: 999999, allowLargeLocal: true }]) {
    await assert.rejects(transferCapsule({ provider }, capsule), { code: 'job_capsule_limit_exceeded' });
  }
  assert.deepEqual(calls, []);
  await assert.rejects(lstat(destination), { code: 'ENOENT' });
});
test('invalid managed cap cannot fall through to provider tooling or local override', async t => {
  const { capsule } = await fixture(t), calls = mockTransports(t);
  setCap(t, '1e9');
  for (const provider of [...providers, { type: 'local', allowLargeLocal: true }]) await assert.rejects(transferCapsule({ provider }, capsule), { code: 'invalid_job_capsule_limit' });
  assert.deepEqual(calls, []);
});
test('within-cap remote transfers reach only mocked transports; absent cap preserves standalone path', async t => {
  const { capsule, bytes } = await fixture(t), calls = mockTransports(t);
  setCap(t, String(bytes));
  for (const provider of providers) assert.equal((await transferCapsule({ provider }, capsule)).verified, true);
  assert.equal(calls.filter(call => call.operation === 'spawn' && (call.args[0] === 'copy' || (call.args[0] === 's3' && call.args[1] === 'sync'))).length, 4);
  assert.equal((await transferCapsule({ provider: { type: 'local', maxBytes: bytes } }, capsule)).bytes, bytes);
  delete process.env[JOB_CAPSULE_LIMIT_ENV];
  assert.equal((await transferCapsule({ provider: providers[0] }, capsule)).verified, true);
});
test('missing root, linked directories and special files fail closed', async t => {
  const { root, capsule } = await fixture(t), env = { [JOB_CAPSULE_LIMIT_ENV]: '999' };
  await assert.rejects(enforceJobCapsuleLimit(join(root, 'missing'), { env }), { code: 'job_capsule_size_unavailable' });
  const linked = join(capsule, 'linked');
  await symlink(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(enforceJobCapsuleLimit(capsule, { env }), { code: 'job_capsule_file_refused' });
  await assert.rejects(enforceJobCapsuleLimit(linked, { env }), { code: 'job_capsule_file_refused' });
  const fakeRoot = resolve('synthetic-capsule');
  const filesystem = {
    realpath: async path => path,
    readdir: async () => ['special-file'],
    lstat: async path => ({ isSymbolicLink: () => false, isDirectory: () => path === fakeRoot, isFile: () => false }),
  };
  await assert.rejects(enforceJobCapsuleLimit(fakeRoot, { env, filesystem }), { code: 'job_capsule_file_refused' });
});
test('unsafe filesystem byte counts cannot silently become zero or overflow', async () => {
  const root = resolve('synthetic-capsule'), env = { [JOB_CAPSULE_LIMIT_ENV]: String(Number.MAX_SAFE_INTEGER) };
  for (const size of [NaN, -1, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    const filesystem = { realpath: async path => path, readdir: async () => ['file'],
      lstat: async path => ({ isSymbolicLink: () => false, isDirectory: () => path === root, isFile: () => path !== root, size }) };
    await assert.rejects(enforceJobCapsuleLimit(root, { env, filesystem }), { code: 'job_capsule_size_unavailable' });
  }
});
