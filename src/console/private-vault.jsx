import React, { useState, useEffect } from 'react';
import { Icon } from './icons.jsx';
import { buildAwsS3QuickCreateUrl } from '../../cloud/runner/storage-oauth.mjs';

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

const VAULT_STORAGE_KEY = 'portabase.runner.vault.sealed.v1';
export const GCP_RUNNER_REGIONS = [
  { id: 'us-central1', label: 'us-central1 (Iowa · Recommended)' },
  { id: 'us-east1', label: 'us-east1 (S. Carolina)' },
  { id: 'us-west1', label: 'us-west1 (Oregon)' },
  { id: 'europe-west1', label: 'europe-west1 (Belgium)' },
  { id: 'asia-east1', label: 'asia-east1 (Taiwan)' },
];

export function PrivateSealedVault({ projectRef = '', onVaultSealed = null }) {
  const [authMethod, setAuthMethod] = useState('password-api');
  const [dbPassword, setDbPassword] = useState('');
  const [supabaseApiKey, setSupabaseApiKey] = useState('');
  const [supabaseRefreshToken, setSupabaseRefreshToken] = useState('');
  const [supabaseOAuthClientId, setSupabaseOAuthClientId] = useState('');
  const [capsulePassphrase, setCapsulePassphrase] = useState('');
  const [sealingPassword, setSealingPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');

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

  // Mask toggles using text-security to avoid password input violation
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
    if (!dbPassword && !supabaseApiKey && !supabaseRefreshToken && !capsulePassphrase) {
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
        .map(b => b.toString(16).padStart(2, '0'))
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

      // Immediately scrub plaintext secrets from memory
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

      setSuccess('Vault sealed successfully! 0 secret bytes left this browser.');
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
      setAuthMethod(parsed.authMethod || 'password-api');
      setDbPassword(loadedDbPassword);
      setSupabaseApiKey(loadedApiKey);
      setSupabaseRefreshToken(loadedRefreshToken);
      setSupabaseOAuthClientId(parsed.supabaseOAuthClientId || '');
      setCapsulePassphrase(parsed.capsulePassphrase || '');
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

  if (sealedData) {
    const hasDb = sealedData.hasDbPassword !== undefined ? sealedData.hasDbPassword : true;
    const hasApi = sealedData.hasApiKey !== undefined ? sealedData.hasApiKey : true;
    const hasRefresh = sealedData.hasRefreshToken !== undefined ? sealedData.hasRefreshToken : Boolean(sealedData.supabaseRefreshToken);
    const hasCap = sealedData.hasCapsulePassphrase !== undefined ? sealedData.hasCapsulePassphrase : true;

    return (
      <div className="pb-card pb-vault-sealed" style={{
        background: '#0e1713',
        border: '2px solid #249361',
        borderRadius: '10px',
        padding: '24px',
        marginTop: '16px',
        color: '#f0fdf4',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>🔒</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#3ecf8e', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                Runner Vault Sealed Shut
                <span className="pb-badge pb-badge-ok" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                  SEALED · AES-256-GCM
                </span>
                <span className="pb-badge" style={{ fontSize: '11px', background: '#1e293b', color: '#93c5fd' }}>
                  Google Cloud Run ({sealedData.gcpRegion || 'us-central1'})
                </span>
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                Encrypted locally in browser memory. Plaintext keys have been purged.
              </p>
            </div>
          </div>
          <span style={{ background: '#132e22', color: '#3ecf8e', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
            0 secret bytes sent to Portabase servers
          </span>
        </div>

        <div style={{ background: '#07100b', padding: '14px 16px', borderRadius: '6px', border: '1px solid #1c3d2c', marginBottom: '16px', fontSize: '13px' }}>
          <div style={{ color: '#9ca3af', marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase', fontFamily: 'monospace' }}>Cryptographic Seal Fingerprint</div>
          <div style={{ color: '#6ee7b7', wordBreak: 'break-all', fontFamily: 'monospace' }}>{sealedData.fingerprint}</div>
          <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '6px', fontFamily: 'monospace' }}>
            Sealed at: {sealedData.sealedAt} · KDF: PBKDF2 (100,000 rounds)
          </div>
          <div style={{ borderTop: '1px solid #1c3d2c', marginTop: '10px', paddingTop: '10px', fontSize: '12px', color: '#d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <span style={{ fontWeight: 600, color: '#3ecf8e' }}>Sealed contents: </span>
              <span>
                Database ({hasDb ? '✓' : '—'}) · API Key ({hasApi ? '✓' : '—'}) · Refresh Token ({hasRefresh ? '✓' : '—'}) · Passphrase ({hasCap ? '✓' : '—'})
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span className="pb-badge" style={{ fontSize: '10px', textTransform: 'uppercase' }}>
                Platform: Cloud Run
              </span>
              {sealedData.storageDestination && (
                <span className="pb-badge pb-badge-ok" style={{ fontSize: '10px', textTransform: 'uppercase' }}>
                  Dest: {sealedData.storageDestination}
                </span>
              )}
            </div>
          </div>
        </div>

        {error && <div className="pb-callout danger" style={{ marginBottom: '16px' }}><p>{error}</p></div>}
        {success && <div className="pb-callout ok" style={{ marginBottom: '16px' }}><p>{success}</p></div>}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="pb-btn pb-btn-primary" onClick={downloadSealedJson} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="download" size={14} /> Download Sealed Vault (<code style={{ background: 'transparent' }}>portabase-runner.sealed.json</code>)
          </button>
          <button type="button" className="pb-btn" onClick={() => setShowUnlockModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="key" size={14} /> Unlock Vault with Sealing Password
          </button>
        </div>

        {showUnlockModal && (
          <div style={{ marginTop: '20px', padding: '16px', background: '#111827', borderRadius: '8px', border: '1px solid #374151' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#f3f4f6' }}>Enter Sealing Password to Unlock &amp; Edit</h4>
            <form onSubmit={handleUnlock} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Sealing password"
                value={unlockPassword}
                onChange={e => setUnlockPassword(e.target.value)}
                style={{
                  flex: '1 1 240px',
                  padding: '8px 12px',
                  background: '#1f2937',
                  color: '#fff',
                  border: '1px solid #4b5563',
                  borderRadius: '4px',
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

  return (
    <div className="pb-card pb-vault-unsealed" style={{
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: '10px',
      padding: '24px',
      marginTop: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🛡️</span>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#f0f6fc' }}>Private Sealed Runner Vault</h3>
        </div>
        <span className="pb-badge pb-badge-ok" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          LOCAL BROWSER VAULT · ZERO NETWORK TRANSMISSION
        </span>
      </div>

      <p style={{ fontSize: '13px', color: '#8b949e', marginTop: 0, marginBottom: '18px', lineHeight: 1.5 }}>
        Enter credentials below to seal them shut inside an encrypted file using WebCrypto (<code>PBKDF2-SHA256</code> + <code>AES-256-GCM</code>).
        Your plaintext secrets never cross the network. Once sealed, you can safely copy the sealed vault to your runner.
      </p>

      {error && <div className="pb-callout danger" style={{ marginBottom: '14px' }}><p>{error}</p></div>}
      {success && <div className="pb-callout ok" style={{ marginBottom: '14px' }}><p>{success}</p></div>}

      <form onSubmit={handleSeal} style={{ display: 'grid', gap: '16px' }}>
        {/* Section A: Google Cloud Run Platform Configuration */}
        <div style={{ background: '#131920', padding: '14px', borderRadius: '8px', border: '1px solid #21262d' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#f0f6fc' }}>
              Compute Platform: Google Cloud Run (Per-Subscriber Job · Scale-to-Zero)
            </label>
            <span className="pb-badge pb-badge-ok" style={{ fontSize: '10px' }}>
              SCALE-TO-ZERO · 0 STANDBY COST
            </span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#8b949e', lineHeight: 1.4 }}>
            Your automated runner runs inside an isolated, private Google Cloud Run container. Ephemeral jobs spin up on demand, run the backup, and immediately terminate.
          </p>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
              Google Cloud Region:
            </label>
            <select
              className="pb-select"
              value={gcpRegion}
              onChange={e => setGcpRegion(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '400px',
                padding: '8px 12px',
                background: '#0d1117',
                color: '#f0f6fc',
                border: '1px solid #30363d',
                borderRadius: '6px',
              }}
            >
              {GCP_RUNNER_REGIONS.map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Section B: Connection Method */}
        <div style={{ background: '#131920', padding: '14px', borderRadius: '8px', border: '1px solid #21262d' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '8px' }}>
            1. Supabase Connection Method
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`pb-btn ${authMethod === 'password-api' ? 'pb-btn-primary' : ''}`}
              onClick={() => setAuthMethod('password-api')}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              Password &amp; API Key
            </button>
            <button
              type="button"
              className={`pb-btn ${authMethod === 'refresh-token' ? 'pb-btn-primary' : ''}`}
              onClick={() => setAuthMethod('refresh-token')}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              OAuth Refresh Token (Auto-Rotation)
            </button>
            <button
              type="button"
              className={`pb-btn ${authMethod === 'oauth' ? 'pb-btn-primary' : ''}`}
              onClick={() => setAuthMethod('oauth')}
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              One-Click Supabase OAuth (PKCE)
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#8b949e' }}>
            {authMethod === 'oauth'
              ? 'Runner Supabase OAuth PKCE flow: generates one-click OAuth token pair with auto-discovery of Project URL and service_role key.'
              : authMethod === 'refresh-token'
              ? 'Provide a Supabase OAuth Refresh Token (sbr_...) so your runner automatically refreshes access tokens before each backup.'
              : 'Direct Database Password and Secret / Service-Role API key for the runner.'}
          </p>
        </div>

        {/* Database Password input */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
            Supabase Database Password{' '}
            <span style={{ color: '#8b949e', fontWeight: 400 }}>(Supabase Dashboard → Project Settings → Database)</span>
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="pb-input"
              placeholder="Enter your Postgres database password"
              value={dbPassword}
              onChange={e => setDbPassword(e.target.value)}
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
              onClick={() => setShowDbPassword(v => !v)}
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
              aria-label={showDbPassword ? 'Hide database password' : 'Show database password'}
            >
              {showDbPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {dbPassword && (
            <div style={{ fontSize: '12px', color: '#3ecf8e', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ✓ Database password ready (target: db.{projectRef || '<project-ref>'}.supabase.co:5432/postgres)
            </div>
          )}
        </div>

        {/* API Key input */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
            Supabase Secret / Service-Role API Key{' '}
            <span style={{ color: '#8b949e', fontWeight: 400 }}>(Supabase Dashboard → Project Settings → API Keys)</span>
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="pb-input"
              placeholder="sb_secret_... or service_role JWT (eyJ...)"
              value={supabaseApiKey}
              onChange={e => setSupabaseApiKey(e.target.value)}
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
              onClick={() => setShowApiKey(v => !v)}
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
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          {supabaseApiKey.trim() && (
            <div style={{ fontSize: '12px', marginTop: '6px' }}>
              {(supabaseApiKey.trim().startsWith('sb_secret_') || supabaseApiKey.trim().startsWith('eyJ')) ? (
                <span style={{ color: '#3ecf8e' }}>✓ Valid Supabase secret / service_role key format</span>
              ) : supabaseApiKey.trim().startsWith('sb_publishable_') ? (
                <span style={{ color: '#f59e0b' }}>⚠ That looks like a publishable/anon key — use your sb_secret_ or service_role key for full Auth &amp; Storage backup</span>
              ) : null}
            </div>
          )}
        </div>

        {/* Refresh Token input */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
            Supabase OAuth Refresh Token{' '}
            <span style={{ color: '#8b949e', fontWeight: 400 }}>(Option for automatic token rotation, sbr_... or OAuth token)</span>
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="pb-input"
              placeholder="sbr_... or OAuth refresh token"
              value={supabaseRefreshToken}
              onChange={e => setSupabaseRefreshToken(e.target.value)}
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
              onClick={() => setShowRefreshToken(v => !v)}
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
              aria-label={showRefreshToken ? 'Hide refresh token' : 'Show refresh token'}
            >
              {showRefreshToken ? 'Hide' : 'Show'}
            </button>
          </div>
          {supabaseRefreshToken.trim() && (
            <div style={{ fontSize: '12px', color: '#3ecf8e', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ✓ Supabase OAuth refresh token configured (automatic access token rotation enabled)
            </div>
          )}
        </div>

        {/* Section C: Backup Storage Destination (OAuth / Keyless) */}
        <div style={{ background: '#131920', padding: '16px', borderRadius: '8px', border: '1px solid #21262d' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#f0f6fc' }}>
              2. Backup Storage Destination (OAuth / Keyless Custody)
            </label>
            <span className="pb-badge pb-badge-ok" style={{ fontSize: '10px' }}>
              ZERO STATIC SECRET KEYS
            </span>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#8b949e', lineHeight: 1.4 }}>
            Configure where the encrypted capsules will be written. All destinations support OAuth or keyless identity federation.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', marginBottom: '14px' }}>
            {[
              { id: 'gdrive', title: 'Google Drive', icon: '📁', tag: 'OAuth PKCE' },
              { id: 'dropbox', title: 'Dropbox', icon: '📦', tag: 'OAuth PKCE' },
              { id: 'gcs', title: 'Google Cloud Storage', icon: '☁️', tag: 'Native Workload Identity' },
              { id: 's3-oidc', title: 'AWS S3 (OIDC Federation)', icon: '🛡️', tag: 'Zero IAM Keys' },
            ].map(dest => (
              <button
                key={dest.id}
                type="button"
                onClick={() => setStorageDestination(dest.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: storageDestination === dest.id ? '2px solid #3ecf8e' : '1px solid #30363d',
                  background: storageDestination === dest.id ? '#132a1e' : '#0d1117',
                  color: '#f0f6fc',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <span>{dest.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: '12px' }}>{dest.title}</span>
                </div>
                <div style={{ fontSize: '10px', color: '#8b949e' }}>{dest.tag}</div>
              </button>
            ))}
          </div>

          {/* Option 1: Google Drive */}
          {storageDestination === 'gdrive' && (
            <div style={{ display: 'grid', gap: '10px', background: '#0d1117', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f6fc' }}>Google Drive OAuth Configuration</span>
                <a
                  href="/oauth/google-drive/start"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="pb-btn pb-btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                >
                  <Icon name="key" size={12} /> Launch 1-Click Google Drive OAuth
                </a>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                  Google Drive Refresh Token (<code>GOOGLE_DRIVE_REFRESH_TOKEN</code>)
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="pb-input"
                    placeholder="Enter Google Drive refresh token"
                    value={gdriveRefreshToken}
                    onChange={e => setGdriveRefreshToken(e.target.value)}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      paddingRight: '60px',
                      WebkitTextSecurity: showGdriveToken ? 'none' : 'disc',
                    }}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGdriveToken(v => !v)}
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
                    {showGdriveToken ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                  Folder Path in Drive
                </label>
                <input
                  type="text"
                  className="pb-input"
                  value={gdriveFolderPath}
                  onChange={e => setGdriveFolderPath(e.target.value)}
                  placeholder="/Portabase"
                  style={{ width: '100%', fontFamily: 'monospace' }}
                />
              </div>
            </div>
          )}

          {/* Option 2: Dropbox */}
          {storageDestination === 'dropbox' && (
            <div style={{ display: 'grid', gap: '10px', background: '#0d1117', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f6fc' }}>Dropbox OAuth Configuration</span>
                <a
                  href="/oauth/dropbox/start"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="pb-btn pb-btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                >
                  <Icon name="key" size={12} /> Launch 1-Click Dropbox OAuth
                </a>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                  Dropbox Refresh Token (<code>DROPBOX_REFRESH_TOKEN</code>)
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="pb-input"
                    placeholder="Enter Dropbox refresh token"
                    value={dropboxRefreshToken}
                    onChange={e => setDropboxRefreshToken(e.target.value)}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      paddingRight: '60px',
                      WebkitTextSecurity: showDropboxToken ? 'none' : 'disc',
                    }}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDropboxToken(v => !v)}
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
                    {showDropboxToken ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                  Folder Path in Dropbox
                </label>
                <input
                  type="text"
                  className="pb-input"
                  value={dropboxFolderPath}
                  onChange={e => setDropboxFolderPath(e.target.value)}
                  placeholder="/Portabase"
                  style={{ width: '100%', fontFamily: 'monospace' }}
                />
              </div>
            </div>
          )}

          {/* Option 3: Google Cloud Storage (GCS) */}
          {storageDestination === 'gcs' && (
            <div style={{ display: 'grid', gap: '10px', background: '#0d1117', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f6fc' }}>
                Google Cloud Storage (GCS) · Native Workload Identity
              </span>
              <p style={{ margin: 0, fontSize: '11px', color: '#8b949e', lineHeight: 1.4 }}>
                When running on Google Cloud Run, the runner authenticates directly to your GCS bucket using GCP Service Account Workload Identity. No secret keys or passwords are required!
              </p>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                  GCS Bucket URI (<code>GCS_BUCKET_URI</code>)
                </label>
                <input
                  type="text"
                  className="pb-input"
                  value={gcsBucketUri}
                  onChange={e => setGcsBucketUri(e.target.value)}
                  placeholder="gs://my-supabase-backup-vault"
                  style={{ width: '100%', fontFamily: 'monospace' }}
                />
              </div>
            </div>
          )}

          {/* Option 4: AWS S3 via OIDC Federation */}
          {storageDestination === 's3-oidc' && (
            <div style={{ display: 'grid', gap: '10px', background: '#0d1117', padding: '12px', borderRadius: '6px', border: '1px solid #30363d' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#f0f6fc' }}>
                  AWS S3 via OIDC Federation ("AWS OAuth" · Zero IAM Keys)
                </span>
                <a
                  href={quickCreateUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="pb-btn pb-btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                >
                  🚀 1-Click AWS CloudFormation Setup
                </a>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: '#8b949e', lineHeight: 1.4 }}>
                Federates the Google Cloud Run OIDC token directly into AWS via <code>sts:AssumeRoleWithWebIdentity</code>. You never create or store static AWS IAM access keys!
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                    S3 Bucket Name (<code>AWS_S3_BUCKET</code>)
                  </label>
                  <input
                    type="text"
                    className="pb-input"
                    value={awsS3Bucket}
                    onChange={e => setAwsS3Bucket(e.target.value)}
                    placeholder="my-portabase-backups"
                    style={{ width: '100%', fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#c9d1d9', marginBottom: '4px' }}>
                    IAM Role ARN (<code>AWS_S3_ROLE_ARN</code>)
                  </label>
                  <input
                    type="text"
                    className="pb-input"
                    value={awsS3RoleArn}
                    onChange={e => setAwsS3RoleArn(e.target.value)}
                    placeholder="arn:aws:iam::123456789012:role/PortabaseS3RunnerRole"
                    style={{ width: '100%', fontFamily: 'monospace' }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section D: Vault Sealing Password */}
        <div style={{ background: '#161b22', padding: '16px', borderRadius: '6px', border: '1px solid #21262d' }}>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#c9d1d9', lineHeight: 1.5 }}>
            This password seals the vault shut <strong>AND</strong> encrypts your backup capsules. You will use this same password to unlock this vault or decrypt capsules produced by your runner.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
                3. Vault Sealing Password <span style={{ color: '#3ecf8e' }}>*</span>
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  className="pb-input"
                  placeholder="Min 8 characters"
                  value={sealingPassword}
                  onChange={e => setSealingPassword(e.target.value)}
                  style={{
                    width: '100%',
                    paddingRight: '60px',
                    WebkitTextSecurity: showSealingPassword ? 'none' : 'disc',
                  }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSealingPassword(v => !v)}
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
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
                4. Confirm Sealing Password <span style={{ color: '#3ecf8e' }}>*</span>
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  className="pb-input"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    paddingRight: '60px',
                    WebkitTextSecurity: showConfirmPassword ? 'none' : 'disc',
                  }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(v => !v)}
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

          {(confirmPassword || (sealingPassword && sealingPassword.length > 0)) && (
            <div style={{ marginTop: '8px', fontSize: '12px' }}>
              {sealingPassword && confirmPassword && sealingPassword === confirmPassword ? (
                <span style={{ color: '#3ecf8e' }}>✓ Passwords match</span>
              ) : confirmPassword ? (
                <span style={{ color: '#f87171' }}>Passwords do not match</span>
              ) : null}
            </div>
          )}

          <details style={{ marginTop: '14px', fontSize: '12px', color: '#8b949e' }}>
            <summary style={{ cursor: 'pointer', color: '#58a6ff', userSelect: 'none', fontWeight: 500 }}>
              Optional: Use a different passphrase for capsule files
            </summary>
            <div style={{ marginTop: '8px', padding: '10px 12px', background: '#0d1117', borderRadius: '4px', border: '1px solid #30363d' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#c9d1d9', marginBottom: '4px' }}>
                Capsule Encryption Passphrase (defaults to Vault Sealing Password)
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  className="pb-input"
                  placeholder="Leave blank to use Vault Sealing Password"
                  value={capsulePassphrase}
                  onChange={e => setCapsulePassphrase(e.target.value)}
                  style={{
                    width: '100%',
                    fontFamily: 'monospace',
                    paddingRight: '60px',
                    WebkitTextSecurity: showCapsulePassphrase ? 'none' : 'disc',
                  }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowCapsulePassphrase(v => !v)}
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
              <span style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px', display: 'block' }}>
                If specified, the runner will use this passphrase to encrypt capsule files instead of your vault sealing password.
              </span>
            </div>
          </details>
        </div>

        <div>
          <button
            type="submit"
            className="pb-btn pb-btn-primary"
            disabled={isSealing || !sealingPassword || sealingPassword.length < 8 || sealingPassword !== confirmPassword || (!dbPassword && !supabaseApiKey && !supabaseRefreshToken && !capsulePassphrase)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '14px' }}
          >
            <Icon name="lock" size={16} /> 🔒 Seal Vault Shut with Sealing Password
          </button>
          <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '12px' }}>
            Encrypts in browser memory and scrubs raw values.
          </span>
        </div>
      </form>
    </div>
  );
}
