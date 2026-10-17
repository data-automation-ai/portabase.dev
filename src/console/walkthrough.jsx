import React, { useState, useMemo } from 'react';
import { Icon } from './icons.jsx';
import { PrivateSealedVault } from './private-vault.jsx';

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
  
  const [vaultKind, setVaultKind] = useState(currentDest?.destinationKind || 'local');
  const [vaultPath, setVaultPath] = useState(currentDest?.path || 'C:\\PortabaseBackups');

  const [layers, setLayers] = useState({
    database: true,
    auth: true,
    storage: true,
    functions: true,
  });

  const [copiedDoctor, setCopiedDoctor] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

  // Validation statuses
  const [step1Valid, setStep1Valid] = useState(Boolean(currentProject?.ref && /^[a-z0-9]{20}$/i.test(currentProject.ref)));
  const [step2Valid, setStep2Valid] = useState(Boolean(currentDest));
  const [step3Valid, setStep3Valid] = useState(true);
  const [step4Valid, setStep4Valid] = useState(Boolean(state?.onboarding?.completed));

  const cleanRef = useMemo(() => extractProjectRef(projectInput), [projectInput]);

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
        layers: { ...layers },
        createdAt: new Date().toISOString(),
      };
      if (existing >= 0) projects[existing] = { ...projects[existing], ...updated };
      else projects.unshift(updated);
      return { ...s, projects };
    });
    setStep1Valid(true);
    toast?.('Step 1 Validated: Supabase project reference saved!', 'ok');
    setStep(2);
  };

  const validateStep2 = () => {
    if (!vaultPath.trim()) {
      toast?.('Please provide a destination folder path or bucket name.', 'danger');
      return;
    }
    setState?.((s) => {
      const destinations = [...(s.destinations || [])];
      const dest = {
        id: `dest_${vaultKind}_${Date.now().toString(36)}`,
        name: vaultKind === 'local' ? 'Local Drive / NAS' : vaultKind === 's3' ? 'Amazon S3' : vaultKind === 'dropbox' ? 'Dropbox Vault' : 'Google Drive',
        destinationKind: vaultKind,
        path: vaultPath.trim(),
        verified: true,
        createdAt: new Date().toISOString(),
      };
      destinations.unshift(dest);
      return { ...s, destinations };
    });
    setStep2Valid(true);
    toast?.('Step 2 Validated: Capsule vault saved!', 'ok');
    setStep(3);
  };

  const validateStep3 = () => {
    if (!layers.database && !layers.auth && !layers.storage && !layers.functions) {
      toast?.('Select at least one layer to back up.', 'danger');
      return;
    }
    setState?.((s) => ({
      ...s,
      jobInclude: {
        ...(s.jobInclude || {}),
        layers: { ...layers },
      },
    }));
    setStep3Valid(true);
    toast?.('Step 3 Validated: Backup layers confirmed!', 'ok');
    setStep(4);
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
    setStep4Valid(true);
    toast?.('🎉 Guided setup complete! Your project is configured for backup protection.', 'ok');
  };

  const planCapLabel = plan?.id === 'cloud-free' ? '100 MB' : plan?.id === 'cloud-7' ? '500 MB' : '10 GB';

  return (
    <section className="pb-card pb-walkthrough-card" style={{
      background: 'linear-gradient(180deg, #12181f 0%, #0d1117 100%)',
      border: '1px solid #30363d',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
    }} aria-label="Step-by-step setup walkthrough">
      {/* Header & Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <span className="pb-badge pb-badge-ok" style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.06em', marginBottom: '6px', display: 'inline-block' }}>
            BEGINNER WALKTHROUGH · STEP {step} OF 4
          </span>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f0f6fc' }}>
            Step-by-Step Portabase Setup
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#8b949e' }}>
            Follow these 4 simple steps to protect your Supabase database into self-owned encrypted capsules.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {[
            { num: 1, label: 'Supabase Ref', valid: step1Valid },
            { num: 2, label: 'Vault', valid: step2Valid },
            { num: 3, label: 'Scope', valid: step3Valid },
            { num: 4, label: 'Run & Seal', valid: step4Valid },
          ].map((item) => (
            <button
              key={item.num}
              type="button"
              onClick={() => setStep(item.num)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '999px',
                border: step === item.num ? '1px solid #3ecf8e' : '1px solid #30363d',
                background: step === item.num ? '#132a1e' : item.valid ? '#161b22' : '#0d1117',
                color: step === item.num ? '#3ecf8e' : item.valid ? '#7ee787' : '#8b949e',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <span>{item.valid ? '✓' : item.num}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Step 1: Connect Supabase */}
      {step === 1 && (
        <div className="pb-walkthrough-step">
          <div style={{ background: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>1️⃣</span> Connect your Supabase Project
              {step1Valid && <span className="pb-badge pb-badge-ok">✓ Validated</span>}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#8b949e', lineHeight: 1.5 }}>
              Paste your Supabase URL (e.g. <code>https://abcdefghijklmnopqrst.supabase.co</code>) or your 20-character project ref.
              We use this solely to structure your backup commands — we never ask for or receive your password here.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
                  Supabase Project URL or 20-char Reference
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
                    {/^[a-z0-9]{20}$/i.test(cleanRef) ? `✓ Extracted Ref: ${cleanRef}` : 'Ref must be exactly 20 lowercase letters and numbers'}
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

            <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="pb-btn pb-btn-primary"
                onClick={validateStep1}
                disabled={!cleanRef || !/^[a-z0-9]{20}$/i.test(cleanRef)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Icon name="check" size={14} /> Validate &amp; Continue to Step 2 &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Choose Storage Vault */}
      {step === 2 && (
        <div className="pb-walkthrough-step">
          <div style={{ background: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>2️⃣</span> Choose Your Capsule Storage Vault
              {step2Valid && <span className="pb-badge pb-badge-ok">✓ Validated</span>}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#8b949e', lineHeight: 1.5 }}>
              Where do you want your encrypted backup files to be saved? You retain 100% custody of the encrypted capsules.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '16px' }}>
              {[
                { id: 'local', title: 'Local Folder (PC / NAS)', icon: '🖥️', defaultPath: 'C:\\PortabaseBackups' },
                { id: 'gdrive', title: 'Google Drive (OAuth PKCE)', icon: '📁', defaultPath: '/Portabase' },
                { id: 'dropbox', title: 'Dropbox Vault (OAuth PKCE)', icon: '📦', defaultPath: '/Portabase' },
                { id: 'gcs', title: 'Google Cloud Storage (GCS)', icon: '☁️', defaultPath: 'gs://my-supabase-backup-vault' },
                { id: 's3', title: 'AWS S3 (OIDC Federation)', icon: '🛡️', defaultPath: 'my-supabase-backup-bucket' },
              ].map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { setVaultKind(v.id); setVaultPath(v.defaultPath); }}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: vaultKind === v.id ? '2px solid #3ecf8e' : '1px solid #30363d',
                    background: vaultKind === v.id ? '#132a1e' : '#0d1117',
                    color: '#f0f6fc',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '20px', marginBottom: '6px' }}>{v.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>{v.title}</div>
                </button>
              ))}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
                {vaultKind === 'local' ? 'Folder Path on your computer or server' : vaultKind === 'gcs' ? 'GCS Bucket URI (gs://...)' : vaultKind === 's3' ? 'S3 Bucket Name' : 'Folder Path'}
              </label>
              <input
                type="text"
                className="pb-input"
                value={vaultPath}
                onChange={(e) => setVaultPath(e.target.value)}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
            </div>

            <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="pb-btn pb-btn-primary"
                onClick={validateStep2}
                disabled={!vaultPath.trim()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Icon name="check" size={14} /> Validate &amp; Continue to Step 3 &rarr;
              </button>
              <button type="button" className="pb-btn" onClick={() => setStep(1)}>
                &larr; Back to Step 1
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Select Scope & Check Size Cap */}
      {step === 3 && (
        <div className="pb-walkthrough-step">
          <div style={{ background: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>3️⃣</span> Select What to Back Up &amp; Check Size Cap
              {step3Valid && <span className="pb-badge pb-badge-ok">✓ Validated</span>}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#8b949e', lineHeight: 1.5 }}>
              Choose which Supabase components to include in each capsule. Your current plan includes up to <strong>{planCapLabel}</strong>.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '16px' }}>
              {[
                { key: 'database', title: '🗄️ Database & Schema', desc: 'PostgreSQL tables, schemas, views, RLS policies' },
                { key: 'auth', title: '👥 Auth Users & Identities', desc: 'Supabase Auth users, passwords, MFA' },
                { key: 'storage', title: '📦 Storage Buckets', desc: 'Storage files, avatars, public & private uploads' },
                { key: 'functions', title: '⚡ Edge Functions', desc: 'Function source code, configs, dependencies' },
              ].map((layer) => (
                <label
                  key={layer.key}
                  style={{
                    display: 'block',
                    padding: '12px',
                    borderRadius: '8px',
                    border: layers[layer.key] ? '1px solid #3ecf8e' : '1px solid #30363d',
                    background: layers[layer.key] ? '#132a1e' : '#0d1117',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <input
                      type="checkbox"
                      checked={layers[layer.key]}
                      onChange={(e) => setLayers({ ...layers, [layer.key]: e.target.checked })}
                    />
                    <strong style={{ fontSize: '13px', color: '#f0f6fc' }}>{layer.title}</strong>
                  </div>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginLeft: '22px' }}>{layer.desc}</div>
                </label>
              ))}
            </div>

            <div style={{ background: '#0d1117', padding: '12px 14px', borderRadius: '6px', border: '1px solid #21262d', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <span style={{ fontSize: '12px', color: '#8b949e' }}>Current Plan Cap:</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#3ecf8e', marginLeft: '6px' }}>{planCapLabel}</span>
              </div>
              <button
                type="button"
                className="pb-btn pb-btn-sm"
                onClick={onOpenSizer}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <Icon name="table" size={12} /> Open Table Sizer
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="pb-btn pb-btn-primary"
                onClick={validateStep3}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Icon name="check" size={14} /> Validate &amp; Continue to Step 4 &rarr;
              </button>
              <button type="button" className="pb-btn" onClick={() => setStep(2)}>
                &larr; Back to Step 2
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Run & Verify + Private Sealed Runner Vault */}
      {step === 4 && (
        <div className="pb-walkthrough-step">
          <div style={{ background: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>4️⃣</span> Run &amp; Verify Your First Capsule
              {step4Valid && <span className="pb-badge pb-badge-ok">✓ Completed</span>}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#8b949e', lineHeight: 1.5 }}>
              Your database credentials and encryption keys never leave your machine or runner.
              PortaBase cloud never holds or receives your database password or encryption keys.
            </p>

            <div style={{ background: '#0d1117', padding: '12px 14px', borderRadius: '6px', border: '1px solid #21262d', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f6fc' }}>
                  Runner Platform: Google Cloud Run (Isolated Per-Subscriber Job)
                </span>
                <span className="pb-badge pb-badge-ok" style={{ marginLeft: '8px', fontSize: '10px' }}>
                  SCALE-TO-ZERO · ZERO STANDBY
                </span>
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#8b949e' }}>
                  Executes inside private Google Cloud Run containers (us-central1, us-east1, us-west1, europe-west1). Plaintext keys purged upon job completion.
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gap: '12px', marginBottom: '18px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#c9d1d9' }}>
                    1. Check project connectivity:
                  </label>
                  <button type="button" className="pb-btn pb-btn-sm" onClick={copyDoctorCommand}>
                    {copiedDoctor ? '✓ Copied' : 'Copy command'}
                  </button>
                </div>
                <pre style={{ margin: 0, padding: '10px 14px', background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#58a6ff', fontSize: '13px', overflowX: 'auto' }}>
                  npx portabase doctor --project {cleanRef || '&lt;ref&gt;'}
                </pre>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#c9d1d9' }}>
                    2. Take your first encrypted backup:
                  </label>
                  <button type="button" className="pb-btn pb-btn-sm" onClick={copyBackupCommand}>
                    {copiedBackup ? '✓ Copied' : 'Copy command'}
                  </button>
                </div>
                <pre style={{ margin: 0, padding: '10px 14px', background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#58a6ff', fontSize: '13px', overflowX: 'auto' }}>
                  npx portabase backup --project {cleanRef || '&lt;ref&gt;'}
                </pre>
              </div>
            </div>

            {/* Private Sealed Runner Vault Embedded */}
            <div style={{ marginTop: '20px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#f0f6fc' }}>
                Optional: Client-Side Sealed Runner Vault
              </h4>
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#8b949e' }}>
                Need to seal credentials for your automated runner? Use the in-browser vault below.
                It encrypts locally with AES-256-GCM and zero network traffic.
              </p>
              <PrivateSealedVault projectRef={cleanRef} />
            </div>

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pb-btn pb-btn-primary"
                onClick={completeWalkthrough}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Icon name="check" size={14} /> Mark Walkthrough Complete ✓
              </button>
              <button type="button" className="pb-btn" onClick={() => setStep(3)}>
                &larr; Back to Step 3
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
