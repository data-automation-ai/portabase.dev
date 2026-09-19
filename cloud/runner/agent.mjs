/**
 * Per-subscriber Cloud Runner.
 * Sleeps empty until a transfer starts. Keys are sealed to this process only.
 * The Portabase control plane never stores keys or capsule bytes.
 */

import { randomUUID } from 'node:crypto';
import { describeEngineJob } from './engine-job.mjs';

export const RUNNER_STATUSES = Object.freeze(['sleeping', 'ready', 'running', 'error', 'stopped']);
export const FORBIDDEN_CONTROL_ACTIONS = Object.freeze(['get-key', 'ssh', 'dump-keys', 'exec-shell', 'read-capsule']);

export function createSleepingRunner({
  subscriberId,
  region = 'us-east-1',
  now = () => new Date().toISOString(),
} = {}) {
  if (!subscriberId) {
    const err = new Error('subscriberId is required');
    err.code = 'missing_subscriber';
    throw err;
  }
  const runnerId = `run_${randomUUID()}`;
  return {
    runnerId,
    subscriberId,
    status: 'sleeping',
    region,
    engine: 'free-open-source-cli',
    sealedKeysPresent: false,
    createdAt: now(),
    updatedAt: now(),
    lastJobId: null,
    isolation: 'per-subscriber-container',
    note: 'Empty sleeping runner. Keys arrive from the browser seal URL only.',
  };
}

export function runnerPublicRecord(runner) {
  return {
    runnerId: runner.runnerId,
    subscriberId: runner.subscriberId,
    status: runner.status,
    region: runner.region,
    engine: runner.engine,
    sealedKeysPresent: Boolean(runner.sealedKeysPresent),
    createdAt: runner.createdAt,
    updatedAt: runner.updatedAt,
    lastJobId: runner.lastJobId || null,
    isolation: runner.isolation,
  };
}

export function rejectControlPlaneAction(action) {
  const a = String(action || '').toLowerCase();
  if (FORBIDDEN_CONTROL_ACTIONS.includes(a) || a === 'getkey' || a.includes('ssh')) {
    const err = new Error('Control plane cannot SSH or get keys from a runner');
    err.code = 'control_plane_key_access_refused';
    err.status = 403;
    throw err;
  }
  return true;
}

export function acceptBrowserSeal(runner, { sealedEnvelope } = {}, now = () => new Date().toISOString()) {
  if (!runner) {
    const err = new Error('runner_missing');
    err.code = 'runner_missing';
    throw err;
  }
  if (!sealedEnvelope || typeof sealedEnvelope !== 'object') {
    const err = new Error('sealed envelope required');
    err.code = 'seal_required';
    throw err;
  }
  if (sealedEnvelope.plaintext || sealedEnvelope.passphrase || sealedEnvelope.serviceRole) {
    const err = new Error('Seal must be ciphertext to the runner — plaintext keys refused on this hop');
    err.code = 'plaintext_seal_refused';
    throw err;
  }
  if (!sealedEnvelope.ciphertext || !sealedEnvelope.alg) {
    const err = new Error('sealed envelope missing ciphertext');
    err.code = 'invalid_seal';
    throw err;
  }
  return {
    ...runner,
    status: runner.status === 'sleeping' ? 'ready' : runner.status,
    sealedKeysPresent: true,
    updatedAt: now(),
  };
}

export function startTransfer(runner, jobSpec = {}, now = () => new Date().toISOString()) {
  if (!runner?.sealedKeysPresent) {
    const err = new Error('Runner has no sealed keys — browser must seal to the runner first');
    err.code = 'runner_unsealed';
    throw err;
  }
  if (runner.status !== 'sleeping' && runner.status !== 'ready') {
    const err = new Error(`Runner cannot start a transfer from status=${runner.status}`);
    err.code = 'runner_not_idle';
    throw err;
  }
  const engine = describeEngineJob(jobSpec);
  const jobId = jobSpec.jobId || `job_${randomUUID()}`;
  return {
    runner: {
      ...runner,
      status: 'running',
      lastJobId: jobId,
      updatedAt: now(),
    },
    job: {
      jobId,
      customerId: runner.subscriberId,
      runnerId: runner.runnerId,
      region: runner.region,
      status: 'running',
      phase: 'capture',
      command: engine.command,
      engine: engine.engine,
      destinationKind: jobSpec.destinationKind || null,
      createdAt: now(),
    },
    engine,
  };
}

export function sleepRunner(runner, now = () => new Date().toISOString()) {
  return {
    ...runner,
    status: 'sleeping',
    sealedKeysPresent: false,
    updatedAt: now(),
    note: 'Job finished. Ephemeral keys discarded. Runner sleeps empty.',
  };
}
