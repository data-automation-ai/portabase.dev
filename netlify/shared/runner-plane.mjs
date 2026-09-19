/**
 * Control-plane view of Cloud Runners.
 * Lifecycle + job metadata / hashes only. Never keys, capsule bytes, or SSH.
 */

import { findForbiddenField } from '../../cloud/control-plane/forbidden.mjs';
import {
  FORBIDDEN_CONTROL_ACTIONS,
  createSleepingRunner,
  rejectControlPlaneAction,
  runnerPublicRecord,
} from '../../cloud/runner/agent.mjs';

export const RUNNER_METADATA_FIELDS = Object.freeze([
  'runnerId',
  'subscriberId',
  'status',
  'region',
  'engine',
  'sealedKeysPresent',
  'createdAt',
  'updatedAt',
  'lastJobId',
  'isolation',
  'destinationKind',
  'phase',
  'jobId',
  'action',
]);

export function assertControlPlaneRunnerBody(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    const err = new Error('Runner body must be an object');
    err.code = 'invalid_body';
    err.status = 400;
    throw err;
  }
  const hit = findForbiddenField(body);
  if (hit) {
    const err = new Error(`Forbidden secret-shaped field at ${hit}`);
    err.code = 'forbidden_secret_shape';
    err.status = 400;
    throw err;
  }
  if (body.ciphertext || body.sealedEnvelope || body.keys || body.ssh || body.privateKey) {
    const err = new Error('Sealed keys go to the runner, never the Portabase control plane');
    err.code = 'keys_must_seal_to_runner';
    err.status = 400;
    throw err;
  }
  rejectControlPlaneAction(body.action);
  return true;
}

export function provisionSleepingRunner({ subscriberId, region } = {}) {
  return runnerPublicRecord(createSleepingRunner({ subscriberId, region }));
}

export function controlPlaneJobMetadata(job = {}) {
  return {
    jobId: job.jobId || null,
    customerId: job.customerId || job.subscriberId || null,
    status: job.status || null,
    phase: job.phase || null,
    createdAt: job.createdAt || null,
    destinationKind: job.destinationKind || null,
    runnerId: job.runnerId || null,
    region: job.region || null,
    capsuleHash: job.capsuleHash || null,
    layerHashes: job.layerHashes || null,
    objectCount: job.objectCount ?? null,
    sizeBytes: job.sizeBytes ?? null,
    errorCode: job.errorCode || null,
    errorMessage: job.errorMessage || null,
  };
}

export { FORBIDDEN_CONTROL_ACTIONS, rejectControlPlaneAction };
