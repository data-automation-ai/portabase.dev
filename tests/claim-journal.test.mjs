import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClaimJournal } from '../cloud/runner/claim-journal.mjs';
import { pullOnce } from '../cloud/runner/worker.mjs';

const owner = 'a'.repeat(64), runnerId = '11111111-1111-4111-8111-111111111111';
const configRef = '33333333-3333-4333-8333-333333333333', origin = 'https://cloud.example.test';
const sha = value => createHash('sha256').update(value).digest('hex');
const job = { id: 'job_claim', version: 2, runnerId, type: 'backup', status: 'running',
  payload: { version: 2, runnerId, configRef, configRevision: 1 }, admission: { maxBytes: 1000 } };
const reply = (request, value = null) => ({ ok: true, job: value, claim: {
  protocol: 1, sequence: request.claimSequence, requestId: request.claimRequestId, runnerId,
} });
async function fixture(t) {
  assert.doesNotMatch(tmpdir(), /^[fF]:/);
  const directory = await mkdtemp(join(tmpdir(), 'portabase-claim-test-'));
  t.after(async () => {
    const root = resolve(directory), parent = resolve(tmpdir());
    assert.ok(root.startsWith(`${parent}${sep}`) && basename(root).startsWith('portabase-claim-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const options = { directory, owner, runnerId, origin };
  const base = join(directory, '.claim-journal', owner, runnerId, sha(origin));
  const env = { PORTABASE_RUNNER_CONFIG_DIR: directory, PORTABASE_RUNNER_ID: runnerId,
    PORTABASE_PROJECT_REF: 'abcdefghijklmnopqrst', PORTABASE_AGENT_TOKEN: `pb_agent_${owner}_0_${'b'.repeat(64)}` };
  return { options, base, env, journal: await createClaimJournal(options),
    worker: overrides => pullOnce({ baseUrl: origin, env, ...overrides }) };
}

test('pending and accepted decisions survive restart; null is durable and sequence advances only after settlement', async t => {
  const f = await fixture(t), first = await f.journal.request();
  assert.equal(first.claimSequence, 1);
  const restarted = await createClaimJournal(f.options);
  assert.deepEqual(await restarted.request(), first);
  await restarted.accept(first, reply(first));
  assert.deepEqual(await (await createClaimJournal(f.options)).request(), first);
  await assert.rejects(restarted.accept(first, reply(first, job)), { code: 'claim_assignment_conflict' });
  await restarted.settle(first, null);
  const next = await (await createClaimJournal(f.options)).request();
  assert.equal(next.claimSequence, 2); assert.notEqual(next.claimRequestId, first.claimRequestId);
  await assert.rejects(restarted.accept(first, reply(first)), { code: 'claim_assignment_conflict' });
  const bytes = await readFile(join(f.base, 'state.json'), 'utf8');
  assert.ok(bytes.length < 4096); assert.doesNotMatch(bytes, /pb_agent|projectRef|password|engine\.json/);
});

test('real process exit preserves the exact pending or received claim before any engine execution', async t => {
  for (const received of [false, true]) {
    const f = await fixture(t);
    const moduleUrl = new URL('../cloud/runner/claim-journal.mjs', import.meta.url).href;
    const source = `import {createClaimJournal} from ${JSON.stringify(moduleUrl)};
      const journal=await createClaimJournal(${JSON.stringify(f.options)}); const request=await journal.request();
      ${received ? `await journal.accept(request,{ok:true,job:${JSON.stringify(job)},claim:{protocol:1,sequence:request.claimSequence,requestId:request.claimRequestId,runnerId:${JSON.stringify(runnerId)}}});` : ''}
      process.stdout.write(JSON.stringify(request));process.exit(0);`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { timeout: 15000 });
    const request = JSON.parse(stdout);
    assert.deepEqual(await f.journal.request(), request);
    await f.journal.accept(request, reply(request, received ? job : null));
  }
});

test('echo, status, runner, version and private payload violations never accept or advance a claim', async t => {
  const f = await fixture(t), request = await f.journal.request();
  const good = reply(request, job);
  for (const invalid of [ {}, { ...good, ok: false }, { ...good, claim: { ...good.claim, sequence: 2 } },
    { ...good, claim: { ...good.claim, requestId: configRef } }, { ...good, claim: { ...good.claim, runnerId: configRef } },
    { ...good, job: { ...job, status: 'queued' } }, { ...good, job: { ...job, runnerId: configRef } },
    { ...good, job: { ...job, version: 1 } },
    { ...good, job: { ...job, payload: { ...job.payload, password: 'synthetic-refused' } } } ]) {
    await assert.rejects(f.journal.accept(request, invalid));
    assert.deepEqual(await f.journal.request(), request);
    assert.equal(JSON.parse(await readFile(join(f.base, 'state.json'), 'utf8')).state, 'pending');
  }
  await f.journal.accept(request, good);
  for (const change of [{ id: 'job_changed' }, { type: 'verify' }, { payload: { ...job.payload, configRevision: 2 } }]) {
    await assert.rejects(f.journal.accept(request, reply(request, { ...job, ...change })), { code: 'claim_assignment_conflict' });
  }
  await f.journal.accept(request, reply(request, { ...job, status: 'succeeded', safeError: null }));
});

test('foreign, malformed, oversized, aliased and partial-write journal records fail closed', async t => {
  for (const mutate of [state => ({ ...state, owner: 'c'.repeat(64) }), state => ({ ...state, runnerId: configRef }),
    state => ({ ...state, origin: 'https://foreign.example.test' }), state => ({ ...state, sequence: 0 }),
    state => ({ ...state, requestId: [state.requestId] }), state => ({ ...state, extra: true }),
    () => 'x'.repeat(5000)]) {
    const f = await fixture(t); await f.journal.request();
    const path = join(f.base, 'state.json');
    await writeFile(path, JSON.stringify(mutate(JSON.parse(await readFile(path, 'utf8')))));
    await assert.rejects(f.journal.request(), { code: 'invalid_claim_journal' });
  }
  const f = await fixture(t); await f.journal.request();
  await link(join(f.base, 'state.json'), join(f.base, 'alias.json'));
  await assert.rejects(f.journal.request(), { code: 'invalid_claim_journal' });
  const g = await fixture(t); await g.journal.request(); await writeFile(join(g.base, 'next.json'), '{}');
  await assert.rejects(g.journal.request(), { code: 'invalid_claim_journal' });
  assert.equal(await readFile(join(g.base, 'next.json'), 'utf8'), '{}');
});

test('concurrent reservations never create divergent request identities and sequence exhaustion is explicit', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => f.journal.request()));
  const fulfilled = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  assert.ok(fulfilled.length >= 1);
  for (const result of fulfilled) assert.deepEqual(result, fulfilled[0]);
  for (const result of results.filter(row => row.status === 'rejected')) assert.equal(result.reason.code, 'supervisor_lease_review_required');
  const path = join(f.base, 'state.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...state, state: 'settled', sequence: Number.MAX_SAFE_INTEGER }));
  await assert.rejects(f.journal.request(), { code: 'claim_sequence_exhausted' });
});

test('terminal server decisions without matching completed local execution never execute or claim again', async t => {
  const f = await fixture(t); let requests = 0;
  await assert.rejects(f.worker({ fetchImpl: async (_, init) => {
    requests++; return { ok: true, json: async () => reply(JSON.parse(init.body), { ...job, status: 'succeeded', safeError: null }) };
  }, spawnImpl: () => assert.fail('terminal result cannot run') }), { code: 'claim_assignment_conflict' });
  assert.equal(requests, 1);
  const state = JSON.parse(await readFile(join(f.base, 'state.json'), 'utf8'));
  assert.equal(state.state, 'received'); assert.equal(state.sequence, 1);
});

test('missing or blocked local journal never sends a claim and crashed mutex is not stolen', async t => {
  const f = await fixture(t); await f.journal.request();
  await writeFile(join(f.base, '.supervisor.lock'), 'synthetic-crash-leftover');
  await assert.rejects(f.worker({ fetchImpl: () => assert.fail('must not request') }), { code: 'supervisor_lease_review_required' });
  assert.equal(await readFile(join(f.base, '.supervisor.lock'), 'utf8'), 'synthetic-crash-leftover');
});
