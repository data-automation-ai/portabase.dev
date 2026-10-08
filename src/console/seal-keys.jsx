import React from 'react';
import { Icon } from './icons.jsx';
import { KEYS_COPY } from '../data/never-hold-keys.js';

/** Private runner setup requires a real authenticated interface and key protocol. */
export function SealKeysPanel({ demo = false } = {}) {
  return (
    <section className="pb-seal pb-card" aria-label="Private runner setup">
      {demo && <p className="pb-muted">Demo workspace · private runner setup is unavailable here too.</p>}
      <div className="pb-callout" role="status">
        <Icon name="shield" size={16} />
        <div>
          <strong>{KEYS_COPY.sealTitle}</strong>
          <p>{KEYS_COPY.sealBody}</p>
        </div>
      </div>
      <p>
        Do not paste service-role keys, database passwords or the capsule passphrase into this website.
        Sensitive setup belongs in the private runner interface, which is not connected yet.
      </p>
      <p className="pb-muted" id="runner-setup-unavailable">
        This panel cannot connect to a runner, encrypt credentials or verify a seal.
        A URL check cannot establish those protections.
      </p>
      <button type="button" className="pb-btn" disabled aria-describedby="runner-setup-unavailable">
        Private runner setup unavailable
      </button>
    </section>
  );
}
