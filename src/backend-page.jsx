import React, { useEffect } from 'react';
import {
  capsuleAbout,
  capsuleNever,
  capsuleSteps,
  workerNever,
  workerSignals,
  workerSteps,
} from './data/backend.js';

export function BackendTeaser({ Arrow }) {
  return (
    <section className="section backend-home" id="backend">
      <div className="shell">
        <div className="section-kicker green">BACKEND · CONTROL PLANE</div>
        <div className="split-heading">
          <h2>How the backend talks to capsules and workers.</h2>
          <p>
            The open-source CLI creates encrypted recovery capsules on a runner you control.
            Portabase Cloud — when you turn it on — only exchanges <strong>job intent, status, and opt-in health</strong>.
            It does not hold your passphrase, database URLs, service-role keys, or capsule plaintext.
            Destinations stay yours: local, S3, Dropbox, and the rest.
          </p>
        </div>
        <div className="backend-home-grid">
          <article>
            <small>01 · CAPSULES</small>
            <b>Talks about recovery archives — never opens them</b>
            <p>
              Capsules are customer-owned <code>.pbase</code> archives (plus capsule directories) the CLI encrypts and stores in <em>your</em> vault.
              Cloud may learn a capsuleId and whether verify passed. It cannot decrypt the file, and it is not the vault of record.
            </p>
            <a className="text-link" href="/backend#capsules">Capsule communication <span>→</span></a>
          </article>
          <article>
            <small>02 · WORKERS</small>
            <b>Job signals — not a credential proxy</b>
            <p>
              Workers on your AWS, VPS, or self-hosted schedule pull job intent and report status.
              Secrets stay on the runner. Recovery bytes are not uploaded to Portabase.
              Cloud is optional monitoring and orchestration signals.
            </p>
            <a className="text-link" href="/backend#workers">Worker communication <span>→</span></a>
          </article>
        </div>
        <div className="backend-home-actions">
          <a className="button button-primary" href="/backend">Read the Backend page <Arrow /></a>
          <a className="button button-ghost" href="/security">Security &amp; trust <Arrow /></a>
        </div>
      </div>
    </section>
  );
}

export function BackendPage({ Logo, Arrow, Footer }) {
  useEffect(() => {
    document.title = 'Portabase — Backend · capsules & workers';
    window.scrollTo(0, 0);
    const id = window.location.hash.replace(/^#/, '');
    if (id) {
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }));
    }
  }, []);

  return (
    <div className="security-page backend-page">
      <header className="site-header security-header">
        <div className="shell nav-wrap">
          <Logo href="/" />
          <nav className="nav cloud-page-nav">
            <a href="#overview">Overview</a>
            <a href="#capsules">Capsules</a>
            <a href="#workers">Cloud workers</a>
            <a href="#boundaries">Boundaries</a>
            <a href="/security">Security</a>
            <a href="/docs">Docs</a>
            <a href="/cloud">Cloud pricing</a>
            <a href="/legal">Legal</a>
          </nav>
          <a className="button button-small desktop-cta" href="/login?next=/app">Start free trial <Arrow /></a>
        </div>
      </header>

      <main>
        <section className="security-hero" id="overview">
          <div className="shell">
            <div className="section-kicker green">BACKEND · ESCAPE CONTROL PLANE</div>
            <h1>The backend never becomes your vault.<br /><em>It talks about jobs — not secrets.</em></h1>
            <p className="security-lead">
              Portabase has two layers. The <strong>open-source CLI</strong> is the data plane: it creates, verifies, and restores
              encrypted recovery capsules. The <strong>optional Cloud backend</strong> (this website + APIs) is the control plane:
              GUI, schedules, job intent, status, and telemetry so the Escape keeps running.
              Full capture is free. Cloud is optional. Independent product — <strong>not affiliated with Supabase, Inc.</strong>
            </p>
            <div className="security-hero-proof">
              <span>Open-source CLI = full capture</span>
              <span>Cloud = optional signals</span>
              <span>Provably zero-knowledge</span>
              <span>No passphrase in our DB</span>
              <span>No capsule plaintext</span>
              <span>No object names</span>
              <span>BYO vault</span>
              <span>Workers pull jobs</span>
            </div>
            <div className="security-honest-banner" role="note">
              <strong>Up front:</strong> Portabase Cloud does <strong>not</strong> hold your encryption passphrase, database URLs,
              service-role keys, or capsule plaintext, and it is <strong>not</strong> the vault of record for <code>.pbase</code> ciphertext.
              On optional <em>managed</em> Cloud runners, a job must still use crypto for the run — that residual visibility is documented on
              {' '}<a href="/security">Security</a>. Customer-controlled workers keep secrets entirely on your side.
            </div>
            <div className="backend-jump">
              <a href="#capsules">
                <small>SECTION 01</small>
                <b>Communication with capsules</b>
                <p>How the product talks about encrypted archives — and why it never opens them.</p>
              </a>
              <a href="#workers">
                <small>SECTION 02</small>
                <b>Communication with cloud workers</b>
                <p>Job intent, status, and alerts. Not credential proxying. Not recovery-byte upload.</p>
              </a>
              <a href="#trust-boundary">
                <small>SECTION 03</small>
                <b>Trust-boundary diagram</b>
                <p>Your vault and keys vs optional Cloud telemetry.</p>
              </a>
            </div>
          </div>
        </section>

        <section className="section security-keys-deep" id="capsules">
          <div className="shell">
            <div className="section-kicker green">01 · CAPSULES</div>
            <h2>Communication with the capsules.</h2>
            <p className="security-prose">
              A <strong>capsule</strong> is an encrypted, customer-owned recovery archive produced by the open-source CLI:
              a <code>.pbase</code> payload plus a capsule directory (manifest, checksums, capture status).
              It is the Escape artifact — database, Auth records, Storage object bytes, and Edge Function source —
              sealed so a Supabase lockout does not take the only copy with it.
            </p>

            <div className="keys-deep-types backend-never-grid">
              <article>
                <small>WHAT IT IS</small>
                <b>Your recovery archive</b>
                <p>
                  Created, verified, and restored by the CLI on a runner you authorize.
                  Same engine on GitHub and under Cloud. Complete job — not a lite edition.
                </p>
              </article>
              <article>
                <small>WHAT THE BACKEND HOLDS</small>
                <b>Nothing that opens it</b>
                <p>
                  No passphrase. No DB URLs. No service-role keys. No capsule plaintext.
                  Opt-in health may mention a capsuleId and whether the job succeeded.
                </p>
              </article>
              <article>
                <small>WHERE IT LIVES</small>
                <b>Your destination</b>
                <p>
                  Local folder, S3, Dropbox, Drive, NAS — you choose.
                  Cloud never hosts capsule ciphertext as the vault of record.
                </p>
              </article>
            </div>

            <figure className="flow-diagram">
              <figcaption>
                <span>SEQUENCE · CAPSULE PATH</span>
                <b>Runner writes ciphertext to your vault. Cloud hears status only if you opt in.</b>
              </figcaption>
              <div className="flow-track" role="img" aria-label="Supabase to runner encrypt to customer vault to optional Cloud health">
                <div className="flow-node">
                  <small>SOURCE</small>
                  <strong>Supabase project</strong>
                  <span>DB · Auth · Storage · Functions</span>
                </div>
                <div className="flow-arrow" aria-hidden="true"><i /><em>capture</em></div>
                <div className="flow-node accent">
                  <small>YOUR RUNNER</small>
                  <strong>Open-source CLI</strong>
                  <span>Encrypt · checksum · verify</span>
                </div>
                <div className="flow-arrow" aria-hidden="true"><i /><em>upload</em></div>
                <div className="flow-node">
                  <small>YOUR VAULT</small>
                  <strong>.pbase capsule</strong>
                  <span>S3 · Dropbox · local · NAS</span>
                </div>
                <div className="flow-arrow dashed" aria-hidden="true"><i /><em>opt-in health</em></div>
                <div className="flow-node cloud">
                  <small>PORTABASE CLOUD</small>
                  <strong>Status only</strong>
                  <span>capsuleId · result · timing</span>
                </div>
              </div>
              <p className="flow-note">
                Thick path = recovery data on your infrastructure. Dashed path = allowlisted telemetry
                (<code>docs/TELEMETRY_SCHEMA.md</code>). Forbidden: passphrase, secrets, connection strings, capsule bytes.
              </p>
            </figure>

            <h3>How the product talks about a capsule</h3>
            <p className="security-prose">
              The backend talks <em>about</em> capsule workflows. It does not talk <em>to</em> a capsule as a decryptor.
              Create / verify / restore are CLI commands on the runner. Cloud receives non-secret health the customer opts into.
            </p>
            <div className="trust-columns backend-trust">
              <div className="trust-col trust-never">
                <h5>Never sent to Cloud</h5>
                <ul>{capsuleNever.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div className="trust-col trust-optional">
                <h5>Opt-in — talks about the job</h5>
                <ul>{capsuleAbout.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>

            <ol className="security-steps keys-deep-steps">
              {capsuleSteps.map((step) => (
                <li key={step.title}>
                  <b>{step.title}</b>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="key-callout" style={{ marginTop: 28 }}>
              <span>HONEST BOUNDARY</span>
              <b>Cloud never hosts capsule ciphertext as the vault of record.</b>
              <p>
                Destinations are customer local disk, S3, Dropbox, Drive, or NAS.
                Staging disk on a managed runner is ephemeral workspace for a job — then discarded.
                The durable Escape copy is the sealed capsule in storage you own.
                Standalone restore needs capsule + passphrase + a blank target, not this website.
                Key injection (console or CLI) happens on the customer side — Portabase never receives the passphrase.
              </p>
            </div>
          </div>
        </section>

        <section className="section security-picture" id="workers">
          <div className="shell">
            <div className="section-kicker">02 · CLOUD WORKERS</div>
            <h2>Communication with the cloud workers.</h2>
            <p className="security-prose">
              Workers are the processes that actually run Escape: the CLI on a schedule, a self-hosted agent, or an optional
              Cloud-managed runner. Portabase Cloud communicates with them as <strong>orchestration signals</strong> —
              job intent, status, alerts — not as a proxy that holds or forwards your production secrets.
            </p>

            <figure className="flow-diagram">
              <figcaption>
                <span>SEQUENCE · WORKER CHANNEL</span>
                <b>Pull job intent. Run locally. Report status. Never upload recovery bytes.</b>
              </figcaption>
              <div className="flow-track backend-worker-track" role="img" aria-label="Console intent to worker pull to customer vault to Cloud alerts">
                <div className="flow-node cloud">
                  <small>CONTROL PLANE</small>
                  <strong>Job intent</strong>
                  <span>backup · verify · replay</span>
                </div>
                <div className="flow-arrow dashed" aria-hidden="true"><i /><em>worker pulls</em></div>
                <div className="flow-node accent">
                  <small>YOUR WORKER</small>
                  <strong>AWS · VPS · self-host</strong>
                  <span>Secrets stay here</span>
                </div>
                <div className="flow-arrow" aria-hidden="true"><i /><em>capsule path</em></div>
                <div className="flow-node">
                  <small>YOUR VAULT</small>
                  <strong>Encrypted capsule</strong>
                  <span>Never copied to Portabase</span>
                </div>
                <div className="flow-arrow dashed" aria-hidden="true"><i /><em>status · alerts</em></div>
                <div className="flow-node">
                  <small>YOUR TEAM</small>
                  <strong>SMS · email · Slack</strong>
                  <span>Success and failure</span>
                </div>
              </div>
              <p className="flow-note">
                Customer workers pull <code>GET /api/cloud/jobs</code> and report via <code>POST /api/cloud/telemetry</code>
                (Bearer agent token). Job payloads carry labels — not DB URLs or passphrases.
                Local schedules (systemd, Task Scheduler) work with Cloud entirely off.
              </p>
            </figure>

            <ol className="security-steps keys-deep-steps">
              {workerSteps.map((step) => (
                <li key={step.title}>
                  <b>{step.title}</b>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="keys-deep-grid-2" style={{ marginTop: 28 }}>
              <article className="keys-deep-card keys-deep-never">
                <small>TRUST BOUNDARY · WORKER PATH</small>
                <b>What does not cross to Portabase</b>
                <ul>{workerNever.map((item) => <li key={item}>{item}</li>)}</ul>
              </article>
              <article className="keys-deep-card">
                <small>WHAT CLOUD IS FOR</small>
                <b>Signals the worker may send or receive</b>
                <ul className="backend-signal-list">{workerSignals.map((item) => <li key={item}>{item}</li>)}</ul>
              </article>
            </div>

            <div className="backend-runner-split">
              <article>
                <small>CUSTOMER-CONTROLLED · DEFAULT SELF-HOST</small>
                <b>Your AWS, VPS, or office box</b>
                <p>
                  Recommended when you want secrets never to leave infrastructure you operate.
                  Install the CLI, set env vars locally, schedule with systemd, EventBridge, or Task Scheduler.
                  Cloud, if enabled, is monitoring and job-intent only. This is the zero Portabase key-path story.
                </p>
              </article>
              <article>
                <small>OPTIONAL · MANAGED CLOUD RUNNERS</small>
                <b>Portabase-operated compute</b>
                <p>
                  Cloud can also stage jobs on isolated managed runners so you are not babysitting a laptop.
                  Capsules still land in <em>your</em> BYO vault. Because that runner must use crypto for the job window,
                  there is a residual possibility Portabase can see or use key material during the run —
                  we do not pretend otherwise. Details and the trust dial live on{' '}
                  <a href="/security">Security</a>.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section security-picture" id="trust-boundary">
          <div className="shell">
            <div className="section-kicker green">03 · TRUST BOUNDARY</div>
            <h2>Your vault and keys vs optional Cloud telemetry.</h2>
            <p className="security-prose">
              The thick line is customer infrastructure. The dashed line is allowlisted health.
              Portabase is <strong>provably zero-knowledge</strong> of customer encryption keys / passphrases and never hosts capsule plaintext or object-name inventory.
            </p>
            <figure className="trust-boundary-diagram" aria-label="Trust boundary between customer vault and Cloud telemetry">
              <div className="trust-boundary-col yours">
                <small>YOUR SIDE · ALWAYS</small>
                <b>Vault · keys · runner</b>
                <ul>
                  <li>Encryption passphrase / wrap PIN</li>
                  <li>Sealed .pbase ciphertext</li>
                  <li>S3 / Dropbox / Drive / rclone / Local Starter</li>
                  <li>Supabase source credentials</li>
                  <li>CLI inject-key on the runner or browser-local wrap</li>
                </ul>
              </div>
              <div className="trust-boundary-mid" aria-hidden="true">
                <span>boundary</span>
                <em>no passphrase<br />no plaintext</em>
              </div>
              <div className="trust-boundary-col ours">
                <small>OPTIONAL · CLOUD TELEMETRY</small>
                <b>Jobs · status · alerts</b>
                <ul>
                  <li>Job intent (backup / verify / replay)</li>
                  <li>capsuleId · status · timing · error class</li>
                  <li>Worker heartbeat / online</li>
                  <li>SMS / email / Slack — no capsule bytes</li>
                  <li>Plan usage vs 100 MB / 10 GB / 25 GB cap</li>
                </ul>
              </div>
            </figure>
          </div>
        </section>

        <section className="section security-honest" id="boundaries">
          <div className="shell">
            <div className="section-kicker red">BOUNDARIES · SAY THEM OUT LOUD</div>
            <h2>What the backend will not claim.</h2>
            <div className="security-honest-grid">
              <article>
                <b>We do not store your encryption keys</b>
                <p>
                  The control-plane database is workspaces, agents, alert routes, and health events.
                  It is not a passphrase vault and not a place we keep service-role keys as the product of record.
                </p>
              </article>
              <article>
                <b>We do not host your capsules</b>
                <p>
                  Recovery bytes stay in storage you own. Staging on a managed runner is temporary disk, not the Escape copy.
                  If someone only has our website, they cannot restore your project.
                </p>
              </article>
              <article>
                <b>We do not proxy your Supabase credentials</b>
                <p>
                  Workers are not a backhaul for DB URLs. Job intent is “run backup / verify / replay.”
                  The runner already has (or is separately granted) what it needs to talk to Supabase and the vault.
                </p>
              </article>
            </div>
            <div className="security-table-wrap">
              <table className="security-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>What moves</th>
                    <th>What must not move</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>CLI ↔ capsule / vault</td>
                    <td>Encrypted .pbase, manifests, checksums, verify results</td>
                    <td>Nothing to Portabase — this path is customer infrastructure</td>
                  </tr>
                  <tr>
                    <td>Worker ↔ Cloud jobs</td>
                    <td>Intent (type, labels), queue status</td>
                    <td>Passphrase, DB URL, service-role, vault keys</td>
                  </tr>
                  <tr>
                    <td>Worker ↔ Cloud telemetry</td>
                    <td>Allowlisted health events (opt-in)</td>
                    <td>Secret-shaped fields — rejected by schema</td>
                  </tr>
                  <tr>
                    <td>Cloud ↔ your team</td>
                    <td>SMS / email / Slack / webhook alerts</td>
                    <td>Capsule contents, decrypt material</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="section security-standalone">
          <div className="shell security-standalone-inner">
            <div>
              <div className="section-kicker">OPEN CORE</div>
              <h2>Cloud is optional. The CLI is the Escape.</h2>
              <p>
                Run <code>doctor</code>, <code>backup</code>, <code>verify</code>, and <code>replay</code> with Cloud disabled.
                Telemetry defaults off on self-hosted agents. Want zero vendor compute? Keep the runner yours.
                Want GUI and waking humans? Turn Cloud on — capsules still do not live here.
              </p>
            </div>
            <div className="security-standalone-actions">
              <a className="button button-primary" href="https://github.com/DataAutomation-ai" target="_blank" rel="noreferrer">GitHub · open source <Arrow /></a>
              <a className="button button-ghost" href="/security">Security &amp; key path <Arrow /></a>
              <a className="button button-ghost" href="/cloud">Cloud vs open source <Arrow /></a>
            </div>
          </div>
        </section>

        <section className="section security-cta">
          <div className="shell security-cta-card">
            <div className="section-kicker green">NEXT</div>
            <h2>See the trust dial, or run the engine yourself.</h2>
            <p>
              Backend describes the wires. Security explains residual key visibility on managed jobs.
              Cloud is the optional GUI, telemetry, and SMS product — Cloud Free 100 MB, then $7 or $17 per month (10 GB / 25 GB), BYO storage.
            </p>
            <div className="security-cta-actions">
              <a className="button button-primary" href="/security">Open Security <Arrow /></a>
              <a className="button button-ghost" href="/docs">Docs <Arrow /></a>
              <a className="button button-ghost" href="/login?next=/app">Start Cloud trial <Arrow /></a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
