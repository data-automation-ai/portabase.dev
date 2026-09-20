import React, { useEffect } from 'react';
import { CLI_INSTALL, CLOUD_PLANS, LOCAL_STARTER, planPriceRangeLabel } from './lib/product.js';
import {
  destinationsGuide,
  exportManifest,
  fillMissing,
  installCopy,
  liveSupabaseViewer,
  openCapsule,
  reportDrift,
  restoreOrder,
  telemetryUi,
} from './data/docs.js';

export function DocsPage({ Logo, Arrow, Footer }) {
  useEffect(() => {
    document.title = 'Portabase — Docs · CLI, fill, restore, drift';
    window.scrollTo(0, 0);
    const id = window.location.hash.replace(/^#/, '');
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }));
  }, []);

  return (
    <div className="security-page docs-page">
      <header className="site-header security-header">
        <div className="shell nav-wrap">
          <Logo href="/" />
          <nav className="nav cloud-page-nav">
            <a href="#install">Install</a>
            <a href="#fill-missing">Fill-missing</a>
            <a href="#restore-order">Restore order</a>
            <a href="#export-manifest">Manifest</a>
            <a href="#report-drift">Drift</a>
            <a href="#telemetry">Telemetry</a>
            <a href="#open-capsule">Open capsule</a>
            <a href="#live-supabase">Live Supabase</a>
            <a href="#destinations">Destinations</a>
            <a href="/backend">Backend</a>
            <a href="/security">Security</a>
          </nav>
          <a className="button button-small desktop-cta" href="/login?next=/app">Start free trial <Arrow /></a>
        </div>
      </header>

      <main>
        <section className="security-hero" id="overview">
          <div className="shell">
            <div className="section-kicker green">DOCS · OPEN CORE</div>
            <h1>Run the engine yourself.<br /><em>Cloud is optional telemetry.</em></h1>
            <p className="security-lead">
              Full capture is free. These pages document how the CLI fills, restores, and reports —
              and what Portabase Cloud is allowed to hear. Independent product — <strong>not affiliated with Supabase, Inc.</strong>
              Portabase is <strong>provably zero-knowledge</strong> of customer encryption keys / passphrases and capsule contents.
            </p>
            <div className="security-hero-proof">
              <span>Open-source CLI = full capture</span>
              <span>Cloud = optional signals</span>
              <span>No hosted vault</span>
              <span>No passphrase in our DB</span>
            </div>
          </div>
        </section>

        <section className="section security-keys-deep" id="install">
          <div className="shell">
            <div className="section-kicker green">CLI INSTALL</div>
            <h2>Install the open-source CLI.</h2>
            <p className="security-prose">
              The npm package and the GitHub CLI repo are the same engine this site talks about.
              Cloud login is not required to capture or restore.
            </p>
            <pre className="docs-code" tabIndex={0}><code>{installCopy.command}</code></pre>
            <div className="docs-cta-row">
              <a className="button button-primary" href={CLI_INSTALL.npmUrl} target="_blank" rel="noreferrer">npm package <Arrow /></a>
              <a className="button button-ghost" href={CLI_INSTALL.githubCli} target="_blank" rel="noreferrer">GitHub · portabase-CLI <Arrow /></a>
            </div>
            <ol className="security-steps keys-deep-steps">
              {installCopy.steps.map((step) => (
                <li key={step}><b>{step}</b><p>Credentials and the encryption passphrase stay in your environment variables.</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section security-picture" id="fill-missing">
          <div className="shell">
            <div className="section-kicker">FILL-MISSING</div>
            <h2>{fillMissing.title}</h2>
            <p className="security-prose">{fillMissing.summary}</p>
            <ul className="docs-plain-list">
              {fillMissing.points.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <pre className="docs-code" tabIndex={0}><code>{`portabase restore --fill-missing --writers 1
# default --writers is 1
# not incremental sync — absent-only Storage/DB fill`}</code></pre>
          </div>
        </section>

        <section className="section security-keys-deep" id="restore-order">
          <div className="shell">
            <div className="section-kicker green">RESTORE ORDER</div>
            <h2>Tables → views → procs → functions → data.</h2>
            <p className="security-prose">
              Replay into a <strong>new blank</strong> Supabase project. Never the source.
              Storage object bytes and permission grants apply when those layers are in the capsule.
            </p>
            <ol className="security-steps keys-deep-steps">
              {restoreOrder.map((step) => (
                <li key={step.id}><b>{step.title}</b><p>{step.body}</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section security-picture" id="export-manifest">
          <div className="shell">
            <div className="section-kicker">EXPORT / UNLOAD</div>
            <h2>{exportManifest.title}</h2>
            <p className="security-prose">{exportManifest.summary}</p>
            <div className="keys-deep-types">
              {exportManifest.commands.map((cmd) => (
                <article key={cmd.name}>
                  <small>COMMAND</small>
                  <b><code>{cmd.name}</code></b>
                  <p>{cmd.body}</p>
                </article>
              ))}
              <article>
                <small>NEVER IN THE FILE</small>
                <b>No secrets</b>
                <p>{exportManifest.never.join(' · ')}</p>
              </article>
            </div>
            <pre className="docs-code" tabIndex={0}><code>{`portabase export-manifest --capsule ./portabase-capsules/NAME
portabase capsule-unload --capsule ./portabase-capsules/NAME
# names, layers, checksums — not passphrases`}</code></pre>
          </div>
        </section>

        <section className="section security-keys-deep" id="report-drift">
          <div className="shell">
            <div className="section-kicker green">DRIFT</div>
            <h2>{reportDrift.title}</h2>
            <p className="security-prose">{reportDrift.summary}</p>
            <div className="keys-deep-types">
              {reportDrift.checks.map((check) => (
                <article key={check.id}>
                  <small>OPT-IN CHECK</small>
                  <b>{check.title}</b>
                  <p>{check.body}</p>
                </article>
              ))}
            </div>
            <pre className="docs-code" tabIndex={0}><code>{`portabase verify --capsule ./portabase-capsules/NAME --report-drift
# MD5 / row-count / RBAC — telemetry may send counts only, never dumps`}</code></pre>
          </div>
        </section>

        <section className="section security-picture" id="telemetry">
          <div className="shell">
            <div className="section-kicker">CLOUD DASHBOARD</div>
            <h2>{telemetryUi.title}</h2>
            <p className="security-prose">{telemetryUi.summary}</p>
            <div className="keys-deep-types">
              {telemetryUi.never.map((item) => (
                <article key={item}>
                  <small>FORBIDDEN FROM OUR SITE</small>
                  <b>{item}</b>
                  <p>Telemetry is graphs and gauges of runner health — not a capsule browser.</p>
                </article>
              ))}
            </div>
            <p className="security-prose"><a href="/app/telemetry?demo=1">Open the demo Telemetry page</a>.</p>
          </div>
        </section>

        <section className="section security-keys-deep" id="open-capsule">
          <div className="shell">
            <div className="section-kicker green">ZERO KNOWLEDGE</div>
            <h2>{openCapsule.title}</h2>
            <p className="security-prose">{openCapsule.summary}</p>
            <div className="keys-deep-types">
              {openCapsule.paths.map((p) => (
                <article key={p.name}>
                  <small>YOUR SIDE</small>
                  <b>{p.name}</b>
                  <p>{p.body}</p>
                </article>
              ))}
            </div>
            <pre className="docs-code" tabIndex={0}><code>{`export PORTABASE_ENCRYPTION_PASSPHRASE   # ≥16 chars, never pasted into this website
portabase verify --capsule ./portabase-capsules/NAME --decrypt
# Portabase Cloud cannot open the archive for you`}</code></pre>
            <p className="security-prose"><a href="/app/inspect?demo=1">Open the demo inspect wizard</a>.</p>
          </div>
        </section>

        <section className="section security-picture" id="live-supabase">
          <div className="shell">
            <div className="section-kicker">LIVE PROJECT · NOT THE CAPSULE</div>
            <h2>{liveSupabaseViewer.title}</h2>
            <p className="security-prose">{liveSupabaseViewer.summary}</p>
            <div className="keys-deep-types">
              {liveSupabaseViewer.points.map((point) => (
                <article key={point}>
                  <small>BROWSER ONLY</small>
                  <b>Direct to your Supabase</b>
                  <p>{point}</p>
                </article>
              ))}
            </div>
            <p className="security-prose">
              <a href="/app/supabase-viewer?demo=1">Open the live viewer</a>
              {' · '}
              <a href="/tools/supabase-viewer">/tools/supabase-viewer</a>
            </p>
          </div>
        </section>

        <section className="section security-picture" id="destinations">
          <div className="shell">
            <div className="section-kicker">DESTINATIONS · STAGING</div>
            <h2>Local Starter vs S3 / Dropbox / Drive / rclone.</h2>
            <p className="security-prose">
              {LOCAL_STARTER.summary} Large Storage fills need temporary disk.
              Prefer a cloud runner. Do not dump multi-GB onto a laptop unless you named that path.
            </p>
            <div className="keys-deep-types">
              {destinationsGuide.map((d) => (
                <article key={d.id}>
                  <small>{d.id.toUpperCase()}</small>
                  <b>{d.title}</b>
                  <p>{d.body}</p>
                </article>
              ))}
            </div>
            <div className="security-honest-banner" role="note">
              <strong>Disk warning:</strong> Capture — especially Storage — stages bytes before they are sealed.
              That disk must be a runner you chose. Portabase Cloud does not host the durable capsule.
            </div>
          </div>
        </section>

        <section className="section security-standalone" id="auth-trial">
          <div className="shell security-standalone-inner">
            <div>
              <div className="section-kicker">AUTH · TRIAL</div>
              <h2>Login → trial → connect project → first capsule proof.</h2>
              <p>
                Sign in with email or Google (Supabase Auth). Start a 7-day Square trial ({planPriceRangeLabel()}/mo after).
                Connect a project <em>label</em>. Prove a capsule on <em>your</em> vault.
                We do not promise a hosted vault. Keys stay on your side.
              </p>
            </div>
            <div className="security-standalone-actions">
              <a className="button button-primary" href="/login?mode=signup&next=/dashboard">Sign in / start trial <Arrow /></a>
              <a className="button button-ghost" href="/security">Security &amp; zero knowledge <Arrow /></a>
              <a className="button button-ghost" href="/legal">Legal · not affiliated <Arrow /></a>
            </div>
          </div>
        </section>

        <section className="section security-cta">
          <div className="shell security-cta-card">
            <div className="section-kicker green">NEXT</div>
            <h2>Backend wires, Security trust dial, Cloud plans.</h2>
            <p>
              Plans: {Object.values(CLOUD_PLANS).map((p) => p.shortLabel).join(' · ')}.
              Vault and keys remain yours.
            </p>
            <div className="security-cta-actions">
              <a className="button button-primary" href="/backend">Backend <Arrow /></a>
              <a className="button button-ghost" href="/security">Security <Arrow /></a>
              <a className="button button-ghost" href="/cloud">Cloud pricing <Arrow /></a>
              <a className="button button-ghost" href="/#escape">Escape <Arrow /></a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
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
                  Portabase Cloud is <strong>provably zero-knowledge</strong> of those secrets and does not host capsule plaintext or ciphertext as the vault of record.
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
            <a className="button button-ghost" href="/docs#install">Docs <Arrow /></a>
          </div>
        </div>
      </div>
    </section>
  );
}
