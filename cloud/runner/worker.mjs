/**
 * Customer worker. Pulls one job intent and runs the free engine
 * with secrets that are already in this process environment.
 * The control plane never receives those secrets, and this file never sends them back.
 *
 *   PORTABASE_CLOUD_URL=https://portabase.dev \
 *   PORTABASE_AGENT_TOKEN=<registered runner credential> \
 *   node cloud/runner/worker.mjs
 *
 * The worker's own portabase config (project ref, vault, passphrase env)
 * must already match the queued project. This process does not accept a
 * database URL or passphrase from the job.
 */
import { spawn } from 'node:child_process';
import { buildFreeEngineArgv } from './engine-job.mjs';
import { publicJobError, readPrivateBackupResult } from './job-result.mjs';
import { resolvePrivateJob } from './private-config.mjs';
import { RUNNER_ID_RE } from './config-reference.mjs';
import { fileURLToPath } from 'node:url';
import { createCompletionJournal, runnerJournalOwner } from './completion-journal.mjs';
import { privateReplayReviewOptions } from '../../utility/private-replay.mjs';
import { createClaimJournal } from './claim-journal.mjs';

export function engineArgvForJob(job, { configPath, restorePlan } = {}) {
  // A validated plan must never be silently dropped into an unfiltered replay.
  // Execution stays closed until the child consumes an immutable plan snapshot.
  if (restorePlan !== undefined) {
    throw Object.assign(new Error('private_restore_execution_unavailable'), { code: 'private_restore_execution_unavailable' });
  }
  const type = job?.type;
  if (!['backup', 'verify', 'replay'].includes(type)) {
    const error = new Error('Unsupported worker operation');
    error.code = 'unsupported_job_type';
    throw error;
  }
  const command = type;
  const payload = job?.payload || {};
  if (payload.version === 2) throw Object.assign(new Error('private_config_unresolved'), { code: 'private_config_unresolved' });
  const argv = buildFreeEngineArgv({
    command,
    excludeTableData: (payload.excludeTables || []).join(','),
    excludeBuckets: (payload.excludeBuckets || []).join(','),
    incrementalBinary: payload.incrementalBinary === true,
    confirmTarget: payload.targetRef || '',
    capsule: payload.capsulePath || '',
  });
  if (configPath) {
    argv[1] = fileURLToPath(new URL('../../utility/portabase.mjs', import.meta.url));
    argv.push('--config', configPath);
  }
  return argv;
}

export function assertWorkerMayRun(job, env = process.env) {
  if (!['backup', 'verify', 'replay'].includes(job?.type)) {
    const error = new Error('Unsupported worker operation');
    error.code = 'unsupported_job_type';
    throw error;
  }
  const wanted = job?.payload?.projectRef || null;
  const local = env.PORTABASE_PROJECT_REF || '';
  if ((wanted || job?.type === 'backup') && !/^[a-z0-9]{20}$/.test(local)) {
    const error = new Error('Worker project identity is required');
    error.code = 'missing_worker_project';
    throw error;
  }
  if (job?.type === 'backup' && !/^[a-z0-9]{20}$/.test(wanted || '')) {
    const error = new Error('Backup project identity is required');
    error.code = 'missing_job_project';
    throw error;
  }
  if (wanted && wanted !== local) {
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
  let url;
  try { url = new URL(baseUrl); } catch { throw Object.assign(new Error('invalid_cloud_url'), { code: 'invalid_cloud_url' }); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw Object.assign(new Error('invalid_cloud_url'), { code: 'invalid_cloud_url' });
  }
  return `${url.origin}${path}`;
}

const PRIVATE_REQUEST_ERRORS = new Set(['unauthorized', 'unauthorized_agent', 'runner_not_authorized',
  'runner_job_access_required', 'runner_action_refused', 'ambiguous_runner_auth', 'agent_store_unavailable',
  'subscription_required', 'job_exceeds_plan', 'queue_changed', 'job_service_unavailable',
  'job_result_conflict', 'job_not_running', 'job_not_found', 'invalid_json', 'body_too_large',
  'method_not_allowed', 'supervisor_stopping', 'runner_request_timeout', 'invalid_claim_response',
  'claim_reference_conflict', 'claim_sequence_conflict', 'claim_previous_unfinished', 'runner_execution_pending', 'durable_claim_required']);

async function postJob(fetchImpl, { baseUrl, token, agentToken, body }) {
  const privateRequest = body.version === 2;
  let response;
  try { response = await fetchImpl(cloudUrl(baseUrl, privateRequest ? '/api/cloud/runner-jobs' : '/api/cloud/jobs'), {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${privateRequest ? agentToken : token}`,
    },
    body: JSON.stringify(body),
  }); } catch (error) {
    if (!privateRequest) throw error;
    const code = PRIVATE_REQUEST_ERRORS.has(error?.code) ? error.code : 'job_request_failed';
    // Fetch errors can embed request headers. Keep neither their message nor cause.
    throw Object.assign(new Error(code), { code });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = privateRequest
      ? (PRIVATE_REQUEST_ERRORS.has(data?.error) ? data.error : 'job_request_failed')
      : data.error || 'job_request_failed';
    const err = new Error(code);
    err.code = code;
    err.status = response.status;
    throw err;
  }
  return data;
}

export function spawnEngine(argv, { spawnImpl = spawn, cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    const child = spawnImpl(cmd, args, { cwd, stdio: 'inherit', env });
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
  agentToken = env.PORTABASE_AGENT_TOKEN,
} = {}) {
  const privateMode = env.PORTABASE_RUNNER_CONFIG_DIR !== undefined;
  if (!baseUrl || (!privateMode && !token)) {
    const err = new Error('Worker authentication setup is required');
    err.code = 'missing_worker_auth';
    throw err;
  }
  const runnerId = env.PORTABASE_RUNNER_ID;
  if (privateMode && (!env.PORTABASE_RUNNER_CONFIG_DIR || !RUNNER_ID_RE.test(runnerId || '') || !agentToken)) {
    throw Object.assign(new Error('private_runner_setup_required'), { code: 'private_runner_setup_required' });
  }
  if (privateMode && env.PORTABASE_RUNTIME_CONFIG) {
    throw Object.assign(new Error('private_config_override_refused'), { code: 'private_config_override_refused' });
  }
  const binding = privateMode ? { version: 2, runnerId } : {};
  let journal;
  if (privateMode) {
    const origin = new URL(cloudUrl(baseUrl, '/api/cloud/jobs')).origin;
    journal = await createCompletionJournal({ directory: env.PORTABASE_RUNNER_CONFIG_DIR,
      owner: runnerJournalOwner(agentToken), runnerId, origin });
    const completions = await journal.pending();
    if (completions.some(row => row.state === 'execution_unknown')) {
      throw Object.assign(new Error('Execution outcome requires private runner review'), { code: 'job_execution_unknown' });
    }
    if (completions.length) {
      let reconciled = 0;
      for (const completion of completions.slice(0, 10)) {
        try {
          const response = await postJob(fetchImpl, { baseUrl, token, agentToken, body: completion.report });
          await journal.acknowledge(completion, response); reconciled++;
        } catch (error) { throw Object.assign(new Error('Job result acknowledgement unavailable'), { code: 'job_result_unconfirmed', cause: error }); }
      }
      return { idle: false, job: null, reconciled: true, completionCount: reconciled };
    }
  }
  const claims = privateMode ? await createClaimJournal({ directory: env.PORTABASE_RUNNER_CONFIG_DIR,
    owner: runnerJournalOwner(agentToken), runnerId, origin: new URL(baseUrl).origin }) : null;
  const claimRequest = claims ? await claims.request() : { type: 'claim', ...binding };
  const claimed = await postJob(fetchImpl, { baseUrl, token, agentToken: privateMode ? agentToken : undefined, body: claimRequest });
  if (claims) await claims.accept(claimRequest, claimed);
  const job = claimed.job || null;
  if (!job) { if (claims) await claims.settle(claimRequest, null); return { idle: true, job: null }; }
  if (claims) {
    const completed = await journal.completed(job);
    if (completed) {
      await journal.acknowledge(completed, claimed);
      await claims.settle(claimRequest, job);
      return { idle: false, job: null, reconciled: true, completionCount: 0 };
    }
    if (job.status !== 'running') throw Object.assign(new Error('claim_assignment_conflict'), { code: 'claim_assignment_conflict' });
  }
  let executionFinished = false;
  let journalAttempted = false, journalBinding;
  try {
    let childEnv = env;
    let execution = { job, configPath: undefined, cwd: process.cwd() };
    if (privateMode) {
      if (job.version !== 2 || job.runnerId !== runnerId || job.payload?.runnerId !== runnerId) {
        throw Object.assign(new Error('runner_binding_mismatch'), { code: 'runner_binding_mismatch' });
      }
      if (!Number.isSafeInteger(job.admission?.maxBytes) || job.admission.maxBytes <= 0) {
        throw Object.assign(new Error('invalid_job_capsule_limit'), { code: 'invalid_job_capsule_limit' });
      }
      childEnv = { ...env, PORTABASE_JOB_MAX_CAPSULE_BYTES: String(job.admission.maxBytes), PORTABASE_JOB_COMPLETION_REPORTER: 'server' };
      for (const key of Object.keys(childEnv)) if (/^PORTABASE_CLOUD_TOKEN$/i.test(key)) delete childEnv[key];
      execution = await resolvePrivateJob(job, { directory: env.PORTABASE_RUNNER_CONFIG_DIR, runnerId,
        projectRef: env.PORTABASE_PROJECT_REF, targetRef: env.PORTABASE_TARGET_PROJECT_REF,
        ...(job.type === 'replay' ? privateReplayReviewOptions(env) : {}) });
    } else if (job.version === 2 || job.payload?.version === 2) {
      throw Object.assign(new Error('private_runner_setup_required'), { code: 'private_runner_setup_required' });
    }
    assertWorkerMayRun(execution.job, env);
    let argv;
    if (execution.restorePlan !== undefined) {
      // This is a distinct child protocol, not a bypass of engineArgvForJob's
      // guard. The child revalidates this exact revision and consumes snapshots.
      childEnv = { ...childEnv, PORTABASE_PRIVATE_CONFIG_REVISION_SHA256: execution.configRevisionSha256 };
      argv = [process.execPath, fileURLToPath(new URL('../../utility/private-replay.mjs', import.meta.url)),
        job.payload.configRef, String(job.payload.configRevision)];
    } else argv = engineArgvForJob(execution.job, execution);
    if (journal) {
      journalAttempted = true;
      journalBinding = await journal.start(job);
    }
    const executionStartedAt = Date.now();
    const run = spawnImpl
      ? await spawnImpl(argv, { cwd: execution.cwd, env: childEnv })
      : await spawnEngine(argv, { cwd: execution.cwd, env: childEnv });
    const code = Number(run?.code);
    const status = code === 0 ? 'succeeded' : 'failed';
    executionFinished = true;
    let result = null;
    if (privateMode && status === 'succeeded' && job.type === 'backup') {
      try {
        result = await readPrivateBackupResult({ ...execution.resultContext, startedAt: executionStartedAt });
      } catch {
        // An older engine can complete without the new safe result projection.
        // Do not rerun or turn a completed backup into a failure.
      }
    }
    const report = {
      type: 'finish', ...binding, jobId: job.id, status,
      safeError: status === 'failed' ? publicJobError(`engine_exit_${Number.isFinite(code) ? code : 'unknown'}`) : null,
      ...(result ? { result } : {}),
    };
    const completion = journal ? await journal.finish(journalBinding, report) : null;
    const response = await postJob(fetchImpl, {
      baseUrl,
      token,
      agentToken: privateMode ? agentToken : undefined,
      body: report,
    });
    if (journal) await journal.acknowledge(completion, response);
    if (claims) await claims.settle(claimRequest, job);
    return { idle: false, job, status, code };
  } catch (error) {
    // A failed acknowledgement says nothing about the completed engine result.
    // Never replace it with a second, contradictory failure report or rerun it.
    if (executionFinished) {
      throw Object.assign(new Error('Job result acknowledgement unavailable'), { code: 'job_result_unconfirmed', cause: error });
    }
    if (journalAttempted) {
      // A start marker survives exceptions or crashes. Do not infer failure or
      // rerun: execution may have happened, and only private review can resolve it.
      throw Object.assign(new Error('Execution outcome requires private runner review'), { code: 'job_execution_unknown' });
    }
    const report = {
      type: 'finish', ...binding, jobId: job.id, status: 'failed', safeError: publicJobError(error.code),
    };
    if (journal) {
      // Validation failed before start: persist an explicit non-execution result.
      // Never send an unjournaled failure when its reservation/write fails.
      const completion = await journal.reject(job, report);
      try {
        const response = await postJob(fetchImpl, { baseUrl, token, agentToken, body: report });
        await journal.acknowledge(completion, response);
        await claims.settle(claimRequest, job);
      } catch (failure) {
        throw Object.assign(new Error('Job result acknowledgement unavailable'), { code: 'job_result_unconfirmed', cause: failure });
      }
      throw error;
    }
    await postJob(fetchImpl, {
      baseUrl,
      token,
      agentToken: privateMode ? agentToken : undefined,
      body: report,
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
    console.error(JSON.stringify({ ok: false, error: publicJobError(error.code) }));
    process.exitCode = 1;
  });
}
