import React, { useEffect, useRef, useState } from 'react';
import { fetchAgents, fetchCloudJobs, queueCloudJob } from '../lib/cloud-api.js';
import { loadSession } from '../lib/session.js';
import { MAX_PRIVATE_JOB_FILE_BYTES, privateJobReference, privateJobAttemptKey, readPrivateJobAttempt, canRetryPrivateJob, matchingPrivateJob } from '../lib/private-job-reference.js';

function accountIdentity() {
  const session = loadSession();
  if (session?.cloudVersion !== 'supabase' || typeof session.user?.id !== 'string') throw new Error('account_required');
  return `supabase:${session.user.id}`;
}
export function PrivateJobQueue({ agent, onClose }) {
  const [reference, setReference] = useState(null), [phase, setPhase] = useState('empty');
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [job, setJob] = useState(null);
  const attempt = useRef(null), selection = useRef(0), pending = useRef(false), controller = useRef(null), owner = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; selection.current++; controller.current?.abort(); }; }, []);

  async function timed(operation) {
    controller.current = new AbortController();
    const signal = controller.current.signal;
    let timer;
    try {
      return await Promise.race([operation(signal), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.current?.abort(); reject(new Error('request_timeout')); }, 20_000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function importFile(event) {
    const file = event.target.files?.[0], revision = ++selection.current;
    setReference(null); setConfirmed(false); setError(''); setNotice(''); setJob(null); setPhase('empty'); attempt.current = null;
    if (!file) return;
    try {
      if (file.size > MAX_PRIVATE_JOB_FILE_BYTES) throw new Error('oversize');
      const text = await file.text();
      if (new TextEncoder().encode(text).length > MAX_PRIVATE_JOB_FILE_BYTES) throw new Error('oversize');
      const next = privateJobReference(JSON.parse(text), agent);
      const account = accountIdentity();
      const prior = readPrivateJobAttempt(sessionStorage, privateJobAttemptKey(account, next));
      if (!mounted.current || revision !== selection.current) return;
      owner.current = account; attempt.current = prior; setReference(next);
      setPhase(prior ? canRetryPrivateJob(prior) ? 'uncertain' : 'expired' : 'preview');
      if (prior) setNotice('An earlier queue attempt exists for this reference. Check the queue before continuing.');
    } catch {
      if (mounted.current && revision === selection.current) setError('Import a valid opaque job reference for this active runner (maximum 4 KiB). Private configurations, manifests and credentials are not accepted. Nothing from this file was uploaded.');
    }
  }
  async function queue() {
    if (pending.current || !reference || !confirmed || !['preview', 'retry'].includes(phase) || agent.revokedAt || agent.jobAccess !== true) return;
    pending.current = true; setPhase('sending'); setConfirmed(false); setError(''); setNotice('');
    let attempted = false;
    try {
      const result = await timed(async signal => {
        if (accountIdentity() !== owner.current) throw new Error('account_changed');
        const agents = (await fetchAgents()).agents;
        if (signal.aborted) throw new Error('request_timeout');
        if (!Array.isArray(agents) || !agents.some(row => row.id === reference.runnerId && !row.revokedAt && row.jobAccess === true)) throw new Error('runner_unavailable');
        if (attempt.current && !canRetryPrivateJob(attempt.current)) throw new Error('retry_expired');
        if (!attempt.current) {
          const next = { requestId: crypto.randomUUID(), startedAt: Date.now() };
          sessionStorage.setItem(privateJobAttemptKey(owner.current, reference), JSON.stringify(next));
          attempt.current = next;
        }
        if (accountIdentity() !== owner.current || signal.aborted) throw new Error('account_changed');
        attempted = true;
        return queueCloudJob({ ...reference, requestId: attempt.current.requestId }, undefined, { signal });
      });
      const accepted = result.execution === 'intent_queue_only' && matchingPrivateJob(result.job, reference, attempt.current.requestId);
      if (!accepted) throw new Error('invalid_queue_response');
      if (mounted.current) { setJob(accepted); setPhase('recorded'); }
    } catch (failure) {
      if (!mounted.current) return;
      if (attempted) {
        setPhase('uncertain');
        setError([400, 401, 402, 403, 409, 429].includes(failure.status)
          ? 'The queue request was not accepted. Check account access, runner status or your plan limits, then check the queue before retrying.'
          : 'The queue result is unconfirmed. Check the queue before retrying; the request may already have been saved.');
      } else {
        setPhase(attempt.current && !canRetryPrivateJob(attempt.current) ? 'expired' : 'preview');
        setError('Could not verify this active runner or preserve the request for safe retry. Refresh runner/account access before trying again.');
      }
    } finally { pending.current = false; }
  }
  async function checkQueue() {
    if (pending.current || !reference || !attempt.current) return;
    pending.current = true; setPhase('checking'); setError(''); setNotice('');
    try {
      if (accountIdentity() !== owner.current) throw new Error('account_changed');
      const result = await timed(signal => fetchCloudJobs(undefined, { signal }));
      if (accountIdentity() !== owner.current) throw new Error('account_changed');
      if (!Array.isArray(result.jobs)) throw new Error('invalid_jobs');
      const match = result.jobs.map(row => matchingPrivateJob(row, reference, attempt.current.requestId)).find(Boolean);
      if (!mounted.current) return;
      if (match) { setJob(match); setPhase('recorded'); }
      else if (canRetryPrivateJob(attempt.current)) { setPhase('retry'); setNotice('No matching request was found. You may explicitly retry using the same request ID.'); }
      else { setPhase('expired'); setNotice('The 24-hour retry window has ended. Review the job history before creating a new private configuration reference.'); }
    } catch { if (mounted.current) { setPhase('uncertain'); setError('Queue status is unavailable. No retry was sent. Check again before continuing.'); } }
    finally { pending.current = false; }
  }
  const busy = ['sending', 'checking'].includes(phase);
  return <section className="pb-card" aria-label={`Queue private job for ${agent.name}`} style={{ marginBlock: 20 }}>
    <h3>Queue a private runner job</h3>
    <p>Import the job reference downloaded from your private runner workspace. The configuration stays on that runner. Importing does not queue or execute a job.</p>
    <div className="pb-field"><label htmlFor={`private-job-${agent.id}`}>Opaque job reference JSON (maximum 4 KiB)</label>
      <input id={`private-job-${agent.id}`} type="file" accept=".json,application/json" onChange={importFile} disabled={busy || !!agent.revokedAt} /></div>
    {agent.revokedAt && <p role="alert">This runner credential is revoked. Jobs cannot be queued here.</p>}
    {!agent.revokedAt && agent.jobAccess !== true && <p role="alert">This credential supports telemetry only. Enable private jobs by explicitly replacing its token in Runner credentials, then refresh before queueing.</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {reference && <div aria-label="Local job reference preview">
      <p>Runner: <strong>{agent.name}</strong> · <code style={{ overflowWrap: 'anywhere' }}>{reference.runnerId}</code></p>
      <p>Operation: <strong>{reference.type}</strong> · Configuration revision: <strong>{reference.configRevision}</strong></p>
      <p>Configuration reference: <code style={{ overflowWrap: 'anywhere' }}>{reference.configRef}</code></p>
      <p>The runner must have this exact private configuration. A queued intent does not confirm runner availability or execution.</p>
      {['preview', 'retry'].includes(phase) && <><label className="pb-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>Queue this {reference.type} job on {agent.name}.</span></label>
        <button className="pb-btn pb-btn-primary" type="button" disabled={!confirmed || !!agent.revokedAt || agent.jobAccess !== true} onClick={queue}>{phase === 'retry' ? 'Retry the same request' : 'Queue job'}</button></>}
      {['uncertain', 'expired', 'checking'].includes(phase) && <button className="pb-btn" type="button" disabled={busy} onClick={checkQueue}>{phase === 'checking' ? 'Checking queue…' : 'Check queue'}</button>}
      {phase === 'sending' && <p role="status">Submitting job intent…</p>}
      {phase === 'expired' && <p>The retry window is closed. This panel will not send this request again.</p>}
      {job && <p role="status">Job <code>{job.id}</code> · account-reported status: <strong>{job.status}</strong>. Queue acceptance alone does not prove execution or recovery.</p>}
    </div>}
    <button className="pb-btn" type="button" disabled={busy} onClick={onClose} style={{ marginTop: 16 }}>Close job reference</button>
  </section>;
}
