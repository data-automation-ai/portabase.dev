import React from 'react';
import { KEYS_COPY } from '../data/never-hold-keys.js';

export function KeysPathCards() {
  return (
    <div className="keys-path-grid keys-path-grid-3">
      {KEYS_COPY.paths.map((path) => (
        <article key={path.step}>
          <em aria-hidden="true">{path.step}</em>
          <small>{path.kicker}</small>
          <b>{path.title}</b>
          <p>{path.body}</p>
        </article>
      ))}
    </div>
  );
}

export function KeysFlow({ compact = false } = {}) {
  return (
    <figure className={`keys-diagram${compact ? ' keys-diagram-compact' : ''}`} aria-label="Never-hold-keys path">
      <div className="keys-diagram-chrome">
        <span>CONFIDENTIAL RUNNER · VALIDATION</span>
        <b>Attest before sending</b>
      </div>
      <div className="keys-flow" role="img" aria-label="Verifier checks Google attestation before encrypted commands reach the Intel TDX runner through the controller.">
        {KEYS_COPY.flow.map((node, i) => (
          <React.Fragment key={node.label}>
            {i > 0 && (
              <span className="keys-flow-arrow" aria-hidden="true">
                {i === 1 ? 'verifies →' : 'encrypted →'}
              </span>
            )}
            <div className={`keys-flow-node${i === 2 ? ' is-blind' : ''}`}>
              <small>{i === 2 ? 'CONTROL' : i === 1 ? 'PROTECTED VM' : 'YOU'}</small>
              <b>{node.label}</b>
              <span>{node.detail}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
      <figcaption>
        <span>The managed runner is in Portabase’s Google project. Its verified workload processes the job.</span>
        <small>Live attestation tested · complete customer recovery still pending</small>
      </figcaption>
    </figure>
  );
}

export function KeysHonest() {
  return (
    <p className="keys-honest">
      <strong>Honest limit:</strong> {KEYS_COPY.honest}
    </p>
  );
}
