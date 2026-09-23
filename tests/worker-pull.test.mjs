import test from 'node:test';
import assert from 'node:assert/strict';
import { engineArgvForJob, pullOnce } from '../cloud/runner/worker.mjs';

const REF = 'ekklokrukxmqlahtonnc';

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
});

test('pullOnce claims, runs, and finishes without putting the token in the body', async () => {
  const bodies = [];
  const fetchImpl = async (_url, opts) => {
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
