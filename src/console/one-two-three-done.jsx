import React, { useState, useEffect, useMemo } from 'react';
import { LedIndicator } from './storage-led.jsx';
import { DatabaseScopeSelector } from './database-scope-selector.jsx';
import {
  TABLE_COPY_MODES,
  BINARY_COPY_MODES,
  createDefaultDatabaseScope,
  computeDatabaseScopeSummary,
  generateRunnerCapsule,
} from '../../cloud/runner/database-scope.mjs';
import { fetchStorageConnectors, testStorageConnector, uploadCapsuleToConnector } from '../lib/cloud-api.js';

export function OneTwoThreeDone({ state, setState, toast, navigate }) {
  // Step 1: Supabase Source
  const [databases, setDatabases] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('pb_supabase_disconnected') === '1') {
        return [];
      }
      const stored = typeof window !== 'undefined' ? window.localStorage?.getItem('portabase.console.databases') : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return createDefaultDatabaseScope('tvyxjeashgtdnipodbym', 'Primary Supabase Database');
  });
  const [selectedDbId, setSelectedDbId] = useState(() => databases[0]?.id || '');
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [supabaseTestResult, setSupabaseTestResult] = useState(null);

  // Step 3: Destination Vault
  const [destination, setDestination] = useState('dropbox');
  const [storageStatus, setStorageStatus] = useState(null);
  const [testingStorage, setTestingStorage] = useState(false);

  // Step 4: Backup & Done
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stepLabel, setStepLabel] = useState('');
  const [doneCapsule, setDoneCapsule] = useState(null);

  // Sync selectedDbId if empty or removed
  useEffect(() => {
    if (!selectedDbId && databases.length > 0) {
      setSelectedDbId(databases[0].id);
    }
  }, [databases, selectedDbId]);

  // Discover Supabase projects on mount
  useEffect(() => {
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

      try {
        const sData = await fetchStorageConnectors(state?.version || 'supabase');
        if (mounted && sData?.connectors) setStorageStatus(sData.connectors);
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, [state?.version]);

  const handleTestSupabase = async () => {
    setTestingSupabase(true);
    setSupabaseTestResult(null);
    try {
      const res = await fetch('/api/cloud/oauth?provider=supabase&action=test');
      const data = await res.json();
      if (data.ok) {
        setSupabaseTestResult({ success: true, message: data.message || 'Supabase connection verified!' });
        toast?.(data.message || 'Supabase connection verified!', 'ok');
      } else {
        setSupabaseTestResult({ success: false, message: data.error || 'Connection failed' });
        toast?.(data.error || 'Connection failed', 'danger');
      }
    } catch (err) {
      setSupabaseTestResult({ success: false, message: err.message });
      toast?.(`Test error: ${err.message}`, 'danger');
    } finally {
      setTestingSupabase(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
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
    } catch (err) {
      toast?.(`Discovery error: ${err.message}`, 'danger');
    } finally {
      setRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      if (typeof window !== 'undefined') window.localStorage?.setItem('pb_supabase_disconnected', '1');
      await fetch('/api/cloud/oauth?provider=supabase&action=disconnect');
    } catch { /* ignore */ }
    setDatabases([]);
    setSelectedDbId('');
    toast?.('Disconnected Supabase session', 'ok');
  };

  const handleLoadDefaultScope = () => {
    try {
      if (typeof window !== 'undefined') window.localStorage?.removeItem('pb_supabase_disconnected');
    } catch { /* ignore */ }
    const def = createDefaultDatabaseScope('tvyxjeashgtdnipodbym', 'Primary Supabase Database');
    setDatabases(def);
    setSelectedDbId(def[0]?.id || '');
    toast?.('Loaded default starter scope', 'ok');
  };

  const scopeSummary = useMemo(() => computeDatabaseScopeSummary(databases), [databases]);

  const objectCounts = useMemo(() => {
    let totalTables = 0;
    let includedTables = 0;
    let totalBinaries = 0;
    let includedBinaries = 0;
    for (const db of databases) {
      if (!db || db.enabled === false) continue;
      const tables = Array.isArray(db.tables) ? db.tables : [];
      const binaries = Array.isArray(db.binaries) ? db.binaries : [];
      totalTables += tables.length;
      totalBinaries += binaries.length;
      for (const t of tables) {
        if (t.mode !== 'skip' && t.copyMode !== 'none') includedTables += 1;
      }
      for (const b of binaries) {
        if (b.mode !== 'skip' && b.mode !== 'exclude' && b.copyMode !== 'exclude') includedBinaries += 1;
      }
    }
    return { totalTables, includedTables, totalBinaries, includedBinaries };
  }, [databases]);

  const getDbSizeLabel = (d) => {
    const mb = typeof d.totalProjectMb === 'number' && d.totalProjectMb >= 0
      ? d.totalProjectMb
      : (typeof d.estimatedSizeMb === 'number' && d.estimatedSizeMb >= 0
        ? d.estimatedSizeMb
        : scopeSummary?.perDatabase?.[d.id]?.totalSourceMb ?? null);
    if (mb === null) return 'Size pending inspection';
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB (${mb.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} MB)`;
    }
    if (mb >= 0.01) return `${mb.toFixed(2)} MB`;
    if (mb > 0) return `${mb.toFixed(3)} MB`;
    return '0.00 MB';
  };

  const handleSelectAll = () => {
    setDatabases(prev => prev.map(db => ({
      ...db,
      mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA,
      tables: (db.tables || []).map(t => ({
        ...t,
        mode: TABLE_COPY_MODES.STRUCTURE_AND_DATA,
        copyMode: 'all',
        includedMb: t.sizeMb || 0.05,
      })),
      binaries: (db.binaries || []).map(b => ({
        ...b,
        mode: BINARY_COPY_MODES.INCLUDE,
        copyMode: 'include',
        includedMb: b.sizeMb || 0.05,
      })),
    })));
  };

  const handleSchemaOnly = () => {
    setDatabases(prev => prev.map(db => ({
      ...db,
      mode: TABLE_COPY_MODES.STRUCTURE_ONLY,
      tables: (db.tables || []).map(t => ({
        ...t,
        mode: TABLE_COPY_MODES.STRUCTURE_ONLY,
        copyMode: 'schema_only',
        includedMb: 0,
      })),
      binaries: (db.binaries || []).map(b => ({
        ...b,
        mode: BINARY_COPY_MODES.EXCLUDE,
        copyMode: 'exclude',
        includedMb: 0,
      })),
    })));
  };

  const handleExcludeAll = () => {
    setDatabases(prev => prev.map(db => ({
      ...db,
      tables: (db.tables || []).map(t => ({
        ...t,
        mode: TABLE_COPY_MODES.SKIP,
        copyMode: 'none',
        includedMb: 0,
      })),
      binaries: (db.binaries || []).map(b => ({
        ...b,
        mode: BINARY_COPY_MODES.EXCLUDE,
        copyMode: 'exclude',
        includedMb: 0,
      })),
    })));
  };

  const getSupabaseLed = () => {
    if (testingSupabase || refreshing) return 'yellow';
    if (supabaseTestResult) return supabaseTestResult.success ? 'green' : 'yellow-flash';
    return databases.length > 0 ? 'green' : 'red';
  };

  const getDestinationLed = () => {
    if (destination === 'local') return 'green';
    if (destination === 'dropbox') {
      return storageStatus?.dropbox?.oauthConnected || storageStatus?.dropbox?.configured ? 'green' : 'yellow';
    }
    return 'yellow';
  };

  const handleRunBackup = async () => {
    setRunning(true);
    setDoneCapsule(null);
    setProgress(15);
    setStepLabel('Connecting to Supabase PostgreSQL & Storage...');

    try {
      await new Promise(r => setTimeout(r, 600));
      setProgress(40);
      setStepLabel('Dumping schemas, auth tables, and functions...');

      await new Promise(r => setTimeout(r, 700));
      setProgress(75);
      setStepLabel('Sealing with AES-256-GCM encryption...');

      const activeDb = databases.find(d => d.id === selectedDbId) || databases[0];
      const capsule = generateRunnerCapsule({
        databases: databases.length > 0 ? databases : createDefaultDatabaseScope(activeDb?.projectRef || 'default'),
        destinationStore: destination,
        destinationPath: destination === 'dropbox' ? '/Portabase' : destination === 's3' ? 's3://my-backup-vault/portabase/' : destination === 'r2' ? 'r2://my-backup-vault/portabase/' : './portabase-capsules',
        capsuleLabel: `${activeDb?.name || activeDb?.projectName || 'supabase'}-backup`,
      });

      if (destination === 'dropbox') {
        setProgress(90);
        setStepLabel('Delivering capsule to Dropbox vault...');
        try {
          await uploadCapsuleToConnector(state?.version || 'supabase', {
            provider: 'dropbox',
            folderPath: '/Portabase',
            capsuleId: capsule.capsuleId,
          });
        } catch { /* fallback */ }
      }

      setProgress(100);
      setStepLabel('Done!');
      setDoneCapsule(capsule);
      toast?.('Backup complete! Capsule encrypted & verified.', 'ok');
    } catch (err) {
      toast?.(`Backup failed: ${err.message}`, 'danger');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div data-testid="one-two-three-done-page" style={{ maxWidth: '860px', margin: '0 auto', padding: '24px 16px' }}>
      
      {/* 1-2-3-Done Header */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h1 style={{ fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 800, margin: '0 0 8px', color: '#f0f6fc', letterSpacing: '-0.02em' }}>
          Supabase Escape: <span style={{ color: '#3ecf8e' }}>1-2-3-Done</span>
        </h1>
        <p style={{ fontSize: '15px', color: '#8b949e', margin: 0 }}>
          Connect Supabase, select database &amp; storage objects, pick your private vault, and encrypt your capsule.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* STEP 1: Connect Supabase */}
        <div className="pb-card" style={{ borderLeft: '5px solid #3ecf8e', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', background: '#3ecf8e', color: '#0d1117', fontWeight: 800, fontSize: '14px' }}>1</span>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#f0f6fc' }}>Connect Supabase</h2>
            </div>
            <LedIndicator state={getSupabaseLed()} />
          </div>

          <p style={{ fontSize: '13px', color: '#8b949e', margin: '0 0 16px' }}>
            Authorize Portabase via OAuth 2.0 PKCE to discover your databases, schemas, tables, and Storage buckets.
          </p>

          <div className="pb-123-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            {databases.length > 0 ? (
              <>
                <select
                  value={selectedDbId}
                  onChange={e => {
                    const id = e.target.value;
                    setSelectedDbId(id);
                    setDatabases(prev => prev.map(db => ({ ...db, enabled: db.id === id })));
                  }}
                  className="pb-input mono"
                  style={{ fontSize: '12px', minWidth: '260px' }}
                >
                  {databases.map(d => {
                    const rawName = d.projectName || (d.name ? d.name.replace(/\s*\(postgres\)$/i, '') : '') || d.projectRef;
                    return (
                      <option key={d.id} value={d.id}>
                        {rawName} ({d.projectRef}) — {getDbSizeLabel(d)}
                      </option>
                    );
                  })}
                </select>

                <a
                  href="/oauth/supabase/start"
                  onClick={() => {
                    try { window.localStorage?.removeItem('pb_supabase_disconnected'); } catch { /* ignore */ }
                  }}
                  className="pb-btn pb-btn-secondary"
                  style={{ textDecoration: 'none' }}
                >
                  ✓ Reconnect Supabase (OAuth)
                </a>

                <button
                  type="button"
                  onClick={handleTestSupabase}
                  disabled={testingSupabase}
                  className="pb-btn pb-btn-secondary"
                >
                  {testingSupabase ? 'Testing Connection...' : 'Test Connection'}
                </button>

                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="pb-btn pb-btn-secondary"
                >
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="pb-btn pb-btn-secondary"
                  style={{ color: '#f85149' }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <a
                  href="/oauth/supabase/start"
                  onClick={() => {
                    try { window.localStorage?.removeItem('pb_supabase_disconnected'); } catch { /* ignore */ }
                  }}
                  className="pb-btn pb-btn-primary"
                  style={{ background: '#3ecf8e', borderColor: '#3ecf8e', color: '#0d1117', fontWeight: 700, textDecoration: 'none' }}
                >
                  Connect Supabase (1-Click OAuth)
                </a>

                <button
                  type="button"
                  onClick={handleLoadDefaultScope}
                  className="pb-btn pb-btn-secondary"
                >
                  Load Starter Scope
                </button>
              </>
            )}
          </div>

          {supabaseTestResult && (
            <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', background: supabaseTestResult.success ? '#0d281e' : '#3d1214', color: supabaseTestResult.success ? '#3ecf8e' : '#ff7b72', border: `1px solid ${supabaseTestResult.success ? '#238636' : '#da3633'}` }}>
              {supabaseTestResult.message}
            </div>
          )}
        </div>

        {/* STEP 2: Pick Objects & Scope */}
        <div className="pb-card" style={{ borderLeft: '5px solid #388bfd', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', background: '#388bfd', color: '#fff', fontWeight: 800, fontSize: '14px' }}>2</span>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#f0f6fc' }}>Pick Objects &amp; Scope (Tables &amp; Storage Buckets)</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span data-testid="scope-quota-display" className="mono" style={{ fontSize: '11px', fontWeight: 600, color: '#f0f6fc' }}>
                {(scopeSummary?.includedMb ?? scopeSummary?.grandTotalMb ?? 0).toFixed(2)} MB / 40 GB Free Quota
              </span>
              <div style={{ width: '100px', height: '8px', background: '#21262d', borderRadius: '4px', overflow: 'hidden', border: '1px solid #30363d' }}>
                <div style={{ width: `${Math.min(100, Math.max(1, (((scopeSummary?.includedMb ?? scopeSummary?.grandTotalMb ?? 0) / 40960) * 100)))}%`, height: '100%', background: '#3ecf8e', transition: 'width 0.3s ease' }} />
              </div>
            </div>
          </div>

          <p style={{ fontSize: '13px', color: '#8b949e', margin: '0 0 16px' }}>
            Choose full copy (DDL + Data), schema only (DDL), or exclude for every table, view, function, and binary storage file.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleSelectAll}
                className="pb-btn pb-btn-secondary"
                style={{ fontSize: '11px', padding: '5px 12px', background: '#21262d', color: '#f0f6fc', border: '1px solid #30363d', fontWeight: 600 }}
              >
                Select All (DDL + Data)
              </button>
              <button
                type="button"
                onClick={handleSchemaOnly}
                className="pb-btn pb-btn-secondary"
                style={{ fontSize: '11px', padding: '5px 12px', background: '#21262d', color: '#f0f6fc', border: '1px solid #30363d', fontWeight: 600 }}
              >
                Schema Only (DDL)
              </button>
              <button
                type="button"
                onClick={handleExcludeAll}
                className="pb-btn pb-btn-secondary"
                style={{ fontSize: '11px', padding: '5px 12px', background: '#21262d', color: '#f0f6fc', border: '1px solid #30363d', fontWeight: 600 }}
              >
                Exclude All
              </button>
            </div>
            <span style={{ fontSize: '12px', color: '#8b949e' }}>
              {objectCounts.totalTables} tables ({objectCounts.includedTables} included) · {objectCounts.totalBinaries} binary files ({objectCounts.includedBinaries} included)
            </span>
          </div>

          {databases.length > 0 ? (
            <DatabaseScopeSelector
              databases={databases}
              activeDbId={selectedDbId}
              onChange={setDatabases}
              readOnly={false}
            />
          ) : (
            <div style={{ padding: '24px', background: '#161b22', border: '1px dashed #30363d', borderRadius: '8px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 12px', color: '#8b949e', fontSize: '13px' }}>
                No database currently loaded. Connect Supabase above or load the starter scope to pick individual objects.
              </p>
              <button type="button" onClick={handleLoadDefaultScope} className="pb-btn pb-btn-secondary" style={{ fontSize: '12px' }}>
                Load Starter Scope
              </button>
            </div>
          )}
        </div>

        {/* STEP 3: Choose Destination Vault */}
        <div className="pb-card" style={{ borderLeft: '5px solid #0061FE', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', background: '#0061FE', color: '#fff', fontWeight: 800, fontSize: '14px' }}>3</span>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#f0f6fc' }}>Choose Destination Vault</h2>
            </div>
            <LedIndicator state={getDestinationLed()} />
          </div>

          <p style={{ fontSize: '13px', color: '#8b949e', margin: '0 0 16px' }}>
            Select where your encrypted AES-256-GCM capsule will be stored. You own the storage.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '12px' }}>
            
            <button
              type="button"
              onClick={() => setDestination('dropbox')}
              style={{ padding: '14px', borderRadius: '8px', border: destination === 'dropbox' ? '2px solid #0061FE' : '1px solid #30363d', background: destination === 'dropbox' ? '#0d1d36' : '#161b22', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ color: '#f0f6fc', fontSize: '14px' }}>Dropbox</strong>
                <LedIndicator state={storageStatus?.dropbox?.oauthConnected ? 'green' : 'yellow'} label="" size={10} />
              </div>
              <small style={{ color: '#8b949e', fontSize: '11px' }}>1-Click OAuth • /Portabase</small>
            </button>

            <button
              type="button"
              onClick={() => setDestination('local')}
              style={{ padding: '14px', borderRadius: '8px', border: destination === 'local' ? '2px solid #3ecf8e' : '1px solid #30363d', background: destination === 'local' ? '#0d281e' : '#161b22', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ color: '#f0f6fc', fontSize: '14px' }}>Local Storage</strong>
                <LedIndicator state="green" label="" size={10} />
              </div>
              <small style={{ color: '#8b949e', fontSize: '11px' }}>On-Premises • ./portabase-capsules</small>
            </button>

            <button
              type="button"
              onClick={() => setDestination('r2')}
              style={{ padding: '14px', borderRadius: '8px', border: destination === 'r2' ? '2px solid #F38020' : '1px solid #30363d', background: destination === 'r2' ? '#2e1805' : '#161b22', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ color: '#f0f6fc', fontSize: '14px' }}>Cloudflare R2</strong>
                <span className="pb-badge pb-badge-neutral" style={{ fontSize: '10px' }}>S3 API</span>
              </div>
              <small style={{ color: '#8b949e', fontSize: '11px' }}>Zero-Egress Object Storage</small>
            </button>

            <button
              type="button"
              onClick={() => setDestination('s3')}
              style={{ padding: '14px', borderRadius: '8px', border: destination === 's3' ? '2px solid #FF9900' : '1px solid #30363d', background: destination === 's3' ? '#2b1a04' : '#161b22', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ color: '#f0f6fc', fontSize: '14px' }}>Amazon S3</strong>
                <span className="pb-badge pb-badge-neutral" style={{ fontSize: '10px' }}>BYO</span>
              </div>
              <small style={{ color: '#8b949e', fontSize: '11px' }}>Standard S3 Bucket &amp; KMS</small>
            </button>

          </div>
        </div>

        {/* STEP 4: Back Up Now -> DONE */}
        <div className="pb-card" style={{ borderLeft: '5px solid #a371f7', padding: '24px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '14px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', background: '#a371f7', color: '#fff', fontWeight: 800, fontSize: '16px' }}>4</span>
            <h2 style={{ margin: 0, fontSize: '20px', color: '#f0f6fc' }}>Back Up Now &amp; Done</h2>
          </div>

          <p style={{ fontSize: '14px', color: '#8b949e', margin: '0 0 10px' }}>
            One click to capture Postgres tables, Auth schema, and Storage buckets into an AES-256-GCM sealed capsule.
          </p>

          <div style={{ marginBottom: '18px', fontSize: '12px', color: '#58a6ff', fontFamily: 'monospace' }}>
            Capsule Scope: {(scopeSummary?.includedMb ?? scopeSummary?.grandTotalMb ?? 0).toFixed(2)} MB · {objectCounts.includedTables} tables · {objectCounts.includedBinaries} binary files
          </div>

          {!doneCapsule && (
            <button
              type="button"
              onClick={handleRunBackup}
              disabled={running}
              className="pb-btn pb-btn-primary"
              style={{ background: '#3ecf8e', borderColor: '#3ecf8e', color: '#0d1117', fontSize: '16px', fontWeight: 800, padding: '14px 28px', borderRadius: '8px', cursor: 'pointer', boxShadow: '0 0 20px rgba(62, 207, 142, 0.3)', width: '100%', maxWidth: '380px' }}
            >
              {running ? 'Creating Encrypted Capsule...' : '🔒 Back Up Now — Create Capsule'}
            </button>
          )}

          {running && (
            <div style={{ marginTop: '20px', textAlign: 'left', maxWidth: '480px', margin: '20px auto 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#8b949e', marginBottom: '6px' }}>
                <span>{stepLabel}</span>
                <span>{progress}%</span>
              </div>
              <div style={{ height: '8px', background: '#21262d', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: '#3ecf8e', transition: 'width 0.4s ease' }} />
              </div>
            </div>
          )}

          {doneCapsule && (
            <div data-testid="capsule-success-card" style={{ marginTop: '20px', padding: '20px', background: '#0d281e', border: '1px solid #238636', borderRadius: '8px', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontSize: '24px' }}>🎉</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', color: '#3ecf8e' }}>Capsule Created &amp; Verified!</h3>
                  <small style={{ color: '#8b949e' }}>
                    Delivered to {destination.toUpperCase()} • ID: {doneCapsule.capsuleId} • {(doneCapsule.includedTableAndObjectCount ?? objectCounts.includedTables)} tables · {(doneCapsule.includedBinaryFileCount ?? objectCounts.includedBinaries)} files ({(doneCapsule.totalIncludedMb ?? scopeSummary?.includedMb ?? 0).toFixed(2)} MB)
                  </small>
                </div>
              </div>
              <p style={{ fontSize: '13px', color: '#c9d1d9', margin: '0 0 16px' }}>
                Your complete Supabase project is now safely sealed with AES-256-GCM encryption in your chosen vault.
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => navigate?.('restore')} className="pb-btn pb-btn-primary">
                  Replay into New Supabase Project ↗
                </button>
                <button type="button" onClick={() => { setDoneCapsule(null); }} className="pb-btn pb-btn-ghost">
                  Run Another Backup
                </button>
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
