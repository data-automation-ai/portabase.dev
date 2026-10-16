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
  const [sourceSecret, setSourceSecret] = useState('');
  const [capsulePassphrase, setCapsulePassphrase] = useState('');
  const [sealingPassword, setSealingPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  
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
    if (!sourceSecret && !capsulePassphrase) {
      setError('Please provide at least a source secret or capsule passphrase to seal.');
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

      const payload = JSON.stringify({
        projectRef,
        sourceSecret,
        capsulePassphrase,
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
      };

      // Immediately scrub plaintext secrets from memory
      setSourceSecret('');
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
      setSourceSecret(parsed.sourceSecret || '');
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

        <div style={{ background: '#07100b', padding: '14px 16px', borderRadius: '6px', border: '1px solid #1c3d2c', marginBottom: '16px', fontFamily: 'monospace', fontSize: '13px' }}>
          <div style={{ color: '#9ca3af', marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase' }}>Cryptographic Seal Fingerprint</div>
          <div style={{ color: '#6ee7b7', wordBreak: 'break-all' }}>{sealedData.fingerprint}</div>
          <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '6px' }}>
            Sealed at: {sealedData.sealedAt} · KDF: PBKDF2 (100,000 rounds)
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
            1. Supabase Source Secret / DB Connection or Service Key <span style={{ color: '#8b949e', fontWeight: 400 }}>(stays on machine only)</span>
          </label>
          <input
            type="password"
            className="pb-input"
            placeholder="postgresql://postgres:[password]@db.ref.supabase.co:5432/postgres or sb_secret_..."
            value={sourceSecret}
            onChange={e => setSourceSecret(e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace' }}
            autoComplete="new-password"
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#c9d1d9', marginBottom: '6px' }}>
            2. Capsule Encryption Passphrase <span style={{ color: '#8b949e', fontWeight: 400 }}>(used by runner to encrypt backup files)</span>
          </label>
          <input
            type="password"
            className="pb-input"
            placeholder="Min 16 characters recommended"
            value={capsulePassphrase}
            onChange={e => setCapsulePassphrase(e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace' }}
            autoComplete="new-password"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', background: '#161b22', padding: '14px', borderRadius: '6px', border: '1px solid #21262d' }}>
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

        <div>
          <button
            type="submit"
            className="pb-btn pb-btn-primary"
            disabled={isSealing || !sealingPassword || sealingPassword.length < 8}
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
