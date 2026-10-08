import React, { useEffect, useRef, useState } from 'react';
import { fetchNotificationPreferences, saveNotificationPreferences } from '../lib/cloud-api.js';
import { NotificationDestinations } from './notification-destinations.jsx';
import { NotificationHistory } from './notification-history.jsx';

function validRecord(record) {
  return Number.isSafeInteger(record?.revision) && record.revision >= 0
    && ['email', 'sms'].every(channel => ['onFailure', 'onSuccess'].every(key => typeof record?.preferences?.[channel]?.[key] === 'boolean'));
}

/** Account preferences only. Transport setup and contact verification remain separate. */
export function NotificationPreferences({
  embedded = false,
  loadPreferences = fetchNotificationPreferences,
  savePreferences = saveNotificationPreferences,
}) {
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const request = useRef(0);

  async function load() {
    const current = ++request.current;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const next = await loadPreferences();
      if (!validRecord(next)) throw new Error('invalid_preferences_response');
      if (current !== request.current) return;
      setRecord(next);
      setDraft(structuredClone(next.preferences));
      setConflict(false);
    } catch {
      if (current === request.current) setError('Could not load your notification preferences. Retry to read your saved settings.');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => { request.current++; };
  }, [loadPreferences]);

  const dirty = record && draft && JSON.stringify(record.preferences) !== JSON.stringify(draft);
  function change(channel, key, enabled) {
    setDraft(previous => ({ ...previous, [channel]: { ...previous[channel], [key]: enabled } }));
    setNotice('');
  }

  async function save(event) {
    event.preventDefault();
    if (!record || !dirty || loading || saving || conflict) return;
    const current = ++request.current;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const next = await savePreferences({ revision: record.revision, preferences: draft });
      if (!validRecord(next)) throw new Error('invalid_preferences_response');
      if (current !== request.current) return;
      setRecord(next);
      setDraft(structuredClone(next.preferences));
      setNotice('Preferences saved. Notification delivery is not connected yet.');
    } catch (failure) {
      if (current !== request.current) return;
      if (failure.status === 409) {
        setConflict(true);
        setError('Your saved preferences changed elsewhere. Reload the latest settings before editing again. Reloading replaces your unsaved changes.');
      } else {
        setError('Could not save your preferences. Your changes are still here; retry saving.');
      }
    } finally {
      if (current === request.current) setSaving(false);
    }
  }

  return <section className="pb-stack" aria-label="Notification preferences">
    {!embedded && <div className="pb-page-head"><div><h1>Alerts</h1><p>Choose which runner events should trigger email and SMS notifications.</p></div></div>}
    <div className="pb-callout warn" role="status">
      <div><strong>Notification delivery is not connected</strong><p>You can save preferences and manage contact verification below. Automated email and SMS alerts still require a configured delivery service.</p></div>
    </div>
    {loading && <p role="status">Loading notification preferences…</p>}
    {error && <div className="pb-callout danger" role="alert"><div><p>{error}</p>
      {(!record || conflict) && <button type="button" className="pb-btn" disabled={loading || saving} onClick={load}>{conflict ? 'Reload latest settings' : 'Retry loading'}</button>}
    </div></div>}
    {!loading && record && draft && <form className="pb-card" onSubmit={save}>
      <div className="pb-card-head"><h2>Saved event preferences</h2><span>{dirty ? 'Unsaved changes' : 'Saved settings'}</span></div>
      {['email', 'sms'].map(channel => <fieldset key={channel} disabled={saving || conflict} style={{ marginBottom: 16 }}>
        <legend>{channel === 'email' ? 'Email' : 'SMS'}</legend>
        <label className="pb-check"><input type="checkbox" checked={draft[channel].onFailure} onChange={event => change(channel, 'onFailure', event.target.checked)} /><span>{channel === 'email' ? 'Email' : 'SMS'} for failures and missed backups</span></label>
        <label className="pb-check"><input type="checkbox" checked={draft[channel].onSuccess} onChange={event => change(channel, 'onSuccess', event.target.checked)} /><span>{channel === 'email' ? 'Email' : 'SMS'} for completed backups, checks and restores</span></label>
      </fieldset>)}
      <button type="submit" className="pb-btn pb-btn-primary" disabled={!dirty || saving || conflict}>{saving ? 'Saving…' : 'Save preferences'}</button>
      {notice && <p role="status">{notice}</p>}
    </form>}
    <NotificationDestinations />
    <NotificationHistory />
  </section>;
}
