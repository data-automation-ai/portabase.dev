import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { runSupervisor, supervisorSettings, waitForPoll } from '../cloud/runner/supervisor.mjs';
import { pullOnce } from '../cloud/runner/worker.mjs';
import { createCompletionJournal, runnerJournalOwner } from '../cloud/runner/completion-journal.mjs';

const runnerId = '11111111-1111-4111-8111-111111111111', configRef = '33333333-3333-4333-8333-333333333333';
const error = code => Object.assign(new Error(`private-diagnostic-${code}`), { code });
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const claimed = (job, body) => ({ ok: true, job, claim: { protocol: 1,
  sequence: body.claimSequence, requestId: body.claimRequestId, runnerId } });
async function waitForStart(ready, running) {
  let timer;
  try {
    await Promise.race([ready, running.then(result => assert.fail(`Supervisor stopped before fixture started: ${result.reason || result.state}`)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Supervisor fixture did not start within 10 seconds')), 10000); })]);
  } finally { clearTimeout(timer); }
}
async function fixture(t) {
  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const directory = await mkdtemp(join(tmpdir(), 'portabase-supervisor-test-'));
  t.after(async () => {
    const root = resolve(directory), base = resolve(tmpdir());
    assert.ok(root.startsWith(`${base}${sep}`) && basename(root).startsWith('portabase-supervisor-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const env = { PORTABASE_CLOUD_URL: 'https://cloud.example.test',
    PORTABASE_AGENT_TOKEN: `pb_agent_${'a'.repeat(64)}_0_${'b'.repeat(64)}`, PORTABASE_RUNNER_CONFIG_DIR: directory,
    PORTABASE_RUNNER_ID: runnerId, PORTABASE_PROJECT_REF: 'abcdefghijklmnopqrst' };
  const job = { id: 'job_supervisor', version: 2, runnerId, type: 'backup', status: 'running',
    payload: { version: 2, runnerId, configRef, configRevision: 1 }, admission: { maxBytes: 1000, paid: false } };
  const engine = JSON.stringify({ projectRef: env.PORTABASE_PROJECT_REF, backupDirectory: 'backups', statusDirectory: 'status' });
  await mkdir(join(directory, configRef)); await writeFile(join(directory, 'engine.json'), engine);
  await writeFile(join(directory, configRef, '1.json'), JSON.stringify({ ...job.payload, operation: 'backup', projectRef: env.PORTABASE_PROJECT_REF,
    engineConfigPath: 'engine.json', engineConfigSha256: createHash('sha256').update(engine).digest('hex'),
    excludeTables: [], excludeBuckets: [], incrementalBinary: false }));
  return { env, job, directory, controller: new AbortController() };
}

test('timing options reject coercion/unbounded values and require bounded retry settings', () => {
  assert.deepEqual(supervisorSettings({}), { pollMs: 30000, retryBaseMs: 1000, retryMaxMs: 60000, requestTimeoutMs: 30000 });
  for (const key of ['PORTABASE_RUNNER_POLL_MS', 'PORTABASE_RUNNER_RETRY_BASE_MS', 'PORTABASE_RUNNER_RETRY_MAX_MS', 'PORTABASE_RUNNER_REQUEST_TIMEOUT_MS']) {
    for (const value of ['', '0', '-1', '01', '1000.0', '1e3', '999', '300001', '9007199254740992', 1000]) {
      assert.throws(() => supervisorSettings({ [key]: value }), { code: 'invalid_supervisor_settings' });
    }
  }
  assert.throws(() => supervisorSettings({ PORTABASE_RUNNER_RETRY_BASE_MS: '2000', PORTABASE_RUNNER_RETRY_MAX_MS: '1000' }));
});

test('persistent loop stays sequential and lifecycle output excludes returned job/private diagnostics', async t => {
  const f = await fixture(t), statuses = [], waits = []; let calls = 0, active = 0, peak = 0, release;
  let started; const ready = new Promise(resolve => { started = resolve; });
  const running = runSupervisor({ env: { ...f.env, PORTABASE_CLOUD_TOKEN: 'synthetic-customer-canary',
    portabase_cloud_token: 'synthetic-customer-canary' }, signal: f.controller.signal, onStatus: row => statuses.push(row),
    pull: async options => {
      assert.equal(Object.hasOwn(options, 'token'), false);
      assert.equal(Object.keys(options.env).some(key => /^PORTABASE_CLOUD_TOKEN$/i.test(key)), false);
      calls++; active++; peak = Math.max(peak, active);
      if (calls === 1) { started(); await new Promise(resolve => { release = resolve; }); }
      active--; return { job: { private: 'private-source-name' }, stdout: 'private-output' };
    }, wait: async delay => { waits.push(delay); if (calls === 2) f.controller.abort(); },
  });
  await waitForStart(ready, running); assert.equal(calls, 1); assert.equal(waits.length, 0); release();
  assert.deepEqual(await running, { state: 'stopped', polls: 2 });
  assert.equal(peak, 1); assert.deepEqual(waits, [30000, 30000]);
  assert.doesNotMatch(JSON.stringify(statuses), /private-|synthetic-customer|pb_agent|configRef|job_supervisor/);
});

test('bounded exponential backoff resets after success and contains jitter', async t => {
  const f = await fixture(t), waits = []; let calls = 0;
  await runSupervisor({ env: { ...f.env, PORTABASE_RUNNER_RETRY_MAX_MS: '4000' }, signal: f.controller.signal, random: () => 1,
    pull: async () => { calls++; if (calls !== 5) throw error('job_service_unavailable'); },
    wait: async delay => { waits.push(delay); if (waits.length === 6) f.controller.abort(); },
  });
  assert.deepEqual(waits, [1000, 2000, 4000, 4000, 30000, 1000]);
});

test('shutdown interrupts a referenced idle timer without waiting for its deadline', async () => {
  const controller = new AbortController(), waiting = waitForPoll(60000, controller.signal);
  controller.abort(); await waiting;
  await waitForPoll(60000, controller.signal);
});

test('shutdown drains a running child and completion report before stopping', async t => {
  const f = await fixture(t), requests = []; let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const running = runSupervisor({ env: f.env, signal: f.controller.signal,
    fetchImpl: async (_, init) => {
      const body = JSON.parse(init.body); requests.push(body.type);
      return response(200, body.type === 'claim' ? claimed(f.job, body) : { ok: true, job: { ...f.job, status: body.status, safeError: body.safeError } });
    }, spawnImpl: async () => { started(); await new Promise(resolve => { release = resolve; }); return { code: 0 }; },
    wait: async () => assert.fail('shutdown cannot begin another wait'),
  });
  await waitForStart(ready, running); f.controller.abort(); assert.deepEqual(requests, ['claim']); release();
  assert.deepEqual(await running, { state: 'stopped', polls: 1 });
  assert.deepEqual(requests, ['claim', 'finish']);
});

test('abort during pending report drains acknowledgement and never begins a claim', async t => {
  const f = await fixture(t), requests = [];
  const journal = await createCompletionJournal({ directory: f.directory, owner: runnerJournalOwner(f.env.PORTABASE_AGENT_TOKEN), runnerId, origin: f.env.PORTABASE_CLOUD_URL });
  const binding = await journal.start(f.job);
  await journal.finish(binding, { type: 'finish', version: 2, runnerId, jobId: f.job.id, status: 'succeeded', safeError: null });
  const result = await runSupervisor({ env: f.env, signal: f.controller.signal,
    fetchImpl: async (_, init) => { const body = JSON.parse(init.body); requests.push(body.type); f.controller.abort();
      return response(200, { ok: true, job: { ...f.job, status: body.status, safeError: body.safeError } }); },
    spawnImpl: () => assert.fail('pending completion never executes'),
    wait: () => assert.fail('shutdown cannot wait'),
  });
  assert.equal(result.state, 'stopped'); assert.deepEqual(requests, ['finish']); assert.deepEqual(await journal.pending(), []);
});

test('abort before in-flight invocation reaches claim prevents the network request', async t => {
  const f = await fixture(t); let requests = 0;
  const result = await runSupervisor({ env: f.env, signal: f.controller.signal,
    pull: async options => { f.controller.abort(); await options.fetchImpl('https://cloud.example.test/api/cloud/jobs', { body: '{"type":"claim"}' }); },
    fetchImpl: async () => { requests++; },
  });
  assert.equal(result.state, 'stopped'); assert.equal(requests, 0);
});

test('unknown execution, corrupt journals, identity/auth and admission failures halt without retries', async t => {
  const f = await fixture(t);
  for (const [code, reason] of [
    ['job_execution_unknown', 'private_review_required'], ['invalid_completion_journal', 'private_review_required'],
    ['completion_binding_conflict', 'private_review_required'], ['completion_journal_full', 'private_review_required'],
    ['runner_binding_mismatch', 'configuration_required'], ['project_ref_mismatch', 'configuration_required'],
    ['unauthorized', 'authentication_required'], ['runner_not_authorized', 'authentication_required'], ['runner_job_access_required', 'authentication_required'],
    ['subscription_required', 'admission_required'], ['job_exceeds_plan', 'admission_required'],
  ]) {
    let calls = 0;
    const result = await runSupervisor({ env: f.env, pull: async () => { calls++; throw Object.assign(error('job_result_unconfirmed'), { cause: error(code) }); }, wait: () => assert.fail('fatal error cannot retry') });
    assert.equal(calls, 1); assert.equal(result.state, 'halted'); assert.equal(result.reason, reason);
  }
});

test('real pending journal retries a failed completion acknowledgement without rerunning engine', async t => {
  const f = await fixture(t), requests = [], waits = []; let runs = 0, finishes = 0;
  const result = await runSupervisor({ env: f.env, signal: f.controller.signal, random: () => 1,
    fetchImpl: async (_, init) => {
      const body = JSON.parse(init.body); requests.push(body.type);
      if (body.type === 'claim') return response(200, claimed(f.job, body));
      if (++finishes === 1) return response(503, { error: 'job_service_unavailable' });
      return response(200, { ok: true, job: { ...f.job, status: body.status, safeError: body.safeError } });
    }, spawnImpl: async () => { runs++; return { code: 0 }; },
    wait: async delay => { waits.push(delay); if (finishes === 2) f.controller.abort(); },
  });
  assert.equal(result.state, 'stopped'); assert.equal(runs, 1); assert.deepEqual(requests, ['claim', 'finish', 'finish']); assert.deepEqual(waits, [1000, 30000]);
});

test('authentication rejection hidden by worker completion wrapper halts while preserving pending journal', async t => {
  const f = await fixture(t); let requests = 0;
  const result = await runSupervisor({ env: f.env,
    fetchImpl: async (_, init) => { requests++; const body = JSON.parse(init.body);
      return body.type === 'claim' ? response(200, claimed(f.job, body)) : response(401, { error: 'private-provider-diagnostic' }); },
    spawnImpl: async () => ({ code: 0 }), wait: () => assert.fail('expired auth cannot retry'),
  });
  assert.equal(result.reason, 'authentication_required'); assert.equal(requests, 2);
  const journal = await createCompletionJournal({ directory: f.directory, owner: runnerJournalOwner(f.env.PORTABASE_AGENT_TOKEN), runnerId, origin: f.env.PORTABASE_CLOUD_URL });
  assert.equal((await journal.pending()).length, 1);
});

test('successful HTTP completion with wrong identity or result halts instead of retrying forever', async t => {
  for (const patch of [{ id: 'job_foreign' }, { runnerId: configRef }, { type: 'verify' }, { version: 1 },
    { status: 'failed', safeError: 'engine_exit_1' }, { safeError: 'engine_exit_1' }, null]) {
    const f = await fixture(t); let runs = 0, claims = 0, finishes = 0;
    const options = { env: f.env,
      fetchImpl: async (_, init) => {
        const body = JSON.parse(init.body);
        if (body.type === 'claim') { claims++; return response(200, claimed(f.job, body)); }
        finishes++;
        return response(200, patch === null ? {} : { ok: true, job: { ...f.job, status: body.status, safeError: body.safeError, ...patch } });
      }, spawnImpl: async () => { runs++; return { code: 0 }; },
      wait: () => assert.fail('semantic acknowledgement mismatch must halt without retry'),
    };
    const result = await runSupervisor(options);
    assert.equal(result.state, 'halted'); assert.equal(result.reason, 'private_review_required');
    assert.equal(runs, 1); assert.equal(claims, 1); assert.equal(finishes, 1);
    const journal = await createCompletionJournal({ directory: f.directory, owner: runnerJournalOwner(f.env.PORTABASE_AGENT_TOKEN), runnerId, origin: f.env.PORTABASE_CLOUD_URL });
    assert.equal((await journal.pending()).length, 1);
    // A later invocation keeps the same exact report and still cannot claim/run.
    assert.equal((await runSupervisor(options)).reason, 'private_review_required');
    assert.equal(runs, 1); assert.equal(claims, 1); assert.equal(finishes, 2);
  }
});

test('private request exceptions discard reflected credentials and unmapped agent authority halts', async t => {
  const f = await fixture(t), canary = `Bearer ${f.env.PORTABASE_AGENT_TOKEN}`;
  for (const fetchImpl of [async () => { throw Object.assign(new Error(canary), { code: canary }); },
    async () => response(503, { error: canary })]) {
    await assert.rejects(pullOnce({ baseUrl: f.env.PORTABASE_CLOUD_URL, env: f.env, fetchImpl }), failure => {
      assert.equal(failure.code, 'job_request_failed'); assert.equal(failure.message, 'job_request_failed');
      assert.equal(failure.cause, undefined); assert.ok(!JSON.stringify(failure).includes(canary)); return true;
    });
  }
  const result = await runSupervisor({ env: f.env, fetchImpl: async (url, init) => {
    assert.equal(url, `${f.env.PORTABASE_CLOUD_URL}/api/cloud/runner-jobs`);
    assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Authorization: canary });
    assert.equal(JSON.stringify(JSON.parse(init.body)).includes('pb_agent_'), false);
    return response(403, { error: 'runner_job_access_required' });
  }, wait: () => assert.fail('unmapped token must require owner action'), spawnImpl: () => assert.fail('no admitted job') });
  assert.equal(result.reason, 'authentication_required'); assert.equal(result.polls, 1);
});

test('durable claim transport, HTTP5xx and deadline retry the exact saved request', async t => {
  for (const fetchImpl of [
    async () => { throw new Error('private network failure'); },
    async () => response(503, { error: 'job_service_unavailable' }),
    async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
  ]) {
    const f = await fixture(t), requests = []; let waits = 0;
    const result = await runSupervisor({ env: { ...f.env, PORTABASE_RUNNER_REQUEST_TIMEOUT_MS: '1000' }, signal: f.controller.signal,
      fetchImpl: async (url, init) => { const body = JSON.parse(init.body); requests.push(body);
        return requests.length === 1 ? fetchImpl(url, init) : response(200, claimed(null, body)); },
      spawnImpl: () => assert.fail('no assignment may execute'), wait: () => { if (++waits === 2) f.controller.abort(); } });
    assert.equal(result.state, 'stopped'); assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  }
});

test('malformed successful durable claim replies halt for private review', async t => {
  for (const fetchImpl of [async () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } }),
    async () => response(200, {}), async (_, init) => response(200, { ...claimed(null, JSON.parse(init.body)), claim: {} })]) {
    const f = await fixture(t);
    const result = await runSupervisor({ env: f.env, fetchImpl,
      spawnImpl: () => assert.fail('bad claim must not execute'), wait: () => assert.fail('bad claim must not retry') });
    assert.equal(result.reason, 'private_review_required');
  }
});

test('explicit claim throttling backs off and supervisor refuses missing private setup before requests', async t => {
  const f = await fixture(t); let requests = 0;
  const result = await runSupervisor({ env: f.env, signal: f.controller.signal,
    fetchImpl: async () => { requests++; return response(429, { error: 'rate_limited' }); },
    wait: async () => f.controller.abort(),
  });
  assert.equal(result.state, 'stopped'); assert.equal(requests, 1);
  for (const patch of [{ PORTABASE_RUNNER_CONFIG_DIR: undefined }, { PORTABASE_AGENT_TOKEN: '' }, { PORTABASE_CLOUD_URL: '' },
    { PORTABASE_RUNNER_ID: 'wrong' }, { PORTABASE_RUNTIME_CONFIG: '{}' }]) {
    await assert.rejects(runSupervisor({ env: { ...f.env, ...patch }, fetchImpl: () => assert.fail('invalid setup cannot request') }));
  }
});
