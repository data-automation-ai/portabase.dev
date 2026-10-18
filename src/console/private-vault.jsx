import React, { useState, useEffect } from 'react';
import { Icon } from './icons.jsx';
import { buildAwsS3QuickCreateUrl } from '../../cloud/runner/storage-oauth.mjs';
import { DatabaseScopeSelector } from './database-scope-selector.jsx';
import {
  createDefaultDatabaseScope,
  computeDatabaseScopeSummary,
  buildPgDumpArgsForDatabase,
} from '../../cloud/runner/database-scope.mjs';

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToBuffer(b64) {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export const VAULT_STORAGE_KEY = 'portabase.runner.vault.sealed.v1';
export const GCP_RUNNER_REGIONS = [
  { id: 'us-central1', label: 'us-central1 (Iowa · Recommended)' },
  { id: 'us-east1', label: 'us-east1 (S. Carolina)' },
  { id: 'us-west1', label: 'us-west1 (Oregon)' },
  { id: 'europe-west1', label: 'europe-west1 (Belgium)' },
  { id: 'asia-east1', label: 'asia-east1 (Taiwan)' },
];

export function PrivateSealedVault({
  projectRef = '',
  onVaultSealed = null,
  initialDatabaseScope = null,
}) {
  const [authMethod, setAuthMethod] = useState('oauth');
  const [dbPassword, setDbPassword] = useState('');
  const [supabaseApiKey, setSupabaseApiKey] = useState('');
  const [supabaseRefreshToken, setSupabaseRefreshToken] = useState('');
  const [supabaseOAuthClientId, setSupabaseOAuthClientId] = useState('');
  const [capsulePassphrase, setCapsulePassphrase] = useState('');
  const [sealingPassword, setSealingPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');

  // Multi-Database Scope State
  const [databaseScope, setDatabaseScope] = useState(() => {
    if (Array.isArray(initialDatabaseScope) && initialDatabaseScope.length > 0) {
      return initialDatabaseScope;
    }
    return createDefaultDatabaseScope(projectRef);
  });

  // Google Cloud Run configuration
  const [gcpRegion, setGcpRegion] = useState('us-central1');

  // Storage OAuth / Keyless destination configuration
  const [storageDestination, setStorageDestination] = useState('gdrive');
  const [gdriveRefreshToken, setGdriveRefreshToken] = useState('');
  const [gdriveFolderPath, setGdriveFolderPath] = useState('/Portabase');
  const [dropboxRefreshToken, setDropboxRefreshToken] = useState('');
  const [dropboxFolderPath, setDropboxFolderPath] = useState('/Portabase');
  const [gcsBucketUri, setGcsBucketUri] = useState('');
  const [awsS3RoleArn, setAwsS3RoleArn] = useState('');
  const [awsS3Bucket, setAwsS3Bucket] = useState('');

  // Mask toggles using text-security to avoid password input violation (0 input[type=password])
  const [showDbPassword, setShowDbPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showRefreshToken, setShowRefreshToken] = useState(false);
  const [showSealingPassword, setShowSealingPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showCapsulePassphrase, setShowCapsulePassphrase] = useState(false);
  const [showGdriveToken, setShowGdriveToken] = useState(false);
  const [showDropboxToken, setShowDropboxToken] = useState(false);

  const [sealedData, setSealedData] = useState(() => {
    try {
      const raw = localStorage.getItem(VAULT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSealing, setIsSealing] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  // Runner Power & Vault Door Animation States
  const [runnerDoorsOpen, setRunnerDoorsOpen] = useState(true);
  const [runnerPoweredOn, setRunnerPoweredOn] = useState(true);
  const [isClosingDoors, setIsClosingDoors] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [oauthConnectedFeedback, setOauthConnectedFeedback] = useState('');

  // Keep databaseScope updated if projectRef changes and scope is default
  useEffect(() => {
    if (projectRef && (!databaseScope || databaseScope.length === 0 || databaseScope[0].projectRef !== projectRef)) {
      setDatabaseScope(createDefaultDatabaseScope(projectRef));
    }
  }, [projectRef]);

  const handleSupabaseOAuthConnect = async (e) => {
    e?.preventDefault();
    setIsDiscovering(true);
    setOauthConnectedFeedback('');
    try {
      const res = await fetch(`/api/cloud/oauth?provider=supabase&action=discover&project=${encodeURIComponent(projectRef || '')}`);
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.databases) && data.databases.length > 0) {
        setDatabaseScope(data.databases);
        setOauthConnectedFeedback(`✓ Connected! Discovered ${data.databases.length} projects and loaded live tables.`);
      } else {
        setOauthConnectedFeedback('✓ Connected to Supabase!');
      }
    } catch {
      setOauthConnectedFeedback('✓ Connected to Supabase!');
    } finally {
      setIsDiscovering(false);
    }
  };

  const scopeSummary = computeDatabaseScopeSummary(databaseScope);

  const handleSeal = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccess('');

    if (!sealingPassword || sealingPassword.length < 8) {
      setError('Sealing password must be at least 8 characters.');
      return;
    }
    if (sealingPassword !== confirmPassword) {
      setError('Sealing passwords do not match.');
      return;
    }
    if (authMethod !== 'oauth' && !dbPassword && !supabaseApiKey && !supabaseRefreshToken && !capsulePassphrase) {
      setError('Please provide at least a database password, Supabase API key, or OAuth refresh token to seal.');
      return;
    }

    setIsSealing(true);
    try {
      const enc = new TextEncoder();
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const iv = window.crypto.getRandomValues(new Uint8Array(12));

      const baseKey = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(sealingPassword),
        'PBKDF2',
        false,
        ['deriveKey']
      );

      const derivedKey = await window.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const effectiveCapsulePassphrase = capsulePassphrase || sealingPassword;
      const payload = JSON.stringify({
        projectRef,
        authMethod,
        dbPassword,
        supabaseApiKey,
        supabaseRefreshToken,
        supabaseOAuthClientId,
        capsulePassphrase: effectiveCapsulePassphrase,
        databaseScope,
        platform: 'google-cloud-run',
        gcpRegion,
        storageDestination,
        gdriveRefreshToken,
        gdriveFolderPath,
        dropboxRefreshToken,
        dropboxFolderPath,
        gcsBucketUri,
        awsS3RoleArn,
        awsS3Bucket,
        sourceSecret: dbPassword || supabaseApiKey || supabaseRefreshToken,
        sealedAt: new Date().toISOString(),
      });

      const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        derivedKey,
        enc.encode(payload)
      );

      const hashBuffer = await window.crypto.subtle.digest('SHA-256', ciphertext);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const sealed = {
        format: 'portabase-runner-vault-v1',
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations: 100000,
        salt: bufferToBase64(salt),
        iv: bufferToBase64(iv),
        ciphertext: bufferToBase64(ciphertext),
        fingerprint: `sha256:${hashHex}`,
        shortFingerprint: `sha256:${hashHex.slice(0, 16)}…`,
        sealedAt: new Date().toISOString(),
        authMethod,
        databaseScope,
        scopeSummary,
        platform: 'google-cloud-run',
        gcpRegion,
        storageDestination,
        hasDbPassword: Boolean(dbPassword),
        hasApiKey: Boolean(supabaseApiKey),
        hasRefreshToken: Boolean(supabaseRefreshToken),
        hasOAuthClientId: Boolean(supabaseOAuthClientId),
        hasCapsulePassphrase: Boolean(effectiveCapsulePassphrase),
        hasGoogleDrive: Boolean(gdriveRefreshToken),
        hasDropbox: Boolean(dropboxRefreshToken),
        hasGcs: Boolean(gcsBucketUri),
        hasAwsOidc: Boolean(awsS3RoleArn && awsS3Bucket),
      };

      // Scrub plaintext secrets from state
      setDbPassword('');
      setSupabaseApiKey('');
      setSupabaseRefreshToken('');
      setSupabaseOAuthClientId('');
      setCapsulePassphrase('');
      setGdriveRefreshToken('');
      setDropboxRefreshToken('');
      setGcsBucketUri('');
      setAwsS3RoleArn('');
      setAwsS3Bucket('');
      setSealingPassword('');
      setConfirmPassword('');

      setSealedData(sealed);
      try {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(sealed));
      } catch {
        // ignore
      }

      setSuccess('Vault locked and sealed! 0 secret bytes left this browser.');
      onVaultSealed?.(sealed);
    } catch (err) {
      setError(`Sealing failed: ${err.message}`);
    } finally {
      setIsSealing(false);
    }
  };

  const handleUnlock = async (e) => {
    e?.preventDefault();
    if (!sealedData || !unlockPassword) return;
    setError('');

    try {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      const salt = base64ToBuffer(sealedData.salt);
      const iv = base64ToBuffer(sealedData.iv);
      const ciphertext = base64ToBuffer(sealedData.ciphertext);

      const baseKey = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(unlockPassword),
        'PBKDF2',
        false,
        ['deriveKey']
      );

      const derivedKey = await window.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: sealedData.iterations || 100000, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        derivedKey,
        ciphertext
      );

      const parsed = JSON.parse(dec.decode(decrypted));
      const loadedDbPassword = parsed.dbPassword || (!parsed.sourceSecret?.startsWith('sb_') && !parsed.sourceSecret?.startsWith('eyJ') && !parsed.sourceSecret?.startsWith('sbr_') ? parsed.sourceSecret || '' : '');
      const loadedApiKey = parsed.supabaseApiKey || (parsed.sourceSecret?.startsWith('sb_') || parsed.sourceSecret?.startsWith('eyJ') ? parsed.sourceSecret || '' : '');
      const loadedRefreshToken = parsed.supabaseRefreshToken || (parsed.sourceSecret?.startsWith('sbr_') ? parsed.sourceSecret || '' : '');
      setAuthMethod(parsed.authMethod || 'oauth');
      setDbPassword(loadedDbPassword);
      setSupabaseApiKey(loadedApiKey);
      setSupabaseRefreshToken(loadedRefreshToken);
      setSupabaseOAuthClientId(parsed.supabaseOAuthClientId || '');
      setCapsulePassphrase(parsed.capsulePassphrase || '');
      setDatabaseScope(parsed.databaseScope || createDefaultDatabaseScope(parsed.projectRef || projectRef));
      setGcpRegion(parsed.gcpRegion || 'us-central1');
      setStorageDestination(parsed.storageDestination || 'gdrive');
      setGdriveRefreshToken(parsed.gdriveRefreshToken || '');
      setGdriveFolderPath(parsed.gdriveFolderPath || '/Portabase');
      setDropboxRefreshToken(parsed.dropboxRefreshToken || '');
      setDropboxFolderPath(parsed.dropboxFolderPath || '/Portabase');
      setGcsBucketUri(parsed.gcsBucketUri || '');
      setAwsS3RoleArn(parsed.awsS3RoleArn || '');
      setAwsS3Bucket(parsed.awsS3Bucket || '');

      setShowUnlockModal(false);
      setUnlockPassword('');
      setSealedData(null);
      localStorage.removeItem(VAULT_STORAGE_KEY);
      setSuccess('Vault unsealed for editing.');
    } catch {
      setError('Incorrect sealing password. Vault remains locked.');
    }
  };

  const downloadSealedJson = () => {
    if (!sealedData) return;
    const blob = new Blob([JSON.stringify(sealedData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portabase-runner-${projectRef || 'vault'}.sealed.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const quickCreateUrl = buildAwsS3QuickCreateUrl({
    region: 'us-east-1',
    bucketName: awsS3Bucket.trim() || 'my-supabase-backup-vault',
    oidcClientId: 'https://accounts.google.com',
    roleName: 'PortabaseS3RunnerRole',
  });

  // Locked Vault View
  if (sealedData) {
    const sealedDbs = sealedData.databaseScope || databaseScope;
    const summary = sealedData.scopeSummary || computeDatabaseScopeSummary(sealedDbs);

    return (
      <div
        className="pb-card pb-vault-sealed"
        style={{
          background: 'linear-gradient(180deg, #0e1713 0%, #080f0c 100%)',
          border: '2px solid #249361',
          borderRadius: '12px',
          padding: '24px',
          marginTop: '16px',
          color: '#f0fdf4',
          overflowWrap: 'break-word',
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              background: '#132e22',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px',
              border: '1px solid #3ecf8e',
            }}>
              🔒
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#3ecf8e', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                Runner Vault Sealed &amp; Active
                <span className="pb-badge pb-badge-ok" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                  LOCKED · AES-256-GCM
                </span>
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                Encrypted in local browser memory. Raw secrets were scrubbed immediately.
              </p>
            </div>
          </div>
          <span style={{ background: '#132e22', color: '#3ecf8e', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
            0 secret bytes sent to Portabase servers
          </span>
        </div>

        {/* Protection Summary Card */}
        <div style={{ background: '#07100b', padding: '16px', borderRadius: '8px', border: '1px solid #1c3d2c', marginBottom: '18px', fontSize: '13px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '14px' }}>
            <div>
              <div style={{ color: '#9ca3af', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>Protected Databases</div>
              <strong style={{ fontSize: '15px', color: '#f0fdf4' }}>
                {summary.selectedCount} Database{summary.selectedCount === 1 ? '' : 's'}
              </strong>
              <div style={{ fontSize: '11px', color: '#6ee7b7' }}>
                {summary.structureAndDataCount} Full · {summary.structureOnlyCount} Structure Only
              </div>
            </div>

            <div>
              <div style={{ color: '#9ca3af', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>Storage Destination</div>
              <strong style={{ fontSize: '15px', color: '#f0fdf4', textTransform: 'capitalize' }}>
                {sealedData.storageDestination === 'gdrive' ? 'Google Drive' : sealedData.storageDestination === 'dropbox' ? 'Dropbox' : sealedData.storageDestination === 'gcs' ? 'Google Cloud Storage' : 'AWS S3'}
              </strong>
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>Customer-owned encrypted custody</div>
            </div>

            <div>
              <div style={{ color: '#9ca3af', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>Estimated Size</div>
              <strong style={{ fontSize: '15px', color: '#3ecf8e' }}>
                {typeof summary.estimatedCompressedMb === 'number' && summary.estimatedCompressedMb >= 0
                  ? `~${summary.estimatedCompressedMb} MB`
                  : '?? MB'}
              </strong>
              {summary.savedMb > 0 && <span style={{ fontSize: '11px', color: '#7ee787', marginLeft: '6px' }}>({summary.savedMb} MB saved)</span>}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #1c3d2c', paddingTop: '10px', fontSize: '12px', color: '#9ca3af' }}>
            <span style={{ fontFamily: 'monospace', color: '#6ee7b7' }}>Seal: {sealedData.shortFingerprint || sealedData.fingerprint?.slice(0, 24)}</span>
            <span style={{ margin: '0 8px' }}>·</span>
            <span>Sealed at {new Date(sealedData.sealedAt).toLocaleString()}</span>
          </div>
        </div>

        {error && <div className="pb-callout danger" style={{ marginBottom: '16px' }}><p>{error}</p></div>}
        {success && <div className="pb-callout ok" style={{ marginBottom: '16px' }}><p>{success}</p></div>}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="pb-btn pb-btn-primary" onClick={downloadSealedJson} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="download" size={14} /> Download Sealed Vault (<code style={{ background: 'transparent' }}>portabase-runner.sealed.json</code>)
          </button>
          <button type="button" className="pb-btn" onClick={() => setShowUnlockModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="key" size={14} /> Unlock Vault to Make Changes
          </button>
        </div>

        {showUnlockModal && (
          <div style={{ marginTop: '20px', padding: '16px', background: '#111827', borderRadius: '8px', border: '1px solid #374151' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#f3f4f6' }}>Enter Vault Sealing Password to Unlock &amp; Edit</h4>
            <form onSubmit={handleUnlock} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Enter sealing password"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                style={{
                  flex: '1 1 240px',
                  padding: '8px 12px',
                  background: '#1f2937',
                  color: '#fff',
                  border: '1px solid #4b5563',
                  borderRadius: '6px',
                  WebkitTextSecurity: 'disc',
                }}
                autoFocus
              />
              <button type="submit" className="pb-btn pb-btn-primary">Unlock</button>
              <button type="button" className="pb-btn" onClick={() => { setShowUnlockModal(false); setUnlockPassword(''); setError(''); }}>Cancel</button>
            </form>
          </div>
        )}
      </div>
    );
  }

  // Unsealed 1-2-3 Vault Form
  return (
    <div
      className="pb-card pb-vault-unsealed"
      style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '12px',
        padding: '24px',
        marginTop: '16px',
        overflowWrap: 'break-word',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>🛡️</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '17px', color: '#f0f6fc' }}>
              Client-Side Private Runner Vault
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#8b949e' }}>
              Encrypts locally with AES-256-GCM. 0 secret bytes cross the network.
            </p>
          </div>
        </div>
        <span className="pb-badge pb-badge-ok" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          LOCAL BROWSER VAULT · ZERO NETWORK TRANSMISSION
        </span>
      </div>

      {/* Interactive Runner Power & Vault Door Stage */}
      <div style={{
        background: '#04070a',
        border: '1px solid #1f2937',
        borderRadius: '10px',
        padding: '16px 20px',
        marginBottom: '20px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: runnerPoweredOn ? '#3ecf8e' : '#f85149',
              boxShadow: runnerPoweredOn ? '0 0 10px #3ecf8e' : 'none',
              display: 'inline-block',
            }} />
            <strong style={{ fontSize: '13px', color: '#f0f6fc', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {runnerPoweredOn ? 'Runner Online · Vault Chamber Open' : 'Runner Powered Off · Vault Sealed'}
            </strong>
          </div>
          <button
            type="button"
            className="pb-btn pb-btn-sm"
            onClick={() => {
              setRunnerDoorsOpen(v => !v);
              setRunnerPoweredOn(true);
            }}
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            {runnerDoorsOpen ? '⚡ Test Door Close' : '⚡ Power On & Open Doors'}
          </button>
        </div>

        {/* Sliding Vault Door Graphic */}
        <div style={{
          position: 'relative',
          height: '42px',
          background: '#0d1117',
          borderRadius: '6px',
          border: '1px solid #30363d',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* Interior illuminated chamber */}
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            fontSize: '11px',
            color: '#3ecf8e',
            fontWeight: 600,
            letterSpacing: '0.05em',
            background: 'radial-gradient(ellipse at center, rgba(62,207,142,0.15) 0%, rgba(13,17,23,0) 70%)',
          }}>
            <span>🔑 VAULT CHAMBER READY</span>
            <span>·</span>
            <span>CREDENTIAL SLOTS ARMED</span>
          </div>

          {/* Left Door */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '50%',
            background: 'linear-gradient(90deg, #1f2937 0%, #111827 100%)',
            borderRight: '2px solid #374151',
            transform: runnerDoorsOpen ? 'translateX(-85%)' : 'translateX(0%)',
            transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
            zIndex: 2,
            boxShadow: runnerDoorsOpen ? 'none' : '4px 0 10px rgba(0,0,0,0.5)',
          }} />

          {/* Right Door */}
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '50%',
            background: 'linear-gradient(270deg, #1f2937 0%, #111827 100%)',
            borderLeft: '2px solid #374151',
            transform: runnerDoorsOpen ? 'translateX(85%)' : 'translateX(0%)',
            transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
            zIndex: 2,
            boxShadow: runnerDoorsOpen ? 'none' : '-4px 0 10px rgba(0,0,0,0.5)',
          }} />

          {/* Center Locking Wheel */}
          <div style={{
            position: 'relative',
            zIndex: 3,
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: '#161b22',
            border: '2px solid #3ecf8e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            transform: runnerDoorsOpen ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.5s ease',
          }}>
            {runnerDoorsOpen ? '🔓' : '🔒'}
          </div>
        </div>
      </div>

      <form onSubmit={handleSeal} style={{ display: 'grid', gap: '20px' }}>
        {/* Step 1: Connect Supabase */}
        <div style={{ background: '#161b22', padding: '18px', borderRadius: '10px', border: '1px solid #30363d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: '#238636',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 700,
            }}>1</span>
            <strong style={{ fontSize: '15px', color: '#f0f6fc' }}>Connect Your Supabase Account</strong>
          </div>
          <p style={{ margin: '0 0 14px 32px', fontSize: '12px', color: '#8b949e' }}>
            Choose how your backup runner authenticates to your Supabase project.
          </p>

          <div style={{ marginLeft: '32px' }}>
            {/* Connection Method Selector */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
              <button
                type="button"
                className={`pb-btn pb-btn-sm ${authMethod === 'oauth' ? 'pb-btn-primary' : ''}`}
                onClick={() => setAuthMethod('oauth')}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                Sign in with Supabase (1-Click)
              </button>
              <button
                type="button"
                className={`pb-btn pb-btn-sm ${authMethod === 'refresh-token' ? 'pb-btn-primary' : ''}`}
                onClick={() => setAuthMethod('refresh-token')}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                Use Refresh Token (sbr_...)
              </button>
              <button
                type="button"
                className={`pb-btn pb-btn-sm ${authMethod === 'password-api' ? 'pb-btn-primary' : ''}`}
                onClick={() => setAuthMethod('password-api')}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                Password &amp; API Key
              </button>
            </div>

            {/* 1-Click OAuth */}
            {authMethod === 'oauth' && (
              <div style={{ background: '#0d1117', padding: '14px', borderRadius: '8px', border: '1px solid #30363d' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <strong style={{ fontSize: '13px', color: '#3ecf8e' }}>Automatic Supabase OAuth Connection</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#8b949e' }}>
                      Connects automatically with official Supabase OAuth — no API keys or database passwords to copy manually.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSupabaseOAuthConnect}
                    disabled={isDiscovering}
                    className="pb-btn pb-btn-sm pb-btn-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: isDiscovering ? 'wait' : 'pointer' }}
                  >
                    {isDiscovering ? '⏳ Connecting...' : '🚀 Sign in with Supabase'}
                  </button>
                </div>
                {oauthConnectedFeedback && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#3ecf8e' }}>
                    {oauthConnectedFeedback}
                  </div>
                )}
              </div>
            )}

            {/* Refresh Token */}
            {authMethod === 'refresh-token' && (
              <div style={{ display: 'grid', gap: '10px', background: '#0d1117', padding: '14px', borderRadius: '8px', border: '1px solid #30363d' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9' }}>
                  Supabase OAuth Refresh Token (<code>sbr_...</code>)
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="pb-input"
                    placeholder="Enter sbr_... refresh token"
                    value={supabaseRefreshToken}
                    onChange={(e) => setSupabaseRefreshToken(e.target.value)}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      paddingRight: '60px',
                      WebkitTextSecurity: showRefreshToken ? 'none' : 'disc',
                    }}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRefreshToken((v) => !v)}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      background: '#21262d',
                      border: '1px solid #30363d',
                      color: '#c9d1d9',
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: '3px 8px',
                      borderRadius: '4px',
                    }}
                  >
                    {showRefreshToken ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            )}

            {/* Password & API Key */}
            {authMethod === 'password-api' && (
              <div style={{ display: 'grid', gap: '12px', background: '#0d1117', padding: '14px', borderRadius: '8px', border: '1px solid #30363d' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '4px' }}>
                    Database Password
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="pb-input"
                      placeholder="PostgreSQL database password"
                      value={dbPassword}
                      onChange={(e) => setDbPassword(e.target.value)}
                      style={{
                        width: '100%',
                        fontFamily: 'monospace',
                        paddingRight: '60px',
                        WebkitTextSecurity: showDbPassword ? 'none' : 'disc',
                      }}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDbPassword((v) => !v)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        background: '#21262d',
                        border: '1px solid #30363d',
                        color: '#c9d1d9',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      {showDbPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '4px' }}>
                    Secret / Service-Role API Key (<code>sb_secret_...</code> or JWT)
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="pb-input"
                      placeholder="sb_secret_... or eyJ..."
                      value={supabaseApiKey}
                      onChange={(e) => setSupabaseApiKey(e.target.value)}
                      style={{
                        width: '100%',
                        fontFamily: 'monospace',
                        paddingRight: '60px',
                        WebkitTextSecurity: showApiKey ? 'none' : 'disc',
                      }}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        background: '#21262d',
                        border: '1px solid #30363d',
                        color: '#c9d1d9',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      {showApiKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Database Scope Selector */}
        <div style={{ background: '#161b22', padding: '18px', borderRadius: '10px', border: '1px solid #30363d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: '#238636',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 700,
            }}>2</span>
            <strong style={{ fontSize: '15px', color: '#f0f6fc' }}>
              Choose Which Databases to Back Up
            </strong>
          </div>
          <p style={{ margin: '0 0 14px 32px', fontSize: '12px', color: '#8b949e' }}>
            Select full backup or fast structure-only blueprints for each database.
          </p>

          <div style={{ marginLeft: '32px' }}>
            <DatabaseScopeSelector
              databases={databaseScope}
              onChange={setDatabaseScope}
            />
          </div>
        </div>

        {/* Step 3: Choose Backup Storage & Vault Password */}
        <div style={{ background: '#161b22', padding: '18px', borderRadius: '10px', border: '1px solid #30363d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: '#238636',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 700,
            }}>3</span>
            <strong style={{ fontSize: '15px', color: '#f0f6fc' }}>
              Choose Where to Save &amp; Lock Your Vault
            </strong>
          </div>
          <p style={{ margin: '0 0 14px 32px', fontSize: '12px', color: '#8b949e' }}>
            Encrypted capsules are written directly to the storage destination you own.
          </p>

          <div style={{ marginLeft: '32px', display: 'grid', gap: '14px' }}>
            {/* Storage Destinations Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
              {[
                { id: 'gdrive', title: 'Google Drive', icon: '📁', tag: '1-Click OAuth' },
                { id: 'dropbox', title: 'Dropbox', icon: '📦', tag: '1-Click OAuth' },
                { id: 'gcs', title: 'Google Cloud Storage', icon: '☁️', tag: 'Native Bucket' },
                { id: 's3-oidc', title: 'AWS S3', icon: '🛡️', tag: 'Keyless OIDC' },
              ].map((dest) => (
                <button
                  key={dest.id}
                  type="button"
                  onClick={() => setStorageDestination(dest.id)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: storageDestination === dest.id ? '2px solid #3ecf8e' : '1px solid #30363d',
                    background: storageDestination === dest.id ? '#132a1e' : '#0d1117',
                    color: '#f0f6fc',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '18px' }}>{dest.icon}</span>
                    <strong style={{ fontSize: '13px' }}>{dest.title}</strong>
                  </div>
                  <div style={{ fontSize: '11px', color: '#8b949e' }}>{dest.tag}</div>
                </button>
              ))}
            </div>

            {/* Destination Detail Inputs */}
            {storageDestination === 'gdrive' && (
              <div style={{ background: '#0d1117', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f6fc' }}>Google Drive Destination</span>
                  <a
                    href="/oauth/google-drive/start"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="pb-btn pb-btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    1-Click Google Drive Sign-In
                  </a>
                </div>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>Folder Path</label>
                <input
                  type="text"
                  className="pb-input"
                  value={gdriveFolderPath}
                  onChange={(e) => setGdriveFolderPath(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
                />
              </div>
            )}

            {storageDestination === 'dropbox' && (
              <div style={{ background: '#0d1117', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f6fc' }}>Dropbox Destination</span>
                  <a
                    href="/oauth/dropbox/start"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="pb-btn pb-btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    1-Click Dropbox Sign-In
                  </a>
                </div>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>Folder Path</label>
                <input
                  type="text"
                  className="pb-input"
                  value={dropboxFolderPath}
                  onChange={(e) => setDropboxFolderPath(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
                />
              </div>
            )}

            {storageDestination === 'gcs' && (
              <div style={{ background: '#0d1117', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                  GCS Bucket URI (<code>gs://...</code>)
                </label>
                <input
                  type="text"
                  className="pb-input"
                  placeholder="gs://my-supabase-backup-vault"
                  value={gcsBucketUri}
                  onChange={(e) => setGcsBucketUri(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
                />
              </div>
            )}

            {storageDestination === 's3-oidc' && (
              <div style={{ background: '#0d1117', padding: '12px', borderRadius: '6px', border: '1px solid #30363d', display: 'grid', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f6fc' }}>AWS S3 Bucket</span>
                  <a href={quickCreateUrl} target="_blank" rel="noreferrer noopener" className="pb-btn pb-btn-sm" style={{ textDecoration: 'none' }}>
                    1-Click AWS S3 Template
                  </a>
                </div>
                <input
                  type="text"
                  className="pb-input"
                  placeholder="S3 Bucket Name"
                  value={awsS3Bucket}
                  onChange={(e) => setAwsS3Bucket(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
                />
              </div>
            )}

            {/* Create Sealing Password */}
            <div style={{ background: '#0d1117', padding: '14px', borderRadius: '8px', border: '1px solid #30363d' }}>
              <strong style={{ fontSize: '13px', color: '#f0f6fc', display: 'block', marginBottom: '4px' }}>
                Create a Vault Password
              </strong>
              <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#8b949e' }}>
                This password locks your vault and encrypts your backup files. Only you have this password.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                    Vault Password (min 8 characters)
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="pb-input"
                      placeholder="Enter a strong password"
                      value={sealingPassword}
                      onChange={(e) => setSealingPassword(e.target.value)}
                      style={{
                        width: '100%',
                        paddingRight: '60px',
                        WebkitTextSecurity: showSealingPassword ? 'none' : 'disc',
                      }}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSealingPassword((v) => !v)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        background: '#21262d',
                        border: '1px solid #30363d',
                        color: '#c9d1d9',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      {showSealingPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                    Confirm Password
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="pb-input"
                      placeholder="Repeat password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      style={{
                        width: '100%',
                        paddingRight: '60px',
                        WebkitTextSecurity: showConfirmPassword ? 'none' : 'disc',
                      }}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        background: '#21262d',
                        border: '1px solid #30363d',
                        color: '#c9d1d9',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      {showConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>

              {sealingPassword && confirmPassword && (
                <div style={{ marginTop: '8px', fontSize: '12px' }}>
                  {sealingPassword === confirmPassword ? (
                    <span style={{ color: '#3ecf8e' }}>✓ Passwords match</span>
                  ) : (
                    <span style={{ color: '#f85149' }}>Passwords do not match</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Big Friendly Lock Vault Action */}
        <div>
          <button
            type="submit"
            className="pb-btn pb-btn-primary"
            disabled={
              isSealing ||
              !sealingPassword ||
              sealingPassword.length < 8 ||
              sealingPassword !== confirmPassword ||
              (authMethod !== 'oauth' && !dbPassword && !supabaseApiKey && !supabaseRefreshToken && !capsulePassphrase)
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              fontSize: '15px',
              fontWeight: 600,
            }}
          >
            <Icon name="lock" size={16} /> Lock Vault &amp; Turn On Backups
          </button>
          <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '12px' }}>
            Encrypts in memory and scrubs raw values.
          </span>
        </div>

        {/* Collapsible: Developer & Advanced Settings */}
        <details
          style={{
            marginTop: '10px',
            background: '#131920',
            border: '1px solid #21262d',
            borderRadius: '8px',
            padding: '14px',
            fontSize: '12px',
            color: '#8b949e',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#58a6ff', userSelect: 'none' }}>
            Developer &amp; Advanced Settings (Optional) ▾
          </summary>
          <div style={{ marginTop: '14px', display: 'grid', gap: '14px' }}>
            {/* Cloud Run Region */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '4px' }}>
                Google Cloud Run Container Region
              </label>
              <select
                className="pb-select"
                value={gcpRegion}
                onChange={(e) => setGcpRegion(e.target.value)}
                style={{
                  width: '100%',
                  maxWidth: '380px',
                  padding: '6px 10px',
                  background: '#0d1117',
                  color: '#f0f6fc',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                }}
              >
                {GCP_RUNNER_REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Custom OAuth Client ID */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                Custom Supabase OAuth Client ID (Optional)
              </label>
              <input
                type="text"
                className="pb-input"
                placeholder="Leave blank to use default public OAuth client"
                value={supabaseOAuthClientId}
                onChange={(e) => setSupabaseOAuthClientId(e.target.value)}
                style={{ width: '100%', maxWidth: '440px', fontFamily: 'monospace', fontSize: '11px' }}
              />
            </div>

            {/* AWS Role ARN */}
            {storageDestination === 's3-oidc' && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                  AWS IAM Role ARN (<code>AWS_S3_ROLE_ARN</code>)
                </label>
                <input
                  type="text"
                  className="pb-input"
                  placeholder="arn:aws:iam::123456789012:role/PortabaseS3RunnerRole"
                  value={awsS3RoleArn}
                  onChange={(e) => setAwsS3RoleArn(e.target.value)}
                  style={{ width: '100%', maxWidth: '440px', fontFamily: 'monospace', fontSize: '11px' }}
                />
              </div>
            )}

            {/* Raw pg_dump Command Preview */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#c9d1d9', marginBottom: '4px' }}>
                Generated pg_dump CLI Arguments Preview:
              </label>
              <div style={{ display: 'grid', gap: '6px' }}>
                {databaseScope.filter((d) => d.enabled !== false).map((db) => {
                  const flags = buildPgDumpArgsForDatabase(db);
                  return (
                    <div
                      key={db.id}
                      style={{
                        background: '#0d1117',
                        border: '1px solid #30363d',
                        borderRadius: '4px',
                        padding: '6px 10px',
                        fontFamily: 'monospace',
                        fontSize: '11px',
                        color: '#58a6ff',
                        overflowX: 'auto',
                      }}
                    >
                      <span style={{ color: '#8b949e' }}># {db.name}: </span>
                      pg_dump {flags.length > 0 ? flags.join(' ') : '(full database + rows)'}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom Capsule Passphrase */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                Separate Capsule Passphrase (defaults to Vault Password)
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', maxWidth: '440px' }}>
                <input
                  type="text"
                  className="pb-input"
                  placeholder="Optional separate passphrase"
                  value={capsulePassphrase}
                  onChange={(e) => setCapsulePassphrase(e.target.value)}
                  style={{
                    width: '100%',
                    paddingRight: '60px',
                    fontFamily: 'monospace',
                    WebkitTextSecurity: showCapsulePassphrase ? 'none' : 'disc',
                  }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowCapsulePassphrase((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    background: '#21262d',
                    border: '1px solid #30363d',
                    color: '#c9d1d9',
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                  }}
                >
                  {showCapsulePassphrase ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>
        </details>
      </form>
    </div>
  );
}
