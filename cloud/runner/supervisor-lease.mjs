import { randomBytes } from 'node:crypto';
import { lstat, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePrivateDirectory } from './private-config.mjs';
import { RUNNER_ID_RE } from './config-reference.mjs';

export const SUPERVISOR_LOCK_NAME = '.supervisor.lock';
const fail = () => Object.assign(new Error('Supervisor lease requires private review'), { code: 'supervisor_lease_review_required' });
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

/** Local-filesystem exclusion only. Never infer abandonment from a PID or age.
 * Trusted ownership/ACLs are required: portable Node has no unlink-by-handle.
 */
export async function acquireSupervisorLease({ directory, owner, runnerId, origin }) {
  let file;
  try {
    if (!/^[a-f0-9]{64}$/.test(owner || '') || !RUNNER_ID_RE.test(runnerId || '')
      || !origin?.startsWith('https://') || new URL(origin).origin !== origin) throw fail();
    const root = await validatePrivateDirectory(directory), rootIdentity = await lstat(root);
    const path = join(root, SUPERVISOR_LOCK_NAME);
    // 'wx' is the sole acquisition primitive. Existing locks are never opened,
    // modified, removed or stolen, even if malformed or apparently abandoned.
    file = await open(path, 'wx+', 0o600);
    const identity = await file.stat();
    const bytes = Buffer.from(JSON.stringify({ version: 1, owner, runnerId, origin,
      nonce: randomBytes(32).toString('hex'), pid: process.pid, acquiredAt: new Date().toISOString() }));
    async function checkPath() {
      await validatePrivateDirectory(root);
      const currentRoot = await lstat(root), current = await lstat(path), held = await file.stat();
      if (!sameFile(currentRoot, rootIdentity) || !sameFile(current, identity) || !sameFile(held, identity)
        || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || held.nlink !== 1) throw fail();
      return held;
    }
    await checkPath();
    await file.writeFile(bytes); await file.sync();
    let closed = false, released = false;
    async function assertOwned() {
      if (closed) throw fail();
      try {
        const before = await checkPath();
        if (before.size !== bytes.length) throw fail();
        const actual = Buffer.alloc(bytes.length + 1); let offset = 0;
        while (offset < actual.length) {
          const { bytesRead } = await file.read(actual, offset, actual.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        const after = await checkPath();
        if (offset !== bytes.length || !actual.subarray(0, offset).equals(bytes)
          || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw fail();
      } catch { throw fail(); }
    }
    await assertOwned();
    return {
      assertOwned,
      async release() {
        if (released) return;
        try {
          await assertOwned();
          await unlink(path);
          released = true;
        } catch { throw fail(); }
        finally { closed = true; await file.close(); }
      },
    };
  } catch {
    // A failed acquisition/write leaves its reservation for manual review.
    // Never delete a path whose current ownership could not be established.
    await file?.close().catch(() => {});
    throw fail();
  }
}
