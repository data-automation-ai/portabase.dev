import React, { useEffect, useRef, useState } from 'react';
import { fetchAgents, fetchBackupSchedules, saveBackupSchedule, disableBackupSchedule } from '../lib/cloud-api.js';
import { MAX_PRIVATE_JOB_FILE_BYTES, privateJobReference } from '../lib/private-job-reference.js';

const STATUSES = {
  waiting: 'Waiting for next dispatch', queued: 'Backup queued', disabled: 'Disabled',
  runner_unavailable: 'Blocked: runner unavailable', subscription_required: 'Blocked: verified subscription required',
  cadence_not_allowed: 'Blocked: cadence exceeds plan', quota_exhausted: 'Quota reached',
  runner_busy: 'Blocked: runner busy', queue_full: 'Blocked: queue full',
};
const JOB_STATUSES = { queued: 'Queued', running: 'Running', succeeded: 'Succeeded', failed: 'Failed' };
const ERRORS = {
  invalid_schedule: 'Check the schedule fields and import a valid backup reference.',
  runner_not_authorized: 'This runner is unavailable or lacks job access. Refresh your schedules and runner credentials.',
  subscription_required: 'A verified paid subscription is required to enable scheduled backups.',
  cadence_not_allowed: 'This cadence exceeds your plan. Increase the hours between backups.',
  schedule_limit: 'Your account has reached its schedule limit.',
  runner_schedule_exists: 'This runner already has a schedule. Refresh and edit its saved schedule.',
};
function validSchedule(value) {
  try {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.enabled !== 'boolean'
      || !Object.hasOwn(STATUSES, value.status) || !Number.isInteger(value.everyHours) || value.everyHours < 1 || value.everyHours > 168
      || !/^[a-f0-9-]{36}$/i.test(value.id || '') || !Number.isFinite(Date.parse(value.startAt))) return false;
    privateJobReference({ version: 2, type: 'backup', runnerId: value.runnerId, configRef: value.configRef, configRevision: value.configRevision }, { id: value.runnerId });
    return true;
  } catch { return false; }
}
function dateLabel(value) {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Not reported';
}
function nextHour() { return new Date(Math.ceil((Date.now() + 1) / 3600000) * 3600000).toISOString().slice(0, 16); }

/** Imports only the opaque reference. Source settings and scheduling execution remain on the private runner. */
export function ManagedBackupSchedules({ embedded = false, navigate }) {
  const [rows, setRows] = useState([]), [agents, setAgents] = useState([]), [dispatcher, setDispatcher] = useState(false);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false);
  const [draft, setDraft] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), pending = useRef(false), controller = useRef(null), selection = useRef(0);

  async function timed(operation) {
    const abort = new AbortController(); controller.current = abort;
    let timer;
    try { return await Promise.race([operation(abort.signal), new Promise((_, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(new Error('request_timeout')); }, 20000);
    })]); } finally { clearTimeout(timer); }
  }
  async function load() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const results = await timed(signal => Promise.allSettled([fetchBackupSchedules(undefined, { signal }), fetchAgents()]));
      if (results.some(result => result.status !== 'fulfilled')) throw new Error('load_failed');
      const data = results[0].value, runnerData = results[1].value;
      if (!Array.isArray(data.schedules) || !data.schedules.every(validSchedule) || typeof data.dispatcherEnabled !== 'boolean'
        || data.execution !== 'queue_only' || !Array.isArray(runnerData.agents)) throw new Error('invalid_response');
      if (!alive.current) return;
      setRows(data.schedules); setAgents(runnerData.agents.filter(agent => agent.jobAccess === true && !agent.revokedAt));
      setDispatcher(data.dispatcherEnabled); setLoaded(true); setLocked(false); setDraft(null); selection.current++;
    } catch {
      if (alive.current) { setLocked(true); setError('Could not read saved schedules. Refresh before making changes. Previously shown rows may be outdated.'); }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; selection.current++; controller.current?.abort(); }; }, []);

  function edit(row) {
    selection.current++; setError(''); setNotice('');
    setDraft(row ? { id: row.id, revision: row.revision, reference: { version: 2, type: 'backup', runnerId: row.runnerId, configRef: row.configRef, configRevision: row.configRevision },
      everyHours: String(row.everyHours), startAt: new Date(row.startAt).toISOString().slice(0, 16), enabled: row.enabled }
      : { id: crypto.randomUUID(), revision: 0, reference: null, everyHours: '24', startAt: nextHour(), enabled: false });
  }
  async function importReference(event) {
    const file = event.target.files?.[0], generation = ++selection.current;
    setDraft(previous => ({ ...previous, reference: null })); setError(''); setNotice('');
    if (!file) return;
    try {
      if (file.size > MAX_PRIVATE_JOB_FILE_BYTES) throw new Error('too_large');
      const text = await file.text();
      if (new TextEncoder().encode(text).length > MAX_PRIVATE_JOB_FILE_BYTES) throw new Error('too_large');
      const value = JSON.parse(text), agent = agents.find(candidate => candidate.id === value?.runnerId);
      const reference = privateJobReference(value, agent);
      if (reference.type !== 'backup') throw new Error('backup_only');
      if (alive.current && selection.current === generation) setDraft(previous => ({ ...previous, reference }));
    } catch {
      if (alive.current && selection.current === generation) setError('Import a backup reference of at most 4 KiB for one of your active runners with job access. Source configuration, keys, manifests and other operations are rejected.');
    }
  }
  async function mutate(body, disable = false) {
    if (pending.current || locked || !loaded) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const data = await timed(signal => (disable ? disableBackupSchedule : saveBackupSchedule)(body, undefined, { signal }));
      if (!validSchedule(data.schedule) || data.schedule.id !== body.id || data.schedule.revision <= body.revision
        || typeof data.dispatcherEnabled !== 'boolean' || data.execution !== 'queue_only') throw new Error('invalid_response');
      if (!alive.current) return;
      setRows(previous => [...previous.filter(row => row.id !== data.schedule.id), data.schedule]); setDispatcher(data.dispatcherEnabled);
      setDraft(null); selection.current++; setNotice(disable ? 'Schedule disabled. A previously queued or running job is not canceled.' : 'Schedule saved. Saving does not confirm a backup ran.');
    } catch (failure) {
      if (!alive.current) return;
      const code = failure?.data?.error;
      if (code === 'schedule_changed') {
        setLocked(true); setError('This schedule changed elsewhere. Refresh saved schedules before editing again; refreshing replaces your draft.');
      } else if (Object.hasOwn(ERRORS, code || '')) setError(ERRORS[code]);
      else {
        setLocked(true); setError('The change is unconfirmed. Refresh saved schedules to check whether it was saved before making another change.');
      }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function save(event) {
    event.preventDefault();
    const everyHours = Number(draft?.everyHours), date = new Date(`${draft?.startAt}:00.000Z`);
    if (!draft?.reference || !Number.isInteger(everyHours) || everyHours < 1 || everyHours > 168 || !Number.isFinite(date.getTime())) {
      setError('Import a backup reference and choose a valid UTC start time and whole hours from 1 to 168.'); return;
    }
    const { runnerId, configRef, configRevision } = draft.reference;
    mutate({ id: draft.id, revision: draft.revision, runnerId, configRef, configRevision, everyHours, startAt: date.toISOString(), enabled: draft.enabled });
  }

  return <section className="pb-stack" aria-label="Managed backup schedules" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    {!embedded && <div className="pb-page-head"><div><h1>Backup schedules</h1><p>Save a cadence for a private backup configuration.</p></div></div>}
    <div className="pb-callout warn"><div><strong>Hosted private workspace access is not available yet.</strong>
      <p>Use your customer-controlled runner to configure and test the source and vault, then export its opaque backup reference. This page stores the reference and cadence; credentials, keys and inventory stay private.</p>
      {navigate && <button className="pb-btn pb-btn-sm" type="button" onClick={() => navigate('agents')}>Manage runner credentials</button>}
    </div></div>
    {loaded && <p role="status">{dispatcher ? 'Schedule dispatcher enabled. Due backups are subject to subscription, runner availability and the shared transfer quota.' : 'Dispatch blocked: the schedule dispatcher is not enabled. Saved schedules will not queue backups.'} Queued jobs still require a running private worker.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" className="pb-btn" disabled={busy} onClick={load}>Refresh saved schedules</button>
      <button type="button" className="pb-btn pb-btn-primary" disabled={busy || locked || !loaded} onClick={() => edit(null)}>New backup schedule</button>
    </div>
    {busy && <p role="status">Updating schedule view…</p>}
    {error && <p className="pb-callout danger" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loaded && rows.length === 0 && <p>No saved backup schedules.</p>}
    {rows.map((row, index) => <article className="pb-card" aria-label={`Saved schedule ${index + 1}`} key={row.id}>
      <div className="pb-card-head"><h2>Backup every {row.everyHours} hours</h2><span>Saved · revision {row.revision}</span></div>
      <div style={{ padding: 16 }}>
        <p><strong>{STATUSES[row.status]}</strong> · {row.enabled ? 'Enabled' : 'Disabled'}</p>
        <p>Runner: <code>{row.runnerId}</code><br />Private reference: <code>{row.configRef}</code> · configuration revision {row.configRevision}</p>
        <p>Next due: {dateLabel(row.nextDueAt)}<br />Last scheduled: {dateLabel(row.lastScheduledAt)}<br />Last job: {JOB_STATUSES[row.lastJobStatus] || 'Not reported'}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="pb-btn" type="button" disabled={busy || locked} onClick={() => edit(row)}>Edit schedule {index + 1}</button>
          <button className="pb-btn" type="button" disabled={busy || locked || !row.enabled} onClick={() => mutate({ id: row.id, revision: row.revision, enabled: false }, true)}>Disable schedule {index + 1}</button>
        </div>
      </div>
    </article>)}
    {draft && <form className="pb-card" aria-label="Backup schedule editor" onSubmit={save} style={{ padding: 16 }}>
      <h2>{draft.revision ? `Edit saved revision ${draft.revision}` : 'New backup schedule'}</h2>
      <fieldset disabled={busy || locked} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <div className="pb-field"><label htmlFor="backup-reference">Opaque backup reference JSON (maximum 4 KiB)</label>
          <input key={draft.id} id="backup-reference" type="file" accept=".json,application/json" onChange={importReference} style={{ maxWidth: '100%', minWidth: 0 }} /></div>
        {draft.reference && <p aria-label="Local backup reference preview">Backup · runner <code>{draft.reference.runnerId}</code><br />Reference <code>{draft.reference.configRef}</code> · revision {draft.reference.configRevision}</p>}
        <div className="pb-field"><label htmlFor="backup-hours">Hours between backups</label><input id="backup-hours" type="number" min="1" max="168" step="1" required value={draft.everyHours} onChange={event => setDraft({ ...draft, everyHours: event.target.value })} /></div>
        <div className="pb-field"><label htmlFor="backup-start">Start time (UTC)</label><input id="backup-start" type="datetime-local" required value={draft.startAt} onChange={event => setDraft({ ...draft, startAt: event.target.value })} style={{ minWidth: 0, maxWidth: '100%' }} /></div>
        <p>New and edited schedules start at the next cadence boundary at or after saving. Missed past runs are not queued in a backlog. Your plan and other transfers may limit execution.</p>
        <label className="pb-check"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /><span>Enable scheduled backups for this private reference.</span></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="submit" className="pb-btn pb-btn-primary" disabled={!draft.reference}>Save schedule</button>
          <button type="button" className="pb-btn" onClick={() => { selection.current++; setDraft(null); }}>Cancel edit</button>
        </div>
      </fieldset>
    </form>}
    <p>Queue status reports scheduling progress. A successful job or a saved schedule alone does not prove that a restore drill passed.</p>
  </section>;
}
