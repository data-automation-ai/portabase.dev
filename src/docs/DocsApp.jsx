import React, { useEffect, useState } from 'react';
import './docs.css';
import { CLI_INSTALL, CLOUD_FREE, CLOUD_PLANS, planPriceRangeLabel } from '../lib/product.js';
import { DOCS_NAV, DOCS_TITLES, QUICKSTART_COMMANDS, resolveDocsSlug } from '../data/docs-site.js';
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
} from '../data/docs.js';

function Code({ children }) {
  return <pre className="docs-code" tabIndex={0}><code>{children}</code></pre>;
}

function Pager({ prev, next }) {
  return (
    <div className="docs-pager">
      {prev ? <a href={prev.href}><span>Previous</span>{prev.title}</a> : <span />}
      {next ? <a href={next.href} style={{ textAlign: 'right' }}><span>Next</span>{next.title}</a> : <span />}
    </div>
  );
}

function Introduction() {
  return (
    <>
      <p className="docs-lead">
        <strong>Supabase is an excellent product.</strong> Portabase is the Escape hatch —
        an open-source, customer-owned encrypted capsule you can still reach if the dashboard is locked.
        Platform backups cover the database volume. They do not take Storage object bytes, and they still sit behind the same account door.
      </p>
      <h2>What an escape package is</h2>
      <p>
        An escape package is a customer-owned encrypted capsule of <strong>database, Auth, Storage object bytes, and Edge Functions</strong>.
        It is not an official Supabase backup. Official backups remain valuable — they are not a way out if the account door does not open.
      </p>
      <h2>Free CLI vs Cloud</h2>
      <p>
        The engine is free and open source. You run it. Cloud is optional convenience: GUI, guided setup, telemetry,
        and (on paid plans) schedules. Same capsule engine either way. You bring the vault.
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Layer</th><th>Free open-source CLI</th><th>Portabase Cloud</th></tr>
          </thead>
          <tbody>
            <tr><td>Who runs capture</td><td>You, on a machine you control</td><td>Your Cloud Runner</td></tr>
            <tr><td>Keys</td><td>Stay on that machine</td><td>Browser seals keys to the runner only</td></tr>
            <tr><td>Control plane</td><td>None</td><td>Status and hashes — never keys or capsule bytes</td></tr>
            <tr><td>Scheduled service</td><td>Your cron</td><td>The free plan has no scheduled service. Paid $7 / $17 include schedules.</td></tr>
            <tr><td>Price</td><td>Free</td><td>Cloud Free, then {planPriceRangeLabel()}</td></tr>
          </tbody>
        </table>
      </div>
      <h2>Never-hold-keys / paid service blindness</h2>
      <p>
        On the free CLI, service-role keys, database URLs, and the capsule passphrase never leave your box.
        On Cloud, the browser seals keys to <em>your</em> runner for that job. This website and Cloud APIs are allowed
        job <strong>status and hashes</strong> only.
      </p>
      <div className="docs-callout honest">
        <strong>Honest limit.</strong> This is the designed path, with checks in this repo.
        It is not a third-party audited, proven-green isolation guarantee.
        If you need zero Portabase key path, use the free CLI on infrastructure only you operate.
      </div>
      <p>
        Independent product — not affiliated with Supabase, Inc.
        Source: <a href="/docs/threat-model">threat model</a>, <a href="https://github.com/DataAutomation-ai/portabase-CLI" target="_blank" rel="noreferrer">portabase-CLI</a>.
      </p>
    </>
  );
}

function Quickstart() {
  return (
    <>
      <p className="docs-lead">
        Install the free open-source CLI, capture a capsule, verify it, restore only into a <strong>new blank</strong> Supabase project.
        Commands below match <code>docs/FREE-CLI.md</code>, the repo README, and <code>docs/REPLAY.md</code>.
      </p>
      <h2>Install</h2>
      <Code>{QUICKSTART_COMMANDS.install}</Code>
      <p>
        Package: <a href={CLI_INSTALL.npmUrl} target="_blank" rel="noreferrer">{CLI_INSTALL.npmCommand}</a>.
        Source: <a href={CLI_INSTALL.githubCli} target="_blank" rel="noreferrer">DataAutomation-ai/portabase-CLI</a>.
        No Portabase account is required.
      </p>
      <h2>Capture → verify → restore</h2>
      <Code>{QUICKSTART_COMMANDS.capture}</Code>
      <p>
        Set <code>PORTABASE_ENCRYPTION_PASSPHRASE</code> on the machine you run (≥16 characters).
        Never paste it into this website. Restore <code>--execute</code> requires <code>--confirm-target</code> matching the new project ref.
      </p>
      <h2>Replay (proof on a new account)</h2>
      <p>Replay writes only into a new blank project — never the source.</p>
      <Code>{QUICKSTART_COMMANDS.replay}</Code>
      <h2>Optional</h2>
      <p>Limited sample from the README:</p>
      <Code>{QUICKSTART_COMMANDS.trial}</Code>
      <p>Existing size-fit flags only (<code>docs/CLOUD.md</code>) — no invented flags:</p>
      <Code>{QUICKSTART_COMMANDS.exclude}</Code>
      <p>From a clone of this repo you can use the local binary instead of the global install:</p>
      <Code>{QUICKSTART_COMMANDS.repoLocal}</Code>
      <div className="docs-callout danger">
        <strong>Proof lamp.</strong> A MATCH is a real dry-run or compare from this CLI or a Cloud Runner.
        Demo data and empty workspaces cannot turn the lamp green.
      </div>
    </>
  );
}

function CloudDocs() {
  const paid = Object.values(CLOUD_PLANS).map((p) => p.shortLabel).join(' · ');
  return (
    <>
      <p className="docs-lead">
        Cloud is not a second engine. The free CLI already captures, verifies, and restores.
        Cloud layers a dashboard, key-seal to your runner, and — on paid plans only — scheduled service.
        Source: <code>docs/CLOUD.md</code>, <code>docs/BILLING.md</code>.
      </p>
      <h2>Sign up</h2>
      <p>
        Sign in with hosted <strong>Supabase Auth</strong> — email, magic link, Google, or GitHub.
        After sign-in the SPA goes to <code>/dashboard</code>. Demo UI: <a href="/dashboard?demo=1">/dashboard?demo=1</a> (sample, not a live project).
      </p>
      <h2>Seal keys to the runner</h2>
      <p>
        You type secrets in the browser form. They are sealed to <em>your</em> Cloud Runner for that job.
        <code>POST /api/cloud/runners</code> and the rest of <code>/api/cloud/*</code> reject secret-shaped bodies.
        There is no SSH or get-key path from the control plane into a runner.
      </p>
      <Code>{`Browser  --seals keys-->  customer Cloud Runner
                              │
                              ├─ runs free engine
                              └─ one-way telemetry (status / hashes / sizes)
                                      │
                                      ▼
                         Portabase control plane
                         (lifecycle + job metadata only)`}</Code>
      <h2>Dashboard</h2>
      <p>
        Route <code>/dashboard</code> (also <code>/app</code>). The proof lamp stays <strong>RED</strong> until a real dry-run or compare reports MATCH.
        Empty signed-in workspaces do not seed fake jobs.
      </p>
      <h2>Table + bucket sizer</h2>
      <p>
        Before a Cloud job, the dashboard sizer shows per-table sizes and per-bucket sizes / object counts from the free engine
        doctor / size inventory. You selectively <strong>include or exclude</strong> tables and Storage buckets so the capsule fits
        Cloud Free 100 MB, $7 10 GB, or $17 25 GB. Anything omitted is called out as <strong>NOT COVERED</strong>.
        Table omit uses existing <code>--exclude-table-list</code>. No new CLI capture flags.
        The control plane stores the include list, size estimates, and job metadata / hashes — never keys or row bodies.
      </p>
      <h2>Cloud Free vs paid schedules</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th></th><th>Cloud Free</th><th>Paid ({paid})</th></tr>
          </thead>
          <tbody>
            <tr><td>Price</td><td>$0 · no card</td><td>Square after a 7-day trial (card on file)</td></tr>
            <tr><td>Projects</td><td>1</td><td>Plan caps, up to 12 agents</td></tr>
            <tr><td>Capsule usage Cloud may meter</td><td>Up to {CLOUD_FREE.storageCapLabel}</td><td>$7 · 10 GB · $17 · 25 GB</td></tr>
            <tr><td>Databases</td><td>1 project</td><td>$7 one database · $17 unlimited</td></tr>
            <tr><td>Capsules</td><td>Manual only</td><td>$7 · 1 / 24h · $17 · 3 / day</td></tr>
            <tr><td>Scheduled service</td><td><strong>The free plan has no scheduled service</strong></td><td>Yes · managed schedules</td></tr>
            <tr><td>SMS status</td><td>No</td><td>Optional on $17 — status only</td></tr>
            <tr><td>Table + bucket sizer</td><td>Yes · fit 100 MB</td><td>Yes · include/exclude before a job</td></tr>
            <tr><td>Vault</td><td>Customer-owned</td><td>Customer-owned</td></tr>
          </tbody>
        </table>
      </div>
      <div className="docs-callout honest">
        <strong>Designed offer.</strong> Cloud Free is 100 MB, dashboard and manual runs — <strong>no scheduled service</strong>.
        Live entitlement enforcement of that cap is not a completed production proof. Paid schedules are the {planPriceRangeLabel()} Square plans.
      </div>
    </>
  );
}

function ThreatModel() {
  return (
    <>
      <p className="docs-lead">
        Never-hold-keys is the product law. The control plane is blind to keys, passphrase, and capsule bytes.
        Source: <code>docs/CLOUD.md</code>, <code>docs/KEY-PROTECTION.md</code>, <code>docs/ZERO-KNOWLEDGE.md</code>.
      </p>
      <h2>Who may hold what</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Party</th><th>May hold</th><th>Must not hold</th></tr>
          </thead>
          <tbody>
            <tr><td>Customer browser</td><td>Source keys, passphrase, destination credentials (briefly, in-tab)</td><td>—</td></tr>
            <tr><td>Cloud Runner</td><td>Sealed keys for the job window; ephemeral spool</td><td>Long-term capsule vault</td></tr>
            <tr><td>Portabase control plane</td><td>Status, phase, timestamps, sizes, hashes, destination kind</td><td>Keys, passphrase, capsule bytes, row bodies, function source</td></tr>
            <tr><td>SMS (optional on $17)</td><td>Status string + job id</td><td>Keys, capsule bytes, customer data</td></tr>
          </tbody>
        </table>
      </div>
      <h2>Crypto (open source)</h2>
      <p>
        Capsules use readable code in <code>utility/capsule-crypto.mjs</code>: scrypt + AES-256-GCM.
        Passphrase ≥ 16 characters. There is no Cloud function that accepts a passphrase or returns plaintext.
      </p>
      <div className="docs-callout honest">
        <strong>Not proven-green.</strong> Cloud isolation is designed, with allowlist checks in this repo.
        It is not a completed isolation audit. Standalone CLI on your infrastructure is the only posture with no Portabase process in the crypto path.
      </div>
    </>
  );
}

function ProvenVsNot() {
  return (
    <>
      <p className="docs-lead">
        A recovery tool is only useful if you know exactly what is automated inside the encrypted capsule and what requires your manual action during cutover into a new Supabase account.
      </p>
      <h2>1 · What Portabase captures, encrypts, and restores automatically</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Recovery layer</th><th>What is guaranteed by the engine</th><th>How it is verified</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Postgres schema &amp; data</strong></td>
              <td>Full dump of tables, views, sequences, functions, triggers, RLS policies, and rows (including subscriber, membership, and billing tables).</td>
              <td>Restored into a blank target project in a separate Supabase account and verified with per-table row-count parity checks.</td>
            </tr>
            <tr>
              <td><strong>Auth user directory</strong></td>
              <td><code>auth.users</code> and <code>auth.identities</code> (UUIDs, emails, phone numbers, metadata, and provider links) so foreign keys in your public tables never break.</td>
              <td>Verified against <code>auth-inventory.json</code> during preflight and post-restore parity checks.</td>
            </tr>
            <tr>
              <td><strong>Storage buckets &amp; object bytes</strong></td>
              <td>Bucket definitions, public/private flags, MIME limits, RLS policies, and the actual binary files inside every included bucket.</td>
              <td>SHA-256 checksums and object counts verified before sealing and after upload to the target project.</td>
            </tr>
            <tr>
              <td><strong>Edge Function source code</strong></td>
              <td>TypeScript / JavaScript entrypoints, import maps, and per-function <code>verify_jwt</code> configuration.</td>
              <td>Captured into the capsule and redeployed via the Supabase Management API to the target project.</td>
            </tr>
            <tr>
              <td><strong>Client-side AES-256-GCM encryption</strong></td>
              <td>Capsules are sealed locally using <code>scrypt</code> key derivation + <code>AES-256-GCM</code> authenticated encryption before touching your vault.</td>
              <td><code>portabase verify</code> validates the manifest signature and every artifact SHA-256 digest; wrong passphrases fail closed.</td>
            </tr>
            <tr>
              <td><strong>Customer-owned vault connectors</strong></td>
              <td>Direct upload to Google Drive (API v3), Dropbox (API v2), AWS S3, rclone remotes, or local disk.</td>
              <td>Capsules live in storage you control outside Supabase; Portabase.dev never stores your capsule bytes or keys.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>2 · What requires your action during cutover (Platform &amp; operational limits)</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Boundary</th><th>Why it is not automatic</th><th>What you must do</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Edge Function secret values &amp; Vault keys</strong></td>
              <td>Supabase's Management API returns only secret names and SHA-256 digests — never plaintext values.</td>
              <td>Store non-regenerable secrets in an external vault and re-inject them with <code>supabase secrets set</code> or our <a href="/docs/manual-contingency">Python contingency bridge</a>.</td>
            </tr>
            <tr>
              <td><strong>OAuth redirect URIs &amp; provider secrets</strong></td>
              <td>Google, GitHub, and Apple OAuth callbacks are bound to <code>https://&lt;PROJECT_REF&gt;.supabase.co/auth/v1/callback</code>.</td>
              <td>Update the callback URL in your OAuth provider console to your new project ref (see <a href="/docs/auth-cutover">Auth cutover</a>).</td>
            </tr>
            <tr>
              <td><strong>Stripe / Square webhook URLs &amp; app env vars</strong></td>
              <td>External services still point to your old project URL until updated.</td>
              <td>Point your billing webhooks and hosting env vars (Netlify, Vercel, Cloudflare) to the new project's URL and anon/service keys.</td>
            </tr>
            <tr>
              <td><strong>Recovery speed (Warm/Cold vs. Hot)</strong></td>
              <td>Portabase is an encrypted cross-account escape capsule and restore engine, not an active-active millisecond database proxy.</td>
              <td>Plan for a 15–60 minute guarded restore and DNS/env cutover window into your new Supabase account.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="docs-callout danger">
        <strong>Proof lamp (Readiness status).</strong> The dashboard readiness lamp stays <strong>RED</strong> until a real restore preflight, dry-run, or cross-account replay reports <strong>MATCH</strong>. Demo data and unverified backups cannot turn the lamp green.
      </div>
    </>
  );
}

function CliReference({ Arrow }) {
  return (
    <>
      <p className="docs-lead">
        Fill-missing, restore order, drift, destinations, and related CLI surfaces already documented on this site.
        Cloud remains optional telemetry. Independent product — not affiliated with Supabase, Inc.
      </p>
      <h2 id="install">Install</h2>
      <Code>{installCopy.command}</Code>
      <ol>
        {installCopy.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <h2 id="fill-missing">{fillMissing.title}</h2>
      <p>{fillMissing.summary}</p>
      <ul>{fillMissing.points.map((item) => <li key={item}>{item}</li>)}</ul>
      <Code>{`portabase restore --fill-missing --writers 1
# default --writers is 1
# not incremental sync — absent-only Storage/DB fill`}</Code>
      <h2 id="restore-order">Restore order</h2>
      <p>Replay into a <strong>new blank</strong> Supabase project. Never the source.</p>
      <ol>
        {restoreOrder.map((step) => <li key={step.id}><strong>{step.title}.</strong> {step.body}</li>)}
      </ol>
      <h2 id="export-manifest">{exportManifest.title}</h2>
      <p>{exportManifest.summary}</p>
      <h2 id="report-drift">{reportDrift.title}</h2>
      <p>{reportDrift.summary}</p>
      <h2 id="telemetry">{telemetryUi.title}</h2>
      <p>{telemetryUi.summary}</p>
      <h2 id="open-capsule">{openCapsule.title}</h2>
      <p>{openCapsule.summary}</p>
      <h2 id="live-supabase">{liveSupabaseViewer.title}</h2>
      <p>{liveSupabaseViewer.summary}</p>
      <h2 id="destinations">Destinations</h2>
      <ul>
        {destinationsGuide.map((d) => <li key={d.id}><strong>{d.title}.</strong> {d.body}</li>)}
      </ul>
      <p>
        <a href="/security">Security &amp; trust {Arrow ? <Arrow /> : '↗'}</a>
        {' · '}
        <a href="/cloud">Cloud pricing</a>
      </p>
    </>
  );
}

function Keepalive() {
  return (
    <>
      <p className="docs-lead">
        Supabase pauses free projects after about 7 days of inactivity. A tiny scheduled ping — run from
        a machine you control — keeps your own project awake. The database password never leaves your box;
        the passwordless variant uses only the publishable anon key.
      </p>
      <h2>Option A — SQL ping (most certain signal)</h2>
      <p>
        Needs <code>psql</code> and your database connection string. Run daily — weekly is one missed run from paused.
      </p>
      <Code>{`SELECT 'keepalive', now();`}</Code>
      <p>Linux / macOS cron, daily 6 AM (<code>crontab -e</code>):</p>
      <Code>{`SUPABASE_DB_URL='postgresql://postgres:YOUR-PASSWORD@db.YOUR-REF.supabase.co:5432/postgres'
0 6 * * * psql "$SUPABASE_DB_URL" -c "SELECT 'keepalive', now();" >/dev/null 2>&1`}</Code>
      <p>Windows — save as <code>keepalive.ps1</code>, then schedule it:</p>
      <Code>{`$env:PGPASSWORD = 'YOUR-PASSWORD'
& psql 'postgresql://postgres@db.YOUR-REF.supabase.co:5432/postgres' -c "SELECT 'keepalive', now();"`}</Code>
      <Code>{`schtasks /create /tn SupabaseKeepalive /tr "powershell -NoProfile -File C:/path/to/keepalive.ps1" /sc daily /st 06:00`}</Code>
      <h2>Option B — passwordless anon ping</h2>
      <p>
        A sacrificial single-row table, readable by <code>anon</code> for one purpose only: outside
        connectivity. <code>anon</code> is the public internet — anyone with your project ref and
        publishable key can read this table, so it holds exactly one dummy row and nothing else.
      </p>
      <Code>{`create table if not exists keepalive (id int primary key, ping text);
alter table keepalive enable row level security;
-- Justification: dummy single-row table, no user or customer data.
-- Sole purpose is the outside keepalive ping below.
create policy "keepalive public read"
  on keepalive for select using (true);
insert into keepalive values (1, 'ok') on conflict do nothing;`}</Code>
      <div className="docs-callout danger">
        <strong>Never widen this pattern.</strong> RLS stays on with zero public policies on every
        other table. Never add real columns to <code>keepalive</code>, never copy the open policy
        onto another table, and never put the service-role key in a ping script.
      </div>
      <p>Prove it with the adversarial check — only this table answers as <code>anon</code>:</p>
      <Code>{`curl -s "https://YOUR-REF.supabase.co/rest/v1/keepalive?select=id&limit=1" -H "apikey: YOUR-ANON-KEY"`}</Code>
      <p>Schedule the curl the same way as Option A (cron daily, or <code>schtasks</code> on Windows). Daily, not weekly.</p>
      <h2>Optional: lock down egress on Windows</h2>
      <p>
        If the pinger or runner lives on your Windows box, keep it silent by default and open a
        backup window only while a capsule is being created. One honest limit first: Windows
        Defender Firewall filters by port and IP, not by hostname, so port 443 covers Supabase
        and your vault alike during the window — pair it with the runner log, which names every
        destination. Outside the window, both programs are blocked from initiating anything.
      </p>
      <Code>{`# One-time setup: rules start DISABLED (silent by default)
New-NetFirewallRule -DisplayName "Portabase node 443" -Direction Outbound -Program "C:/Program Files/nodejs/node.exe" -Protocol TCP -RemotePort 443 -Action Allow -Enabled False
New-NetFirewallRule -DisplayName "Portabase psql postgres" -Direction Outbound -Program "C:/Program Files/PostgreSQL/16/bin/psql.exe" -Protocol TCP -RemotePort 5432,6543 -Action Allow -Enabled False
New-NetFirewallRule -DisplayName "Portabase node block rest" -Direction Outbound -Program "C:/Program Files/nodejs/node.exe" -Action Block -Enabled False
New-NetFirewallRule -DisplayName "Portabase psql block rest" -Direction Outbound -Program "C:/Program Files/PostgreSQL/16/bin/psql.exe" -Action Block -Enabled False
# Open the backup window (Supabase + vault only), run the capsule, close it
Enable-NetFirewallRule -DisplayName "Portabase *"
portabase backup
Disable-NetFirewallRule -DisplayName "Portabase *"`}</Code>
      <p>
        Adjust the install paths to yours, then verify with <code>Get-NetFirewallRule -DisplayName "Portabase *"</code>.
        If a capture fails inside the window, the block rule caught something new — check the runner log
        before widening anything.
      </p>
      <h2>Honest limits</h2>
      <p>
        A ping prevents the 7-day pause. It does not prevent deletion of a project left unrestored for
        about 90 days, and if Supabase ever narrows what counts as activity, the SQL ping (Option A)
        is the signal most likely to keep counting.
      </p>
    </>
  );
}
function RlsCheck() {
  return (
    <>
      <p className="docs-lead">
        Supabase ships with the door unlocked and the instructions assume you know that.
        The publishable <code>anon</code> key is designed to live in frontend code — so anyone
        can use it. What keeps your data private is <strong>row level security (RLS)</strong> on
        every table. The villain here is the default, never you: new tables happily answer
        the public internet until RLS and policies say otherwise.
      </p>
      <h2>What the anon key is</h2>
      <p>
        The <code>anon</code> key is a public, publishable credential. It ships inside your
        JavaScript bundle, mobile app, or any client that talks to Supabase directly.
        Treat it as <strong>already known to the whole internet</strong> — because for a
        shipped frontend, it is. Reading with the anon key is the expected path, not a hack.
      </p>
      <h2>Why RLS-off means open</h2>
      <p>
        Without RLS enabled (plus a policy allowing only what you intend), a table served
        through the auto-generated REST API answers anonymous requests the same way it
        answers yours. No login bypass is needed — the default posture is readable.
        Enabling RLS with zero public policies closes the table; each policy you add
        re-opens exactly the slice you name.
      </p>
      <div className="docs-callout danger">
        <strong>Never widen the keepalive pattern.</strong> The single-row public-read table in{' '}
        <a href="/docs/keepalive">the keepalive guide</a> is the one deliberate exception.
        Never copy its open policy onto a table that holds user or customer data.
      </div>
      <h2>Three exposure checks</h2>
      <p>Run these against your own project. They read metadata and answer one question: what can <code>anon</code> see?</p>
      <h3>1 · Which tables have RLS off</h3>
      <Code>{`select c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;`}</Code>
      <p>Every row with <code>rls_enabled = false</code> answers anonymous requests unless another layer blocks it. That list is the fix list.</p>
      <h3>2 · Which policies exist per table</h3>
      <Code>{`select tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;`}</Code>
      <p>Tables missing from this list have no policy at all. A policy with <code>using (true)</code> on a real data table is an open door with a label — narrow it or remove it.</p>
      <h3>3 · What anon actually gets (adversarial read)</h3>
      <Code>{`curl -s "https://YOUR-REF.supabase.co/rest/v1/YOUR-TABLE?select=id&limit=1" -H "apikey: YOUR-ANON-KEY"`}</Code>
      <p>
        This is the internet&apos;s view of one table: project ref plus publishable key, no login.
        Repeat it per table. A <code>200</code> with rows on a table you assumed was private is the finding.
        Expect a denial (or empty-by-policy) everywhere except the sacrificial keepalive row.
      </p>
      <h2>Fix order</h2>
      <p>
        Enable RLS on every data table, add the narrowest policy each feature needs, then re-run
        all three checks. Keep the proof: the queries above should show RLS on everywhere, policies
        only where intended, and anonymous reads denied on everything but the dummy row.
      </p>
    </>
  );
}
function RestoreTargets() {
  return (
    <>
      <p className="docs-lead">
        Every Portabase restore lands in a <strong>new blank</strong> project — never the source.
        The one decision is whose account that project lives in. The two options fail differently,
        so pick by what you are recovering from.
      </p>
      <h2>Same account (new blank project, your login)</h2>
      <p><strong>Advantages:</strong> fastest path — same org, same billing, same region, no new
        signup. Ideal for test refreshes, trying a restore, or recovering from your own mistake
        (bad migration, deleted rows) while your account is healthy.</p>
      <p><strong>Disadvantages:</strong> shares the fate of the account. If the account is banned,
        billing-locked, or under investigation, a new project inside it may be unreachable or
        frozen too. This is a rewind button, not an escape hatch.</p>
      <h2>Different account (escape restore)</h2>
      <p><strong>Advantages:</strong> survives anything that happens to the source account — ban,
        billing dispute, lost credentials. The business keeps running under a login the incident
        cannot touch. This is the contingency Portabase exists for.</p>
      <p><strong>Disadvantages:</strong> slower to set up — a second account, fresh secrets and
        API keys, possibly a different region or plan limits (a free target caps at 500 MB).
        Anything outside the capsule (DNS, custom domains, third-party integrations) must be
        re-pointed by hand.</p>
      <h2>Choosing the region</h2>
      <p>The target is a project you create, so its region is your choice at creation time. Paid
        Supabase plans offer the widest region set, so a restore can deliberately re-home the
        project — closer to your users, or out of a region you no longer trust. This is a
        restore-time move, not live multi-region replication: the project runs in one region
        until you replay again.</p>
      <div className="docs-callout honest">
        <strong>Rule of thumb.</strong> Recovering from your own error with a healthy account:
        same account. Recovering from anything done <em>to</em> your account: different account.
        When in doubt, restore to a different account — a capsule that escapes is never the
        wrong choice.
      </div>
    </>
  );
}

function DisasterRecovery() {
  return (
    <>
      <p className="docs-lead">
        The disaster already happened — the account is locked, banned, or gone, and you have a
        capsule. This is the runbook: what to do now, in order, and the post-mortem that makes the
        next one faster.
      </p>
      <h2>1 · First hour — triage, don't make it worse</h2>
      <p>
        Freeze deploys and migrations. Start a written timeline now — you will need it for the
        post-mortem and for any support ticket. Confirm the blast radius: can you log in at all,
        is it one project or the whole account, is there mail from Supabase? If the account is
        healthy and you are recovering from your own mistake, use a same-account restore instead —
        see <a href="/docs/restore-targets">restore targets</a>. Everything below assumes the
        account itself is the problem.
      </p>
      <h2>2 · Create the lifeboat project</h2>
      <p>
        New blank project in an account the incident cannot touch. Pick the region deliberately —
        you are re-creating the project anyway, so put it where you want it (a free target works if
        the capsule is ≤ 500 MB total). Create <strong>nothing</strong> in it: replay refuses a
        non-blank target, which is your guarantee you are not overwriting someone else's data.
      </p>
      <h2>3 · Replay the capsule</h2>
      <Code>{`export PORTABASE_ENCRYPTION_PASSPHRASE='…'
export PORTABASE_TARGET_PROJECT_REF='newprojectref0000001'
export PORTABASE_TARGET_SUPABASE_URL='https://newprojectref0000001.supabase.co'
export PORTABASE_TARGET_SERVICE_ROLE_KEY='…'
export PORTABASE_TARGET_DB_URL='postgresql://…'
export SUPABASE_ACCESS_TOKEN='…'   # for Edge Functions deploy

# No-write check first: decrypts, validates, confirms the target is blank
portabase replay --capsule ./portabase-capsules/<id> --confirm-target newprojectref0000001 --preflight

# Full restore into the new project
portabase replay --capsule ./portabase-capsules/<id> --confirm-target newprojectref0000001`}</Code>
      <p>
        <code>--confirm-target</code> must match <code>PORTABASE_TARGET_PROJECT_REF</code> exactly —
        that friction is deliberate. Replay decrypts the capsule (AES-256-GCM), verifies checksums,
        then restores the layers: database, Storage object bytes, and Edge Functions via the
        capsule's redeploy scripts. On Cloud, the console's Replay flow walks the same steps and
        stores only refs and step status — never target keys.
      </p>
      <h2>4 · Verify before you announce anything</h2>
      <p>
        Check the read-back proof, then spot-check with your own eyes: row counts on the tables
        that pay you, Storage object counts against the capsule inventory, one real sign-in path.
        Compare the user list against <code>auth-inventory.json</code>. Only after this do you tell
        anyone the service is back.
      </p>
      <h2>5 · Auth cutover — the manual layer</h2>
      <p>
        Auth configuration never travels in any capsule, ours or anyone else's. Providers, redirect
        URLs, SMTP, and MFA are re-created by hand on the new project, and every user either signs
        in again (OAuth) or resets a password (email). Full walkthroughs for both novice and expert:
        <a href="/docs/auth-cutover"> Auth cutover</a>.
      </p>
      <h2>6 · Re-point everything outside the capsule</h2>
      <p>
        The capsule restores your project, not your perimeter. New project URL and new anon /
        service-role keys go into env files, CI, and your secrets manager. Then the external
        pointers: custom-domain DNS, payment-webhook endpoints (Square/Stripe dashboards),
        OAuth redirect URIs at each provider, and any mobile or desktop build that pinned the old
        URL — that one ships as an app update, so start it early.
      </p>
      <h2>What the capsule does not cover — the honest list</h2>
      <p>
        The capsule is database, Storage object bytes, Edge Function source, and the Auth
        inventory. Supabase keeps adding services that live outside those layers, and pretending
        otherwise would be the exact overclaim this product exists to fight:
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Outside the capsule</th><th>Why</th><th>What to do</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Vault secrets</strong> (pgsodium)</td>
              <td>The dump carries ciphertext only; the per-project root key lives outside the database</td>
              <td>Fetch the root key while the project is healthy (Management API <code>/pgsodium</code>) and store it in your own vault, next to the capsule passphrase</td>
            </tr>
            <tr>
              <td><strong>Edge Function secret values</strong></td>
              <td>The API returns names and digests only — plaintext is unrecoverable by design</td>
              <td>Keep your own copy of each value; the capsule's manifest lists the names you must re-enter</td>
            </tr>
            <tr>
              <td><strong>Vector Buckets</strong> (Storage vector indexes)</td>
              <td>Vectors live in a separate vector store, not in Postgres and not in ordinary Storage objects</td>
              <td>If you use them, keep your own export or be able to re-embed from source data</td>
            </tr>
            <tr>
              <td><strong>Analytics Buckets</strong> (Iceberg, alpha)</td>
              <td>Parquet files in a separate analytics store; only a catalog row sits in Postgres</td>
              <td>Usually re-derivable from the database the capsule does capture — verify for your case</td>
            </tr>
            <tr>
              <td><strong>Replication / ETL destinations</strong></td>
              <td>Publications ride along in the dump; pipeline and destination credentials do not</td>
              <td>Re-create pipelines by hand; destination creds come from your own records</td>
            </tr>
            <tr>
              <td><strong>Project settings</strong> — custom domains, network restrictions, SSL, PITR, log drains, read replicas</td>
              <td>Control-plane config, not data</td>
              <td>Re-create on the lifeboat project; screenshot these pages today so cutover is transcription, not archaeology</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        For a complete breakdown of <strong>non-regenerable vs. regenerable secrets</strong>, why subscriber lists and memberships <em>are</em> preserved, and how to mirror write-only secrets into an external secret vault before an incident, see <a href="/docs/manual-contingency">Manual effort contingency</a>.
      </p>
      <h2>7 · Post-mortem — while it's fresh</h2>
      <p>
        Write it within a day and store it next to the capsule: the timeline (detected → lifeboat
        created → replay green → cutover), what failed versus what held, and two numbers you now
        know for real instead of guessing — the capsule's age at disaster (your actual RPO) and the
        minutes from decision to green replay (your actual RTO). Close with what changes: capture
        cadence, vault locations, and the date of your next drill.
      </p>
      <div className="docs-callout honest">
        <strong>Restore under pressure is when typos happen.</strong> A replay you have rehearsed
        on a quiet afternoon takes a fraction of the time and none of the panic. The proof lamp
        stays red until a real replay or compare reports MATCH — treat that as your drill
        reminder, not decoration.
      </div>
    </>
  );
}

function ManualContingency() {
  return (
    <>
      <p className="docs-lead">
        Certain runtime secrets and control-plane settings cannot be exported through standard backup APIs.{' '}
        <strong>This is not a limitation of Portabase — it is a deliberate, built-in security architecture within Supabase</strong>{' '}
        (and even the official Supabase CLI, Management API, and MCP servers enforce the exact same boundary).
      </p>
      <div className="docs-callout danger">
        <strong>Important — Not every restore is 100% turnkey out of the box:</strong> You must be aware that you will{' '}
        <strong>not, in all cases, receive a turnkey-ready database or project on the restored side</strong> without addressing the items below.
        Your data, tables, subscriber lists, Storage files, and Edge Function code will be intact, but your application will not run end-to-end
        until missing secret values, Vault keys, and external provider callbacks are re-applied.
      </div>
      <h2>1 · What IS copied automatically (including subscribers &amp; memberships)</h2>
      <p>
        Everything stored as database rows, Storage object bytes, Auth user records, or Edge Function code travels inside your encrypted capsule:
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Asset category</th><th>Copied in capsule?</th><th>How it restores</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Subscriber lists &amp; memberships</strong></td>
              <td><strong>Yes — 100%</strong></td>
              <td>All tables in <code>public.*</code> and custom schemas (<code>subscribers</code>, <code>memberships</code>, <code>subscriptions</code>, <code>organizations</code>, <code>entitlements</code>, Stripe/Square customer IDs, billing tiers) are standard Postgres rows and restore intact.</td>
            </tr>
            <tr>
              <td><strong>Auth user directory &amp; UUIDs</strong></td>
              <td><strong>Yes</strong></td>
              <td><code>auth.users</code> and <code>auth.identities</code> (user UUIDs, emails, phone numbers, <code>raw_user_meta_data</code>, <code>raw_app_meta_data</code>) are captured so foreign keys in your membership tables never break.</td>
            </tr>
            <tr>
              <td><strong>Storage buckets &amp; object bytes</strong></td>
              <td><strong>Yes</strong></td>
              <td>Bucket definitions, RLS policies, and the actual binary files inside every selected bucket.</td>
            </tr>
            <tr>
              <td><strong>Edge Function source code</strong></td>
              <td><strong>Yes</strong></td>
              <td>TypeScript / JavaScript entrypoints, import maps, and per-function <code>verify_jwt</code> config.</td>
            </tr>
            <tr>
              <td><strong>Edge Function secret <em>names</em></strong></td>
              <td><strong>Names only (by default)</strong></td>
              <td>The capsule manifest records every secret key name (e.g. <code>STRIPE_SECRET_KEY</code>, <code>APP_ENCRYPTION_KEY</code>) so you have an exact checklist of what to re-inject.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>2 · Why Supabase blocks standard secret exports — and what CAN still be read</h2>
      <p>
        Supabase separates secrets into two distinct layers, and understanding how each layer works determines how you back them up:
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Secret layer</th><th>Why standard dumps miss it</th><th>Can plaintext be read while the source project is alive?</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>1. Postgres Vault (<code>vault.secrets</code> / <code>pgsodium</code>)</strong></td>
              <td>
                <code>pg_dump</code> only dumps the raw table <code>vault.secrets</code> (which holds ciphertext) and skips views. The root decryption key lives on the Supabase host outside the SQL dump.
              </td>
              <td>
                <strong>YES — via SQL view.</strong> While your source database is reachable via <code>SUPABASE_DB_URL</code>, querying <code>SELECT name, description, secret FROM vault.decrypted_secrets</code> decrypts and returns the <strong>actual plaintext secret values</strong> in memory, which can then be re-inserted into the target database via <code>vault.create_secret()</code>.
              </td>
            </tr>
            <tr>
              <td><strong>2. Edge Function secrets (<code>supabase secrets set</code>)</strong></td>
              <td>
                The Supabase Management API (<code>GET /v1/projects/&#123;ref&#125;/secrets</code>) is write-only by design: it returns the secret <code>name</code> and a one-way digest, never the plaintext string.
              </td>
              <td>
                <strong>Only from inside the Edge runtime or your local <code>.env</code> vault.</strong> Outside the runtime, the API never returns plaintext. Inside a running Edge Function, <code>Deno.env.toObject()</code> holds the live plaintext values.
              </td>
            </tr>
            <tr>
              <td><strong>3. Auth provider secrets &amp; SMTP credentials</strong></td>
              <td>
                Stored in the Supabase control plane per project ref; OAuth callback URLs are tied to <code>https://&lt;ref&gt;.supabase.co/auth/v1/callback</code>.
              </td>
              <td>
                Auth config settings can be read via <code>GET /v1/projects/&#123;ref&#125;/config/auth</code> and pushed to the target via <code>PATCH /v1/projects/&#123;target_ref&#125;/config/auth</code>, though redacted provider secrets must come from your external vault.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>3 · Non-regenerable vs. regenerable secrets</h2>
      <p>
        Not all secrets carry the same blast radius. Your manual contingency plan should separate secrets into two buckets today:
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Category</th><th>Examples</th><th>If lost during a lockout</th><th>Required contingency</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Non-regenerable (Irreplaceable)</strong></td>
              <td>
                Application column-encryption keys (<code>APP_ENCRYPTION_KEY</code>, AES/Fernet keys),{' '}
                <code>pgsodium</code> / Vault secrets, customer-supplied webhook or partner keys you cannot self-issue, custom signing keys
              </td>
              <td>
                <strong>Permanent data loss of encrypted columns or integrations.</strong> Even with a 100% intact Postgres dump, ciphertext cannot be decrypted without the original key.
              </td>
              <td>
                <strong>Mandatory external vaulting before any incident.</strong> Store a copy in 1Password, Bitwarden, AWS Secrets Manager, Doppler, or extract them with the Python script below while healthy.
              </td>
            </tr>
            <tr>
              <td><strong>Regenerable (Rotatable)</strong></td>
              <td>
                Stripe / Square API keys &amp; webhook signing secrets, Resend / Postmark / SendGrid SMTP keys, OpenAI / Anthropic API keys, Google / GitHub OAuth client secrets
              </td>
              <td>
                <strong>Temporary downtime during cutover.</strong> You can log into Stripe, Square, Google Cloud, or Resend, roll a new key, and inject it into the lifeboat project.
              </td>
              <td>
                Store in your external secret vault for a 2-minute cutover, or document the provider dashboards where new keys must be rolled during recovery.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>4 · Python script: Extract, hold, and restore Vault secrets &amp; runtime config</h2>
      <p>
        Run the Python script below on your own machine while your source project is healthy. It connects directly to your source Postgres database and the Supabase Management API to:
      </p>
      <p>
        <strong>1. Extract</strong> every plaintext secret from <code>vault.decrypted_secrets</code>, capture your project's Auth configuration, list all Edge Function secret names, and merge them with your local <code>.env</code> secret values into a single local contingency file (<code>contingency-bundle.json</code>).<br />
        <strong>2. Restore</strong> those exact Vault secrets (via <code>vault.create_secret</code>), Edge Function secrets (via the Management API), and Auth settings directly into your new target Supabase project.
      </p>
      <Code>{`#!/usr/bin/env python3
"""
portabase_contingency_bridge.py
Extracts plaintext Supabase Vault secrets (vault.decrypted_secrets), Edge Function
secret names + local .env values, and Auth config from a source project, holds them
in a local JSON bundle, and restores them into a new target Supabase project.

Install deps:  pip install psycopg[binary] requests python-dotenv
Usage:
  1. Extract while healthy:
     python portabase_contingency_bridge.py extract \\
       --source-db-url "postgresql://postgres:[PASS]@db.[SOURCE_REF].supabase.co:5432/postgres" \\
       --source-ref "[SOURCE_REF]" \\
       --access-token "sbp_..." \\
       --env-file ".env.production" \\
       --out "contingency-bundle.json"

  2. Restore into new target project:
     python portabase_contingency_bridge.py restore \\
       --target-db-url "postgresql://postgres:[PASS]@db.[TARGET_REF].supabase.co:5432/postgres" \\
       --target-ref "[TARGET_REF]" \\
       --access-token "sbp_..." \\
       --bundle "contingency-bundle.json"
"""
import argparse
import json
import pathlib
import requests
import psycopg
from dotenv import dotenv_values

API_BASE = "https://api.supabase.com/v1"


def extract_bundle(args):
    headers = {"Authorization": f"Bearer {args.access_token}"}
    local_env = dotenv_values(args.env_file) if args.env_file and pathlib.Path(args.env_file).exists() else {}

    # 1. Extract plaintext secrets from Postgres vault.decrypted_secrets
    vault_secrets = []
    with psycopg.connect(args.source_db_url) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.views
                    WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
                );
            """)
            if cur.fetchone()[0]:
                cur.execute("SELECT name, description, secret FROM vault.decrypted_secrets WHERE secret IS NOT NULL;")
                for name, description, secret in cur.fetchall():
                    vault_secrets.append({
                        "name": name,
                        "description": description or "",
                        "secret": secret,
                    })

    # 2. Fetch Edge Function secret names from Management API & pair with local .env values
    resp = requests.get(f"{API_BASE}/projects/{args.source_ref}/secrets", headers=headers, timeout=30)
    resp.raise_for_status()
    SYSTEM_PREFIXES = ("SUPABASE_",)
    edge_secrets = {}
    missing_edge_secrets = []
    for item in resp.json():
        key = item.get("name", "")
        if key.startswith(SYSTEM_PREFIXES):
            continue
        if key in local_env and local_env[key]:
            edge_secrets[key] = local_env[key]
        else:
            missing_edge_secrets.append(key)

    # 3. Fetch Auth configuration (Site URL, redirect URLs, provider toggles)
    auth_resp = requests.get(f"{API_BASE}/projects/{args.source_ref}/config/auth", headers=headers, timeout=30)
    auth_config = auth_resp.json() if auth_resp.ok else {}

    bundle = {
        "source_project_ref": args.source_ref,
        "vault_decrypted_secrets": vault_secrets,
        "edge_function_secrets": edge_secrets,
        "missing_edge_secret_names": missing_edge_secrets,
        "auth_config": {
            "site_url": auth_config.get("site_url"),
            "uri_allow_list": auth_config.get("uri_allow_list"),
            "jwt_exp": auth_config.get("jwt_exp"),
            "disable_signup": auth_config.get("disable_signup"),
        },
    }
    out_path = pathlib.Path(args.out)
    out_path.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    print(f"[OK] Saved {len(vault_secrets)} Vault secrets and {len(edge_secrets)} Edge secrets to {out_path}")
    if missing_edge_secrets:
        print(f"[ACTION NEEDED] Populate plaintext values in {out_path} for: {', '.join(missing_edge_secrets)}")


def restore_bundle(args):
    headers = {
        "Authorization": f"Bearer {args.access_token}",
        "Content-Type": "application/json",
    }
    bundle = json.loads(pathlib.Path(args.bundle).read_text(encoding="utf-8"))

    # 1. Restore Postgres Vault secrets via vault.create_secret(...)
    vault_items = bundle.get("vault_decrypted_secrets", [])
    if vault_items:
        with psycopg.connect(args.target_db_url) as conn:
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault CASCADE;")
                for item in vault_items:
                    cur.execute(
                        """
                        DELETE FROM vault.secrets WHERE name = %s;
                        SELECT vault.create_secret(%s, %s, %s);
                        """,
                        (item["name"], item["secret"], item["name"], item.get("description", "")),
                    )
            conn.commit()
        print(f"[OK] Restored {len(vault_items)} plaintext secrets into target vault.secrets")

    # 2. Push Edge Function secrets via Management API
    edge_secrets = bundle.get("edge_function_secrets", {})
    payload = [{"name": k, "value": v} for k, v in edge_secrets.items() if v]
    if payload:
        r = requests.post(f"{API_BASE}/projects/{args.target_ref}/secrets", headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        print(f"[OK] Restored {len(payload)} Edge Function secrets to project {args.target_ref}")

    # 3. Restore non-empty Auth URL settings
    auth_patch = {k: v for k, v in bundle.get("auth_config", {}).items() if v is not None}
    if auth_patch:
        r = requests.patch(f"{API_BASE}/projects/{args.target_ref}/config/auth", headers=headers, json=auth_patch, timeout=30)
        r.raise_for_status()
        print(f"[OK] Applied Auth URL/session config to project {args.target_ref}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Portabase Contingency Secret Bridge")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ext = sub.add_parser("extract")
    p_ext.add_argument("--source-db-url", required=True)
    p_ext.add_argument("--source-ref", required=True)
    p_ext.add_argument("--access-token", required=True)
    p_ext.add_argument("--env-file", default=".env.production")
    p_ext.add_argument("--out", default="contingency-bundle.json")

    p_res = sub.add_parser("restore")
    p_res.add_argument("--target-db-url", required=True)
    p_res.add_argument("--target-ref", required=True)
    p_res.add_argument("--access-token", required=True)
    p_res.add_argument("--bundle", default="contingency-bundle.json")

    parsed = parser.parse_args()
    if parsed.cmd == "extract":
        extract_bundle(parsed)
    else:
        restore_bundle(parsed)`}</Code>
      <h2>5 · Final cutover checklist (re-injecting secrets on the lifeboat project)</h2>
      <p>
        If you store your Edge Function secrets in a standard <code>.env</code> file inside your external vault (1Password, Bitwarden, Doppler, AWS Secrets Manager), you can also push them with the Supabase CLI in one line:
      </p>
      <Code>{`# Pull your production secrets from your external vault (1Password / Doppler / AWS SM)
# and push them to the new lifeboat project in a single batch:
supabase secrets set --project-ref newprojectref0000001 --env-file ./vault-production.env`}</Code>
      <p>
        Then complete the remaining external pointer updates so your restored project becomes turnkey:
      </p>
      <p>
        <strong>1 · Billing &amp; webhook endpoints (Stripe / Square).</strong> Your subscriber and membership tables are already restored in Postgres. In your Stripe or Square dashboard, update the webhook destination URL to <code>https://newprojectref0000001.supabase.co/functions/v1/your-webhook</code> and set the new signing secret via <code>supabase secrets set</code>.
      </p>
      <p>
        <strong>2 · OAuth &amp; SMTP providers.</strong> Follow the <a href="/docs/auth-cutover">Auth cutover</a> guide to point Google/GitHub callback URLs and custom SMTP credentials at the new project ref.
      </p>
      <p>
        <strong>3 · Application environment variables.</strong> Update <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>, and <code>SUPABASE_SERVICE_ROLE_KEY</code> in Netlify, Vercel, Cloudflare, or your container host.
      </p>
      <div className="docs-callout honest">
        <strong>Why Portabase will never ask for your external vault.</strong> Keeping your runtime secrets in an independent vault you control — while Portabase captures the database, Storage, Auth inventory, and Edge Functions without holding your keys — means no single vendor lockout or breach can ever take both your data and your decryption keys.
      </div>
    </>
  );
}

function AuthCutover() {
  return (
    <>
      <p className="docs-lead">
        Auth is the one layer no automation can copy — provider secrets, SMTP credentials, and the
        JWT secret are per-project and cannot travel. The capsule carries the{' '}
        <strong>user inventory</strong> (<code>auth-inventory.json</code>: ids, emails, phones,
        roles, sign-in metadata, providers) and a written checklist (<code>AUTH-CUTOVER.md</code>).
        The two how-tos below walk the manual part: A for the first-timer, B for the engineer.
      </p>
      <h2>What the capsule gives you — and what it never contains</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>In the capsule</th><th>Never in the capsule</th></tr>
          </thead>
          <tbody>
            <tr><td>User ids, emails, phones, roles</td><td>Password hashes — users reset instead</td></tr>
            <tr><td>Per-user provider list (google, github…)</td><td>OAuth client secrets — re-entered from your records</td></tr>
            <tr><td>Created / last-sign-in metadata</td><td>JWT secret — the new project mints its own</td></tr>
            <tr><td>AUTH-CUTOVER.md checklist</td><td>SMTP / SMS / hook secrets — from your providers</td></tr>
          </tbody>
        </table>
      </div>
      <h2>How-to A — first-timer, click by click</h2>
      <p>
        <strong>1 · Gather your own records first.</strong> Most Auth secrets do not live only in
        Supabase — they live at the providers, which you can still reach: OAuth client IDs and
        secrets in the Google / GitHub / Apple developer consoles, SMTP credentials at your mail
        provider, SMS keys at Twilio or similar. Collect these before touching the new project.
      </p>
      <p>
        <strong>2 · Re-enable each provider.</strong> In the new project: Authentication → Sign In /
        Providers. For every provider that was on, enable it and paste the client ID and secret
        from your records. The Google walkthrough below is the pattern every provider follows.
      </p>
      <p>
        <strong>3 · Set URLs.</strong> Authentication → URL Configuration: your app's Site URL and
        every redirect URL your flows use (confirm, recover, invite, magic link).
      </p>
      <p>
        <strong>4 · Reconnect email.</strong> Re-enter SMTP credentials, then redo the email
        templates if you customized them — password recovery only works once this is done.
      </p>
      <p>
        <strong>5 · MFA and phone.</strong> Re-enable the factors you used and re-enter SMS provider
        keys.
      </p>
      <p>
        <strong>6 · Bring users back.</strong> Password hashes never left the old project, so email
        users go through "forgot password" once — that is the designed path, not a failure. OAuth
        users just sign in again. Use <code>auth-inventory.json</code> as your checklist of who to
        expect.
      </p>
      <p>
        <strong>7 · Prove it with one account</strong> — sign up or reset, sign in, exercise one
        real app flow — before announcing the restore to everyone.
      </p>
      <h3>Worked example — Google sign-in</h3>
      <p>
        Google is the provider most projects use, and it shows the whole pattern:
      </p>
      <p>
        <strong>1</strong> · Google Cloud Console → APIs &amp; Services → Credentials → your
        OAuth 2.0 Client ID (Web application). Your client ID and secret are here even if Supabase
        is unreachable — this is why step 1 of the how-to works.
      </p>
      <p>
        <strong>2</strong> · Edit <strong>Authorized redirect URIs</strong>: replace{' '}
        <code>https://OLD-REF.supabase.co/auth/v1/callback</code> with{' '}
        <code>https://NEW-REF.supabase.co/auth/v1/callback</code>. One character wrong here and
        every Google sign-in fails with <code>redirect_uri_mismatch</code>.
      </p>
      <p>
        <strong>3</strong> · In the new Supabase project: Authentication → Providers → Google →
        paste the same client ID and secret.
      </p>
      <p>
        <strong>4</strong> · Check the OAuth consent screen: if it is still in <em>Testing</em>,
        only listed test users can sign in — publish it or re-add testers before your users hit it.
      </p>
      <p>
        <strong>5</strong> · Existing Google users simply sign in again. Behind the scenes they
        receive <strong>new Supabase user ids</strong> — if your tables key rows by user id, that
        mapping is the expert track below.
      </p>
      <h2>How-to B — engineer, the parts that bite</h2>
      <p>
        <strong>1 · Identity mapping.</strong> The new project issues new <code>auth.users</code>{' '}
        UUIDs, while the capsule restored your public-schema rows with the old ones. Build the
        old→new map by joining <code>auth-inventory.json</code> (old id ↔ email) against the new
        project's admin user list, then remap foreign keys (<code>profiles.id</code>,{' '}
        <code>created_by</code>, …) as a deliberate migration before real traffic.
      </p>
      <p>
        <strong>2 · Sessions and keys.</strong> The new project mints a new JWT secret, so every old
        access and refresh token dies at cutover — plan a forced re-login, not silent continuity.
        New anon and service-role keys replace the old ones everywhere: env files, CI, your secrets
        manager, and any shipped mobile or desktop build.
      </p>
      <p>
        <strong>3 · Users at scale.</strong> The Admin API can pre-create users and send invite or
        recovery links, but it cannot set password hashes you never had — the password-reset flow
        remains the honest path for email users.
      </p>
      <p>
        <strong>4 · The config nobody remembers.</strong> Auth hooks (custom access token), captcha,
        and rate limits are per-project too — re-create them from your own records. This is the
        step a drill exposes: screenshot or export the Auth settings pages into your password
        manager today, and cutover is a 30-minute job instead of an archaeological dig.
      </p>
      <div className="docs-callout honest">
        <strong>Why this is manual by design.</strong> Anything that could copy your Auth
        configuration wholesale would have to hold your provider secrets, SMTP credentials, and
        JWT secret — exactly what Portabase refuses to hold. A competitor promising "full Auth
        backup" is holding secrets you should not want them to have.
      </div>
    </>
  );
}

const PAGES = {
  introduction: Introduction,
  quickstart: Quickstart,
  keepalive: Keepalive,
  'restore-targets': RestoreTargets,
  'disaster-recovery': DisasterRecovery,
  'auth-cutover': AuthCutover,
  'manual-contingency': ManualContingency,
  'rls-check': RlsCheck,
  cloud: CloudDocs,
  'threat-model': ThreatModel,
  proven: ProvenVsNot,
  cli: CliReference,
};

const FLAT_NAV = DOCS_NAV.flatMap((group) => group.items);

export function DocsApp({ Logo, Arrow }) {
  const [menu, setMenu] = useState(false);
  const slug = resolveDocsSlug(window.location.pathname, window.location.hash);
  const Page = PAGES[slug] || Introduction;
  const idx = FLAT_NAV.findIndex((item) => item.slug === slug);
  const prev = idx > 0 ? FLAT_NAV[idx - 1] : null;
  const next = idx >= 0 && idx < FLAT_NAV.length - 1 ? FLAT_NAV[idx + 1] : null;

  useEffect(() => {
    document.title = `Portabase — ${DOCS_TITLES[slug] || 'Docs'}`;
    const id = window.location.hash.replace(/^#/, '');
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }));
    else window.scrollTo(0, 0);
  }, [slug]);

  return (
    <div className="docs-app">
      <header className="docs-top">
        <div className="docs-top-inner">
          <div className="docs-brand">
            <Logo href="/" />
            <span className="docs-brand-kicker">Docs</span>
          </div>
          <button type="button" className="docs-menu" onClick={() => setMenu((o) => !o)} aria-label="Toggle navigation">
            {menu ? 'Close' : 'Menu'}
          </button>
          <nav className={menu ? 'docs-top-nav is-open' : 'docs-top-nav'} aria-label="Docs site">
            <a href="/docs/introduction" className="is-here">Docs</a>
            <a href="/docs/quickstart">Quickstart</a>
            <a href="/cloud">Pricing</a>
            <a href="/security">Security</a>
            <a href="/login">Sign in</a>
            <a className="button button-small" href="/login?next=/dashboard">Start free trial {Arrow ? <Arrow /> : '↗'}</a>
          </nav>
        </div>
      </header>
      <div className="docs-body">
        <aside className="docs-side" aria-label="Docs sections">
          {DOCS_NAV.map((group) => (
            <div className="docs-nav-group" key={group.label}>
              <b>{group.label}</b>
              {group.items.map((item) => (
                <a key={item.slug} href={item.href} className={item.slug === slug ? 'is-active' : ''}>{item.title}</a>
              ))}
            </div>
          ))}
        </aside>
        <article className="docs-article">
          <p className="docs-crumb">Docs · {DOCS_TITLES[slug]}</p>
          <h1>{DOCS_TITLES[slug]}</h1>
          <Page Arrow={Arrow} />
          <Pager prev={prev} next={next} />
        </article>
      </div>
      <footer className="docs-foot">
        <div className="docs-foot-inner">
          <span>Open source engine · Cloud optional · Not affiliated with Supabase, Inc.</span>
          <span>
            <a href="https://github.com/DataAutomation-ai/portabase-CLI" target="_blank" rel="noreferrer">GitHub</a>
            {' · '}
            <a href="/#faq">FAQ</a>
            {' · '}
            <a href="/legal">Legal</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
