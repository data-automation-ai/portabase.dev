import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { supabaseAccess, projectRef } from './supabase-access.mjs';
const ENGINE = fileURLToPath(new URL('../../utility/portabase.mjs', import.meta.url));
const PROTECTED_REF = 'eoiqvdmvgaurlecdzqkp';
const fail = code => { throw new Error(code); };
// Phase weights are estimates, not byte-accurate measurements. Database tables
// can vary wildly in size; only Storage reports a completed/total object count.
export function estimateCapturePercent(previous, event) {
  const phase = typeof event === 'string' ? event : event?.phase;
  const milestones = { 'database-manifest': 2, database: 5, storage: 45, functions: 78,
    package: 85, encrypt: 91, transfer: 96, done: 99 };
  let estimate = milestones[phase];
  if (phase === 'storage' && Number.isSafeInteger(event?.completed) && Number.isSafeInteger(event?.total)
    && event.total > 0 && event.completed >= 0) {
    estimate = 45 + Math.floor(30 * Math.min(event.completed, event.total) / event.total);
  }
  return Math.max(0, Math.min(99, Math.max(previous || 0, estimate ?? 0)));
}
async function directorySize(root) {
  let size = 0;
  for (const e of await readdir(root, { withFileTypes: true })) {
    const path = join(root,e.name);
    if (e.isSymbolicLink()) fail('unexpected_work_file');
    size += e.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return size;
}
function runEngine(args, env, root, maxBytes, progress, { spawnImpl = spawn, signal } = {}) {
  return new Promise((resolveJob, reject) => {
    // Subprocess output can contain private schema and error details. It stays
    // inside the enclave and is NEVER forwarded to logs or the control plane.
    const child = spawnImpl(process.execPath, [ENGINE, ...args], {
      cwd: root, env: { PATH: process.env.PATH, HOME: root, LANG: 'C.UTF-8',
        NODE_ENV: 'production', TMPDIR: root, ...env }, stdio: ['ignore','pipe','pipe'] });
    let rejected = false, pendingProgress = '';
    const stop = code => { if (!rejected) { rejected = true; child.kill('SIGKILL'); reject(new Error(code)); } };
    const abort = () => stop('credential_refresh_failed');
    if(signal?.aborted)abort(); else signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data', chunk => {
      pendingProgress = (pendingProgress + chunk.toString()).slice(-8192);
      const lines = pendingProgress.split('\n');
      pendingProgress = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('@portabase ')) continue;
        try {
          const event = JSON.parse(line.slice(11));
          if (['database-manifest','database','storage','functions','package','encrypt','transfer','done'].includes(event?.phase))
            progress({ phase: event.phase, completed: event.completed, total: event.total });
        } catch { /* An untrusted or partial progress line is ignored. */ }
      }
    });
    child.stderr.on('data', () => {});
    const deadline = setTimeout(() => stop('job_time_limit'), 90 * 60 * 1000);
    // Includes encrypted, raw and compressed intermediates. A dedicated VM also
    // bounds disk and memory. Never silently truncate data to make a quota fit.
    let measuring = false;
    const monitor = setInterval(async () => {
      if (measuring) return; measuring = true;
      try { if (await directorySize(root) > maxBytes * 4 + 1024 ** 3) stop('job_disk_limit'); }
      catch { stop('job_disk_measurement_failed'); }
      finally { measuring = false; }
    }, 3000);
    child.on('error', () => { clearTimeout(deadline); clearInterval(monitor); stop('engine_unavailable'); });
    child.on('close', code => {
      signal?.removeEventListener('abort',abort);
      clearTimeout(deadline); clearInterval(monitor); pendingProgress = '';
      if (rejected) return;
      if (code !== 0) reject(new Error('engine_job_failed')); else resolveJob();
    });
  });
}
export function confidentialJobSnapshot(job) {
  return { id: job.id, operation: job.operation, state: job.state, phase: job.phase,
    startedAt: job.startedAt, finishedAt: job.finishedAt || null,
    estimatedPercent: job.operation === 'backup' ? (job.state === 'complete' ? 100 : job.estimatedPercent) : null,
    progressKind: job.operation === 'backup' ? 'estimate' : null,
    durationMs: job.finishedAt ? Date.parse(job.finishedAt) - Date.parse(job.startedAt) : null,
    phaseTimings: job.phaseTimings.map(({ phase, startedAt, finishedAt }) => ({ phase, startedAt,
      durationMs: finishedAt ? Date.parse(finishedAt) - Date.parse(startedAt) : null })),
    result: job.result || null, error: job.error || null, scopeSummary: job.scopeSummary || null };
}
export function engineJobs({ run = runEngine, access = supabaseAccess, platform = process.platform } = {}) {
  const jobs = new Map();
  const snapshot = confidentialJobSnapshot;
  return {
    async start({ owner, sourceRef, targetRef, sourceToken, targetToken, passphrase, provider, maxBytes, operation = 'backup', capsuleId, scope, scopeSummary, authorize, refreshAccess }) {
      if (platform !== 'linux') fail('cloud_runner_required');
      if (!/^[a-f0-9]{64}$/.test(owner || '') || !/^[A-Za-z0-9_-]{43}$/.test(passphrase || '')) fail('invalid_job');
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 ** 3) fail('invalid_job_limit');
      if ([...jobs.values()].some(j => j.owner === owner && j.state === 'running')) fail('job_already_running');
      projectRef(sourceRef); projectRef(targetRef);
      if (sourceRef === targetRef || targetRef === PROTECTED_REF) fail('unsafe_restore_target');
      if (!['backup','restore'].includes(operation)) fail('unsupported_operation');
      const source = access(sourceToken), target = access(targetToken);
      const [sourceStatus, targetStatus] = await Promise.all([source.inspect(sourceRef),target.inspect(targetRef)]);
      if (!targetStatus.blank) fail('restore_target_not_blank');
      if (sourceStatus.measuredBytes > maxBytes) fail('plan_size_limit');
      const prior = operation === 'restore' ? jobs.get(capsuleId) : null;
      if (operation === 'restore' && (!prior || prior.owner !== owner || prior.state !== 'complete' || !prior.capsulePath || prior.sourceRef !== sourceRef)) fail('capsule_not_available');
      if (operation === 'backup' && (!scope || typeof scope.storage !== 'boolean' || typeof scope.auth !== 'boolean' || typeof scope.functions !== 'boolean')) fail('source_scope_required');
      // Charge a manual run only after destination, size and capsule validation.
      if(authorize)await authorize();
      const root = await mkdtemp('/tmp/portabase-job-');
      const job = { id: randomUUID(), owner, sourceRef, targetRef, operation, root, vaultRequested: !!provider, scopeSummary: scopeSummary || null,
        state: 'running', phase: 'preflight',
        startedAt: new Date().toISOString(), phaseTimings: [], estimatedPercent: operation === 'backup' ? 0 : null };
      const phase = name => {
        if (job.phase === name) return;
        const at = new Date().toISOString(), prior = job.phaseTimings.at(-1);
        if (prior && !prior.finishedAt) prior.finishedAt = at;
        job.phase = name;
        job.phaseTimings.push({ phase: name, startedAt: at });
      };
      job.phaseTimings.push({ phase: job.phase, startedAt: job.startedAt });
      jobs.set(job.id,job);
      job.completion = (async () => {
        let refreshTimer, refreshPromise;
        try {
          // A full Auth export requires postgres membership. The source PG
          // wrapper then forces read-only transactions for every connection.
          const credential = operation === 'backup' ? await source.credentials(sourceRef,{readOnly:false}) : await target.credentials(targetRef,{readOnly:false});
          const refreshFile=join(root,'database-access.json'), abort=new AbortController();
          const persistAccess=async token=>{
            await writeFile(refreshFile+'.next',JSON.stringify({ref:credential.ref,readOnly:credential.readOnly,enforceReadOnly:operation==='backup',accessToken:token}),{mode:0o600});
            await rename(refreshFile+'.next',refreshFile);
          };
          await persistAccess(credential.managementToken);
          if(refreshAccess)refreshTimer=setInterval(()=>{
            if(refreshPromise)return;
            refreshPromise=(async()=>{
              try{await persistAccess(await refreshAccess());}catch{abort.abort();}
            })().finally(()=>{refreshPromise=null;});
          },60000);
          const config = { projectRef: sourceRef, backupDirectory: join(root,'capsules'), statusDirectory: join(root,'status'),
            ...(operation === 'backup' ? { capture: scope } : {}),
            encryption: { passphraseEnv: 'PORTABASE_ENCRYPTION_PASSPHRASE' }, provider: provider || { type: 'local', maxBytes, allowLargeLocal: true } };
          const env = { PORTABASE_RUNTIME_CONFIG: JSON.stringify(config), PORTABASE_ENCRYPTION_PASSPHRASE: passphrase,
            PORTABASE_JOB_MAX_CAPSULE_BYTES: String(maxBytes), PORTABASE_EVIDENCE_DIRECTORY: join(root,'evidence'),
            PORTABASE_DB_REFRESH_FILE:refreshFile, PORTABASE_CONFIDENTIAL_RUNNER:'1',
            SUPABASE_ACCESS_TOKEN: credential.managementToken };
          let args;
          if (operation === 'backup') {
            Object.assign(env, { SUPABASE_PROJECT_REF: sourceRef, SUPABASE_URL: `https://${sourceRef}.supabase.co`, SUPABASE_DB_URL: credential.databaseUrl, SUPABASE_SERVICE_ROLE_KEY: credential.serviceKey });
            args = ['backup','--progress'];
          } else {
            Object.assign(env, { PORTABASE_TARGET_PROJECT_REF: targetRef, PORTABASE_TARGET_SUPABASE_URL: `https://${targetRef}.supabase.co`,
              PORTABASE_TARGET_DB_URL: credential.databaseUrl, PORTABASE_TARGET_SERVICE_ROLE_KEY: credential.serviceKey });
            args = ['replay', '--capsule', prior.capsulePath, '--confirm-target', targetRef];
          }
          await run(args,env,root,maxBytes,event => {
            const name = typeof event === 'string' ? event : event?.phase;
            if (operation === 'backup') job.estimatedPercent = estimateCapturePercent(job.estimatedPercent,event);
            if (typeof name === 'string' && name !== 'done') phase(name);
          },{signal:abort.signal});
          if (operation === 'backup') {
            const status = JSON.parse(await readFile(join(root,'status/latest.json'),'utf8'));
            if (status.state !== 'COMPLETE' || !/^[a-z0-9_.-]+$/i.test(status.capsule || '')) fail('capture_incomplete');
            if (Number(status.sizeBytes) > maxBytes) fail('plan_size_limit');
            job.capsulePath = join(root,'capsules',status.capsule);
            job.result = { capsuleId: status.capsule, bytes: status.sizeBytes, ciphertextSha256: status.capsuleHash,
              captureComplete: true, vaultVerified: !!provider && status.destinationVerified === true, restoreVerified: false,
              destinationKind: provider?.type || 'temporary_runner', temporaryCapsuleRetained: !provider,
              measuredSourceBytes: sourceStatus.measuredBytes };
          } else {
            const files = await readdir(join(root,'evidence'));
            const name = files.filter(n => n.endsWith('.json')).sort().at(-1);
            if (!name) fail('restore_evidence_missing');
            const evidence = JSON.parse(await readFile(join(root,'evidence',name),'utf8'));
            job.result = { captureComplete: true, restoreVerified: evidence.status === 'RECOVERY_DATA_PATH_VERIFIED',
              verificationScope: 'database_inventory_and_row_counts;storage_object_hashes;function_status',
              databaseContentIdentityVerified: false, applicationBehaviorVerified: false, evidence };
            if (!job.result.restoreVerified) fail('restore_verification_incomplete');
            await rm(prior.root,{recursive:true,force:true});
            prior.capsulePath = null;
            prior.result.temporaryCapsuleRetained = false;
          }
          job.state = 'complete'; phase('complete');
        } catch (error) { job.state = 'failed'; job.error = /^[a-z0-9_]{3,80}$/.test(error.message) ? error.message : 'job_failed'; }
        finally { clearInterval(refreshTimer); if(refreshPromise)await refreshPromise; job.finishedAt = new Date().toISOString();
          const current = job.phaseTimings.at(-1); if (current && !current.finishedAt) current.finishedAt = job.finishedAt;
          await rm(join(root,'database-access.json'),{force:true});
          if (!job.capsulePath) await rm(root,{recursive:true,force:true}); }
      })();
      return snapshot(job);
    },
    status(owner,id) { const j=jobs.get(id); if (!j || j.owner!==owner) fail('job_not_found'); return snapshot(j); },
    list(owner) { return [...jobs.values()].filter(j=>j.owner===owner).map(snapshot); },
    async wait(owner,id) { const j=jobs.get(id); if (!j || j.owner!==owner) fail('job_not_found'); await j.completion; return snapshot(j); },
  };
}
