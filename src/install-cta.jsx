import React from 'react';
import { CLI_INSTALL } from './lib/product.js';

export function InstallCta({ Arrow }) {
  return (
    <section className="section install-cta" id="install-cli">
      <div className="shell install-cta-card">
        <div>
          <div className="section-kicker green">OPEN SOURCE · FREE CAPTURE</div>
          <h2>Install the CLI. Keep the keys.</h2>
          <p>
            Full Escape engine on your runner. Cloud is optional GUI and telemetry —
            never custody of passphrases or capsule bytes.
          </p>
          <pre className="docs-code" tabIndex={0}><code>{CLI_INSTALL.npmCommand}</code></pre>
          <div className="docs-cta-row">
            <a className="button button-primary" href={CLI_INSTALL.npmUrl} target="_blank" rel="noreferrer">View on npm <Arrow /></a>
            <a className="button button-ghost" href={CLI_INSTALL.githubCli} target="_blank" rel="noreferrer">GitHub · portabase-CLI <Arrow /></a>
            <a className="button button-ghost" href="/docs/quickstart">Docs <Arrow /></a>
          </div>
        </div>
      </div>
    </section>
  );
}
