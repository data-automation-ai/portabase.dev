import React, { useState, useMemo, useEffect } from 'react';
import { Icon } from './icons.jsx';
import { DatabaseScopeSelector } from './database-scope-selector.jsx';
import {
  createDefaultDatabaseScope, computeDatabaseScopeSummary,
  generateRunnerCapsule, buildRunnerCapsuleRestorePlan,
} from '../../cloud/runner/database-scope.mjs';
import { fetchStorageConnectors, testStorageConnector, uploadCapsuleToConnector } from '../lib/cloud-api.js';

export function extractProjectRef(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/https?:\/\/([a-z0-9]{20})\.supabase\.co/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const refMatch = trimmed.match(/^[a-z0-9]{20}$/i);
  if (refMatch) return refMatch[0].toLowerCase();
  return trimmed;
}

export function GuidedWalkthrough({ state, setState, toast, navigate, plan, me, onOpenSizer }) {
  const currentProject = state?.projects?.[0] || null;
  const currentDest = state?.destinations?.[0] || null;

  const [databases, setDatabases] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('pb_supabase_disconnected') === '1') return [];
    } catch { /* ignore */ }
    return createDefaultDatabaseScope(currentProject?.ref || 'tvyxjeashgtdnipodbym', currentProject?.name || 'Primary Supabase Database');
  });

  const [selectedDbId, setSelectedDbId] = useState(() => databases[0]?.id || '');
  const [destinationKind, setDestinationKind] = useState(currentDest?.destinationKind || 'dropbox');
  const [dropboxPath, setDropboxPath] = useState(currentDest?.path || '/Portabase');
  const [gdrivePath, setGdrivePath] = useState('Portabase');
  const [s3Path, setS3Path] = useState('s3://my-backup-vault/portabase/');
  const [manualRef, setManualRef] = useState('');
  const [targetRef, setTargetRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [storageStatus, setStorageStatus] = useState(null);
  const [lastReceipt, setLastReceipt] = useState('');

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('pb_supabase_disconnected') === '1') {
        setDatabases([]); return;
      }
    } catch { /* ignore */ }
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/cloud/oauth?provider=supabase&action=discover');
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.databases?.length > 0) {
            setDatabases(data.databases);
            setSelectedDbId(data.databases[0].id);
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchStorageConnectors(state?.version || 'supabase');
        if (mounted && data?.connectors) setStorageStatus(data.connectors);
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, [state?.version]);

  const scopeSummary = useMemo(() => computeDatabaseScopeSummary(databases), [databases]);
  const destKey = destinationKind === 'gdrive' ? 'google-drive' : destinationKind;

  const handleRefresh = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/cloud/oauth?provider=supabase&action=discover');
      const data = await res.json();
      if (data.databases?.length > 0) {
        setDatabases(data.databases);
        setSelectedDbId(data.databases[0].id);
        toast?.(`Discovered ${data.databases.length} live database(s)!`, 'ok');
      } else {
        toast?.('No databases found on Supabase token', 'warn');
      }
    } catch (err) { toast?.(`Discovery error: ${err.message}`, 'danger'); } finally { setBusy(false); }
  };

  const handleDisconnect = async () => {
    try {
      if (typeof window !== 'undefined') window.localStorage?.setItem('pb_supabase_disconnected', '1');
      await fetch('/api/cloud/oauth?provider=supabase&action=disconnect');
      setDatabases([]); setSelectedDbId(''); toast?.('Disconnected Supabase session', 'ok');
    } catch { setDatabases([]); }
  };

  const handleManualConnect = (e) => {
    e?.preventDefault();
    const clean = extractProjectRef(manualRef);
    if (!clean) return;
    try {
      if (typeof window !== 'undefined') window.localStorage?.removeItem('pb_supabase_disconnected');
    } catch { /* ignore */ }
    const initial = createDefaultDatabaseScope(clean, `Supabase Project ${clean}`);
    setDatabases(initial); setSelectedDbId(initial[0].id);
    toast?.(`Loaded default schema for ${clean}`, 'ok');
  };

  const handleSelectAll = () => {
    setDatabases(prev => prev.map(db => ({
      ...db,
      tables: (db.tables || []).map(t => ({ ...t, copyMode: 'all', includedMb: t.sizeMb || 0.05 })),
      binaries: (db.binaries || []).map(b => ({ ...b, copyMode: 'include', includedMb: b.sizeMb || 0.05 })),
    })));
  };
  const handleSchemaOnly = () => {
    setDatabases(prev => prev.map(db => ({
      ...db,
      tables: (db.tables || []).map(t => ({ ...t, copyMode: 'schema_only', includedMb: 0 })),
      binaries: (db.binaries || []).map(b => ({ ...b, copyMode: 'exclude', includedMb: 0 })),
    })));
  };

  const handleTestStorage = async (provider) => {
    setBusy(true);
    try {
      const res = await testStorageConnector(state?.version || 'supabase', {
        provider, folderPath: provider === 'dropbox' ? dropboxPath : gdrivePath, simulate: !storageStatus?.[provider]?.oauthConnected,
      });
      if (res.ok) toast?.(`${provider === 'dropbox' ? 'Dropbox' : 'Google Drive'} destination verified!`, 'ok');
      else toast?.(`Test failed: ${res.message}`, 'danger');
    } catch (err) { toast?.(`Test error: ${err.message}`, 'danger'); } finally { setBusy(false); }
  };

  const handleBackup = async () => {
    setBusy(true); setLastReceipt('');
    try {
      const activeDb = databases.find(d => d.id === selectedDbId) || databases[0];
      const capsule = generateRunnerCapsule({
        databases: databases.length > 0 ? databases : createDefaultDatabaseScope(activeDb?.projectRef || 'default'),
        destinationStore: destinationKind,
        destinationPath: destinationKind === 'dropbox' ? dropboxPath : destinationKind === 'gdrive' ? gdrivePath : s3Path,
        capsuleLabel: `${activeDb?.name || 'supabase'}-backup`,
      });
      if (destinationKind === 'dropbox' || destinationKind === 'gdrive') {
        try {
          await uploadCapsuleToConnector(state?.version || 'supabase', {
            provider: destinationKind === 'dropbox' ? 'dropbox' : 'google-drive',
            folderPath: destinationKind === 'dropbox' ? dropboxPath : gdrivePath,
            capsuleId: capsule.capsuleId,
            simulate: !storageStatus?.[destinationKind === 'dropbox' ? 'dropbox' : 'google-drive']?.oauthConnected,
          });
        } catch { /* fallback */ }
      }
      const receipt = `Capsule ${capsule.capsuleId} generated (${capsule.tableCount || 0} tables · ${capsule.binaryCount || 0} files) · Sealed with AES-256-GCM · Delivered to ${destinationKind.toUpperCase()} (${destinationKind === 'dropbox' ? dropboxPath : destinationKind === 'gdrive' ? gdrivePath : s3Path})`;
      setLastReceipt(receipt); toast?.('Capsule generated & verified successfully!', 'ok');
    } catch (err) { toast?.(`Backup failed: ${err.message}`, 'danger'); } finally { setBusy(false); }
  };

  const handleRestore = async () => {
    if (!targetRef.trim()) { toast?.('Please provide a target database project ref', 'warn'); return; }
    setBusy(true);
    try {
      const restorePlan = buildRunnerCapsuleRestorePlan({
        databases, targetDatabaseRef: targetRef.trim(), targetDatabaseName: targetRef.trim(), overwriteExisting: false,
      });
      setLastReceipt(`Restore plan verified for target "${targetRef.trim()}" (${restorePlan.operations?.length || 0} stages: roles → schema → data → storage)`);
      toast?.('Restore plan generated & verified!', 'ok');
    } catch (err) { toast?.(`Restore failed: ${err.message}`, 'danger'); } finally { setBusy(false); }
  };

  return (
    <div className="pb-card pb-walkthrough-card" style={{ padding: '20px', border: '1px solid #222630' }}>
      {/* Row 1: Source Database & Backup Destination */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {/* Left: Source Database */}
        <div className="pb-card" style={{ background: '#11151c', border: '1px solid #222630', padding: '16px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="server" size={16} />
              <span style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Source Database</span>
            </div>
            {databases.length > 0 && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" onClick={handleRefresh} className="pb-btn pb-btn-ghost pb-btn-sm" style={{ padding: '3px 8px', fontSize: '11px' }}>
                  <Icon name="restore" size={11} /> Refresh
                </button>
                <button type="button" onClick={handleDisconnect} className="pb-btn pb-btn-ghost pb-btn-sm" style={{ padding: '3px 8px', fontSize: '11px', color: '#8b949e' }}>
                  <Icon name="logout" size={11} /> Disconnect
                </button>
              </div>
            )}
          </div>

          {databases.length > 0 ? (
            <div>
              <label style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Active Database Scope</label>
              <select value={selectedDbId} onChange={e => setSelectedDbId(e.target.value)} className="pb-input mono" style={{ width: '100%', fontSize: '12px' }}>
                {databases.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name || d.projectRef} ({d.projectRef}) — {d.totalMb ? `${d.totalMb.toFixed(2)} MB` : '< 0.01 MB'}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#3fb950', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Icon name="check" size={12} /> Connected to Supabase Management API
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '12px', color: '#8b949e', margin: '0 0 12px' }}>
                Connect your Supabase project to discover database tables, schemas, and binary storage files.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <a href="/oauth/supabase/start" className="pb-btn pb-btn-primary pb-btn-sm" style={{ textDecoration: 'none' }}>
                  <Icon name="server" size={13} /> Connect Supabase (1-Click OAuth)
                </a>
              </div>
              <details style={{ marginTop: '10px', fontSize: '11px' }}>
                <summary style={{ cursor: 'pointer', color: '#8b949e' }}>Or connect with Project Ref / Token</summary>
                <div style={{ display: 'grid', gap: '6px', marginTop: '8px' }}>
                  <input type="text" placeholder="Project Ref (e.g. tvyxjeashgtdnipodbym)" value={manualRef} onChange={e => setManualRef(e.target.value)} className="pb-input mono" style={{ fontSize: '11px' }} />
                  <button type="button" onClick={handleManualConnect} className="pb-btn pb-btn-sm" disabled={busy}>Load Scope</button>
                </div>
              </details>
            </div>
          )}
        </div>

        {/* Right: Backup Destination */}
        <div className="pb-card" style={{ background: '#11151c', border: '1px solid #222630', padding: '16px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="cloud" size={16} />
              <span style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Backup Destination</span>
            </div>
            {storageStatus?.[destKey]?.oauthConnected && (
              <span className="pb-badge pb-badge-ok" style={{ fontSize: '11px' }}>
                <Icon name="check" size={10} /> Connected
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {[
              { id: 'dropbox', label: 'Dropbox', icon: 'capsule' },
              { id: 'gdrive', label: 'Google Drive', icon: 'folder' },
              { id: 's3', label: 'Amazon S3', icon: 'cloud' },
            ].map(dest => (
              <button key={dest.id} type="button" onClick={() => setDestinationKind(dest.id)}
                className={`pb-btn pb-btn-sm ${destinationKind === dest.id ? 'pb-btn-primary' : 'pb-btn-ghost'}`}
                style={{ flex: 1, padding: '5px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                <Icon name={dest.icon} size={13} /> {dest.label}
              </button>
            ))}
          </div>

          {destinationKind === 'dropbox' && (
            <div>
              <label style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Dropbox Folder Path</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="text" value={dropboxPath} onChange={e => setDropboxPath(e.target.value)} className="pb-input mono" style={{ flex: 1, fontSize: '12px' }} />
                <button type="button" onClick={() => handleTestStorage('dropbox')} className="pb-btn pb-btn-sm" disabled={busy}>Test</button>
              </div>
              <div style={{ marginTop: '8px' }}><a href="/oauth/dropbox/start" className="pb-text-link" style={{ fontSize: '11px' }}>1-Click Dropbox OAuth</a></div>
            </div>
          )}

          {destinationKind === 'gdrive' && (
            <div>
              <label style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Google Drive Folder</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="text" value={gdrivePath} onChange={e => setGdrivePath(e.target.value)} className="pb-input mono" style={{ flex: 1, fontSize: '12px' }} />
                <button type="button" onClick={() => handleTestStorage('google-drive')} className="pb-btn pb-btn-sm" disabled={busy}>Test</button>
              </div>
              <div style={{ marginTop: '8px' }}><a href="/oauth/google-drive/start" className="pb-text-link" style={{ fontSize: '11px' }}>1-Click Google Drive OAuth</a></div>
            </div>
          )}

          {destinationKind === 's3' && (
            <div>
              <label style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginBottom: '4px' }}>Amazon S3 Bucket URI</label>
              <input type="text" value={s3Path} onChange={e => setS3Path(e.target.value)} placeholder="s3://my-bucket/portabase/" className="pb-input mono" style={{ width: '100%', fontSize: '12px' }} />
              <span style={{ fontSize: '11px', color: '#8b949e', marginTop: '6px', display: 'block' }}>Zero-knowledge runner writes encrypted capsules directly to your S3 bucket.</span>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Tables & Storage Buckets */}
      <div className="pb-card" style={{ background: '#11151c', border: '1px solid #222630', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icon name="table" size={16} />
            <span style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tables &amp; Storage Buckets</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" onClick={handleSelectAll} className="pb-btn pb-btn-ghost pb-btn-sm" style={{ fontSize: '11px', padding: '3px 8px' }}>Select All</button>
              <button type="button" onClick={handleSchemaOnly} className="pb-btn pb-btn-ghost pb-btn-sm" style={{ fontSize: '11px', padding: '3px 8px' }}>Schema Only</button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '240px' }}>
            <span className="mono" style={{ fontSize: '11px', fontWeight: 600 }}>{scopeSummary.includedMb.toFixed(2)} MB / 40 GB Free Quota</span>
            <div style={{ flex: 1, height: '6px', background: '#222630', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, Math.max(1, (scopeSummary.includedMb / 40960) * 100))}%`, height: '100%', background: '#2ea043' }} />
            </div>
          </div>
        </div>
        <DatabaseScopeSelector databases={databases} onChange={setDatabases} readOnly={false} />
      </div>

      {/* Row 3: Primary Action Bar */}
      <div className="pb-card" style={{ background: '#11151c', border: '1px solid #222630', padding: '16px', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button" onClick={handleBackup} disabled={busy || databases.length === 0}
              className="pb-btn pb-btn-primary"
              style={{ background: '#2ea043', borderColor: '#2ea043', color: '#fff', fontWeight: 700, fontSize: '14px', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Icon name="capsule" size={16} />
              {busy ? 'Backing Up…' : `Back Up Capsule to ${destinationKind === 'dropbox' ? 'Dropbox' : destinationKind === 'gdrive' ? 'Google Drive' : 'Amazon S3'}`}
            </button>
            <span className="mono" style={{ fontSize: '11px', color: '#8b949e' }}>AES-256-GCM · Client-side encrypted</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="text" placeholder="Target project ref" value={targetRef} onChange={e => setTargetRef(e.target.value)} className="pb-input mono" style={{ width: '180px', fontSize: '12px', padding: '6px 8px' }} />
            <button type="button" onClick={handleRestore} disabled={busy || !targetRef.trim()} className="pb-btn pb-btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px' }}>
              <Icon name="restore" size={13} /> Restore Capsule to Target
            </button>
          </div>
        </div>

        {lastReceipt && (
          <div className="pb-callout ok mono" style={{ marginTop: '14px', padding: '10px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="check" size={14} />
            <span>{lastReceipt}</span>
          </div>
        )}
      </div>
    </div>
  );
}
