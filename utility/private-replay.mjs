import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configReference } from '../cloud/runner/config-reference.mjs';
import { resolvePrivateJob, validatePrivateDirectory } from '../cloud/runner/private-config.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
function positiveInteger(value, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail('private_replay_setup_required');
  return Number(value);
}

// Explicit runner configuration only. No URL, queued payload, CLI flag, or
// implicit/unlimited default may supply a passphrase or archive review limit.
export function privateReplayReviewOptions(env) {
  return { passphrase: env.PORTABASE_ENCRYPTION_PASSPHRASE,
    maxCipherBytes: positiveInteger(env.PORTABASE_REVIEW_MAX_CIPHER_BYTES, true),
    maxExpandedBytes: positiveInteger(env.PORTABASE_REVIEW_MAX_EXPANDED_BYTES, true) };
}

/** Fixed private child entry. executePrepared is an in-process synthetic-test
 * seam, never an environment setting, serialized field, or command-line flag.
 * Local logs/evidence stay in the runner; this module makes no Cloud requests.
 */
export async function runPrivateReplayChild(argv, { env = process.env, executePrepared } = {}) {
  if (!Array.isArray(argv) || argv.length !== 2 || env.PORTABASE_RUNTIME_CONFIG) fail('private_replay_setup_required');
  if (!executePrepared && env !== process.env) fail('private_replay_environment_required');
  const configRevision = positiveInteger(argv[1]);
  const reference = configReference({ version: 2, runnerId: env.PORTABASE_RUNNER_ID, configRef: argv[0], configRevision });
  const expectedRevision = env.PORTABASE_PRIVATE_CONFIG_REVISION_SHA256;
  if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) fail('private_replay_setup_required');
  const admissionMaxBytes = positiveInteger(env.PORTABASE_JOB_MAX_CAPSULE_BYTES);
  const options = { directory: env.PORTABASE_RUNNER_CONFIG_DIR, runnerId: reference.runnerId,
    projectRef: env.PORTABASE_PROJECT_REF, targetRef: env.PORTABASE_TARGET_PROJECT_REF, ...privateReplayReviewOptions(env) };
  const execution = await resolvePrivateJob({ type: 'replay', payload: reference, admission: { maxBytes: admissionMaxBytes } }, options);
  if (!execution.restorePlan || execution.configRevisionSha256 !== expectedRevision) fail('private_replay_config_changed');
  const { preparePrivateReplay } = await import('./private-replay-prepare.mjs');
  const prepared = await preparePrivateReplay({ ...options, capsulePath: execution.job.payload.capsulePath,
    planRef: execution.restorePlan.binding.planRef, expectedBindingSha256: execution.restorePlan.bindingSha256, admissionMaxBytes });
  try {
    // Evidence survives cleanup of the private execution snapshot.
    const base = join(execution.cwd, '.replay-evidence');
    try { await mkdir(base, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await validatePrivateDirectory(base);
    const evidenceDirectory = join(base, randomUUID());
    await mkdir(evidenceDirectory, { mode: 0o700 });
    await validatePrivateDirectory(evidenceDirectory);
    const run = executePrepared || (await import('./portabase.mjs')).runPreparedPrivateReplay;
    if (typeof run !== 'function') fail('private_restore_execution_unavailable');
    const result = await run(prepared, { directory: execution.cwd, targetRef: options.targetRef,
      confirmTarget: options.targetRef, evidenceDirectory });
    if (result?.status !== 'SELECTIVE_RESTORE_VERIFIED') fail('private_replay_not_verified');
    return result;
  } finally { await prepared.cleanup(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runPrivateReplayChild(process.argv.slice(2));
  } catch {
    // Raw paths, provider diagnostics and private rows are not serialized.
    console.error('Private replay failed. No success was recorded.');
    process.exitCode = 1;
  }
}
