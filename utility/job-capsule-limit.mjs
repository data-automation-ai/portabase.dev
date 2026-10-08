import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const JOB_CAPSULE_LIMIT_ENV = 'PORTABASE_JOB_MAX_CAPSULE_BYTES';
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Worker-owned cap. Absence preserves standalone CLI behavior; malformed
 * values must never silently remove the managed-job limit. */
export function jobCapsuleLimit(env = process.env) {
  const raw = env[JOB_CAPSULE_LIMIT_ENV];
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) fail('invalid_job_capsule_limit');
  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes) || bytes < 0) fail('invalid_job_capsule_limit');
  return bytes;
}

/** Count the full final upload tree, including ciphertext and sidecar files.
 * Reject links and special files so recursive transports cannot copy bytes that
 * the size check ignored. The worker must keep this completed tree immutable.
 * This is not source-size accounting, a staging-disk cap, or bandwidth metering:
 * compression, cached source objects and transport retries affect those differently.
 */
export async function enforceJobCapsuleLimit(capsuleDir, {
  env = process.env, filesystem = { lstat, readdir, realpath },
} = {}) {
  const maxBytes = jobCapsuleLimit(env);
  if (maxBytes === null) return null;
  let bytes = 0, files = 0;
  const root = resolve(capsuleDir);
  const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  async function visit(path, isRoot = false) {
    const info = await filesystem.lstat(path);
    if (info.isSymbolicLink()) fail('job_capsule_file_refused');
    if (info.isDirectory()) {
      const names = await filesystem.readdir(path);
      for (const name of names) await visit(join(path, name));
    } else if (!isRoot && info.isFile()) {
      if (!Number.isSafeInteger(info.size) || info.size < 0 || !Number.isSafeInteger(bytes + info.size)) fail('job_capsule_size_unavailable');
      bytes += info.size;
      files++;
      if (bytes > maxBytes) fail('job_capsule_limit_exceeded');
    } else fail('job_capsule_file_refused');
  }
  try {
    if (!samePath(await filesystem.realpath(root), root)) fail('job_capsule_file_refused');
    await visit(root, true);
  } catch (error) {
    if (['job_capsule_file_refused', 'job_capsule_size_unavailable', 'job_capsule_limit_exceeded'].includes(error?.code)) throw error;
    fail('job_capsule_size_unavailable');
  }
  return { bytes, files, maxBytes };
}
