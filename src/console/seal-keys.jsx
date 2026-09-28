import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import { KEYS_COPY } from '../data/never-hold-keys.js';
import { KeysFlow, KeysHonest } from '../components/keys-flow.jsx';
import { assertRunnerSealUrl } from '../lib/runner-seal.js';

/**
 * Runner setup / seal-keys chrome.
 * Validates that the destination is a runner, never Portabase /api.
 * Does not collect Supabase keys on this website.
 */
export function SealKeysPanel({ demo = false, toast } = {}) {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState(null);

  const check = (event) => {
    event?.preventDefault();
    try {
      const ok = assertRunnerSealUrl(url.trim());
      setResult({ ok: true, url: ok });
      toast?.('Seal destination is a runner — not Portabase /api', 'ok');
    } catch (err) {
      setResult({ ok: false, message: err.message, code: err.code });
      toast?.(err.message || 'Seal URL refused', 'danger');
    }
  };

  return (
    <div className="pb-seal">
      <div className="pb-callout ok">
        <Icon name="shield" size={16} />
        <div>
          <strong>{KEYS_COPY.sealTitle}</strong>
          <p>{KEYS_COPY.sealBody}</p>
        </div>
      </div>
      <form className="pb-card pb-seal-form" onSubmit={check}>
        <div className="pb-card-head">
          <h3>Check runner seal URL</h3>
          <span>refuses /api/cloud</span>
        </div>
        <p className="pb-muted" style={{ marginTop: 0 }}>
          Do not paste service-role keys or the capsule passphrase into this website.
          Those belong on the runner. This form only checks that the seal destination is not Portabase.
        </p>
        <div className="pb-field">
          <label htmlFor="seal-url">Runner seal URL</label>
          <input
            id="seal-url"
            type="url"
            required
            value={url}
            onChange={(e) => { setUrl(e.target.value); setResult(null); }}
            placeholder="https://runner.example.internal/seal"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="pb-btn pb-btn-primary">Check destination</button>
        {result?.ok && (
          <div className="pb-callout ok" style={{ marginTop: 14 }}>
            <Icon name="check" size={16} />
            <div>
              <strong>Runner only</strong>
              <p>
                {demo
                  ? `Demo does not send secrets. Accepted destination: ${result.url}`
                  : `This console will POST a sealed envelope only to ${result.url}. Portabase /api is not on that path.`}
              </p>
            </div>
          </div>
        )}
        {result && !result.ok && (
          <div className="pb-callout danger" style={{ marginTop: 14 }} role="alert">
            <Icon name="warn" size={16} />
            <div>
              <strong>Refused</strong>
              <p>{result.message}</p>
            </div>
          </div>
        )}
      </form>
      <KeysFlow compact />
      <KeysHonest />
    </div>
  );
}
