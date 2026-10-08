import React, { useEffect, useRef, useState } from 'react';
import { MAX_SHARED_MANIFEST_BYTES, projectSharedManifest, sharedManifestBytes } from '../../utility/shared-manifest.mjs';
import { fetchManifestSharing, grantManifestSharing, revokeManifestSharing, uploadSharedManifest } from '../lib/manifest-sharing-api.js';

function validateSharing(record, projectRef) {
  if (typeof record.enabled !== 'boolean' || typeof record.inventoryConsent !== 'boolean') throw new Error('invalid_sharing_response');
  if (record.enabled && (typeof record.grantId !== 'string' || !/^[a-f0-9]{64}$/.test(record.previewDigest || ''))) throw new Error('invalid_sharing_response');
  return { ...record, snapshot: record.enabled && record.snapshot ? projectSharedManifest(record.snapshot, { inventoryConsent: record.inventoryConsent, projectRef }) : null };
}

export function ManifestSharing({ agent, onClose }) {
  const [remote, setRemote] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [snapshot, setSnapshot] = useState(null);
  const [allowSnapshot, setAllowSnapshot] = useState(false);
  const [allowInventory, setAllowInventory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selection = useRef(0);
  const mounted = useRef(true);
  const hasInventory = Boolean(snapshot && Object.hasOwn(snapshot, 'inventory'));

  async function refresh() {
    setLoadState('loading');
    setError('');
    setNotice('');
    setAllowSnapshot(false);
    setAllowInventory(false);
    try {
      const result = validateSharing(await fetchManifestSharing(agent.id), agent.projectRef);
      if (mounted.current) { setRemote(result); setLoadState('ready'); }
    } catch {
      if (mounted.current) { setRemote(null); setLoadState('uncertain'); setError('Sharing status could not be loaded. Refresh before uploading, or revoke sharing to disable it.'); }
    }
  }
  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => { mounted.current = false; selection.current++; };
  }, [agent.id]);

  async function importFile(event) {
    const file = event.target.files?.[0];
    const current = ++selection.current;
    setSnapshot(null);
    setAllowSnapshot(false);
    setAllowInventory(false);
    setError('');
    setNotice('');
    if (!file) return;
    try {
      if (file.size > MAX_SHARED_MANIFEST_BYTES) throw new Error('too_large');
      // Inventory consent here enables LOCAL validation/preview only. No request is made.
      const preview = projectSharedManifest(JSON.parse(await file.text()), { projectRef: agent.projectRef, inventoryConsent: true });
      if (mounted.current && current === selection.current) setSnapshot(preview);
    } catch {
      if (mounted.current && current === selection.current) setError('This file is not a valid shareable snapshot for this project, or exceeds 256 KiB. Raw capsule manifests, credentials and diagnostic logs are not accepted. Nothing from this file was uploaded.');
    }
  }

  async function share() {
    if (!snapshot || !allowSnapshot || (hasInventory && !allowInventory) || busy || loadState !== 'ready' || agent.revokedAt) return;
    setBusy(true);
    setError('');
    setNotice('');
    let granted = false;
    let requestStarted = false;
    try {
      const bytes = sharedManifestBytes(snapshot, { projectRef: agent.projectRef, inventoryConsent: hasInventory && allowInventory });
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      requestStarted = true;
      const consent = validateSharing(await grantManifestSharing({ agentId: agent.id, expectedRevision: remote.revision, inventoryConsent: hasInventory && allowInventory, previewDigest: digest }), agent.projectRef);
      if (!consent.enabled || consent.previewDigest !== digest || consent.inventoryConsent !== (hasInventory && allowInventory)) throw new Error('consent_not_confirmed');
      granted = true;
      if (mounted.current) setRemote(consent);
      const result = await uploadSharedManifest({ agentId: agent.id, expectedRevision: consent.revision, grantId: consent.grantId, snapshot });
      if (result.previewDigest !== digest || typeof result.uploadedAt !== 'string' || !Number.isFinite(Date.parse(result.uploadedAt))) throw new Error('upload_not_confirmed');
      if (mounted.current) {
        setRemote({ ...consent, ...result, snapshot });
        setNotice('This exact snapshot is now shared in your account.');
        setAllowSnapshot(false);
        setAllowInventory(false);
      }
    } catch (failure) {
      if (mounted.current) {
        if (requestStarted) setLoadState('uncertain');
        setError(!requestStarted ? 'Local validation or hashing failed. Nothing was uploaded.'
          : failure.status === 409 ? 'Sharing changed while this request was in progress. Refresh the status and review your consent before retrying.'
            : granted ? 'Consent was saved, but the upload was not confirmed. It may have completed. Refresh the status before retrying, or revoke sharing.'
              : 'The consent request was not confirmed. No snapshot upload was attempted. Refresh the status before retrying, or revoke sharing.');
      }
    } finally { if (mounted.current) setBusy(false); }
  }

  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = validateSharing(await revokeManifestSharing(agent.id), agent.projectRef);
      if (result.enabled) throw new Error('revocation_not_confirmed');
      if (mounted.current) {
        setRemote(result); setLoadState('ready'); setAllowSnapshot(false); setAllowInventory(false);
        setNotice('Sharing is off. The stored snapshot has been removed from the active account record. Your local preview and capsule are unchanged.');
      }
    } catch {
      if (mounted.current) { setLoadState('uncertain'); setError('Revocation was not confirmed. The snapshot may still be shared. Retry revocation or refresh the status.'); }
    } finally { if (mounted.current) setBusy(false); }
  }

  return <section className="pb-card" aria-label={`Manifest sharing for ${agent.name}`} style={{ marginBottom: 24 }}>
    <div className="pb-card-head"><h3>Manifest sharing · {agent.name}</h3><button type="button" className="pb-btn" onClick={onClose} disabled={busy}>Close</button></div>
    <p>Sharing is optional. Export a summary on the machine that holds your capsule, then import the JSON file to review it locally.</p>
    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>portabase export-manifest --capsule &lt;dir&gt; --for-sharing --out &lt;new-file.json&gt;</pre>
    <p>This command exports counts and the encrypted capsule hash without uploading anything. It excludes inventory names. A shareable file containing optional inventory names requires the separate consent below.</p>
    <p role="status">{loadState === 'loading' ? 'Loading sharing status…' : loadState !== 'ready' ? 'Sharing status is unconfirmed.' : remote?.enabled ? remote.snapshot ? 'A snapshot is currently shared.' : 'Consent is active, but no snapshot has been uploaded.' : 'Sharing is off.'}</p>
    {error && <p className="pb-callout warn" role="alert">{error}</p>}
    {notice && <p className="pb-callout info" role="status">{notice}</p>}
    <div className="pb-inline" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
      <button type="button" className="pb-btn" onClick={refresh} disabled={busy || loadState === 'loading'}>Refresh sharing status</button>
      {(remote?.enabled || loadState === 'uncertain') && <button type="button" className="pb-btn" style={{ whiteSpace: 'normal', maxWidth: '100%' }} onClick={revoke} disabled={busy}>Revoke sharing and remove stored snapshot</button>}
    </div>
    {loadState === 'ready' && remote?.snapshot && <details><summary>View currently shared snapshot</summary><SnapshotPreview snapshot={remote.snapshot} label="Currently shared snapshot" /></details>}
    {agent.revokedAt ? <p>Reporting access is revoked. You can review or remove existing sharing; uploads require an active runner credential.</p> : <>
      <div className="pb-field">
        <label htmlFor={`manifest-file-${agent.id}`}>Shareable snapshot JSON (maximum 256 KiB)</label>
        <input id={`manifest-file-${agent.id}`} type="file" accept=".json,application/json" onChange={importFile} disabled={busy} />
      </div>
      {snapshot && <>
        <h4>Local preview — not uploaded by importing</h4>
        <SnapshotPreview snapshot={snapshot} label="Local snapshot preview" />
        <label className="pb-check"><input type="checkbox" checked={allowSnapshot} onChange={event => setAllowSnapshot(event.target.checked)} disabled={busy} /><span>Allow Portabase to store this exact preview in my account.</span></label>
        {hasInventory && <label className="pb-check"><input type="checkbox" checked={allowInventory} onChange={event => setAllowInventory(event.target.checked)} disabled={busy} /><span>Also allow the project, table, bucket and object names shown here.</span></label>}
        {remote?.enabled && <p>Sharing this preview replaces the previously approved snapshot for this runner.</p>}
        <button type="button" className="pb-btn pb-btn-primary" onClick={share} disabled={busy || loadState !== 'ready' || !allowSnapshot || (hasInventory && !allowInventory)}>{busy ? 'Saving…' : 'Share this snapshot'}</button>
      </>}
    </>}
  </section>;
}

function SnapshotPreview({ snapshot, label }) {
  return <pre aria-label={label} style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 12, border: '1px solid var(--c-border)', borderRadius: 8 }}>{JSON.stringify(snapshot, null, 2)}</pre>;
}
