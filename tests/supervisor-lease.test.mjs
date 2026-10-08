import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rename, link, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { acquireSupervisorLease, SUPERVISOR_LOCK_NAME } from '../cloud/runner/supervisor-lease.mjs';
import { runSupervisor } from '../cloud/runner/supervisor.mjs';

const runnerId = '11111111-1111-4111-8111-111111111111', owner = 'a'.repeat(64), origin = 'https://cloud.example.test';
async function fixture(t) {
  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const parent = await mkdtemp(join(tmpdir(), 'portabase-supervisor-lease-test-')), directory = join(parent, 'private');
  await mkdir(directory);
  t.after(async () => {
    const path = resolve(parent), base = resolve(tmpdir());
    assert.ok(path.startsWith(`${base}${sep}`) && basename(path).startsWith('portabase-supervisor-lease-test-'));
    await rm(path, { recursive: true, force: true });
  });
  const options = { directory, owner, runnerId, origin };
  const env = { PORTABASE_RUNNER_CONFIG_DIR: directory, PORTABASE_RUNNER_ID: runnerId, PORTABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
    PORTABASE_CLOUD_URL: origin, PORTABASE_AGENT_TOKEN: `pb_agent_${owner}_0_${'b'.repeat(64)}` };
  return { parent, directory, options, env, path: join(directory, SUPERVISOR_LOCK_NAME) };
}

test('exclusive root lease refuses every second owner and only its own handle can release it', async t => {
  const f = await fixture(t), first = await acquireSupervisorLease(f.options);
  const bytes = await readFile(f.path);
  const attempts = await Promise.allSettled([
    acquireSupervisorLease(f.options), acquireSupervisorLease({ ...f.options, owner: 'c'.repeat(64) }),
    acquireSupervisorLease({ ...f.options, runnerId: '22222222-2222-4222-8222-222222222222' }),
  ]);
  assert.ok(attempts.every(result => result.status === 'rejected' && result.reason.code === 'supervisor_lease_review_required'));
  assert.deepEqual(await readFile(f.path), bytes); await first.assertOwned(); await first.release(); await first.release();
  await assert.rejects(readFile(f.path), { code: 'ENOENT' });
  const next = await acquireSupervisorLease(f.options); await next.release();
});

test('stale, malformed, symlink and hardlinked locks are never stolen or modified', async t => {
  for (const mode of ['stale', 'malformed', 'symlink', 'hardlink']) {
    const f = await fixture(t), target = join(f.parent, 'retained');
    await writeFile(target, 'must-remain-unchanged');
    if (mode === 'symlink' && process.platform === 'win32') {
      const linkedDirectory = join(f.parent, 'linked'); await mkdir(linkedDirectory);
      await symlink(linkedDirectory, f.path, 'junction');
      await assert.rejects(acquireSupervisorLease(f.options), { code: 'supervisor_lease_review_required' });
      assert.equal(await readFile(target, 'utf8'), 'must-remain-unchanged');
      continue;
    }
    if (mode === 'symlink') await symlink(target, f.path);
    else if (mode === 'hardlink') await link(target, f.path);
    else await writeFile(f.path, mode === 'stale' ? JSON.stringify({ pid: 99999999, acquiredAt: '1970-01-01T00:00:00Z' }) : '');
    const original = await readFile(f.path);
    await assert.rejects(acquireSupervisorLease(f.options), { code: 'supervisor_lease_review_required' });
    assert.deepEqual(await readFile(f.path), original); assert.equal(await readFile(target, 'utf8'), 'must-remain-unchanged');
  }
});

test('root, lock identity, content and link changes block cleanup without deleting replacement files', async t => {
  for (const mode of ['root', 'lock', 'content', 'hardlink', 'root-link']) {
    const f = await fixture(t), lease = await acquireSupervisorLease(f.options);
    if (mode === 'root' || mode === 'root-link') {
      try { await rename(f.directory, join(f.parent, 'original-root')); }
      catch (error) {
        // Windows may prohibit replacing an ancestor of the held descriptor.
        assert.equal(process.platform, 'win32'); assert.equal(error.code, 'EPERM');
        await lease.assertOwned(); await lease.release(); continue;
      }
      if (mode === 'root-link') {
        const destination = join(f.parent, 'other-root'); await mkdir(destination);
        await symlink(destination, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
      } else await mkdir(f.directory);
      await writeFile(f.path, 'replacement-owner');
    } else if (mode === 'lock') {
      try { await rename(f.path, join(f.directory, 'original-lock')); }
      catch (error) {
        assert.equal(process.platform, 'win32'); assert.equal(error.code, 'EPERM');
        await lease.assertOwned(); await lease.release(); continue;
      }
      await writeFile(f.path, 'replacement-owner');
    }
    else if (mode === 'content') await writeFile(f.path, 'replacement-owner');
    else await link(f.path, join(f.directory, 'lock-alias'));
    const before = await readFile(f.path);
    await assert.rejects(lease.assertOwned(), { code: 'supervisor_lease_review_required' });
    await assert.rejects(lease.release(), { code: 'supervisor_lease_review_required' });
    assert.deepEqual(await readFile(f.path), before);
  }
});

test('unsafe private roots are refused and an existing lease halts supervisor before any pull', async t => {
  const f = await fixture(t), lease = await acquireSupervisorLease(f.options), statuses = [];
  for (const directory of ['F:/forbidden', 'relative', '\\\\server\\share']) await assert.rejects(acquireSupervisorLease({ ...f.options, directory }));
  const alias = join(f.parent, 'root-alias');
  await symlink(f.directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(acquireSupervisorLease({ ...f.options, directory: alias }), { code: 'supervisor_lease_review_required' });
  const result = await runSupervisor({ env: f.env, pull: () => assert.fail('second supervisor must not claim'), onStatus: row => statuses.push(row) });
  assert.deepEqual(result, { state: 'halted', reason: 'supervisor_lease_review_required', polls: 0 });
  assert.deepEqual(statuses, [{ state: 'halted', reason: 'supervisor_lease_review_required' }]);
  await lease.release();
});

function startProcess(t, env, hold) {
  const url = new URL('../cloud/runner/supervisor.mjs', import.meta.url).href;
  const script = `import {runSupervisor} from ${JSON.stringify(url)};
    const controller=new AbortController(); let release;
    process.on('message', message=>{if(message==='stop'){controller.abort();release?.();}});
    try {
      const result=await runSupervisor({env:${JSON.stringify(env)},signal:controller.signal,
        fetchImpl:()=>{throw new Error('provider-forbidden');},
        pull:async()=>{process.send({state:'entered'});${hold ? 'await new Promise(resolve=>{release=resolve;});' : 'controller.abort();'}}});
      process.send({state:'result',result}); process.disconnect();
    } catch(error){process.send({state:'error',code:error.code});process.disconnect();process.exitCode=1;}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const messages = [], waiters = [];
  child.on('message', message => { messages.push(message); for (const notify of waiters.slice()) notify(); });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  return { child, exited, async message(state) {
    const present = messages.find(message => message.state === state); if (present) return present;
    return new Promise((resolveMessage, reject) => {
      const timer = setTimeout(() => { finish(); reject(new Error(`child did not report ${state}`)); }, 10000);
      const check = () => { const found = messages.find(message => message.state === state); if (found) { finish(); resolveMessage(found); }
        else if (messages.some(message => message.state === 'error')) { finish(); reject(new Error('synthetic child reported setup failure')); } };
      const onExit = () => { finish(); reject(new Error(`child exited before ${state}`)); };
      const finish = () => { clearTimeout(timer); child.removeListener('exit', onExit); const index = waiters.indexOf(check); if (index >= 0) waiters.splice(index, 1); };
      waiters.push(check); child.once('exit', onExit); check();
    });
  } };
}

test('real processes exclude concurrent supervisors and clean shutdown permits a later owner', async t => {
  const f = await fixture(t), first = startProcess(t, f.env, true);
  await first.message('entered');
  const competitors = [startProcess(t, f.env, false), startProcess(t, f.env, false)];
  for (const competitor of competitors) {
    const { result } = await competitor.message('result');
    assert.deepEqual(result, { state: 'halted', reason: 'supervisor_lease_review_required', polls: 0 });
    await competitor.exited;
  }
  first.child.send('stop'); assert.equal((await first.message('result')).result.state, 'stopped'); await first.exited;
  await assert.rejects(readFile(f.path), { code: 'ENOENT' });
  const later = startProcess(t, f.env, false);
  assert.equal((await later.message('result')).result.state, 'stopped'); await later.exited;
});

test('real process crash leaves lock intact and future supervisor requires manual review', async t => {
  const f = await fixture(t), first = startProcess(t, f.env, true);
  await first.message('entered'); const bytes = await readFile(f.path);
  first.child.kill('SIGKILL'); await first.exited;
  const later = startProcess(t, f.env, false);
  assert.equal((await later.message('result')).result.reason, 'supervisor_lease_review_required'); await later.exited;
  assert.deepEqual(await readFile(f.path), bytes);
});
