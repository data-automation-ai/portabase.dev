import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import {
  BROWSER_DECRYPT,
  assertPassphraseStaysLocal,
  cliOpenHints,
  inspectLocalFile,
  inspectNeverShows,
} from '../lib/capsule-inspect.js';
import { ZK_COPY } from '../lib/zero-knowledge.js';
import { CAPSULE_KEY_MIN_LENGTH, fingerprintPassphrase, shortFingerprint } from '../lib/capsule-key.js';
import { formatBytes } from './data/store.js';

const STEPS = [
  { id: 'path', title: 'How to open' },
  { id: 'file', title: 'Local file' },
  { id: 'key', title: 'Your passphrase' },
  { id: 'result', title: 'On this device' },
];

export function OpenCapsulePage({ toast, navigate }) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState('local');
  const [result, setResult] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [busy, setBusy] = useState(false);
  const [capsuleDir, setCapsuleDir] = useState('./portabase-capsules/NAME');

  const resetSecrets = () => setPassphrase('');

  const onFile = async (file) => {
    setBusy(true);
    try {
      const inspected = await inspectLocalFile(file);
      setResult(inspected);
      setStep(2);
      toast?.('File stayed in this browser — nothing uploaded', 'ok');
    } catch (err) {
      toast?.(err.message || 'Could not read that file locally', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const confirmKey = async () => {
    setBusy(true);
    try {
      assertPassphraseStaysLocal(passphrase);
      const fp = await fingerprintPassphrase(passphrase, result?.meta?.id || result?.name || 'local');
      setFingerprint(shortFingerprint(fp));
      resetSecrets();
      setStep(3);
      toast?.('Passphrase used only in this tab, then discarded', 'ok');
    } catch (err) {
      toast?.(err.message || 'Passphrase check failed locally', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pb-page-head">
        <div>
          <h1>Open a capsule</h1>
          <p>
            {ZK_COPY.cannotOpen} Decrypt happens with your passphrase on this computer or the CLI.
            The file and secret are never posted to Cloud APIs. {ZK_COPY.headline}.
          </p>
        </div>
        <div className="pb-page-actions">
          <button type="button" className="pb-btn" onClick={() => navigate('telemetry')}><Icon name="chart" size={14} /> Telemetry</button>
          <button type="button" className="pb-btn" onClick={() => navigate('backups')}><Icon name="capsule" size={14} /> Manage</button>
        </div>
      </div>

      <div className="pb-callout danger">
        <Icon name="shield" size={16} />
        <div>
          <strong>{ZK_COPY.headline}</strong>
          <p>
            {ZK_COPY.cannotSee} {ZK_COPY.architecture}
            We will not fake a server-side peek.
          </p>
        </div>
      </div>

      <ol className="pb-wizard" aria-label="Open capsule steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}>
            <span>{i + 1}</span>
            {s.title}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="pb-grid pb-grid-2">
          <button type="button" className={`pb-card pb-choice${mode === 'local' ? ' is-on' : ''}`} onClick={() => setMode('local')}>
            <small>THIS BROWSER</small>
            <b>Select a file on this computer</b>
            <p>Read local <code>capsule.json</code> metadata, or acknowledge a <code>.pbase</code> as sealed ciphertext. No upload.</p>
          </button>
          <button type="button" className={`pb-card pb-choice${mode === 'cli' ? ' is-on' : ''}`} onClick={() => setMode('cli')}>
            <small>YOUR RUNNER · FULL OPEN</small>
            <b>CLI decrypt on the machine that has the key</b>
            <p><code>portabase verify --decrypt</code> is the real open path. Same engine that sealed the archive.</p>
          </button>
          <div className="pb-card" style={{ gridColumn: '1 / -1' }}>
            <p className="pb-muted" style={{ marginTop: 0 }}>
              Browser limitation (honest): {BROWSER_DECRYPT.reason}
            </p>
            <button
              type="button"
              className="pb-btn pb-btn-primary"
              onClick={() => {
                if (mode === 'cli') setStep(3);
                else setStep(1);
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="pb-card" style={{ maxWidth: 640 }}>
          <div className="pb-field">
            <label>Local capsule file</label>
            <input
              type="file"
              accept=".json,.pbase,application/json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = '';
              }}
            />
            <span className="pb-field-hint">Stays in memory in this tab. We do not POST it to /api.</span>
          </div>
          <button type="button" className="pb-btn" onClick={() => setStep(0)}>Back</button>
        </div>
      )}

      {step === 2 && (
        <div className="pb-card" style={{ maxWidth: 640 }}>
          <p className="pb-muted">
            Optional: type the passphrase here only to prove it stays local (fingerprint, then discard).
            It is <strong>not</strong> sent anywhere and it will <strong>not</strong> decrypt a .pbase in this browser.
          </p>
          <div className="pb-field">
            <label>Passphrase (≥{CAPSULE_KEY_MIN_LENGTH} characters)</label>
            <input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
          <div className="pb-inline">
            <button type="button" className="pb-btn" onClick={() => { resetSecrets(); setStep(1); }}>Back</button>
            <button type="button" className="pb-btn" onClick={() => { resetSecrets(); setStep(3); }}>Skip — CLI only</button>
            <button type="button" className="pb-btn pb-btn-primary" disabled={busy} onClick={confirmKey}>Confirm locally</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="pb-grid pb-grid-2">
          <div className="pb-card">
            <div className="pb-kpi-label">What this tab could do</div>
            {result?.kind === 'capsule-json' && result.meta && (
              <ul className="pb-muted" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
                <li>Capsule id: <code>{result.meta.id || '—'}</code></li>
                <li>Status: {result.meta.status || '—'}</li>
                <li>Layers present: {Object.entries(result.meta.layers).filter(([, on]) => on).map(([k]) => k).join(', ') || 'none flagged'}</li>
                <li>Encryption recorded: {result.meta.hasEncryption ? 'yes' : 'no'} · {result.meta.cryptoFormat}</li>
              </ul>
            )}
            {result?.kind === 'pbase' && (
              <p className="pb-muted">
                Local <code>.pbase</code> · {formatBytes(result.size)} ciphertext. Not decrypted here.
              </p>
            )}
            {!result && mode === 'cli' && (
              <p className="pb-muted">You chose the CLI path. Nothing was uploaded.</p>
            )}
            {fingerprint && (
              <p className="pb-faint">Local fingerprint {fingerprint} — not the passphrase.</p>
            )}
            <p className="pb-faint" style={{ marginTop: 12 }}>Never shown: {inspectNeverShows().join(' · ')}</p>
          </div>
          <div className="pb-card">
            <div className="pb-kpi-label">Open it yourself</div>
            <div className="pb-field">
              <label>Capsule directory on your runner</label>
              <input value={capsuleDir} onChange={(e) => setCapsuleDir(e.target.value)} className="pb-mono" />
            </div>
            <pre className="pb-code">{cliOpenHints(capsuleDir)}</pre>
            <button
              type="button"
              className="pb-btn"
              onClick={() => {
                navigator.clipboard?.writeText(cliOpenHints(capsuleDir));
                toast?.('CLI copied — run it on your runner', 'ok');
              }}
            >
              Copy CLI
            </button>
          </div>
          <div className="pb-card" style={{ gridColumn: '1 / -1' }}>
            <div className="pb-inline">
              <button type="button" className="pb-btn pb-btn-primary" onClick={() => { setResult(null); setFingerprint(''); setStep(0); }}>Start over</button>
              <a className="pb-btn" href="/docs#export-manifest">Docs · export-manifest</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
