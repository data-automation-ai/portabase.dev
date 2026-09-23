/**
 * Customer worker. Pulls one job intent and runs the free engine
 * with secrets that are already in this process environment.
 * The control plane never receives those secrets, and this file never sends them back.
 *
 *   PORTABASE_CLOUD_URL=https://portabase.dev \
 *   PORTABASE_CLOUD_TOKEN=<supabase access token> \
 *   node cloud/runner/worker.mjs
 *
 * The worker's own portabase config (project ref, vault, passphrase env)
 * must already match the queued project. This process does not accept a
 * database URL or passphrase from the job.
 */
import { spawn } from 'node:child_process';
import { buildFreeEngineArgv } from './engine-job.mjs';

export function engineArgvForJob(job) {
  const type = job?.type;
  const command = type === 'verify' || type === 'replay' ? type : 'backup';
  const payload = job?.payload || {};
  return buildFreeEngineArgv({
    command,
    excludeTableData: (payload.excludeTables || []).join(','),
    excludeBuckets: (payload.excludeBuckets || []).join(','),
    confirmTarget: payload.targetRef || '',
  });
}

export function assertWorkerMayRun(job, env = process.env) {
  const wanted = job?.payload?.projectRef || null;
  const local = env.PORTABASE_PROJECT_REF || '';
  if (wanted && local && wanted !== local) {
    const err = new Error('Queued project ref does not match PORTABASE_PROJECT_REF on this worker');
    err.code = 'project_ref_mismatch';
    throw err;
  }
  if (job?.type === 'replay' && !job?.payload?.targetRef) {
    const err = new Error('Replay job is missing targetRef');
    err.code = 'missing_target_ref';
    throw err;
  }
  return true;
}

function cloudUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/$/, '')}${path}`;
}

async function postJob(fetchImpl, { baseUrl, token, body }) {
  const response = await fetchImpl(cloudUrl(baseUrl, '/api/cloud/jobs'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `job_request_failed_${response.status}`);
    err.code = data.error || 'job_request_failed';
    err.status = response.status;
    throw err;
  }
  return data;
}

export function spawnEngine(argv, { spawnImpl = spawn, cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    const child = spawnImpl(cmd, args, { cwd, stdio: 'inherit', env: process.env });
    if (child && typeof child.then === 'function') {
      child.then(resolve, reject);
      return;
    }
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1 }));
  });
}

/**
 * Claim one job, run it, report succeeded/failed.
 * `spawnImpl` in tests resolves `{ code }` and must not be required to touch the network.
 */
export async function pullOnce({
  baseUrl,
  token,
  fetchImpl = globalThis.fetch,
  spawnImpl,
  env = process.env,
} = {}) {
  if (!baseUrl || !token) {
    const err = new Error('PORTABASE_CLOUD_URL and PORTABASE_CLOUD_TOKEN are required');
    err.code = 'missing_worker_auth';
    throw err;
  }
  const claimed = await postJob(fetchImpl, { baseUrl, token, body: { type: 'claim' } });
  const job = claimed.job || null;
  if (!job) return { idle: true, job: null };
  try {
    assertWorkerMayRun(job, env);
    const argv = engineArgvForJob(job);
    const run = spawnImpl
      ? await spawnImpl(argv)
      : await spawnEngine(argv);
    const code = Number(run?.code);
    const status = code === 0 ? 'succeeded' : 'failed';
    await postJob(fetchImpl, {
      baseUrl,
      token,
      body: {
        type: 'finish',
        jobId: job.id,
        status,
        safeError: status === 'failed' ? `engine_exit_${Number.isFinite(code) ? code : 'unknown'}` : null,
      },
    });
    return { idle: false, job, status, code };
  } catch (error) {
    await postJob(fetchImpl, {
      baseUrl,
      token,
      body: {
        type: 'finish',
        jobId: job.id,
        status: 'failed',
        safeError: String(error.code || 'worker_failed').slice(0, 80),
      },
    }).catch(() => {});
    throw error;
  }
}

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('cloud/runner/worker.mjs');
if (isDirectRun) {
  pullOnce({
    baseUrl: process.env.PORTABASE_CLOUD_URL,
    token: process.env.PORTABASE_CLOUD_TOKEN,
  }).then((result) => {
    console.log(JSON.stringify({ ok: true, ...result, job: result.job ? { id: result.job.id, type: result.job.type, status: result.status } : null }));
  }).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.code || 'worker_failed' }));
    process.exitCode = 1;
  });
}
