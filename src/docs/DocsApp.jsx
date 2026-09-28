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
        What this repo actually proves, and what it does not. Copied from <code>docs/CLOUD.md</code>.
        No invented stats. No fake MATCH green.
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Proven in repo (unit / wiring)</th><th>Not proven</th></tr>
          </thead>
          <tbody>
            <tr><td>Product constants Cloud Free 100 MB · $7 / 10 GB · $17 / 25 GB</td><td>Live Square catalog IDs until Louis pins them</td></tr>
            <tr><td>Cloud Free designed as 100 MB, no scheduled service</td><td>Live entitlement enforcement of Cloud Free caps</td></tr>
            <tr><td>Table + bucket sizer include list (metadata + estimates only)</td><td>Live runner inventory ingest on portabase.dev</td></tr>
            <tr><td>Checkout fails closed with exact env var names when Square is missing</td><td>Live charge in production</td></tr>
            <tr><td>Dashboard lamp stays red unless a real dry-run/compare is MATCH</td><td>A green lamp on demo or empty data (forbidden)</td></tr>
            <tr><td>Runner sketch: sleeping container + free-engine argv + seal-to-runner</td><td>Production ECS/Fargate isolation audit</td></tr>
            <tr><td>Telemetry allowlist + SMS status-only builder</td><td>Twilio delivery in production</td></tr>
            <tr><td>Control plane store: hosted Supabase primary + one SQLite replica</td><td>Live outage drill</td></tr>
          </tbody>
        </table>
      </div>
      <div className="docs-callout danger">
        <strong>Proof lamp.</strong> Stays RED until a real MATCH. Demo / empty / mocked reports cannot turn it green.
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
      <div className="docs-callout honest">
        <strong>Rule of thumb.</strong> Recovering from your own error with a healthy account:
        same account. Recovering from anything done <em>to</em> your account: different account.
        When in doubt, restore to a different account — a capsule that escapes is never the
        wrong choice.
      </div>
    </>
  );
}

const PAGES = {
  introduction: Introduction,
  quickstart: Quickstart,
  keepalive: Keepalive,
  'restore-targets': RestoreTargets,
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
