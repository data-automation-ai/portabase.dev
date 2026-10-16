import React, { useState, useEffect } from 'react';
import { Icon } from './icons.jsx';

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

export function PrivateSealedVault({ projectRef = '', onVaultSealed = null }) {
  const [dbPassword, setDbPassword] = useState('');
  const [supabaseApiKey, setSupabaseApiKey] = useState('');
  const [capsulePassphrase, setCapsulePassphrase] = useState('');
  const [sealingPassword, setSealingPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showDbPassword, setShowDbPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
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
    if (!dbPassword && !supabaseApiKey && !capsulePassphrase) {
      setError('Please provide at least a database password or Supabase API key to seal.');
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
        dbPassword,
        supabaseApiKey,
        capsulePassphrase: effectiveCapsulePassphrase,
        sourceSecret: dbPassword || supabaseApiKey,
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
        hasDbPassword: Boolean(dbPassword),
        hasApiKey: Boolean(supabaseApiKey),
        hasCapsulePassphrase: Boolean(effectiveCapsulePassphrase),
      };

      // Immediately scrub plaintext secrets from memory
      setDbPassword('');
      setSupabaseApiKey('');
      setCapsulePassphrase('');
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
      const loadedDbPassword = parsed.dbPassword || (!parsed.sourceSecret?.startsWith('sb_') && !parsed.sourceSecret?.startsWith('eyJ') ? parsed.sourceSecret || '' : '');
      const loadedApiKey = parsed.supabaseApiKey || (parsed.sourceSecret?.startsWith('sb_') || parsed.sourceSecret?.startsWith('eyJ') ? parsed.sourceSecret || '' : '');
      setDbPassword(loadedDbPassword);
      setSupabaseApiKey(loadedApiKey);
      setCapsulePassphrase(parsed.capsulePassphrase || '');
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

  if (sealedData) {
    const hasDb = sealedData.hasDbPassword !== undefined ? sealedData.hasDbPassword : true;
    const hasApi = sealedData.hasApiKey !== undefined ? sealedData.hasApiKey : true;
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
              <h3 style={{ margin: 0, fontSize: '18px', color: '#3ecf8e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Runner Vault Sealed Shut
                <span className="pb-badge pb-badge-ok" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                  SEALED · AES-256-GCM (PBKDF2-SHA256)
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
          <div style={{ borderTop: '1px solid #1c3d2c', marginTop: '10px', paddingTop: '10px', fontSize: '12px', color: '#d1d5db' }}>
            <span style={{ fontWeight: 600, color: '#3ecf8e' }}>Sealed contents: </span>
            <span>
              Database Password ({hasDb ? '✓' : '—'}) · Supabase API Key ({hasApi ? '✓' : '—'}) · Capsule Passphrase ({hasCap ? '✓' : '—'})
            </span>
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
                type="password"
                placeholder="Sealing password"
                value={unlockPassword}
                onChange={e => setUnlockPassword(e.target.value)}
                style={{ flex: '1 1 240px', padding: '8px 12px', background: '#1f2937', color: '#fff', border: '1px solid #4b5563', borderRadius: '4px' }}
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
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
            1. Supabase Database Password{' '}
            <span style={{ color: '#8b949e', fontWeight: 400 }}>(Supabase Dashboard → Project Settings → Database)</span>
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type={showDbPassword ? 'text' : 'password'}
              className="pb-input"
              placeholder="Enter your Postgres database password"
              value={dbPassword}
              onChange={e => setDbPassword(e.target.value)}
              style={{ width: '100%', fontFamily: 'monospace', paddingRight: '60px' }}
              autoComplete="new-password"
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

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
            2. Supabase Secret / Service-Role API Key{' '}
            <span style={{ color: '#8b949e', fontWeight: 400 }}>(Supabase Dashboard → Project Settings → API Keys)</span>
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type={showApiKey ? 'text' : 'password'}
              className="pb-input"
              placeholder="sb_secret_... or service_role JWT (eyJ...)"
              value={supabaseApiKey}
              onChange={e => setSupabaseApiKey(e.target.value)}
              style={{ width: '100%', fontFamily: 'monospace', paddingRight: '60px' }}
              autoComplete="new-password"
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

        <div style={{ background: '#161b22', padding: '16px', borderRadius: '6px', border: '1px solid #21262d' }}>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#c9d1d9', lineHeight: 1.5 }}>
            This password seals the vault shut <strong>AND</strong> encrypts your backup capsules. You will use this same password to unlock this vault or decrypt capsules produced by your runner.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
                3. Vault Sealing Password <span style={{ color: '#3ecf8e' }}>*</span>
              </label>
              <input
                type="password"
                className="pb-input"
                placeholder="Min 8 characters"
                value={sealingPassword}
                onChange={e => setSealingPassword(e.target.value)}
                style={{ width: '100%' }}
                autoComplete="new-password"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
                4. Confirm Sealing Password <span style={{ color: '#3ecf8e' }}>*</span>
              </label>
              <input
                type="password"
                className="pb-input"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                style={{ width: '100%' }}
                autoComplete="new-password"
              />
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
              <input
                type="password"
                className="pb-input"
                placeholder="Leave blank to use Vault Sealing Password"
                value={capsulePassphrase}
                onChange={e => setCapsulePassphrase(e.target.value)}
                style={{ width: '100%', fontFamily: 'monospace' }}
                autoComplete="new-password"
              />
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
            disabled={isSealing || !sealingPassword || sealingPassword.length < 8 || sealingPassword !== confirmPassword || (!dbPassword && !supabaseApiKey && !capsulePassphrase)}
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
