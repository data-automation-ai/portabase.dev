import React, { useEffect } from 'react';
import { planPriceRangeLabel } from './lib/product.js';
import { DocsApp } from './docs/DocsApp.jsx';

export function DocsPage({ Logo, Arrow }) {
  return <DocsApp Logo={Logo} Arrow={Arrow} />;
}

export function LegalPage({ Logo, Arrow, Footer }) {
  useEffect(() => {
    document.title = 'Portabase — Legal and Terms of Use';
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
            <div className="section-kicker red">LEGAL AND TERMS OF USE</div>
            <h1>Legal and Terms of Use</h1><p><strong>Not affiliated with Supabase, Inc.</strong></p>
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
                  You choose a supported customer-controlled vault; the standalone CLI supports additional destinations.
                  Encryption passphrases and wrap keys are yours.
                  Managed jobs process plaintext and keys inside an attested Secure Enclave in Portabase-operated Google Cloud infrastructure. Portabase is not your recovery vault.
                </p>
              </article>
              <article>
                <b>No hosted-vault promise</b>
                <p>
                  The managed subscription covers its stated runner and transfer allowance. Customer vault storage remains separate.
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
              The account service processes identity, billing, provider-connection and usage metadata. See the security page for the managed workload and credential boundaries.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

/* InstallCta moved to ./install-cta.jsx so this module (DocsApp) can code-split
   out of the landing bundle. main.jsx imports it from the new location. */
