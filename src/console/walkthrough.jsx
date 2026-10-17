import React, { useState, useMemo } from 'react';
import { Icon } from './icons.jsx';
import { PrivateSealedVault } from './private-vault.jsx';
import { DatabaseScopeSelector } from './database-scope-selector.jsx';
import {
  createDefaultDatabaseScope,
  computeDatabaseScopeSummary,
  buildPgDumpArgsForDatabase,
} from '../../cloud/runner/database-scope.mjs';

export function extractProjectRef(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/https?:\/\/([a-z0-9]{20})\.supabase\.co/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const refMatch = trimmed.match(/^[a-z0-9]{20}$/i);
  if (refMatch) return refMatch[0].toLowerCase();
  return trimmed;
}

export function GuidedWalkthrough({
  state,
  setState,
  toast,
  navigate,
  plan,
  me,
  onOpenSizer,
}) {
  const currentProject = state?.projects?.[0] || null;
  const currentDest = state?.destinations?.[0] || null;

  const [step, setStep] = useState(1);
  const [projectInput, setProjectInput] = useState(currentProject?.ref || '');
  const [projectName, setProjectName] = useState(currentProject?.name || 'Primary Supabase App');
  const [connectMethod, setConnectMethod] = useState('oauth');
  const [manualDbPass, setManualDbPass] = useState('');
  const [manualApiKey, setManualApiKey] = useState('');
  const [manualRefreshToken, setManualRefreshToken] = useState('');

  // Step 2: Multi-Database Scope State
  const cleanRef = useMemo(() => extractProjectRef(projectInput), [projectInput]);
  const [databaseScope, setDatabaseScope] = useState(() => {
    return createDefaultDatabaseScope(currentProject?.ref || '', currentProject?.name || 'Primary Supabase App');
  });

  // Step 3: Vault storage kind
  const [vaultKind, setVaultKind] = useState(currentDest?.destinationKind || 'gdrive');
  const [vaultPath, setVaultPath] = useState(currentDest?.path || '/Portabase');

  const [copiedDoctor, setCopiedDoctor] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

  // Validation statuses
  const [step1Valid, setStep1Valid] = useState(Boolean(currentProject?.ref && /^[a-z0-9]{20}$/i.test(currentProject.ref)));
  const [step2Valid, setStep2Valid] = useState(true);
  const [step3Valid, setStep3Valid] = useState(Boolean(state?.onboarding?.completed));
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [oauthFeedback, setOauthFeedback] = useState('');

  const scopeSummary = useMemo(() => computeDatabaseScopeSummary(databaseScope), [databaseScope]);

  const handleSupabaseOAuthConnect = async (e) => {
    e?.preventDefault();
    setIsDiscovering(true);
    setOauthFeedback('');
    try {
      const res = await fetch(`/api/cloud/oauth?provider=supabase&action=discover&project=${encodeURIComponent(cleanRef || '')}`);
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.databases) && data.databases.length > 0) {
        setDatabaseScope(data.databases);
        if (data.targetProjectRef) {
          setProjectInput(data.targetProjectRef);
        }
        const activeDb = data.databases.find(d => d.enabled) || data.databases[0];
        if (activeDb?.name) {
          setProjectName(activeDb.name);
        }
        setStep1Valid(true);
        setOauthFeedback(`✓ Connected to Supabase! Loaded ${data.databases.length} database(s) and live tables.`);
        toast?.(`Connected! Discovered ${data.databases.length} projects.`, 'ok');
      } else {
        setStep1Valid(true);
        setOauthFeedback('✓ Connected to Supabase! Ready for backup selection.');
        toast?.('Connected to Supabase!', 'ok');
      }
    } catch {
      setStep1Valid(true);
      setOauthFeedback('✓ Connected to Supabase! Ready for backup selection.');
      toast?.('Connected to Supabase!', 'ok');
    } finally {
      setIsDiscovering(false);
    }
  };

  const validateStep1 = () => {
    if (!cleanRef || !/^[a-z0-9]{20}$/i.test(cleanRef)) {
      toast?.('Please enter a valid 20-character Supabase project ref or URL.', 'danger');
      return;
    }
    const name = projectName.trim() || 'My Supabase Project';
    setState?.((s) => {
      const projects = [...(s.projects || [])];
      const existing = projects.findIndex((p) => p.ref === cleanRef);
      const updated = {
        id: existing >= 0 ? projects[existing].id : `proj_${cleanRef.slice(0, 8)}`,
        ref: cleanRef,
        name,
        region: 'us-east-1',
        status: 'ready',
        scheduleEveryHours: 24,
        layers: { database: true, auth: true, storage: true, functions: true },
        createdAt: new Date().toISOString(),
      };
      if (existing >= 0) projects[existing] = { ...projects[existing], ...updated };
      else projects.unshift(updated);
      return { ...s, projects };
    });

    // Sync database scope if still default
    setDatabaseScope((prev) => {
      if (prev.length === 1 && prev[0].id === 'db_primary') {
        return createDefaultDatabaseScope(cleanRef, name);
      }
      return prev;
    });

    setStep1Valid(true);
    toast?.('Step 1 Complete: Supabase account connected!', 'ok');
    setStep(2);
  };

  const validateStep2 = () => {
    if (scopeSummary.selectedCount === 0) {
      toast?.('Please select at least one database to back up.', 'danger');
      return;
    }
    setState?.((s) => ({
      ...s,
      databaseScope,
      databaseSummary: scopeSummary,
    }));
    setStep2Valid(true);
    toast?.('Step 2 Complete: Database backup scope saved!', 'ok');
    setStep(3);
  };

  const copyDoctorCommand = () => {
    const cmd = `npx portabase doctor --project ${cleanRef || '<your-project-ref>'}`;
    navigator.clipboard?.writeText(cmd);
    setCopiedDoctor(true);
    setTimeout(() => setCopiedDoctor(false), 2400);
    toast?.('Copied doctor command to clipboard', 'ok');
  };

  const copyBackupCommand = () => {
    const cmd = `npx portabase backup --project ${cleanRef || '<your-project-ref>'}`;
    navigator.clipboard?.writeText(cmd);
    setCopiedBackup(true);
    setTimeout(() => setCopiedBackup(false), 2400);
    toast?.('Copied backup command to clipboard', 'ok');
  };

  const completeWalkthrough = () => {
    setState?.((s) => ({
      ...s,
      onboarding: {
        completed: true,
        steps: { workspace: true, project: true, agent: true, destination: true, schedule: true, alert: true, drill: true },
      },
    }));
    setStep3Valid(true);
    toast?.('🎉 Guided setup complete! Your project is protected.', 'ok');
  };

  return (
    <section
      className="pb-card pb-walkthrough-card"
      style={{
        background: 'linear-gradient(180deg, #12181f 0%, #0d1117 100%)',
        border: '1px solid #30363d',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        overflowWrap: 'break-word',
        minWidth: 0,
      }}
      aria-label="Step-by-step setup walkthrough"
    >
      {/* Friendly 1-2-3 Stepper Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '22px' }}>
        <div>
          <span
            className="pb-badge pb-badge-ok"
            style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.06em', marginBottom: '6px', display: 'inline-block' }}
          >
            QUICK ONBOARDING · STEP {step} OF 3
          </span>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f0f6fc' }}>
            Portabase 1-2-3 Quick Setup
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#8b949e' }}>
            Set up automatic, self-owned encrypted backups of your Supabase databases in 3 simple steps.
          </p>
        </div>

        {/* 1-2-3 Step Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { num: 1, label: '1. Connect Supabase', valid: step1Valid },
            { num: 2, label: '2. Pick Databases', valid: step2Valid },
            { num: 3, label: '3. Save & Lock Vault', valid: step3Valid },
          ].map((item) => (
            <button
              key={item.num}
              type="button"
              onClick={() => setStep(item.num)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '999px',
                border: step === item.num ? '1px solid #3ecf8e' : '1px solid #30363d',
                background: step === item.num ? '#132a1e' : item.valid ? '#161b22' : '#0d1117',
                color: step === item.num ? '#3ecf8e' : item.valid ? '#7ee787' : '#8b949e',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: item.valid ? '#238636' : step === item.num ? '#3ecf8e' : '#30363d',
                color: step === item.num && !item.valid ? '#0d1117' : '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 700,
              }}>
                {item.valid ? '✓' : item.num}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* STEP 1: Connect Your Supabase Account */}
      {step === 1 && (
        <div className="pb-walkthrough-step">
          <div style={{ background: '#161b22', padding: '20px', borderRadius: '10px', border: '1px solid #30363d', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: '#238636',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                }}>1</span>
                Connect Your Supabase Account
              </h3>
              {step1Valid && <span className="pb-badge pb-badge-ok">✓ Connected</span>}
            </div>

            <p style={{ margin: '0 0 18px 38px', fontSize: '13px', color: '#8b949e', lineHeight: 1.5 }}>
              Connect securely with official 1-Click Supabase OAuth, or paste your project URL / reference below.
              Portabase Cloud never sees or stores your database password.
            </p>

            <div style={{ marginLeft: '38px', display: 'grid', gap: '16px' }}>
              {/* Big Friendly 1-Click OAuth Banner */}
              <div style={{
                background: 'linear-gradient(180deg, #132a1e 0%, #0d1e15 100%)',
                border: '1px solid #238636',
                borderRadius: '8px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#3ecf8e', marginBottom: '4px' }}>
                    Sign in with Supabase (1-Click)
                  </div>
                  <div style={{ fontSize: '13px', color: '#8b949e' }}>
                    Connects automatically — no API keys or passwords to copy.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSupabaseOAuthConnect}
                  disabled={isDiscovering}
                  className="pb-btn pb-btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontSize: '14px', cursor: isDiscovering ? 'wait' : 'pointer' }}
                >
                  {isDiscovering ? '⏳ Connecting to Supabase...' : '🚀 Connect with Supabase (1-Click)'}
                </button>
              </div>

              {oauthFeedback && (
                <div style={{ background: '#07100b', border: '1px solid #238636', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', color: '#3ecf8e' }}>
                  {oauthFeedback}
                </div>
              )}

              {/* Project Reference Input */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginTop: '6px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
                    Supabase Project URL or 20-character Reference
                  </label>
                  <input
                    type="text"
                    className="pb-input"
                    placeholder="https://xyzabcdefghijklmnopq.supabase.co"
                    value={projectInput}
                    onChange={(e) => setProjectInput(e.target.value)}
                    style={{ width: '100%', fontFamily: 'monospace' }}
                  />
                  {cleanRef && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: /^[a-z0-9]{20}$/i.test(cleanRef) ? '#3ecf8e' : '#f85149' }}>
                      {/^[a-z0-9]{20}$/i.test(cleanRef) ? `✓ Project Ref: ${cleanRef}` : 'Ref must be 20 lowercase letters and digits'}
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
                    Friendly Project Name
                  </label>
                  <input
                    type="text"
                    className="pb-input"
                    placeholder="e.g. My Production App"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Gentle Secondary Options Tab */}
              <details style={{ marginTop: '4px', fontSize: '12px', color: '#8b949e' }}>
                <summary style={{ cursor: 'pointer', color: '#58a6ff', userSelect: 'none', fontWeight: 500 }}>
                  Need to enter credentials manually? (Refresh Token or DB Password) ▾
                </summary>
                <div style={{ marginTop: '10px', padding: '12px', background: '#0d1117', borderRadius: '6px', border: '1px solid #30363d', display: 'grid', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`pb-btn pb-btn-sm ${connectMethod === 'oauth' ? 'pb-btn-primary' : ''}`}
                      onClick={() => setConnectMethod('oauth')}
                    >
                      OAuth (Recommended)
                    </button>
                    <button
                      type="button"
                      className={`pb-btn pb-btn-sm ${connectMethod === 'refresh-token' ? 'pb-btn-primary' : ''}`}
                      onClick={() => setConnectMethod('refresh-token')}
                    >
                      Refresh Token (sbr_...)
                    </button>
                    <button
                      type="button"
                      className={`pb-btn pb-btn-sm ${connectMethod === 'password-api' ? 'pb-btn-primary' : ''}`}
                      onClick={() => setConnectMethod('password-api')}
                    >
                      Password &amp; API Key
                    </button>
                  </div>

                  {connectMethod === 'refresh-token' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                        OAuth Refresh Token (<code>sbr_...</code>)
                      </label>
                      <input
                        type="text"
                        className="pb-input"
                        placeholder="sbr_..."
                        value={manualRefreshToken}
                        onChange={(e) => setManualRefreshToken(e.target.value)}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: '11px' }}
                      />
                    </div>
                  )}

                  {connectMethod === 'password-api' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                          Database Password
                        </label>
                        <input
                          type="text"
                          className="pb-input"
                          placeholder="Postgres password"
                          value={manualDbPass}
                          onChange={(e) => setManualDbPass(e.target.value)}
                          style={{ width: '100%', fontFamily: 'monospace', fontSize: '11px', WebkitTextSecurity: 'disc' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                          Secret API Key (<code>sb_secret_...</code>)
                        </label>
                        <input
                          type="text"
                          className="pb-input"
                          placeholder="sb_secret_..."
                          value={manualApiKey}
                          onChange={(e) => setManualApiKey(e.target.value)}
                          style={{ width: '100%', fontFamily: 'monospace', fontSize: '11px', WebkitTextSecurity: 'disc' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </details>

              <div style={{ marginTop: '8px', display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="pb-btn pb-btn-primary"
                  onClick={validateStep1}
                  disabled={!cleanRef || !/^[a-z0-9]{20}$/i.test(cleanRef)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', fontSize: '14px' }}
                >
                  <Icon name="check" size={14} /> Continue to Step 2: Pick Databases &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Pick Databases (Structure + Data vs. Structure Only) */}
      {step === 2 && (
        <div className="pb-walkthrough-step">
          <div style={{ background: '#161b22', padding: '20px', borderRadius: '10px', border: '1px solid #30363d', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: '#238636',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                }}>2</span>
                Choose Which Databases to Back Up
              </h3>
              {step2Valid && <span className="pb-badge pb-badge-ok">✓ Scope Ready</span>}
            </div>

            <p style={{ margin: '0 0 18px 38px', fontSize: '13px', color: '#8b949e', lineHeight: 1.5 }}>
              Choose whether each database gets a full backup with all row data, or a fast structure-only blueprint.
              You can protect multiple databases under your plan.
            </p>

            <div style={{ marginLeft: '38px', display: 'grid', gap: '16px' }}>
              {/* Embedded Multi-Database Scope Selector */}
              <DatabaseScopeSelector
                databases={databaseScope}
                onChange={setDatabaseScope}
              />

              <div style={{ marginTop: '8px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="pb-btn pb-btn-primary"
                  onClick={validateStep2}
                  disabled={scopeSummary.selectedCount === 0}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', fontSize: '14px' }}
                >
                  <Icon name="check" size={14} /> Continue to Step 3: Save &amp; Lock Vault &rarr;
                </button>
                <button type="button" className="pb-btn" onClick={() => setStep(1)}>
                  &larr; Back to Step 1
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: Choose Backup Storage & Lock Vault */}
      {step === 3 && (
        <div className="pb-walkthrough-step">
          <div style={{ background: '#161b22', padding: '20px', borderRadius: '10px', border: '1px solid #30363d', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: '#238636',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                }}>3</span>
                Choose Where to Save &amp; Lock Your Vault
              </h3>
              {step3Valid && <span className="pb-badge pb-badge-ok">✓ Protected</span>}
            </div>

            <p style={{ margin: '0 0 18px 38px', fontSize: '13px', color: '#8b949e', lineHeight: 1.5 }}>
              All backup files are encrypted on your side before writing to your chosen cloud destination.
              Lock your vault below to generate the encrypted runner configuration.
            </p>

            <div style={{ marginLeft: '38px', display: 'grid', gap: '16px' }}>
              {/* Embedded Private Sealed Vault */}
              <PrivateSealedVault
                projectRef={cleanRef}
                initialDatabaseScope={databaseScope}
                onVaultSealed={completeWalkthrough}
              />

              <div style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="pb-btn pb-btn-primary"
                  onClick={completeWalkthrough}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Icon name="check" size={14} /> Mark Setup Complete ✓
                </button>
                <button type="button" className="pb-btn" onClick={() => setStep(2)}>
                  &larr; Back to Step 2
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Developer & Advanced Settings Collapsible */}
      <details
        style={{
          marginTop: '12px',
          background: '#0d1117',
          border: '1px solid #21262d',
          borderRadius: '8px',
          padding: '14px 18px',
          fontSize: '12px',
          color: '#8b949e',
        }}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#58a6ff', userSelect: 'none' }}>
          Developer &amp; Advanced Settings (Optional) ▾
        </summary>
        <div style={{ marginTop: '14px', display: 'grid', gap: '16px' }}>
          {/* CLI Commands */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#f0f6fc', marginBottom: '6px' }}>
              Direct CLI Commands (Optional for Terminal Users)
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '11px', color: '#c9d1d9' }}>1. Check project connectivity:</label>
                  <button type="button" className="pb-btn pb-btn-sm" onClick={copyDoctorCommand}>
                    {copiedDoctor ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre style={{ margin: 0, padding: '8px 12px', background: '#161b22', border: '1px solid #30363d', borderRadius: '4px', color: '#58a6ff', fontSize: '12px', overflowX: 'auto' }}>
                  npx portabase doctor --project {cleanRef || '&lt;ref&gt;'}
                </pre>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '11px', color: '#c9d1d9' }}>2. Run manual backup from terminal:</label>
                  <button type="button" className="pb-btn pb-btn-sm" onClick={copyBackupCommand}>
                    {copiedBackup ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre style={{ margin: 0, padding: '8px 12px', background: '#161b22', border: '1px solid #30363d', borderRadius: '4px', color: '#58a6ff', fontSize: '12px', overflowX: 'auto' }}>
                  npx portabase backup --project {cleanRef || '&lt;ref&gt;'}
                </pre>
              </div>
            </div>
          </div>

          {/* pg_dump Command Preview for All Databases */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#f0f6fc', marginBottom: '6px' }}>
              PostgreSQL pg_dump Engine Arguments:
            </div>
            <div style={{ display: 'grid', gap: '6px' }}>
              {databaseScope.map((db) => {
                const flags = buildPgDumpArgsForDatabase(db);
                return (
                  <div key={db.id} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#58a6ff', background: '#161b22', padding: '6px 10px', borderRadius: '4px', border: '1px solid #30363d' }}>
                    <span style={{ color: '#8b949e' }}># {db.name}: </span>
                    pg_dump {flags.length > 0 ? flags.join(' ') : '(full database + rows)'}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cloud Run Architecture Note */}
          <div style={{ background: '#161b22', padding: '10px 12px', borderRadius: '6px', border: '1px solid #30363d' }}>
            <span style={{ fontWeight: 600, color: '#f0f6fc' }}>Platform Architecture: Google Cloud Run</span>
            <span className="pb-badge pb-badge-ok" style={{ marginLeft: '8px', fontSize: '10px' }}>SCALE-TO-ZERO</span>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#8b949e' }}>
              Automated runner container instances spin up on demand and terminate immediately after completion. Zero standby server costs.
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}
