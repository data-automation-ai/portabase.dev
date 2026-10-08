import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rename } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCompletionJournal, runnerJournalOwner, MAX_PENDING_COMPLETIONS } from '../cloud/runner/completion-journal.mjs';
import { pullOnce } from '../cloud/runner/worker.mjs';

const runnerId = '11111111-1111-4111-8111-111111111111';
const configRef = '33333333-3333-4333-8333-333333333333';
const owner = 'a'.repeat(64), origin = 'https://cloud.example.test';
const hash = value => createHash('sha256').update(value).digest('hex');
const reference = { version: 2, runnerId, configRef, configRevision: 1 };
const reportFor = (job, status = 'succeeded') => ({ type: 'finish', version: 2, runnerId, jobId: job.id, status, safeError: status === 'succeeded' ? null : 'engine_exit_3' });
const ackFor = (job, report) => ({ ok: true, job: { ...job, status: report.status, safeError: report.safeError } });
const response = value => ({ ok: true, json: async () => value });
const claimed = (job, request) => ({ ok: true, job: { ...job, status: 'running' }, claim: {
  protocol: 1, sequence: request.claimSequence, requestId: request.claimRequestId, runnerId,
} });
async function fixture() {
  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const directory = await mkdtemp(join(tmpdir(), 'portabase-completion-test-'));
  const options = { directory, owner, runnerId, origin };
  const job = { id: 'job_synthetic', type: 'backup', version: 2, runnerId, payload: reference, admission: { maxBytes: 1000 } };
  const pending = join(directory, '.job-journal', owner, runnerId, 'pending');
  const entry = join(pending, hash(job.id));
  const projectRef = 'abcdefghijklmnopqrst';
  const engine = JSON.stringify({ projectRef, backupDirectory: 'capsules', statusDirectory: 'status' });
  await writeFile(join(directory, 'engine.json'), engine);
  await mkdir(join(directory, configRef));
  await writeFile(join(directory, configRef, '1.json'), JSON.stringify({ ...reference, operation: 'backup', projectRef,
    engineConfigPath: 'engine.json', engineConfigSha256: hash(engine), excludeTables: [], excludeBuckets: [], incrementalBinary: false }));
  const env = { PORTABASE_RUNNER_CONFIG_DIR: directory, PORTABASE_RUNNER_ID: runnerId, PORTABASE_PROJECT_REF: projectRef,
    PORTABASE_AGENT_TOKEN: `pb_agent_${owner}_0_${'b'.repeat(64)}`, PORTABASE_JOB_MAX_CAPSULE_BYTES: '999999999' };
  const worker = overrides => pullOnce({ baseUrl: origin, token: 'synthetic-customer', env, ...overrides });
  return { directory, options, job, pending, entry, env, worker, journal: await createCompletionJournal(options) };
}

test('restart retains exact result, verifies acknowledgement and prevents duplicate execution', async () => {
  const f = await fixture(); const binding = await f.journal.start(f.job);
  const report = reportFor(f.job, 'failed');
  await f.journal.finish(binding, report);
  const restarted = await createCompletionJournal(f.options);
  const [completion] = await restarted.pending();
  assert.deepEqual(completion.report, report);
  for (const reply of [{}, { ok: true }, ackFor({ ...f.job, id: 'job_other' }, report),
    ackFor({ ...f.job, runnerId: configRef }, report), ackFor({ ...f.job, type: 'verify' }, report),
    ackFor({ ...f.job, payload: { ...reference, configRevision: 2 } }, report),
    ackFor(f.job, { ...report, safeError: 'engine_exit_2' }), ackFor(f.job, reportFor(f.job))]) {
    await assert.rejects(restarted.acknowledge(completion, reply));
    assert.equal((await restarted.pending()).length, 1);
  }
  await restarted.acknowledge(completion, ackFor(f.job, report));
  assert.deepEqual(await restarted.pending(), []);
  await assert.rejects(restarted.start(f.job), { code: 'job_already_executed' });
  await restarted.acknowledge(completion, ackFor(f.job, report));
  const saved = await readFile(join(f.directory, '.job-journal', owner, runnerId, 'done', hash(f.job.id), 'finished.json'), 'utf8');
  assert.doesNotMatch(saved, /pb_agent_|synthetic-customer|engine\.json|projectRef/);
});

test('separate process exit preserves started and finished records without rerunning an engine', async () => {
  for (const finish of [false, true]) {
    const f = await fixture();
    const moduleUrl = new URL('../cloud/runner/completion-journal.mjs', import.meta.url).href;
    const script = `import {createCompletionJournal} from ${JSON.stringify(moduleUrl)};
      const journal = await createCompletionJournal(${JSON.stringify(f.options)});
      const binding = await journal.start(${JSON.stringify(f.job)});
      ${finish ? `await journal.finish(binding,${JSON.stringify(reportFor(f.job))});` : ''}
      process.exit(0);`;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 15000 });
    const [row] = await f.journal.pending();
    assert.equal(row.state, finish ? 'execution_finished' : 'execution_unknown');
    if (finish) assert.deepEqual(row.report, reportFor(f.job));
    else await assert.rejects(f.worker({ fetchImpl: async () => assert.fail('must not request') }), { code: 'job_execution_unknown' });
  }
});

test('lost acknowledgement resends only saved completion after restart, with no engine rerun', async () => {
  const f = await fixture(); let spawns = 0; const sent = [];
  await assert.rejects(f.worker({
    fetchImpl: async (_, request) => { const body = JSON.parse(request.body); sent.push(body); if (body.type === 'claim') return response(claimed(f.job, body)); throw new Error('synthetic network interruption'); },
    spawnImpl: async (_, options) => { spawns++; assert.equal(options.env.PORTABASE_JOB_MAX_CAPSULE_BYTES, '1000'); return { code: 0 }; },
  }), { code: 'job_result_unconfirmed' });
  assert.equal(spawns, 1); assert.deepEqual(sent.map(row => row.type), ['claim', 'finish']);
  const result = await f.worker({ fetchImpl: async (_, request) => { const body = JSON.parse(request.body); sent.push(body); return response(ackFor(f.job, body)); },
    spawnImpl: async () => { spawns++; throw new Error('must not rerun'); } });
  assert.equal(result.reconciled, true); assert.equal(result.completionCount, 1); assert.equal(spawns, 1);
  assert.deepEqual(sent[1], sent[2]); assert.deepEqual(await f.journal.pending(), []);
});

test('started state after engine exception blocks future network claims and never reports assumed failure', async () => {
  const f = await fixture(); const sent = [];
  await assert.rejects(f.worker({ fetchImpl: async (_, request) => { const body = JSON.parse(request.body); sent.push(body); return response(claimed(f.job, body)); },
    spawnImpl: async () => { throw new Error('synthetic uncertain process outcome'); } }), { code: 'job_execution_unknown' });
  assert.deepEqual(sent.map(row => row.type), ['claim']);
  await assert.rejects(f.worker({ fetchImpl: async () => { assert.fail('must not claim'); }, spawnImpl: async () => assert.fail('must not run') }), { code: 'job_execution_unknown' });
  assert.equal((await f.journal.pending())[0].state, 'execution_unknown');
});

test('pre-start journal collision never spawns, and durable finish failure never sends contradictory result', async () => {
  const f = await fixture(); let spawns = 0, requests = 0;
  await assert.rejects(f.worker({ fetchImpl: async (_, request) => { requests++; await mkdir(f.entry); return response(claimed(f.job, JSON.parse(request.body))); },
    spawnImpl: async () => { spawns++; return { code: 0 }; } }), { code: 'job_execution_unknown' });
  assert.equal(spawns, 0); assert.equal(requests, 1);
  const g = await fixture(); requests = 0;
  await assert.rejects(g.worker({ fetchImpl: async (_, request) => { requests++; return response(claimed(g.job, JSON.parse(request.body))); },
    spawnImpl: async () => { await mkdir(join(g.entry, 'finished.json')); return { code: 0 }; } }), { code: 'job_result_unconfirmed' });
  assert.equal(requests, 1); await assert.rejects(g.journal.pending());
});

test('malformed, oversized, foreign-owner, origin, runner and revision records fail closed', async () => {
  for (const mutate of [row => ({ ...row, secret: 'refused' }), row => ({ ...row, at: 'yesterday' }),
    row => ({ ...row, binding: { ...row.binding, owner: 'c'.repeat(64) } }),
    row => ({ ...row, binding: { ...row.binding, origin: 'https://other.example.test' } }),
    row => ({ ...row, binding: { ...row.binding, runnerId: configRef } }),
    row => ({ ...row, binding: { ...row.binding, reference: { ...reference, configRevision: 0 } } }),
    () => 'x'.repeat(9000)]) {
    const f = await fixture(); await f.journal.start(f.job);
    const path = join(f.entry, 'started.json'); const row = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify(mutate(row)));
    let network = 0;
    await assert.rejects(f.worker({ fetchImpl: async () => { network++; return response({}); } }));
    assert.equal(network, 0);
  }
  assert.throws(() => runnerJournalOwner('arbitrary-token'), { code: 'private_runner_setup_required' });
});

test('linked root or journal parent is refused before any journal write', async () => {
  const f = await fixture(); const g = await fixture();
  const alias = join(f.directory, 'alias');
  await symlink(g.directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createCompletionJournal({ ...f.options, directory: alias }), { code: 'private_config_path_refused' });
  const linkedOwner = 'd'.repeat(64);
  await symlink(g.directory, join(f.directory, '.job-journal', linkedOwner), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createCompletionJournal({ ...f.options, owner: linkedOwner }), { code: 'private_config_path_refused' });
  for (const directory of ['F:/forbidden', 'relative', '\\\\server\\share']) await assert.rejects(createCompletionJournal({ ...f.options, directory }));
});

test('concurrent start grants execution once and cannot overwrite the immutable start record', async () => {
  const f = await fixture(); const second = await createCompletionJournal(f.options);
  const results = await Promise.allSettled([f.journal.start(f.job), second.start(f.job)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'job_execution_unknown');
  assert.equal((await f.journal.pending()).length, 1);
});

test('bounded pending scan fails closed above cap and replay sends at most ten reports', async () => {
  const f = await fixture(); const byId = new Map();
  for (let index = 0; index < 11; index++) {
    const job = { ...f.job, id: `job_${index}` }; byId.set(job.id, job);
    await f.journal.finish(await f.journal.start(job), reportFor(job));
  }
  let requests = 0;
  const result = await f.worker({ fetchImpl: async (_, request) => { requests++; const body = JSON.parse(request.body); assert.equal(body.type, 'finish'); return response(ackFor(byId.get(body.jobId), body)); } });
  assert.equal(result.completionCount, 10); assert.equal(requests, 10); assert.equal((await f.journal.pending()).length, 1);
  const g = await fixture(); const binding = await g.journal.start(g.job);
  for (let index = 0; index < MAX_PENDING_COMPLETIONS; index++) {
    const jobId = `job_cap_${index}`, path = join(g.pending, hash(jobId)); await mkdir(path);
    await writeFile(join(path, 'started.json'), JSON.stringify({ version: 1, state: 'execution_started', binding: { ...binding, jobId }, at: new Date().toISOString() }));
  }
  await assert.rejects(g.journal.pending(), { code: 'completion_journal_full' });
  assert.equal((await readdir(g.pending)).length, MAX_PENDING_COMPLETIONS + 1);
});

test('missing, malformed or zero v2 admission fails before engine and emits only a fixed code', async () => {
  for (const maxBytes of [undefined, 0, -1, '1000', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const f = await fixture(); const bodies = []; let spawns = 0;
    await assert.rejects(f.worker({ fetchImpl: async (_, request) => { const body = JSON.parse(request.body); bodies.push(body); return response(body.type === 'claim' ? claimed({ ...f.job, admission: { maxBytes } }, body) : ackFor(f.job, body)); },
      spawnImpl: async () => { spawns++; return { code: 0 }; } }), { code: 'invalid_job_capsule_limit' });
    assert.equal(spawns, 0); assert.equal(bodies.at(-1).safeError, 'invalid_job_capsule_limit'); assert.deepEqual(await f.journal.pending(), []);
  }
});

test('validation failure acknowledgement loss replays durable rejection without claiming or running again', async () => {
  const f = await fixture(), bodies = []; let spawns = 0;
  await writeFile(join(f.directory, 'engine.json'), '{"private-row-canary":"changed"}');
  await assert.rejects(f.worker({ fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body); bodies.push(body);
    if (body.type === 'claim') return response(claimed(f.job, body));
    return { ok: false, status: 503, json: async () => ({ error: 'completion_publication_unavailable' }) };
  }, spawnImpl: async () => { spawns++; } }), { code: 'job_result_unconfirmed' });
  assert.equal(spawns, 0);
  assert.deepEqual(bodies.map(row => row.type), ['claim', 'finish']);
  const record = JSON.parse(await readFile(join(f.entry, 'rejected.json'), 'utf8'));
  assert.equal(record.state, 'execution_rejected');
  assert.equal(record.report.status, 'failed'); assert.equal(record.report.safeError, 'worker_failed');
  assert.deepEqual(await readdir(f.entry), ['rejected.json']);
  assert.doesNotMatch(JSON.stringify(record), /private-row-canary|engine\.json|pb_agent_|passphrase/);
  const result = await f.worker({ fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body); bodies.push(body); return response(ackFor(f.job, body));
  }, spawnImpl: async () => assert.fail('rejection replay must not spawn') });
  assert.equal(result.reconciled, true); assert.deepEqual(bodies[1], bodies[2]);
  assert.deepEqual(await f.journal.pending(), []);
  await assert.rejects(f.journal.start(f.job), { code: 'job_already_executed' });
});

test('rejected result survives a separate process and accepts only exact failed acknowledgement', async () => {
  const f = await fixture(), report = { ...reportFor(f.job, 'failed'), safeError: 'invalid_job_capsule_limit' };
  const moduleUrl = new URL('../cloud/runner/completion-journal.mjs', import.meta.url).href;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `import {createCompletionJournal} from ${JSON.stringify(moduleUrl)};
    const journal = await createCompletionJournal(${JSON.stringify(f.options)});
    await journal.reject(${JSON.stringify(f.job)},${JSON.stringify(report)}); process.exit(0);`], { timeout: 15000 });
  const [completion] = await f.journal.pending();
  assert.equal(completion.state, 'execution_rejected'); assert.deepEqual(completion.report, report);
  await assert.rejects(f.journal.acknowledge(completion, ackFor(f.job, reportFor(f.job))));
  await assert.rejects(f.journal.acknowledge(completion, ackFor({ ...f.job, payload: { ...reference, configRevision: 2 } }, report)));
  await f.journal.acknowledge(completion, ackFor(f.job, report));
  assert.deepEqual(await f.journal.pending(), []);
});

test('rejection and execution reservation compete; foreign or successful rejection cannot be recorded', async () => {
  const f = await fixture(), report = reportFor(f.job, 'failed');
  for (const job of [{ ...f.job, runnerId: configRef }, { ...f.job, payload: { ...reference, runnerId: configRef } },
    { ...f.job, payload: { ...reference, projectRef: 'private' } }, { ...f.job, id: '../escape' }]) await assert.rejects(f.journal.reject(job, report));
  await assert.rejects(f.journal.reject(f.job, reportFor(f.job)));
  assert.deepEqual(await readdir(f.pending), []);
  const outcomes = await Promise.allSettled([f.journal.reject(f.job, report), f.journal.start(f.job)]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(row => row.status === 'rejected').reason.code, 'job_execution_unknown');
  assert.equal((await readdir(f.entry)).length, 1);
});

test('pre-execution rejection collision and invalid binding never send unjournaled failure', async () => {
  for (const mode of ['collision', 'foreign']) {
    const f = await fixture(), bodies = [];
    await assert.rejects(f.worker({ fetchImpl: async (_, request) => {
      const body = JSON.parse(request.body); bodies.push(body);
      if (mode === 'collision') await mkdir(f.entry);
      return response(claimed({ ...f.job, ...(mode === 'foreign' ? { runnerId: configRef } : {}), admission: { maxBytes: 0 } }, body));
    }, spawnImpl: async () => assert.fail('must not execute') }), { code: mode === 'collision' ? 'job_execution_unknown' : 'claim_response_mismatch' });
    assert.deepEqual(bodies.map(row => row.type), ['claim']);
    if (mode === 'collision') await assert.rejects(f.worker({ fetchImpl: async () => assert.fail('malformed reservation must block claims') }));
    else assert.deepEqual(await readdir(f.pending), []);
  }
});

test('mixed or forged successful rejection files fail closed on restart', async () => {
  for (const mode of ['mixed', 'success']) {
    const f = await fixture(); await f.journal.reject(f.job, reportFor(f.job, 'failed'));
    const path = join(f.entry, 'rejected.json'), record = JSON.parse(await readFile(path, 'utf8'));
    if (mode === 'mixed') await writeFile(join(f.entry, 'started.json'), '{}');
    else await writeFile(path, JSON.stringify({ ...record, report: reportFor(f.job) }));
    await assert.rejects(f.worker({ fetchImpl: async () => assert.fail('must not send forged completion') }), { code: 'invalid_completion_journal' });
  }
});

test('rejection write failure leaves a blocked reservation and journal outage sends no result', async () => {
  const f = await fixture();
  const journal = await createCompletionJournal({ ...f.options, clock: () => {
    // Simulate loss of the reserved record path immediately before its write.
    mkdirSync(join(f.entry, 'rejected.json')); return Date.now();
  } });
  await assert.rejects(journal.reject(f.job, reportFor(f.job, 'failed')));
  await assert.rejects(f.journal.pending(), { code: 'invalid_completion_journal' });
  await assert.rejects(f.worker({ fetchImpl: async () => assert.fail('partial write must block') }));
  const g = await fixture(), bodies = [];
  await assert.rejects(g.worker({ fetchImpl: async (_, request) => {
    bodies.push(JSON.parse(request.body));
    await rename(g.pending, `${g.pending}-held`); await writeFile(g.pending, 'synthetic blocked journal');
    return response(claimed({ ...g.job, admission: { maxBytes: 0 } }, body));
  }, spawnImpl: async () => assert.fail('journal outage must not execute') }));
  assert.deepEqual(bodies.map(body => body.type), ['claim']);
});
