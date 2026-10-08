import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWorkerMayRun, engineArgvForJob, pullOnce } from '../cloud/runner/worker.mjs';
import { parseJobRequest, finishJob } from '../cloud/runner/job-intent.mjs';

const REF = 'ekklokrukxmqlahtonnc';

test('lost completion acknowledgement never rewrites the engine outcome or reruns it', async () => {
  for (const code of [0, 2]) {
    const bodies = []; let launches = 0;
    await assert.rejects(pullOnce({ baseUrl: 'https://portabase.dev', token: 'fixture',
      env: { PORTABASE_PROJECT_REF: REF },
      fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body); bodies.push(body);
        if (body.type === 'claim') return { ok: true, json: async () => ({ job: { id: 'job_ack', type: 'backup', payload: { projectRef: REF } } }) };
        throw new Error('Response lost after server may have stored completion');
      },
      spawnImpl: async () => { launches++; return { code }; },
    }), { code: 'job_result_unconfirmed' });
    assert.equal(launches, 1);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].status, code === 0 ? 'succeeded' : 'failed');
    assert.equal(bodies[1].safeError, code === 0 ? null : 'engine_exit_2');
  }
});

test('unsupported jobs and missing project binding never spawn a backup', async () => {
  for (const type of ['heartbeat', 'restore', 'unknown', undefined]) {
    assert.throws(() => engineArgvForJob({ type }), { code: 'unsupported_job_type' });
  }
  assert.throws(() => assertWorkerMayRun({ type: 'backup', payload: { projectRef: REF } }, {}), { code: 'missing_worker_project' });
  assert.throws(() => assertWorkerMayRun({ type: 'backup', payload: {} }, { PORTABASE_PROJECT_REF: REF }), { code: 'missing_job_project' });
  for (const job of [{ id: 'job_guard', type: 'heartbeat', payload: {} },
    { id: 'job_guard', type: 'backup', payload: { projectRef: REF } }]) {
    let spawned = false; const bodies = [];
    await assert.rejects(pullOnce({ baseUrl: 'https://portabase.dev', token: 'fixture', env: {},
      fetchImpl: async (_, options) => { const body = JSON.parse(options.body); bodies.push(body);
        return { ok: true, json: async () => body.type === 'claim' ? { job } : {} }; },
      spawnImpl: async () => { spawned = true; return { code: 0 }; },
    }));
    assert.equal(spawned, false);
    assert.equal(bodies.at(-1).status, 'failed');
    assert.ok(['unsupported_job_type', 'missing_worker_project'].includes(bodies.at(-1).safeError));
  }
});

test('private exception codes never cross the worker request or persisted result boundary', async () => {
  const bodies = [];
  const privateCode = 'private_customer_table_missing';
  await assert.rejects(pullOnce({ baseUrl: 'https://portabase.dev', token: 'fixture',
    env: { PORTABASE_PROJECT_REF: REF },
    fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body); bodies.push(body);
      return { ok: true, json: async () => body.type === 'claim'
        ? { job: { id: 'job_private', type: 'backup', payload: { projectRef: REF } } } : {} };
    },
    spawnImpl: async () => { const error = new Error('private diagnostic'); error.code = privateCode; throw error; },
  }), { code: privateCode });
  assert.equal(bodies.at(-1).safeError, 'worker_failed');
  assert.ok(!JSON.stringify(bodies).includes('private_customer'));
  const parsed = parseJobRequest({ type: 'finish', jobId: 'job_private', status: 'failed', safeError: privateCode });
  assert.equal(parsed.safeError, 'worker_failed');
  const done = finishJob([{ id: 'job_private', status: 'running' }], { jobId: 'job_private', status: 'failed', safeError: privateCode });
  assert.equal(done.job.safeError, 'worker_failed');
  assert.ok(!JSON.stringify(done).includes(privateCode));
});

test('engine exit codes stay bounded and successful results never store errors', () => {
  for (const [input, expected] of [['engine_exit_1', 'engine_exit_1'], ['engine_exit_255', 'engine_exit_255'],
    ['engine_exit_256', 'worker_failed'], ['engine_exit_1.5', 'worker_failed'], ['engine_exit_unknown', 'engine_exit_unknown']]) {
    assert.equal(parseJobRequest({ type: 'finish', jobId: 'job_test', status: 'failed', safeError: input }).safeError, expected);
  }
  assert.equal(finishJob([{ id: 'job_test', status: 'running' }], { jobId: 'job_test', status: 'succeeded', safeError: 'worker_failed' }).job.safeError, null);
});

test('a queued backup becomes the free-engine argv and nothing else', () => {
  const argv = engineArgvForJob({
    type: 'backup',
    payload: { projectRef: REF, excludeTables: ['public.logs'], excludeBuckets: ['avatars'] },
  });
  assert.deepEqual(argv, [
    'node', 'utility/portabase.mjs', 'backup',
    '--exclude-table-data', 'public.logs',
    '--exclude-buckets', 'avatars',
  ]);
  assert.equal(JSON.stringify(argv).includes('postgres'), false);
  const incremental = engineArgvForJob({
    type: 'backup',
    payload: { projectRef: REF, excludeTables: [], excludeBuckets: [], incrementalBinary: true },
  });
  assert.ok(incremental.includes('--incremental-binary'));
  assert.equal(engineArgvForJob({ type: 'backup', payload: { incrementalBinary: false } }).includes('--incremental-binary'), false);
});

test('pullOnce claims, runs, and finishes without putting the token in the body', async () => {
  const bodies = [];
  const fetchImpl = async (_url, opts) => {
    assert.equal(_url, 'https://portabase.dev/api/cloud/jobs');
    assert.equal(opts.headers.Authorization, 'Bearer supabase-access-token');
    assert.equal(opts.headers['X-Portabase-Agent-Authorization'], undefined);
    const body = JSON.parse(opts.body);
    bodies.push(body);
    assert.equal(JSON.stringify(body).includes('supabase-access-token'), false);
    if (body.type === 'claim') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          job: {
            id: 'job_1',
            type: 'backup',
            payload: { projectRef: REF, excludeTables: ['public.logs'], excludeBuckets: [] },
          },
        }),
      };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  let spawned = null;
  const result = await pullOnce({
    baseUrl: 'https://portabase.dev',
    token: 'supabase-access-token',
    fetchImpl,
    env: { PORTABASE_PROJECT_REF: REF },
    spawnImpl: async (argv) => {
      spawned = argv;
      return { code: 0 };
    },
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(spawned[2], 'backup');
  assert.equal(bodies[1].status, 'succeeded');
  assert.equal(bodies[1].jobId, 'job_1');
});

test('worker refuses a job for a different project and does not spawn', async () => {
  let spawned = false;
  const bodies = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    if (body.type === 'claim') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          job: { id: 'job_2', type: 'backup', payload: { projectRef: REF, excludeTables: [], excludeBuckets: [] } },
        }),
      };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  await assert.rejects(
    () => pullOnce({
      baseUrl: 'https://portabase.dev',
      token: 't',
      fetchImpl,
      env: { PORTABASE_PROJECT_REF: 'svltssnxzqsrxtbjgaex' },
      spawnImpl: async () => {
        spawned = true;
        return { code: 0 };
      },
    }),
    { code: 'project_ref_mismatch' },
  );
  assert.equal(spawned, false);
  assert.equal(bodies.at(-1).status, 'failed');
  assert.equal(bodies.at(-1).safeError, 'project_ref_mismatch');
});
