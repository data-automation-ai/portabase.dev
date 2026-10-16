import React from 'react';
import { Icon } from './icons.jsx';
import { KEYS_COPY } from '../data/never-hold-keys.js';
import { PrivateSealedVault } from './private-vault.jsx';

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
        Do not paste service-role keys, database passwords or the capsule passphrase into unencrypted website inputs.
        Use the client-side sealed vault below, which encrypts your keys locally in your browser with AES-256-GCM and zero network transmission.
      </p>
      
      <PrivateSealedVault />
    </section>
  );
}
