import React, { useEffect } from 'react';
import { CLI_INSTALL, planPriceRangeLabel } from './lib/product.js';
import { DocsApp } from './docs/DocsApp.jsx';

export function DocsPage({ Logo, Arrow }) {
  return <DocsApp Logo={Logo} Arrow={Arrow} />;
}

export function LegalPage({ Logo, Arrow, Footer }) {
  useEffect(() => {
    document.title = 'Portabase — Legal · disclaimer';
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="security-page legal-page">
      <header className="site-header security-header">
        <div className="shell nav-wrap">
          <Logo href="/" />
          <nav className="nav cloud-page-nav">
            <a href="/docs">Docs</a>
            <a href="/security">Security</a>
            <a href="/backend">Backend</a>
            <a href="/cloud">Cloud</a>
          </nav>
          <a className="button button-small desktop-cta" href="/login?next=/app">Start free trial <Arrow /></a>
        </div>
      </header>
      <main>
        <section className="security-hero" id="disclaimer">
          <div className="shell">
            <div className="section-kicker red">LEGAL · DISCLAIMER</div>
            <h1>Not affiliated with Supabase, Inc.</h1>
            <p className="security-lead">
              Portabase is an independent product of DataAutomation.ai, LLC.
              <strong> We are not affiliated with, endorsed by, or sponsored by Supabase, Inc.</strong>
              “Supabase” and related marks belong to their owners. We build an Escape for projects hosted on that platform.
            </p>
          </div>
        </section>
        <section className="section security-honest">
          <div className="shell">
            <div className="security-honest-grid">
              <article>
                <b>Customer owns destinations and keys</b>
                <p>
                  You choose S3, Dropbox, Drive, rclone, NAS, or Local Starter.
                  Encryption passphrases and wrap keys are yours.
                  Portabase Cloud is <strong>designed to be blind</strong> to those secrets and does not host capsule plaintext or ciphertext as the vault of record.
                </p>
              </article>
              <article>
                <b>No hosted-vault promise</b>
                <p>
                  Paying for Cloud buys GUI, configuration, telemetry, and alerts — not object storage for recovery bytes.
                  If you only have this website, you cannot restore a project.
                </p>
              </article>
              <article>
                <b>Open core</b>
                <p>
                  The CLI is Apache-2.0. Full capture is free.
                  Cloud is optional and billed via Square ({planPriceRangeLabel()}/mo after a 7-day trial).
                </p>
              </article>
            </div>
            <p className="security-prose">
              Contact: <a href="mailto:escape@portabase.dev">escape@portabase.dev</a>.
              Privacy: no analytics on the public site. Telemetry to Cloud is opt-in health metadata only.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

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
