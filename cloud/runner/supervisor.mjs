import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pullOnce, spawnEngine } from './worker.mjs';
import { RUNNER_ID_RE } from './config-reference.mjs';
import { runnerJournalOwner } from './completion-journal.mjs';
import { validatePrivateDirectory } from './private-config.mjs';
import { acquireSupervisorLease } from './supervisor-lease.mjs';
import { loadPrivateRuntimeSecrets } from './runtime-secrets.mjs';

const failure = code => Object.assign(new Error(code), { code });
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))
    || Number(value) < min || Number(value) > max) throw failure('invalid_supervisor_settings');
  return Number(value);
}

export function supervisorSettings(env = process.env) {
  const settings = {
    pollMs: integer(env.PORTABASE_RUNNER_POLL_MS, 30000, 1000, 300000),
    retryBaseMs: integer(env.PORTABASE_RUNNER_RETRY_BASE_MS, 1000, 1000, 300000),
    retryMaxMs: integer(env.PORTABASE_RUNNER_RETRY_MAX_MS, 60000, 1000, 300000),
    requestTimeoutMs: integer(env.PORTABASE_RUNNER_REQUEST_TIMEOUT_MS, 30000, 1000, 120000),
  };
  if (settings.retryMaxMs < settings.retryBaseMs) throw failure('invalid_supervisor_settings');
  return settings;
}

/** Referenced timer keeps the opt-in process alive; shutdown interrupts waiting. */
export function waitForPoll(delay, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolveWait => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolveWait(); };
    const timer = setTimeout(done, delay);
    signal?.addEventListener('abort', done, { once: true });
    if (signal?.aborted) done();
  });
}

function classify(error, observed) {
  if (error?.code === 'supervisor_lease_review_required') return 'supervisor_lease_review_required';
  if (observed.auth) return 'authentication_required';
  if (observed.admission) return 'admission_required';
  if (observed.claimAmbiguous) return 'claim_outcome_unknown';
  const chain = [];
  for (let next = error; next && chain.length < 8 && !chain.includes(next); next = next.cause) chain.push(next);
  const codes = chain.map(row => row?.code);
  if (codes.some(code => ['unauthorized', 'unauthorized_agent', 'runner_not_authorized', 'runner_job_access_required', 'runner_action_refused'].includes(code))) return 'authentication_required';
  if (codes.some(code => ['subscription_required', 'job_exceeds_plan'].includes(code))) return 'admission_required';
  if (codes.some(code => ['job_execution_unknown', 'invalid_completion_journal', 'completion_binding_conflict', 'completion_acknowledgement_mismatch', 'completion_journal_full', 'job_already_executed', 'job_result_conflict', 'invalid_claim_journal', 'claim_response_mismatch', 'claim_assignment_conflict', 'claim_sequence_exhausted', 'claim_reference_conflict', 'claim_sequence_conflict', 'claim_previous_unfinished', 'runner_execution_pending', 'durable_claim_required', 'invalid_claim_response'].includes(code))) return 'private_review_required';
  if (codes.some(code => typeof code === 'string' && (/binding|mismatch|invalid_|missing_|private_config|private_runner|unsupported_|restore_plan|capsule_/.test(code)))) return 'configuration_required';
  // Retry only known temporary transport/service failures and unconfirmed
  // journal reports. Unknown exceptions require private review, not a tight loop.
  if (observed.temporary || codes.some(code => ['job_result_unconfirmed', 'runner_request_timeout', 'job_request_failed', 'job_service_unavailable', 'queue_changed', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code))) return null;
  return 'private_review_required';
}

/** Durable claims retry the saved request pair after transport loss. Legacy
 * requests remain ambiguous; malformed successful replies require review. */
function boundedFetch(fetchImpl, timeoutMs, observed, signal) {
  return async (url, init) => {
    const body = JSON.parse(init.body), controller = new AbortController();
    const durableClaim = body.type === 'claim' && body.version === 2 && body.claimProtocol === 1;
    if (body.type === 'claim' && signal?.aborted) throw failure('supervisor_stopping');
    let timer, gotResponse = false, responseStatus;
    const work = (async () => {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      gotResponse = true; responseStatus = response.status;
      if ([401, 403].includes(response.status)) observed.auth = true;
      if (response.status === 402) observed.admission = true;
      if (response.status === 429 || response.status >= 500) observed.temporary = true;
      if (body.type === 'claim' && !durableClaim && response.status >= 500) observed.claimAmbiguous = true;
      let data;
      try { data = await response.json(); }
      catch (error) {
        if (response.ok && body.type === 'claim') { if (!durableClaim) observed.claimAmbiguous = true; throw failure('invalid_claim_response'); }
        data = {};
      }
      if (response.ok && body.type === 'claim' && (!data || !Object.hasOwn(data, 'job')
        || data.job !== null && (typeof data.job !== 'object' || Array.isArray(data.job)))) {
        if (!durableClaim) observed.claimAmbiguous = true; throw failure('invalid_claim_response');
      }
      return { ok: response.ok, status: response.status, json: async () => data };
    })();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure('runner_request_timeout')); }, timeoutMs);
    });
    try { return await Promise.race([work, deadline]); }
    catch (error) {
      if (body.type === 'claim' && !durableClaim && (!gotResponse || responseStatus >= 200 && responseStatus < 300)) observed.claimAmbiguous = true;
      throw error;
    } finally { clearTimeout(timer); }
  };
}

/** One supervisor per private runner root. This loop is not a scheduler, service
 * provisioner, credential refresher, distributed lease, or sealed-key store.
 * Injected hooks are for local tests; no command or module comes from an API. */
export async function runSupervisor({ env = process.env, signal, fetchImpl = globalThis.fetch,
  pull = pullOnce, spawnImpl, wait = waitForPoll, random = Math.random, onStatus = () => {} } = {}) {
  const settings = supervisorSettings(env);
  if (!env.PORTABASE_CLOUD_URL || !RUNNER_ID_RE.test(env.PORTABASE_RUNNER_ID || '')
    || !/^[a-z0-9]{20}$/.test(env.PORTABASE_PROJECT_REF || '') || env.PORTABASE_RUNTIME_CONFIG) throw failure('private_runner_setup_required');
  runnerJournalOwner(env.PORTABASE_AGENT_TOKEN);
  await validatePrivateDirectory(env.PORTABASE_RUNNER_CONFIG_DIR);
  const origin = new URL(env.PORTABASE_CLOUD_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw failure('invalid_cloud_url');
  const privateEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/^PORTABASE_CLOUD_TOKEN$/i.test(key)));
  const emit = row => { try { onStatus(row); } catch { /* Private status output cannot change execution outcomes. */ } };
  let lease;
  try { lease = await acquireSupervisorLease({ directory: env.PORTABASE_RUNNER_CONFIG_DIR,
    owner: runnerJournalOwner(env.PORTABASE_AGENT_TOKEN), runnerId: env.PORTABASE_RUNNER_ID, origin: origin.origin }); }
  catch { emit({ state: 'halted', reason: 'supervisor_lease_review_required' }); return { state: 'halted', reason: 'supervisor_lease_review_required', polls: 0 }; }
  let failures = 0, polls = 0;
  const draining = () => emit({ state: 'draining' });
  signal?.addEventListener('abort', draining, { once: true });
  try {
    emit({ state: 'starting' });
    while (!signal?.aborted) {
      const observed = {}; let delay = settings.pollMs;
      emit({ state: 'polling' }); polls++;
      try {
        await lease.assertOwned();
        const stored = await loadPrivateRuntimeSecrets({ directory: env.PORTABASE_RUNNER_CONFIG_DIR,
          projectRef: env.PORTABASE_PROJECT_REF });
        const executionEnv = { ...privateEnv, ...stored.env };
        const timedFetch = boundedFetch(fetchImpl, settings.requestTimeoutMs, observed, signal);
        await pull({ baseUrl: origin.origin, env: executionEnv,
          spawnImpl: async (argv, options) => { await lease.assertOwned(); return spawnImpl ? spawnImpl(argv, options) : spawnEngine(argv, options); },
          fetchImpl: async (url, init) => { await lease.assertOwned(); return timedFetch(url, init); } });
        failures = 0;
      } catch (error) {
        if (error?.code === 'supervisor_stopping' && signal?.aborted) break;
        const reason = classify(error, observed);
        if (reason) { emit({ state: 'halted', reason }); return { state: 'halted', reason, polls }; }
        failures = Math.min(failures + 1, 20);
        const cap = Math.min(settings.retryMaxMs, settings.retryBaseMs * 2 ** (failures - 1));
        const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
        delay = Math.max(1000, Math.min(settings.retryMaxMs, Math.floor(cap * (0.5 + jitter * 0.5))));
        emit({ state: 'backoff', retryInMs: delay });
      }
      if (signal?.aborted) break;
      emit({ state: 'waiting', nextPollInMs: delay });
      await wait(delay, signal);
    }
    emit({ state: 'stopped' }); return { state: 'stopped', polls };
  } finally {
    signal?.removeEventListener('abort', draining);
    try { await lease.release(); }
    catch (error) { emit({ state: 'halted', reason: 'supervisor_lease_review_required' }); throw error; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController(), stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    if (process.argv.length !== 2) throw failure('invalid_supervisor_settings');
    const result = await runSupervisor({ signal: controller.signal, onStatus: row => console.log(JSON.stringify(row)) });
    if (result.state === 'halted') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ state: 'halted', reason: error?.code === 'supervisor_lease_review_required' ? error.code : 'supervisor_setup_or_storage_required' })); process.exitCode = 1;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
