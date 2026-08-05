import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { nightmares as stories } from './data/nightmares.js';
import { diagrams, modelLayers, trustBoundary } from './data/diagrams.js';
import { closureReasons, closureCases } from './data/closure-cases.js';
import { AppPage, AuthCallbackPage, LoginPage } from './auth-pages.jsx';
import { loadSession } from './lib/session.js';

const Arrow = () => <span aria-hidden="true">↗</span>;

const SupabaseMark = () => <svg className="supabase-mark" viewBox="0 0 109 113" role="img" aria-label="Supabase logo">
  <defs>
    <linearGradient id="supabase-a" x1="53.974" y1="38.974" x2="94.163" y2="55.829" gradientUnits="userSpaceOnUse"><stop stopColor="#249361" /><stop offset="1" stopColor="#3ECF8E" /></linearGradient>
    <linearGradient id="supabase-b" x1="36.156" y1="30.578" x2="54.484" y2="65.081" gradientUnits="userSpaceOnUse"><stop stopColor="#3ECF8E" /><stop offset="1" stopColor="#3ECF8E" stopOpacity="0" /></linearGradient>
  </defs>
  <path d="M63.708 110.284c-2.898 3.651-8.777 1.652-8.847-3.008L53.84 38.657h46.152c8.358 0 13.018 9.65 7.824 16.193l-44.108 55.434Z" fill="url(#supabase-a)" />
  <path d="M41.318 2.071c2.898-3.651 8.777-1.652 8.846 3.008l.447 68.618H5.034c-8.358 0-13.018-9.65-7.824-16.192L41.318 2.071Z" fill="url(#supabase-b)" />
</svg>;

const retiredStories = [
  {
    tag: 'ACCOUNT TAKEOVER',
    title: 'Six months of work. Gone after a cofounder was hacked.',
    body: 'The founder woke up to a missing project. Supabase audit logs later showed that a compromised cofounder account had deleted it.',
    source: 'Reddit · Apr 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1jt9kix/my_supabase_project_was_deleted_without_warning/',
    verified: 'Poster corrected the record'
  },
  {
    tag: 'PRODUCTION DOWN',
    title: '“Our app is burning, customers are angry and leaving.”',
    body: 'A Pro customer reported random full-project outages for more than two days after a routine Postgres upgrade, with every service unhealthy.',
    source: 'Reddit · Aug 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1msrwza/all_system_down_at_random_for_2_days_on_pro_plan/',
    verified: 'Firsthand user report'
  },
  {
    tag: '10 DAYS',
    title: 'Three days for a response. Still not fixed after ten.',
    body: 'A customer spending roughly €450 per month said a database problem took down the platform for days. They migrated to self-controlled servers.',
    source: 'Reddit · Oct 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1o6aayg/10_days_of_downtime_how_is_this_ok/',
    verified: 'Firsthand user report'
  },
  {
    tag: 'SERVICE RESTRICTED',
    title: 'The backup command failed when it was needed most.',
    body: 'After unexpected egress usage reached 356%, a developer reported that the app stopped loading and service restrictions prevented a one-time pg_dump.',
    source: 'Reddit · Mar 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1rle3pn/crosses_supabase_egress_limit_and_the_time_am_i/',
    verified: 'Firsthand user report'
  },
  {
    tag: 'SELF-LOCKOUT',
    title: 'One SQL statement. Every connection refused.',
    body: 'A developer set the database connection limit to zero. The dashboard and API went down, while the one-line fix required access they did not have.',
    source: 'Reddit · Mar 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1rn42ys/accidentally_locked_myself_out_of_my_supabase/',
    verified: 'Firsthand user report'
  },
  {
    tag: 'IDENTITY FAILURE',
    title: 'A changed GitHub email made the projects disappear.',
    body: 'The dashboard could not retrieve account information. The developer waited on support before discovering the login depended on the old GitHub email.',
    source: 'Reddit · Jan 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1i6jzuj/supabase_login_issues/',
    verified: 'Resolved by the poster'
  },
  {
    tag: 'PLATFORM OUTAGE',
    title: 'Auth, Storage, Realtime and the Management API failed together.',
    body: 'Supabase confirmed that an API Gateway deployment caused a multi-service outage across customer projects. The rollback restored service.',
    source: 'Reddit + official RCA · Nov 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1p5cs5w/supabase_is_down/',
    verified: 'Confirmed by Supabase CEO'
  },
  {
    tag: 'DASHBOARD OUTAGE',
    title: 'Incognito. New browser. Same result: no dashboard.',
    body: 'Users in multiple countries reported being unable to log in. A Supabase representative apologized and linked the incident report after resolution.',
    source: 'Reddit · May 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1tjlhdb/supabasecom_login_not_working_anymore/',
    verified: 'Confirmed incident'
  },
  {
    tag: 'ACCIDENTAL DELETE',
    title: 'A free-tier table was deleted with no usable customer backup.',
    body: 'The developer was told support was the only realistic hope. Supabase ultimately restored the records as a one-time exception.',
    source: 'Reddit · Jun 2024',
    href: 'https://www.reddit.com/r/Supabase/comments/1d7qyyz',
    verified: 'Resolved by support exception'
  },
  {
    tag: 'PROJECT DELETED',
    title: 'The project and its associated backups were permanently gone.',
    body: 'A GitHub discussion documents a developer deleting a project, then joining the support queue while discovering the surrounding application could no longer connect.',
    source: 'GitHub Discussions · 2025',
    href: 'https://github.com/orgs/supabase/discussions/33919',
    verified: 'Public support discussion'
  },
  {
    tag: 'BILLING BUG',
    title: 'A deleted branch kept generating charges.',
    body: 'Supabase confirmed an underlying resource was stuck while going down and promised a refund. The customer later reported the phantom branch still appearing on bills.',
    source: 'Reddit · Jan 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1qgyx97/supabase_support_not_replying_and_taking_too_much/',
    verified: 'Issue acknowledged by support'
  },
  {
    tag: '90-DAY TRAP',
    title: 'The restore button was gone. The old API address was released.',
    body: 'After a long pause, recovery meant downloading artifacts, creating a new project, restoring manually and changing the application URL and keys.',
    source: 'GitHub Discussions · Jan 2026',
    href: 'https://github.com/orgs/supabase/discussions/41710',
    verified: 'Public support guidance'
  },
  {
    tag: 'MISSING FILES',
    title: 'Database restored. Storage objects did not.',
    body: 'Supabase documentation and a long-running community thread confirm database backups contain Storage metadata—not the underlying files.',
    source: 'GitHub Discussions · 2022–2026',
    href: 'https://github.com/orgs/supabase/discussions/6755',
    verified: 'Documented platform behavior'
  },
  {
    tag: 'UNEXPLAINED LOSS',
    title: 'Every table remained. Every row was reportedly gone.',
    body: 'A user reported an intact schema with empty tables and no known destructive action. A Supabase collaborator disputed platform deletion and directed them to audit logs and support.',
    source: 'GitHub Discussions · Apr 2025',
    href: 'https://github.com/orgs/supabase/discussions/34773',
    verified: 'Unverified, disputed report'
  }
];

const auditItems = [
  ['database', 'Database lives outside the Supabase account', 'A current logical dump is encrypted in an account you control.'],
  ['storage', 'Storage files are copied—not just metadata', 'Every object is inventoried, checksummed and independently stored.'],
  ['functions', 'Edge Function source is recoverable', 'Source, configuration and deployment settings exist outside the dashboard.'],
  ['restore', 'A restore has been completed recently', 'Someone has proven the backup works against a separate target.'],
  ['aws', 'Recovery infrastructure is customer-owned', 'The cloud account, storage and encryption keys belong to your company.'],
  ['cutover', 'Your app can switch backend addresses', 'A controlled domain or automated environment update avoids a code hunt.'],
  ['identity', 'More than one person can initiate recovery', 'The escape path does not depend on one email, SSO identity or laptop.'],
  ['runbook', 'Recovery is documented and timed', 'Your team knows the RPO, RTO and exact order of operations.']
];

function Logo({ href = '/' }) {
  return <a className="logo" href={href} aria-label="Portabase home"><span className="logo-mark"><i /><i /><i /></span><span>porta<b>base</b></span></a>;
}

function Header() {
  const [open, setOpen] = useState(false);
  return <header className="site-header">
    <div className="shell nav-wrap">
      <Logo href="/#top" />
      <button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? 'Close' : 'Menu'}</button>
      <nav className={open ? 'nav open' : 'nav'}>
        <a href="/#what-is-this">What is this?</a><a href="/#why-now">Why now</a><a href="/#closures">Account closures</a><a href="/#stories">Real incidents</a><a href="/#escape">The escape plan</a><a href="/security">Security</a><a href="/cloud">Cloud · $17 / $27</a><a href="/login">Sign in</a>
      </nav>
      <a className="button button-small desktop-cta" href="/login?next=/app">Start free trial <Arrow /></a>
    </div>
  </header>;
}

function Hero() {
  return <section className="hero" id="top">
    <div className="hero-noise" />
    <div className="shell hero-shell">
      <div className="hero-brandline"><SupabaseMark /><span>Is great—until the doors are locked.</span></div>
      <div className="hero-grid">
       <div className="hero-copy">
        <p className="hero-usp"><span>USP</span><strong>Your Supabase Escape</strong> — a customer-owned way out when the dashboard is locked.</p>
        <h1>A Supabase lockout can freeze your <em>entire business.</em></h1>
        <p className="hero-risk-headline"><strong>No API. No Auth. No dashboard. No reachable backups.</strong></p>
        <p className="hero-lead"><strong>Portabase is the Escape for Supabase</strong> — open source, Supabase-only. The free engine captures your <strong>database, Auth records, Storage object bytes, and Edge Functions</strong>; encrypts them; and stores the capsule where <em>you</em> choose. Platform backups cover the database — <strong>not your Storage files</strong>. Optional Cloud (this site) is the <strong>GUI, easy setup, and telemetry</strong> so the Escape keeps running — never custody of your keys.</p>
        <div className="hero-analogy"><span aria-hidden="true">⌂</span><p><b>Your landlord changed the locks.</b> The backup inside the building is not an Escape. Portabase keeps your way out in another building—tested, current, and under your control.</p></div>
        <div className="incident-factline"><b>MY INCIDENT · 95+ HOURS</b><span>“Billing dispute” cited</span><span>No details or paperwork</span><span>Card issuer found nothing identifiable</span><span>Singapore payment entity</span><span>No response from Supabase</span></div>
        <div className="hero-actions">
          <a className="button button-primary" href="#escape">Build your Escape <Arrow /></a>
          <a className="text-link" href="#stories">See what lockout looks like <span>↓</span></a>
        </div>
        <div className="hero-proof"><span>USP · Escape</span><span>Supabase only</span><span>OSS free · Cloud = GUI &amp; telemetry</span></div>
      </div>
      {/* Bridge: headline → ban dialog (same placement as design example) */}
      <img
        className="lockout-arrow"
        src="/images/arrow3.png"
        alt="This is the actual login screenshot from the Founder, it's the reason Portabase.dev came to be"
        width="320"
        height="160"
      />
      <div className="lockout-stage">
        <figure className="lockout-evidence">
          <div className="evidence-label"><span><i /> Actual lockout</span><b>Not a mockup</b></div>
          <img className="lockout-shot" src="/images/supabase-banned.jpg" alt="Actual Supabase sign-in screen showing the error: User is banned" />
          <figcaption><span>Account locked. Business frozen. Backups unreachable.</span><small>Actual founder scenario · identifying details redacted</small></figcaption>
        </figure>
      </div>
      </div>
    </div>
    <div className="reality-ticker"><div><span>PROJECT DELETED</span><span>OWNER LOCKED OUT</span><span>PAYMENT FAILED</span><span>STORAGE NOT IN BACKUP</span><span>API KEYS REVOKED</span><span>SUPPORT TICKET OPEN</span><span>PROJECT DELETED</span><span>OWNER LOCKED OUT</span></div></div>
  </section>;
}

function HeroConcept() {
  return <section className="section hero-concept-section" aria-label="Open core and Cloud split">
    <div className="shell">
      <figure className="hero-concept">
        <div className="hero-concept-label"><span>OPEN SOURCE FIRST</span><b>Hosted convenience is optional</b></div>
        <img src="/images/open-core-split.jpg" alt="Split concept: Portabase Community open-source runner keeps keys and capsules on the customer side; Portabase Cloud receives only thin health telemetry for monitoring and multi-person alerts" width="1920" height="1080" />
        <figcaption>
          <span>Community runs recovery. Cloud pages people. Keys never cross the wall.</span>
          <small>Conceptual illustration · product model</small>
        </figcaption>
      </figure>
      <figure className="hero-concept hero-concept-secondary">
        <div className="hero-concept-label"><span>WHEN SUPABASE IS LOCKED</span><b>Your pre-incident capsule still exists</b></div>
        <img src="/images/supabase-vt1.png" alt="Conceptual scene: locked Supabase project while Portabase evacuates encrypted recovery streams to independent destinations and a new project" width="1920" height="1080" />
        <figcaption>
          <span>OSS engine · customer destinations · restore without the original account</span>
          <small>Conceptual illustration · not a live dashboard</small>
        </figcaption>
      </figure>
    </div>
  </section>;
}

function ModelExplainer() {
  return <div className="model-explainer" id="model">
    <div className="model-explainer-head">
      <span className="section-kicker green">THE PRODUCT MODEL</span>
      <h3>Same idea as Supabase itself.</h3>
      <p>The recovery stack is open and self-hostable. The hosted control plane is convenience: console niceties, telemetry, and multi-person alert chains — not a second landlord for your data.</p>
    </div>
    <div className="model-layer-grid">
      {modelLayers.map(layer => (
        <article key={layer.id} className={`model-layer model-layer-${layer.id}`}>
          <header>
            <small>{layer.kicker}</small>
            <b>{layer.price}</b>
          </header>
          <h4>{layer.title}</h4>
          <p className="model-promise">{layer.promise}</p>
          <ul>{layer.points.map(point => <li key={point}>{point}</li>)}</ul>
        </article>
      ))}
    </div>
    <div className="trust-board">
      <div className="trust-board-head">
        <span>TRUST BOUNDARY</span>
        <strong>Audit this in the open-source agent before you turn Cloud on.</strong>
      </div>
      <div className="trust-columns">
        {trustBoundary.map(column => (
          <div key={column.side} className={`trust-col trust-${column.side}`}>
            <h5>{column.title}</h5>
            <ul>{column.items.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
        ))}
      </div>
    </div>
    <figure className="flow-asset">
      <div className="hero-concept-label"><span>DATA PATH</span><b>Capture · encrypt · store · optional alerts</b></div>
      <img loading="lazy" src="/images/open-core-flow.jpg" alt="Flow diagram: Supabase project to open-source engine encryption to customer storage, with an optional dashed branch to Cloud console for alerts only" width="1920" height="1080" />
      <figcaption>
        <span>Thick path = recovery data on your infrastructure. Dashed path = health events only.</span>
        <small>Conceptual flow · exact schema in docs/TELEMETRY_SCHEMA.md</small>
      </figcaption>
    </figure>
  </div>;
}

function WhatIsThis() {
  return <section className="section what-is-this" id="what-is-this">
    <div className="shell">
      <div className="section-kicker green">WHAT IS PORTABASE?</div>
      <div className="what-heading">
        <h2>Open-source recovery.<br />Hosted convenience.</h2>
        <div>
          <p><strong>Community (free · open source):</strong> run the engine on a server, NAS, container, or your cloud account. Built for <strong>Supabase only</strong> today — database, Auth, <strong>Storage files (not just metadata)</strong>, and Edge Functions; encrypt; store where you choose; restore into a fresh project.</p>
          <p><strong>Cloud (this website · paid):</strong> hosted <strong>GUI</strong>, easier configuration, <strong>telemetry</strong>, SMS on success/failure, and multi-person alerts. Same engine underneath. Never needs your passphrase or capsule bytes to page people.</p>
          <p><strong>Full capture is free. No license gate. Encryption code you can read.</strong></p>
        </div>
      </div>
      <div className="definition-strip">
        <div><small>OPEN SOURCE</small><b>Full capture<br />Encrypt &amp; verify<br />Guarded restore</b></div>
        <div><small>SELF-HOST</small><b>Your runner<br />Your schedule<br />Your destinations</b></div>
        <div><small>CLOUD ADDS</small><b>Console ease<br />Telemetry<br />Alert chains</b></div>
        <div><small>NEVER HOSTED</small><b>Passphrase<br />Service keys<br />Capsule contents</b></div>
      </div>
      <ModelExplainer />
      <div className="open-core-story" id="open-core-story">
        <div className="open-core-story-kicker">
          <span>THE MODEL YOU ALREADY KNOW</span>
          <em>Open source first · Cloud on top</em>
        </div>
        <h3>Portabase is open source — the same shape as Supabase itself.</h3>
        <p className="open-core-story-lead">
          The engine that captures your project, encrypts the capsule, and restores into a new Supabase is
          {' '}<strong>Apache-2.0 and free</strong>. You can run it on a VM, a NAS, a container, or any box you control.
          No license unlock. No “pay us or your recovery stops.”
        </p>
        <div className="open-core-story-grid">
          <article>
            <small>01 · OPEN CORE</small>
            <b>The real product is readable code.</b>
            <p>Like Supabase, the serious work lives in the open: capture, encrypt, verify, restore. You can audit the crypto path, pin versions, and keep Escape running even if this website disappeared tomorrow.</p>
          </article>
          <article>
            <small>02 · CLOUD LAYER</small>
            <b>We make Escape something you live with.</b>
            <p>On top of that engine we add the boring-but-critical layer: a calm GUI, guided workflows, telemetry that SMS/email the right people, and — most importantly — <strong>hosted runner compute</strong> so you are not babysitting a laptop cron for the rest of your life.</p>
          </article>
          <article>
            <small>03 · WHAT STAYS YOURS</small>
            <b>Capsules and keys never become our product.</b>
            <p>Cloud stages the job and watches it. Encrypted recovery bytes land in <em>your</em> S3, Dropbox, or Local Starter vault. Passphrases and service keys stay on the runner path — not as our “backup of record.”</p>
          </article>
        </div>
        <p className="open-core-story-close">
          <strong>Do not trust another vague “backup” promise.</strong>
          {' '}Trust an Escape you can run yourself — and a Cloud that only exists to keep that Escape real.
        </p>
        <div className="open-core-story-actions">
          <a className="button button-primary" href="https://github.com/DataAutomation-ai" target="_blank" rel="noreferrer">Browse the open-source engine <Arrow /></a>
          <a className="button button-ghost" href="/cloud">See open source vs Cloud <Arrow /></a>
        </div>
      </div>
      <div className="diagram-intro">
        <div><span>TECHNICAL DETAIL</span><h3>How recovery actually works — still customer-owned.</h3></div>
        <p>These diagrams stay relevant under open core: data path, capsule contents, key custody, and restore guards. Captions now describe Community vs optional Cloud instead of a paid software unlock.</p>
      </div>
      <div className="diagram-grid">
        {diagrams.map(diagram => (
          <figure className="diagram-card" key={diagram.src}>
            <div className={`diagram-layer-tag layer-${diagram.layer}`}>{diagram.layer === 'community' ? 'OSS' : diagram.layer === 'cloud' ? 'CLOUD' : 'OSS + CLOUD'}</div>
            <img loading="lazy" src={diagram.src} alt={diagram.title} />
            <figcaption><b>{diagram.title}</b><span>{diagram.body}</span></figcaption>
          </figure>
        ))}
      </div>
      <div className="what-actions">
        <a className="button button-primary" href="/cloud">Cloud vs open source <Arrow /></a>
        <a className="button button-ghost" href="#escape">See the escape plan <Arrow /></a>
        <a className="button button-ghost" href="#stories">Real incidents <Arrow /></a>
      </div>
    </div>
  </section>;
}

function WhyNow() {
  return <section className="section why-now" id="why-now">
    <div className="shell">
      <div className="love-note"><span>Let’s be clear</span><h2>Supabase is great.</h2><p>That is why so many prototypes quietly became real companies on it. But loving the building does not mean leaving your only exit key with the landlord.</p></div>
      <aside className="founder-note">
        <div className="founder-note-label"><span>FOUNDER’S NOTE</span><small>WHY THIS ISN’T AN ATTACK</small></div>
        <div className="founder-note-copy"><h3>I almost gave this product an angry name.</h3><p>“Supabase Sucks.” “Not So Supa.” Something that captured exactly how it felt to be locked out and unable to reach the business behind the screen.</p><div className="founder-incident"><span>THIS IS MY CURRENT SITUATION</span><p>Supabase cited a billing dispute. I received no transaction details, paperwork, or other explanation my credit-card company could identify. I contacted support. At the time of writing, <strong>95 hours have passed with absolutely no response from Supabase.</strong></p><p>Supabase’s own billing documentation says payments may appear from Singapore because its payment entity is there. There is nothing inherently wrong with that. But when a U.S. or other overseas customer is already disputing a vague billing claim, cross-border payment records, time zones, and remedies can add friction to an emergency that is already costing the business.</p><p>The business did not stop needing its database while the ticket waited. That is the danger Portabase exists to make visible.</p></div><p>But an angry name still would not have been fair—or true. <strong>Supabase is an excellent product.</strong> It has introduced millions of people to databases, Auth, Storage, Functions, and the possibility of building a real application without first becoming a backend engineer.</p><p>Portabase is not here to tell you to leave Supabase. It is here to point out one danger many builders never see: <strong>when the application, dashboard, support path, and backup all depend on the same account, one lock can stand between you and your entire business.</strong></p><b>Keep the platform. Remove the single point of failure.</b></div>
      </aside>
      <div className="growth-grid">
        <div className="growth-stat"><strong>~10M</strong><span>developers building on Supabase—and every one may need help someday</span><a href="https://supabase.com/blog/supabase-series-f" target="_blank" rel="noreferrer">Supabase, June 2026 <Arrow /></a></div>
        <div className="growth-copy">
          <div className="section-kicker green">SUCCESS CREATED A NEW REALITY</div>
          <h3>The weekend prototype became a real business before anyone wrote the disaster plan.</h3>
          <p>Lovable, Bolt, v0 and other tools can put a production database behind an idea in minutes. Then the prototype gets customers, payments, years of records, and employees who need it tomorrow morning. The technical shortcut becomes the heart of a business long before anyone asks the brutal question: what happens if the owner cannot log in?</p>
          <div className="scale-warning"><span>NEARLY 10 MILLION DEVELOPERS. ONE SUPPORT QUEUE.</span><h4>Extraordinary for Supabase. Terrifying when your company is the one that needs help now.</h4><p>Mass adoption proves the product works. It also means your business emergency enters a platform operating at enormous scale. On Pro, the published offering lists email support—but no support SLA, phone line, live chat, designated support contact, or dedicated urgent-outage escalation lane. Those protections begin appearing on higher tiers.</p><b>Your outage may be existential to you. To a platform serving millions, it is still a ticket.</b></div>
          <div className="support-gap">
            <div><small>PRO · FROM $25/MO</small><b>Email support</b><span>No guaranteed support SLA</span></div>
            <div><small>TEAM · FROM $599/MO</small><b>Priority email</b><span>Support SLAs begin here</span></div>
            <div><small>ENTERPRISE</small><b>Private Slack</b><span>Premium 24×7 support</span></div>
          </div>
          <p className="gap-close">If your production site is down on Pro, the published path is email. There is no published Pro phone number or private live-support channel. Supabase’s current legal materials name Supabase Pte. Ltd., and its billing guide identifies a Singapore payment entity. For customers elsewhere, that distance can matter when billing records, business hours, and escalation all collide. A Supabase representative has said the target is 24–48 hours and can run longer under volume; public reports on this page describe outages and support waits stretching far beyond that. Can your company afford to lose tomorrow’s orders, customers, and reputation while the inbox stays silent?</p>
          <aside className="escalation-reality"><span>THIS IS NOT A BUSINESS CONTINUITY PLAN</span><blockquote>“See if you can find a GitHub maintainer. Maybe they can escalate it.”</blockquote><p>When the best remaining idea is to find a stranger on the internet who might know someone inside, you do not control the recovery of your business. You are asking for a favor while the clock runs.</p><b>Portabase turns “please answer” into “restore the capsule.”</b></aside>
          <div className="source-links"><a href="https://supabase.com/solutions/vibe-coders" target="_blank" rel="noreferrer">Supabase for Vibe Coders <Arrow /></a><a href="https://supabase.com/pricing" target="_blank" rel="noreferrer">Published support tiers <Arrow /></a><a href="https://supabase.com/docs/guides/platform/billing-faq" target="_blank" rel="noreferrer">Singapore billing disclosure <Arrow /></a><a href="https://www.reddit.com/r/Supabase/comments/1kbj0sh/supabase_threatened_to_delete_all_my_work_after/" target="_blank" rel="noreferrer">24–48 hour support statement <Arrow /></a></div>
        </div>
      </div>
      <figure className="danger-zone-figure">
        <div className="danger-zone-header"><span>THE VULNERABLE MIDDLE</span><b>Too dependent to wait. Too small to escalate.</b></div>
        <img loading="lazy" src="/images/danger-zone.png" alt="Illustration of the Supabase support risk gap, with businesses spending between hobbyist and enterprise levels shown in a danger zone" />
        <figcaption><strong>This is where a growing business can be most exposed.</strong><span>It depends on Supabase every hour of every day, but one click, billing flag, or identity failure can put the dashboard out of reach. Without enterprise escalation or an independent recovery path, the company may have little more than an unanswered email between normal operations and a prolonged lockout.</span><small>Illustrative analysis—not an official Supabase policy or guarantee.</small></figcaption>
      </figure>
    </div>
  </section>;
}

function Reality() {
  return <section className="section reality" id="reality">
    <div className="shell">
      <div className="section-kicker">THE BLUNT REALITY</div>
      <div className="split-heading"><h2>A backup you can’t reach<br />is not your backup.</h2><p>Your app, dashboard, support path, and provider-held backup can fail behind one account. If every rescue tool needs the same login, one locked door can put your entire company on the other side.</p></div>
      <div className="reality-grid">
        <article><span>01</span><h3>The dashboard is a dependency.</h3><p>Account access, billing, SSO, or the management plane can fail before your database does. Then the button you planned to press is trapped inside the problem you need it to solve.</p></article>
        <article><span>02</span><h3>A database dump is not your business.</h3><p>Customers still need Auth. Products still need images. Workflows still need Functions, secrets, URLs, and integrations. Recover only Postgres and you may recover a database that cannot run the company.</p></article>
        <article><span>03</span><h3>Deletion can erase the safety net.</h3><p>Supabase states that deleting a project permanently removes its data and associated backups. One destructive action can take the production system and the provider-held recovery copy with it.</p></article>
        <article><span>04</span><h3>Pro support is an email path.</h3><p>No published Pro hotline. No private live-support channel. If that email does not get answered, how many hours can your company bleed before “waiting” becomes “we may not recover”?</p></article>
      </div>
      <div className="ban-reasons">
        <div className="ban-reasons-head"><div><span>IT CAN START WITH SOMETHING ORDINARY</span><h3>Restriction does not require a reckless business owner.</h3></div><p>A payment descriptor is questioned. A card expires. A customer uploads disputed material. A traffic spike looks abusive. The result may be a billing restriction, project suspension, investigation, or account-level lockout—different mechanisms with the same immediate problem: your business can no longer depend on normal access.</p></div>
        <div className="ban-reason-grid">
          <div><b>01</b><strong>Foreign payment questioned</strong><p>A bookkeeper, accountant, bank, or fraud system may not recognize “SUPABASE PTE. LTD. · SINGAPORE.” A chargeback inquiry is not documented as an automatic ban, but it can become a payment or fraud review.</p></div>
          <div><b>02</b><strong>Routine card failure</strong><p>An expired card, bank decline, insufficient funds, missing card, overdue invoice, or incorrect billing address can restrict services or pause projects.</p></div>
          <div><b>03</b><strong>Quota or runaway usage</strong><p>Repeated plan overages, spend-cap limits, viral traffic, bot traffic, reconnection loops, uncontrolled channels, or a load test pointed at production can trigger restrictions.</p></div>
          <div><b>04</b><strong>Someone reports hosted content</strong><p>A copyright, privacy, harassment, fraud, or other abuse complaint may trigger investigation. The owner can face the operational consequence before the underlying dispute is resolved.</p></div>
          <div><b>05</b><strong>Your user causes the problem</strong><p>Customer-uploaded piracy, malware, phishing forms, spam, stolen data, or illegal material can place the account at risk even when the business owner did not personally upload it.</p></div>
          <div><b>06</b><strong>Security systems see danger</strong><p>Port scanning, vulnerability probing, denial-of-service patterns, an open proxy, credential compromise, or activity performed through a stolen login can look like platform abuse.</p></div>
          <div><b>07</b><strong>Account-pattern flags</strong><p>Disposable email addresses, automated registration, bulk accounts, excessive accounts, cryptocurrency mining, or attempts to bypass platform controls are expressly prohibited.</p></div>
          <div><b>08</b><strong>Regulated data crosses a line</strong><p>Storing payment-card information without prior written approval, or protected health information without the required agreement, can breach the platform terms even if the application itself is legitimate.</p></div>
          <div><b>09</b><strong>An API key leaks. Attackers use it.</strong><p>A service-role key, database password, access token, or administrator login is exposed through no fault of your own. Bots can steal data, generate abusive traffic, attack other systems, or turn a normal $500 monthly bill into $50,000. The leak may be innocent. The bleeding can still be fatal.</p></div>
          <div><b>10</b><strong>Law or a provider intervenes</strong><p>Supabase’s terms permit suspension when service would violate law or when a required third-party vendor suspends the component Supabase depends on.</p></div>
          <div><b>11</b><strong>The only owner loses identity access</strong><p>The company email expires, a domain lapses, GitHub or SSO access changes, an authenticator is lost, or the sole administrator leaves. The database may still be running while every person able to manage or recover it is locked outside.</p></div>
          <div><b>12</b><strong>A trusted administrator makes one fatal click</strong><p>A cofounder, contractor, compromised administrator, or exhausted employee removes an owner, transfers the wrong organization, or deletes a production project. Legitimate authority does not guarantee legitimate intent—or a reversible result.</p></div>
        </div>
        <div className="billing-emergency">
          <div><span>THE $50,000 DECISION</span><strong>$500 <i>→</i> $50,000</strong></div>
          <div><h3>How do you stop the bleeding without stopping the business?</h3><p>A leaked key explodes your normal bill. Your first instinct may be to stop the card—to establish a point of defense while the charge is investigated. But now the same account may face suspected-abuse review and a failed or overdue payment. Supabase does not publicly state that every card stop causes an automatic ban. It does document that suspected abuse and overdue payment can restrict an organization: projects may be paused, databases made read-only, transfers disabled, or requests returned with HTTP 402. Your financial defense and your production access can become the same negotiation.</p><p className="billing-emergency-close">The accident may not be your fault. The consequences still belong to your business.</p></div>
        </div>
        <p className="ban-reasons-note"><strong>These are not all the same as the literal dashboard status “User is banned.”</strong> They are documented paths to restriction, suspension, termination, or practical lockout. <a href="https://supabase.com/terms" target="_blank" rel="noreferrer">Supabase Terms <Arrow /></a><a href="https://supabase.com/aup" target="_blank" rel="noreferrer">Acceptable Use Policy <Arrow /></a><a href="https://supabase.com/docs/guides/platform/billing-faq" target="_blank" rel="noreferrer">Billing restrictions <Arrow /></a></p>
      </div>
      <div className="wake-up">
        <div className="wake-time">06:41 <small>AM</small></div>
        <div><div className="section-kicker">A VERY POSSIBLE MORNING</div><h3>You wake up. The site is down. You can’t log in.</h3><p>Customers cannot pay. Staff cannot work. The status page is green. Password recovery goes nowhere. Support has your email; every passing hour takes another piece of the business with it.</p></div>
        <a href="#escape">See the other ending <Arrow /></a>
      </div>
      <div className="forty-eight">
        <div className="forty-eight-head"><span>48:00:00</span><div><div className="section-kicker red">A RESPONSE TARGET IS NOT A RECOVERY TIME</div><h3>What happens while you wait?</h3></div></div>
        <div className="wait-line">
          <div><b>00:00</b><span>Production fails</span><small>Auth, orders, uploads or the entire application stop.</small></div>
          <div><b>00:20</b><span>The dashboard won’t help</span><small>Different browser. Password reset. Status page. Same locked door.</small></div>
          <div><b>01:00</b><span>The ticket is open</span><small>There is no published Pro support hotline to call next.</small></div>
          <div><b>06:00</b><span>Customers are leaving</span><small>Your inbox, reviews and refund requests become the status page.</small></div>
          <div><b>24:00</b><span>The business is still waiting</span><small>A first reply may diagnose the problem. It does not guarantee resolution.</small></div>
          <div><b>48:00</b><span>You may receive a response</span><small>Unless volume causes delays. Your lost time is not restored with the service.</small></div>
        </div>
      </div>
    </div>
  </section>;
}

function Stories() {
  const homepageStories = stories.slice(0, Math.ceil(stories.length / 2));
  return <section className="section stories" id="stories">
    <div className="shell">
      <div className="section-kicker red">DOCUMENTED REAL-LIFE INCIDENTS · ZERO HYPOTHETICALS</div>
      <div className="split-heading"><h2>These actually<br />happened.</h2><p>Founders lost dashboards, databases, Storage access, and days waiting for help. These linked reports are not fortune-cookie warnings. They are the mornings other businesses already woke up to. This homepage presents a curated selection from a continuously maintained source archive.</p></div>
      <div className="story-grid">
        {homepageStories.map((story, index) => <a className="story-card" href={story.href} target="_blank" rel="noreferrer" key={story.id}>
          <div className="story-meta"><span>{story.tag}</span><b>{String(index + 1).padStart(2, '0')}</b></div>
          <h3>{story.title}</h3><p>{story.body}</p>
          <div className="story-source"><span>{story.source}<small>{story.verified}</small></span><Arrow /></div>
        </a>)}
      </div>
      <p className="source-note">No policies, feature requests, hypotheticals or backup-market discussions are counted. Community reports document what the poster reported; official incidents document what Supabase confirmed. A report is not presented as independent proof of cause.</p>
    </div>
  </section>;
}

/** Did-you-know comparison: platform backup vs Escape (USP diagram) */
function EscapeVsSupabaseDiagram() {
  const rows = [
    { layer: 'Postgres data & schema', platform: 'yes', escape: 'yes', note: 'Platform covers the database volume' },
    { layer: 'Storage metadata (bucket tables)', platform: 'yes', escape: 'yes', note: 'In Postgres — not the files themselves' },
    { layer: 'Storage object bytes (your files)', platform: 'no', escape: 'yes', note: 'Official: DB backups omit Storage API objects' },
    { layer: 'Edge Function source', platform: 'no', escape: 'yes', note: 'Outside the DB snapshot path' },
    { layer: 'Usable if you cannot log in', platform: 'no', escape: 'yes', note: 'Platform restore needs dashboard / account access' },
    { layer: 'Capsule you hold off-site', platform: 'no', escape: 'yes', note: 'Your Dropbox · S3 · NAS — not only theirs' },
    { layer: 'When support is the only path', platform: 'no', escape: 'yes', note: 'Allow ~48h turnaround (their own guidance) — Escape is already outside' },
  ];
  const cell = (v) => (v === 'yes'
    ? <span className="esc-cmp-yes">Included</span>
    : <span className="esc-cmp-no">Not enough</span>);

  return (
    <div className="esc-cmp" id="escape-vs-backup" role="region" aria-label="Supabase backup versus Portabase Escape">
      <div className="esc-cmp-didyou">
        <span>DID YOU KNOW?</span>
        <b>If you cannot get into Supabase, you cannot retrieve their backup either.</b>
        <p>
          Platform backups live behind the same account, project, and support path as production.
          A ban, billing lock, or “user is banned” screen is not only “no dashboard” — it can mean
          <strong> no practical way to pull what you thought was your safety net</strong>.
          And even when you can restore: Supabase documents that
          <strong> database backups do not include Storage API object bytes</strong>
          {' '}(only metadata in Postgres).
        </p>
        <p style={{ marginTop: 12 }}>
          <strong>Support is not instant either.</strong> On the tiers most growing apps use, the published path is email —
          and public guidance from Supabase has pointed to a <strong>24–48 hour support turnaround</strong>
          {' '}(and longer under volume). If the business is already locked out, that wait is not a recovery plan.
          The Escape has to already exist <em>outside</em> the ticket queue.
        </p>
        <div className="esc-cmp-doclinks">
          <a href="https://supabase.com/docs/guides/platform/backups" target="_blank" rel="noreferrer">Supabase backups docs ↗</a>
          <a href="https://supabase.com/pricing" target="_blank" rel="noreferrer">Published support tiers ↗</a>
          <a href="https://www.reddit.com/r/Supabase/comments/1kbj0sh/supabase_threatened_to_delete_all_my_work_after/" target="_blank" rel="noreferrer">24–48h support statement ↗</a>
        </div>
      </div>

      <div className="esc-cmp-panels">
        <article className="esc-cmp-panel esc-cmp-panel-locked">
          <header>
            <small>THEIR BACKUP + SUPPORT</small>
            <h3>Supabase platform path</h3>
          </header>
          <div className="esc-cmp-lock" aria-hidden="true">
            <div className="esc-cmp-lock-door">
              <i />
              <b>LOCKED OUT</b>
              <span>No login · no API · no download</span>
            </div>
            <div className="esc-cmp-lock-arrow">⇢</div>
            <div className="esc-cmp-lock-vault esc-cmp-lock-vault-dead">
              <b>Backup + support still inside</b>
              <span>Same wall · allow ~48h for a ticket</span>
            </div>
          </div>
          <ul className="esc-cmp-bullets">
            <li>Restores assume you can operate the project / org path</li>
            <li>Storage <em>files</em> are outside the DB backup</li>
            <li>Functions are not “redeployed from the DB snapshot”</li>
            <li><strong>Support turnaround: allow ~48 hours</strong> (their own public guidance) — can run longer under volume</li>
            <li>Too late to discover any of this during a ban</li>
          </ul>
        </article>

        <article className="esc-cmp-panel esc-cmp-panel-escape">
          <header>
            <small>USP · THE ESCAPE</small>
            <h3>Portabase Escape</h3>
          </header>
          <div className="esc-cmp-lock" aria-hidden="true">
            <div className="esc-cmp-lock-door esc-cmp-lock-door-open">
              <i />
              <b>FRONT DOOR DOWN</b>
              <span>Supabase still locked</span>
            </div>
            <div className="esc-cmp-lock-arrow esc-cmp-lock-arrow-ok">⇢</div>
            <div className="esc-cmp-lock-vault">
              <b>Your capsule · your vault</b>
              <span>Dropbox · S3 · NAS · already outside</span>
            </div>
          </div>
          <ul className="esc-cmp-bullets">
            <li>Copy taken <em>before</em> the emergency, off-platform</li>
            <li>Storage object bytes + Function source in the capsule</li>
            <li>Restore to a <strong>new</strong> blank Supabase project</li>
            <li>Does not wait on a 48-hour ticket queue to start recovering</li>
            <li>Prove it with Replay while you still have access</li>
          </ul>
        </article>
      </div>

      <div className="esc-cmp-table-wrap">
        <table className="esc-cmp-table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Supabase platform backup</th>
              <th>Portabase Escape</th>
              <th className="esc-cmp-hide-sm">Why it matters</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.layer}>
                <td><strong>{r.layer}</strong></td>
                <td>{cell(r.platform)}</td>
                <td>{cell(r.escape)}</td>
                <td className="esc-cmp-hide-sm esc-cmp-note">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="esc-cmp-foot">
        <strong>Did you know — bottom line:</strong> a backup you can only reach through the same locked door is not an Escape —
        and waiting <strong>~48 hours for support</strong> (their own guidance) is not a recovery SLA for your company.
        Portabase exists so the way out is already in <em>your</em> building.
      </p>
    </div>
  );
}

function Escape() {
  return <section className="section escape" id="escape">
    <div className="shell">
      <div className="section-kicker green">USP · THE ESCAPE</div>
      <div className="escape-heading"><h2>When the front door fails,<br /><em>leave through your own.</em></h2><p><strong>Escape</strong> is the USP: a customer-owned way out of a Supabase lockout — not a second landlord. Open-source engine builds the encrypted capsule in storage you own (DB, Auth, Storage bytes, Functions). Cloud (this site) keeps the Escape easy with GUI, configuration, and telemetry — and who to wake if the job goes quiet.</p></div>
      <EscapeVsSupabaseDiagram />
      <figure className="escape-vault-hero">
        <div className="viz-panel-label"><span>USP · THE ESCAPE CAPSULE</span><b>Armored · off-site · under guard</b></div>
        <img loading="lazy" src="/images/diagrams/escape-capsule-vault.jpg" alt="Armored Escape recovery capsule sealed on a pedestal inside a vast high-security storage facility with guards and surveillance" width="1920" height="1080" />
        <figcaption>
          <span>Your Escape is not “another login to Supabase.” It is a sealed capsule in storage you control.</span>
          <small>Conceptual · product illustration</small>
        </figcaption>
      </figure>
      <div className="viz-panel-grid escape-viz">
        <figure className="viz-panel">
          <div className="viz-panel-label"><span>HOW IT WORKS</span><b>Encrypt outside the locked account</b></div>
          <img loading="lazy" src="/images/diagrams/recovery-architecture.jpg" alt="Conceptual diagram: locked Supabase account, customer runner encrypting capsules to Drive or S3, optional Cloud alerts" width="1920" height="1080" />
          <figcaption><span>Runner · local encryption · your destinations · optional alerts</span><small>Conceptual</small></figcaption>
        </figure>
        <figure className="viz-panel">
          <div className="viz-panel-label"><span>WHY IT IS NEEDED</span><b>Vendor backup is not an exit</b></div>
          <img loading="lazy" src="/images/diagrams/why-external-recovery.jpg" alt="Conceptual three-panel: dashboard locked, managed backup unreachable, external capsule recoverable" width="1920" height="1080" />
          <figcaption><span>Internal path compromised · external capsule survives</span><small>Conceptual</small></figcaption>
        </figure>
      </div>
      <div className="architecture architecture-open-core">
        <div className="arch-node source"><small>SOURCE</small><b>Supabase</b><span>Database · Auth · Storage · Functions</span></div>
        <div className="arch-flow"><span>OSS runner</span><i>→</i></div>
        <div className="arch-node vault"><small>COMMUNITY · FREE</small><b>Encrypt on your box</b><span>Capsule → Drive · Dropbox · NAS · your S3</span><div className="shield">OSS</div></div>
        <div className="arch-flow"><span>restore</span><i>→</i></div>
        <div className="arch-node recovery"><small>TARGET</small><b>New Supabase</b><span>New account · New project · Guarded restore</span></div>
      </div>
      <div className="cloud-sideband">
        <div><small>OPTIONAL CLOUD</small><b>Health events only</b><p>If you opt in, the runner sends status metadata to Portabase Cloud so missed cycles, verify failures, and RPO breaches can SMS/email a chain of people. Recovery still works if Cloud is down.</p></div>
        <div className="cloud-sideband-path"><span>runner</span><i>⇢</i><span>telemetry</span><i>⇢</i><span>console · SMS · Slack</span></div>
      </div>
      <div className="steps">
        <article><span>1</span><div><h3>Run the open-source engine yourself</h3><p>CLI or agent on infrastructure you control. Credentials and passphrase stay local. No Portabase account required to protect a project.</p></div></article>
        <article><span>2</span><div><h3>Capture the application—not just Postgres</h3><p>Database and Auth records, Storage objects, Function source, manifests, and checksums become one encrypted recovery capsule.</p></div></article>
        <article><span>3</span><div><h3>Verify more than an upload message</h3><p>Destination integrity, ciphertext, AES-GCM authentication, and decrypted payload. Partial layers stay partial — never fake-green.</p></div></article>
        <article><span>4</span><div><h3>Restore offline; alert via Cloud if you want</h3><p>Guarded restore into a fresh project works without Cloud. Turn on Cloud when you want multi-person escalation if the schedule goes silent.</p></div></article>
      </div>
    </div>
  </section>;
}

function Audit() {
  const [answers, setAnswers] = useState({});
  const [started, setStarted] = useState(false);
  const score = useMemo(() => Math.round(Object.values(answers).filter(Boolean).length / auditItems.length * 100), [answers]);
  const complete = Object.keys(answers).length === auditItems.length;
  const label = score >= 88 ? 'RECOVERY READY' : score >= 63 ? 'EXPOSED' : score >= 38 ? 'HIGH RISK' : 'NOT RECOVERABLE';
  const toggle = (key, value) => setAnswers(current => ({ ...current, [key]: value }));
  return <section className="section audit" id="audit">
    <div className="shell audit-shell">
      <div className="audit-intro"><div className="section-kicker">60-SECOND RECOVERY CHECK</div><h2>Could your business survive losing the dashboard tonight?</h2><p>Answer before the emergency answers for you. No credentials, no signup, and nothing leaves this browser.</p>{!started && <button className="button button-primary" onClick={() => setStarted(true)}>Check my exposure <Arrow /></button>}
        <div className="privacy-stamp"><span>⊘</span><div><b>ZERO-KNOWLEDGE CHECK</b><small>Your answers are never transmitted or stored.</small></div></div>
      </div>
      <div className={started ? 'audit-panel active' : 'audit-panel'}>
        {!started ? <div className="audit-placeholder banned"><img src="/images/supabase-banned.jpg" alt="Actual Supabase sign-in screen showing the error: User is banned" /><div><b>This is what losing the dashboard looks like.</b><span>8 questions reveal whether your business can recover from it.</span></div></div> : <>
          <div className="score-line"><div><span>RECOVERY SCORE</span><b>{score}<small>/100</small></b></div><strong className={`risk risk-${label.toLowerCase().replace(' ', '-')}`}>{complete ? label : 'IN PROGRESS'}</strong></div>
          <div className="audit-list">{auditItems.map(([key, title, help], index) => <div className="audit-item" key={key}><span>{index + 1}</span><div><b>{title}</b><small>{help}</small></div><div className="choice"><button className={answers[key] === true ? 'yes selected' : 'yes'} onClick={() => toggle(key, true)}>Yes</button><button className={answers[key] === false ? 'no selected' : 'no'} onClick={() => toggle(key, false)}>No</button></div></div>)}</div>
          {complete && <div className="audit-result"><b>{score < 63 ? 'Your current plan depends on the thing that may fail.' : 'You have a foundation. Now prove the complete recovery path.'}</b><a href="mailto:escape@portabase.dev?subject=My Portabase recovery score">Build my escape plan <Arrow /></a></div>}
        </>}
      </div>
    </div>
  </section>;
}

function Cutover() {
  return <section className="section cutover"><div className="shell cutover-card">
    <div>
      <div className="section-kicker green">TWO RECOVERY PATHS · BYO VAULT</div>
      <h2>Same capsule.<br />Your storage.</h2>
      <p>No S3 or Dropbox yet? <strong>Local Starter</strong> keeps encrypted capsules on this computer (or USB/NAS) while each capsule is ≤ 100 MB. Prefer S3/Dropbox when you can — Portabase never hosts recovery bytes.</p>
      <a className="button button-light" href="/cloud">Compare the two paths <Arrow /></a>
    </div>
    <div className="vault-demo" role="img" aria-label="Customer-owned vault destinations: Amazon S3, Dropbox, and Local Starter under 100 MB available; Google Cloud Storage and Drive, Azure Blob, Backblaze B2, and Cloudflare R2 coming soon">
      <div className="vault-demo-chrome">
        <span className="vault-demo-title">CUSTOMER-OWNED VAULT</span>
        <span className="vault-demo-badge">NO PORTABASE STORAGE</span>
      </div>
      <div className="vault-stream">
        <i /><i /><i />
        <em>AES-256-GCM capsule stream · keys on your runner</em>
        <i /><i /><i />
      </div>
      <div className="vault-tier">
        <header><span className="led live" /><b>AVAILABLE NOW</b><small>production destinations</small></header>
        <div className="vault-grid live three">
          <article className="vault-tile live">
            <span className="vault-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none"><path d="M6 22c0-4.4 3.1-8 7.2-8.8C14.4 9.4 17.8 7 22 7c4.4 0 8 3.1 8.8 7.2 3.6.8 6.2 4 6.2 7.8 0 4.4-3.6 8-8 8H14c-4.4 0-8-3.6-8-8z" stroke="currentColor" strokeWidth="1.4"/><path d="M11 18h10M11 21h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </span>
            <div>
              <small>OBJECT STORE</small>
              <b>Amazon S3</b>
              <span className="status-ok">● Online · customer bucket</span>
            </div>
          </article>
          <article className="vault-tile live">
            <span className="vault-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none"><path d="M8 10h16v14H8z" stroke="currentColor" strokeWidth="1.4"/><path d="M12 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" strokeWidth="1.4"/><path d="M12 17h8M12 20h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </span>
            <div>
              <small>FILE CLOUD</small>
              <b>Dropbox</b>
              <span className="status-ok">● Online · your account</span>
            </div>
          </article>
          <article className="vault-tile live">
            <span className="vault-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none"><rect x="6" y="8" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M10 20h12M10 16h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </span>
            <div>
              <small>NO CLOUD NEEDED</small>
              <b>Local Starter</b>
              <span className="status-ok">● This PC / USB · ≤100 MB</span>
            </div>
          </article>
        </div>
      </div>
      <div className="vault-tier soon">
        <header><span className="led soon" /><b>COMING SOON</b><small>top-tier destinations on the roadmap</small></header>
        <div className="vault-grid soon">
          <article className="vault-tile soon">
            <span className="soon-chip">COMING SOON</span>
            <small>GCP + CONSUMER</small>
            <b>GCP Storage / G-Drive</b>
            <span>Cloud Storage · Google Drive</span>
          </article>
          <article className="vault-tile soon">
            <span className="soon-chip">COMING SOON</span>
            <small>MICROSOFT</small>
            <b>Azure Blob</b>
            <span>Enterprise object store</span>
          </article>
          <article className="vault-tile soon">
            <span className="soon-chip">COMING SOON</span>
            <small>INDEPENDENT</small>
            <b>Backblaze B2</b>
            <span>S3-compatible archive</span>
          </article>
          <article className="vault-tile soon">
            <span className="soon-chip">COMING SOON</span>
            <small>EDGE</small>
            <b>Cloudflare R2</b>
            <span>Zero-egress object store</span>
          </article>
        </div>
      </div>
      <div className="vault-footer">
        <span>Your credentials · Your encryption key · Your destination</span>
        <b><i /></b>
      </div>
    </div>
  </div></section>;
}

/** Label-accurate how-it-works diagrams (HTML/CSS) plus conceptual marketing panels. */
function HowItWorksDiagrams() {
  return <section className="section how-diagrams" id="how-it-works" aria-label="How Portabase works">
    <div className="shell">
      <div className="section-kicker green">HOW IT WORKS</div>
      <h2>Diagrams that explain the job — and why it exists.</h2>
      <p className="cloud-section-lead">Recovery bytes and encryption keys stay on infrastructure you control. Cloud is an optional side channel for health and alerts — never the place capsules live.</p>

      <div className="viz-panel-grid">
        <figure className="viz-panel">
          <div className="viz-panel-label"><span>CONCEPT · RECOVERY ARCHITECTURE</span><b>Banned account ≠ lost business</b></div>
          <img loading="lazy" src="/images/diagrams/recovery-architecture.jpg" alt="Conceptual diagram: locked Supabase account, customer runner encrypting capsules, destination storage, optional Cloud alerts only" width="1920" height="1080" />
          <figcaption>
            <span>Your runner already holds last-good capsules outside the locked dashboard. Optional Cloud only pages people.</span>
            <small>Conceptual illustration · not a live console</small>
          </figcaption>
        </figure>
        <figure className="viz-panel">
          <div className="viz-panel-label"><span>CONCEPT · WHY EXTERNAL RECOVERY</span><b>Vendor backup dies with the login</b></div>
          <img loading="lazy" src="/images/diagrams/why-external-recovery.jpg" alt="Three-panel concept: dashboard locked, managed vendor backup unreachable, customer capsule outside still restorable" width="1920" height="1080" />
          <figcaption>
            <span>Internal path compromised. External capsule still restorable — that is the entire product thesis.</span>
            <small>Conceptual illustration · product model</small>
          </figcaption>
        </figure>
      </div>

      <figure className="flow-diagram">
        <figcaption>
          <span>DIAGRAM 01 · RECOVERY PATH (GITHUB / SELF-HOST)</span>
          <b>Full job without a Portabase account</b>
        </figcaption>
        <div className="flow-track" role="img" aria-label="Supabase source to runner encrypt to your storage to new Supabase project">
          <div className="flow-node">
            <small>SOURCE</small>
            <strong>Supabase</strong>
            <span>DB · Auth · Storage · Functions</span>
          </div>
          <div className="flow-arrow" aria-hidden="true"><i /><em>capture</em></div>
          <div className="flow-node accent">
            <small>YOUR RUNNER</small>
            <strong>Open-source engine</strong>
            <span>Encrypt AES-256-GCM · checksum</span>
          </div>
          <div className="flow-arrow" aria-hidden="true"><i /><em>upload</em></div>
          <div className="flow-node">
            <small>YOUR STORAGE</small>
            <strong>Capsule vault</strong>
            <span>Drive · Dropbox · S3 · NAS</span>
          </div>
          <div className="flow-arrow" aria-hidden="true"><i /><em>restore</em></div>
          <div className="flow-node">
            <small>TARGET</small>
            <strong>New Supabase</strong>
            <span>Guarded · never source ref</span>
          </div>
        </div>
        <p className="flow-note">GitHub edition includes this entire path: CLI, encrypt, verify, restore. No hosted GUI required.</p>
      </figure>

      <figure className="flow-diagram">
        <figcaption>
          <span>DIAGRAM 02 · WHERE KEYS LIVE (HOSTED CLOUD)</span>
          <b>Using our site does not move your passphrase</b>
        </figcaption>
        <div className="zones-diagram" role="img" aria-label="Three zones: runner secrets, your capsule storage, Portabase Cloud metadata only">
          <div className="zone zone-runner">
            <header><small>ZONE A · YOUR RUNNER</small><b>Secrets that decrypt</b></header>
            <ul>
              <li>Encryption passphrase</li>
              <li>Supabase URL + admin key</li>
              <li>Database URL</li>
              <li>Access token (Functions)</li>
            </ul>
            <footer>Never stored in Portabase Cloud DB</footer>
          </div>
          <div className="zone zone-vault">
            <header><small>ZONE B · YOUR DESTINATION</small><b>Encrypted capsules</b></header>
            <ul>
              <li>capsule.pbase (ciphertext)</li>
              <li>checksums · manifest meta</li>
              <li>Immutable dated copies</li>
            </ul>
            <footer>You choose Drive / Dropbox / S3 / local</footer>
          </div>
          <div className="zone zone-cloud">
            <header><small>ZONE C · PORTABASE CLOUD</small><b>Ops metadata only</b></header>
            <ul>
              <li>Login / workspace</li>
              <li>Agent token (hashed)</li>
              <li>Alert routes</li>
              <li>Opt-in health events</li>
            </ul>
            <footer>Cannot decrypt a capsule</footer>
          </div>
        </div>
        <p className="flow-note">Thick data path = A → B. Cloud (C) never sits in the middle of passphrase or capsule bytes.</p>
      </figure>

      <figure className="flow-diagram">
        <figcaption>
          <span>DIAGRAM 03 · OPTIONAL CLOUD SIDE CHANNEL</span>
          <b>GUI · telemetry · advanced reports · alert chains</b>
        </figcaption>
        <div className="sideband-diagram" role="img" aria-label="Runner optional thin telemetry to Cloud then SMS email Slack">
          <div className="sideband-row">
            <div className="flow-node accent">
              <small>YOUR RUNNER</small>
              <strong>Same OSS engine</strong>
              <span>Backup still local-first</span>
            </div>
            <div className="flow-arrow dashed" aria-hidden="true"><i /><em>opt-in health only</em></div>
            <div className="flow-node cloud">
              <small>PORTABASE CLOUD</small>
              <strong>Hosted console</strong>
              <span>Status · reports · fleet</span>
            </div>
            <div className="flow-arrow" aria-hidden="true"><i /><em>escalate</em></div>
            <div className="flow-node">
              <small>YOUR TEAM</small>
              <strong>Alert chain</strong>
              <span>SMS · email · Slack</span>
            </div>
          </div>
          <div className="sideband-legend">
            <span><i className="solid" /> Capsule path (always yours)</span>
            <span><i className="dash" /> Telemetry path (Cloud subscription · opt-in)</span>
          </div>
        </div>
        <p className="flow-note">If Cloud is offline, restore still works from Zone B + passphrase on Zone A. That is the transparency guarantee.</p>
      </figure>
    </div>
  </section>;
}

/** Public first-hand reports: accounts closed / banned with little or no usable notice. */
function ClosureRisk({ variant = 'home' } = {}) {
  const [providerFilter, setProviderFilter] = useState('All');
  const reasons = useMemo(
    () => (providerFilter === 'All' ? closureReasons : closureReasons.filter(r => r.provider === 'Both' || r.provider === providerFilter)),
    [providerFilter],
  );
  const cases = useMemo(
    () => (providerFilter === 'All' ? closureCases : closureCases.filter(c => c.provider === providerFilter)),
    [providerFilter],
  );
  const filters = ['All', 'Supabase', 'AWS'];

  return <section className={`section closure-risk${variant === 'cloud' ? ' closure-risk-cloud' : ''}`} id="closures">
    <div className="shell">
      <div className="section-kicker red">PUBLIC REPORTS · NOT LEGAL FINDINGS</div>
      <div className="split-heading">
        <h2>Accounts close without a usable exit.</h2>
        <p>These are first-hand public posts from GitHub Discussions, Reddit, and mirrored Discord support threads. Exact source URLs are preserved. Posts are at least several months old where durable IDs allow. A report is what someone said happened — not independent proof of cause, and not a claim that every ban is wrongful.</p>
      </div>

      <div className="closure-filter" role="tablist" aria-label="Filter by provider">
        {filters.map(f => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={providerFilter === f}
            className={providerFilter === f ? 'is-active' : ''}
            onClick={() => setProviderFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="closure-reasons-block">
        <div className="closure-block-head">
          <span>WHY IT CAN HAPPEN WITHOUT WARNING YOU CAN USE</span>
          <h3>Ordinary triggers. Same immediate problem: the dashboard is gone.</h3>
        </div>
        <div className="closure-reason-grid">
          {reasons.map((reason, i) => (
            <article key={reason.id}>
              <b>{String(i + 1).padStart(2, '0')}</b>
              <div>
                <div className="closure-reason-meta">
                  <strong>{reason.title}</strong>
                  <em>{reason.provider === 'Both' ? 'Supabase · AWS' : reason.provider}</em>
                </div>
                <p>{reason.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="closure-cases-block">
        <div className="closure-block-head">
          <span>SOURCED CASES · PERMANENT-ISH LINKS</span>
          <h3>Real users. Real lockouts. Click through to the original post.</h3>
        </div>
        <div className="closure-case-grid">
          {cases.map(c => (
            <a className="closure-case" href={c.href} target="_blank" rel="noreferrer" key={c.id}>
              <div className="closure-case-top">
                <span className={`provider-pill provider-${c.provider.toLowerCase()}`}>{c.provider}</span>
                <span className="closure-tag">{c.tag}</span>
              </div>
              <h4>{c.title}</h4>
              <p>{c.body}</p>
              <div className="closure-case-foot">
                <span>
                  <small>{c.platform}</small>
                  <time dateTime={c.date}>{c.date}</time>
                  <em>{c.source}</em>
                </span>
                <Arrow />
              </div>
              <code className="closure-url" title={c.href}>{c.href}</code>
            </a>
          ))}
        </div>
        <p className="closure-disclaimer">
          <strong>Framing:</strong> We publish public accounts of lockout and closure risk so builders treat provider-held recovery as insufficient.
          We do not assert that any named provider violated law or its own terms in a specific case.
          Read the original thread; preserve the URL; decide for yourself.
        </p>
      </div>
    </div>
  </section>;
}

function CloudTeaser() {
  return <section className="section cloud-teaser" id="cloud-teaser">
    <div className="shell cloud-teaser-card">
      <div>
        <div className="section-kicker green">USP · ESCAPE OPS</div>
        <h2>Open source is the Escape.<br />Cloud keeps the Escape running.</h2>
        <p><strong>Supabase only.</strong> GitHub = free Escape engine. <strong>This site</strong> = hosted <strong>GUI</strong>, guided configuration, <strong>telemetry</strong>, SMS on success/failure — so the Escape is not a forgotten cron job. <strong>7-day free trial</strong> then <strong>$17/mo</strong> (1 escape / 24h) or <strong>$27/mo</strong> (up to 3 escapes / day) · ≤12 agents. You provide capsule storage.</p>
        <div className="cloud-teaser-actions">
          <a className="button button-primary" href="/login?mode=signup&next=/app">Start free trial <Arrow /></a>
          <a className="button button-ghost" href="/cloud">Open source vs Cloud <Arrow /></a>
          <a className="button button-ghost" href="/app?demo=1">Open console demo <Arrow /></a>
        </div>
      </div>
      <div className="cloud-teaser-price">
        <span>GUI · CONFIG · TELEMETRY · SMS</span>
        <b>$17–27<small>/mo</small></b>
        <em>Card required · auto-converts</em>
        <p>After 7-day free trial</p>
      </div>
    </div>
  </section>;
}

/** Opportunity deal framing: keep Supabase, remove SPOF */
function PublicDeal() {
  return <section className="section" id="deal" style={{ background: '#0a0b0d', borderTop: '1px solid #2a2b30' }}>
    <div className="shell">
      <div className="section-kicker green">USP · YOUR SUPABASE ESCAPE</div>
      <div className="split-heading">
        <h2>Keep Supabase.<br /><em>Own the Escape.</em></h2>
        <p><strong>USP:</strong> Portabase is your <strong>Supabase Escape</strong> — open source, Supabase-only. Encrypted capsule you control (database, Auth, <strong>Storage objects</strong>, <strong>Edge Functions</strong>) so lockout is not the end. This website is Cloud convenience: <strong>GUI, easier configuration, and telemetry</strong> — so the Escape stays real day to day, not a dusty script.</p>
      </div>
      <div className="gap-callout" style={{ marginTop: 28, marginBottom: 8, padding: '22px 24px', border: '1px solid rgba(201,255,74,.35)', background: 'rgba(201,255,74,.05)' }}>
        <div className="section-kicker green" style={{ marginBottom: 10 }}>SUPABASE PLATFORM BACKUPS · THE GAP</div>
        <h3 style={{ margin: '0 0 12px', fontSize: 22, letterSpacing: '-.03em' }}>Their backup is not a full product escape hatch.</h3>
        <p style={{ margin: 0, color: '#b4b4ae', fontSize: 15, lineHeight: 1.65, maxWidth: 820 }}>
          Supabase documents that <strong>database backups do not include objects stored via the Storage API</strong> — the database holds <em>metadata</em> about files, not the file bytes themselves.
          <a href="https://supabase.com/docs/guides/platform/backups" target="_blank" rel="noreferrer" style={{ color: 'var(--acid)', fontWeight: 700 }}> Official backups docs ↗</a>
          {' '}Edge Function source is managed outside that Postgres snapshot path — a DB-only restore does not bring back your Storage files or redeploy Functions for you.
          <strong style={{ color: '#f0eee8' }}> Portabase captures Storage object bytes and Function source as first-class layers.</strong>
        </p>
      </div>
      <div className="dual-version-grid" style={{ marginTop: 28 }}>
        <article>
          <small>OPEN SOURCE</small>
          <b>Full recovery engine · free</b>
          <p>CLI / self-host: DB · Auth · Storage bytes · Edge Functions. Encrypt, verify, guarded restore. No Portabase login required.</p>
        </article>
        <article>
          <small>THIS WEBSITE · CLOUD</small>
          <b>GUI · easy config · telemetry</b>
          <p>Hosted console, setup wizards, job status, SMS success/failure, multi-person alerts. Same engine under the hood. Capsules still land in <em>your</em> storage.</p>
        </article>
        <article>
          <small>WHEN LOCKED OUT</small>
          <b>New Supabase project · Replay</b>
          <p>Restore into a fresh blank project — never silent overwrite of production. Prove it before the emergency.</p>
        </article>
        <article>
          <small>NOT RIGHT NOW</small>
          <b>Other BaaS · Portabase as your blob store</b>
          <p>Launch scope is Supabase only. We are not your object-storage landlord. You bring S3, Dropbox, Drive, or NAS.</p>
        </article>
      </div>
      <div className="cloud-teaser-actions" style={{ marginTop: 28 }}>
        <a className="button button-primary" href="/cloud#subscribe">Cloud · GUI &amp; telemetry <Arrow /></a>
        <a className="button button-ghost" href="https://github.com/DataAutomation-ai" target="_blank" rel="noreferrer">Open-source engine <Arrow /></a>
      </div>
    </div>
  </section>;
}

function CloudPage() {
  const signedIn = Boolean(loadSession()?.idToken);

  useEffect(() => {
    document.title = 'Portabase Cloud — Open source vs hosted · 7-day trial';
    if (window.location.hash === '#subscribe') {
      document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return <>
    <header className="site-header">
      <div className="shell nav-wrap">
        <Logo href="/" />
        <nav className="nav cloud-page-nav">
          <a href="#how-it-works">How it works</a>
          <a href="#closures">Why accounts close</a>
          <a href="#compare">Compare</a>
          <a href="#keys">Key storage</a>
          <a href="#github">GitHub</a>
          <a href="#subscribe">Pricing</a>
          <a href={signedIn ? '/app' : '/login'}>{signedIn ? 'Console' : 'Sign in'}</a>
        </nav>
        <a className="button button-small desktop-cta" href={signedIn ? '/app' : '/login?mode=signup&next=/app'}>
          {signedIn ? 'Open console' : 'Start 7-day trial'} <Arrow />
        </a>
      </div>
    </header>

    <main className="cloud-page">
      <section className="section cloud-hero">
        <div className="shell">
          <div className="section-kicker green">USP · YOUR SUPABASE ESCAPE</div>
          <h1>GitHub is the Escape hatch.<br />This site is the Escape console.</h1>
          <p className="cloud-hero-lead"><strong>USP: Escape.</strong> Supabase only. Open-source engine does full recovery — including <strong>Storage object bytes and Edge Functions</strong> that platform DB backups leave behind. <strong>This website</strong> is the Cloud GUI, easier configuration, and telemetry so the Escape is operable — not a forgotten script.</p>
          <div className="cloud-hero-actions">
            <a className="button button-primary" href={signedIn ? '/app' : '/login?mode=signup&next=/app'}>Start 7-day free trial <Arrow /></a>
            <a className="button button-ghost" href="/app?demo=1">Open full console (demo) <Arrow /></a>
            <a className="button button-ghost" href="#subscribe">See trial → subscription <Arrow /></a>
            <a className="button button-ghost" href="https://github.com/DataAutomation-ai" target="_blank" rel="noreferrer">GitHub · open source <Arrow /></a>
          </div>
        </div>
      </section>

      <HowItWorksDiagrams />
      <ClosureRisk variant="cloud" />

      <section className="section cloud-compare" id="compare">
        <div className="shell">
          <div className="section-kicker">SIDE BY SIDE</div>
          <h2>Same capsule engine.<br />Different day-to-day experience.</h2>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>GitHub / self-host<br /><span>Apache-2.0 · free</span></th>
                  <th>Portabase Cloud<br /><span>$17 · 1 escape/24h · or · $27 · 3 escapes/day</span></th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Built for <strong>Supabase only</strong> (launch)</td><td className="yes">Yes</td><td className="yes">Yes</td></tr>
                <tr><td>Storage <strong>object bytes</strong> (not metadata-only)</td><td className="yes">Yes</td><td className="yes">Yes · same engine</td></tr>
                <tr><td>Edge Function source capture</td><td className="yes">Yes</td><td className="yes">Yes · same engine</td></tr>
                <tr><td>Full encrypted capture (DB, Auth, Storage, Functions)</td><td className="yes">Yes — complete job</td><td className="yes">Yes — same engine</td></tr>
                <tr><td>Verify + guarded restore to a new Supabase project</td><td className="yes">Yes</td><td className="yes">Yes</td></tr>
                <tr><td>Destinations (Drive, Dropbox, S3, local/NAS)</td><td className="yes">Yes</td><td className="yes">Yes</td></tr>
                <tr><td>Works offline if Portabase Cloud disappears</td><td className="yes">Yes</td><td className="yes">Engine still yes</td></tr>
                <tr><td>Read every line that encrypts your capsule</td><td className="yes">Yes · public GitHub</td><td className="yes">Same public code</td></tr>
                <tr><td>Hosted GUI / ease of configuration</td><td className="no">CLI / self-host config</td><td className="yes">Yes · this website</td></tr>
                <tr><td>Telemetry &amp; fleet / job status</td><td className="no">Local status only</td><td className="yes">Yes</td></tr>
                <tr><td>SMS on success &amp; failure · multi-person alerts</td><td className="no">DIY webhooks only</td><td className="yes">Yes</td></tr>
                <tr><td>Advanced reports &amp; RPO / miss dashboards</td><td className="no">No</td><td className="yes">Yes</td></tr>
                <tr><td>Portabase account required</td><td className="no">No</td><td className="mid">Yes · for Cloud only</td></tr>
              </tbody>
            </table>
          </div>
          <p className="compare-footnote">The GitHub edition is not a lite edition. It is the full recovery path without the hosted GUI, telemetry product, or advanced reports.</p>
        </div>
      </section>

      <section className="section cloud-keys" id="keys">
        <div className="shell">
          <div className="section-kicker green">KEY STORAGE · HOSTED CLOUD</div>
          <h2>How keys work if you use our hosted site.</h2>
          <p className="cloud-section-lead">Using Portabase Cloud does not mean we become your Supabase landlord. Recovery secrets and capsule encryption stay off our product database. Full model: customer KMS, CloudTrail, and job CloudWatch — <a href="/security" style={{ color: 'var(--acid)', fontWeight: 700 }}>Security &amp; trust <span aria-hidden="true">↗</span></a>.</p>
          <div className="key-grid">
            <article>
              <small>ON YOUR RUNNER (ALWAYS)</small>
              <b>Encryption passphrase</b>
              <p>AES-256-GCM key material for capsules. Set via env / OS secret store on the machine or container that runs escapes. <strong>Never uploaded to Portabase Cloud</strong> and never stored in our control-plane database.</p>
            </article>
            <article>
              <small>ON YOUR RUNNER (ALWAYS)</small>
              <b>Supabase &amp; database credentials</b>
              <p>Project URL, service role / secret key, DB URL, access token — read only from your environment when capture or restore runs. Cloud does not proxy or vault these for capsule build.</p>
            </article>
            <article>
              <small>ON YOUR DESTINATION</small>
              <b>Encrypted capsules</b>
              <p>`.pbase` files land in Drive, Dropbox, S3, or local/NAS you choose. Portabase Cloud is not the storage of record for recovery bytes.</p>
            </article>
            <article>
              <small>ON PORTABASE CLOUD (HOSTED)</small>
              <b>Account &amp; ops metadata only</b>
              <p>Login identity (Supabase Auth), workspace membership, agent tokens (hashed), alert routes, and opt-in health events (job status, timing, error class). Enough to run the console and page people — not enough to decrypt a capsule.</p>
            </article>
          </div>
          <div className="key-callout">
            <span>HOSTED TRANSPARENCY</span>
            <b>If Cloud is down, you still restore from the capsule + passphrase on infrastructure you control.</b>
            <p>Subscription value is visibility and escalation. The open-source engine on GitHub remains the recovery authority. Agent telemetry is opt-in and schema-documented; it rejects secret-shaped fields.</p>
          </div>
        </div>
      </section>

      <section className="section cloud-github" id="github">
        <div className="shell">
          <div className="section-kicker">GITHUB EDITION · FULL JOB</div>
          <h2>Transparent source. Complete recovery path.</h2>
          <div className="github-split">
            <div>
              <p>The public GitHub edition (under <a href="https://github.com/DataAutomation-ai" target="_blank" rel="noreferrer">DataAutomation.ai</a> / Portabase open core) ships everything required to protect and restore a Supabase project:</p>
              <ul className="github-list">
                <li>Capture database structure and data, Auth material, Storage objects, Edge Functions</li>
                <li>Local AES-256-GCM encryption and checksums</li>
                <li>Transfer to customer destinations and post-transfer verify</li>
                <li>Guarded restore into a <em>new</em> project (never silent overwrite of source)</li>
                <li>CLI: init, doctor, capture (backup command), verify, status, restore, schedule helpers</li>
              </ul>
              <p>What GitHub deliberately does <strong>not</strong> include as a hosted product: the multi-tenant management GUI, Portabase-operated telemetry inbox, multi-person SMS escalation product, and advanced fleet reports. Those are Cloud.</p>
              <a className="button button-ghost" href="https://github.com/DataAutomation-ai" target="_blank" rel="noreferrer">Browse the open-source home <Arrow /></a>
            </div>
            <aside className="github-aside">
              <span>WHY THIS MATTERS</span>
              <b>You can prove what encrypts your data.</b>
              <p>High-profile recovery software should not hide the crypto path behind a paid binary. Cloud is optional convenience and ops — the GitHub tree remains readable and runnable without a Portabase login.</p>
            </aside>
          </div>
        </div>
      </section>

      <section className="section pricing" id="subscribe">
        <div className="shell pricing-grid">
          <div className="price-copy">
            <div className="section-kicker green">SUPABASE · SQUARE · TWO PLANS · BYO STORAGE</div>
            <h2>Seven free days.<br />Then $17 or $27/mo.</h2>
            <p><strong>Launch: Supabase only.</strong> Protect database, Auth, Storage, and Edge Functions. <strong>Payment: Square</strong> (card on file). Cloud is ops only — <strong>you provide capsule storage</strong>. Portabase never hosts recovery bytes.</p>
            <div className="subscribe-case">
              <article><small>01 · SUPABASE FIRST</small><b>Built for Supabase projects.</b><p>Sign in with Supabase Auth (email or Google). Capture DB, Auth inventory, Storage objects, Edge Functions.</p></article>
              <article><small>02 · TWO PLANS</small><b>$17 · 1 escape / 24h · or · $27 · up to 3 escapes / day.</b><p>Pick how often an escape may run. SMS on success and failure. Up to 12 agents.</p></article>
              <article><small>03 · BYO CAPSULE STORAGE</small><b>You supply the vault.</b><p>S3, Dropbox, NAS, or Local Starter (≤100 MB). Capsules never live on Portabase. Keys stay on your runner.</p></article>
            </div>
            <div className="one-time-math">
              <div><small>TRIAL</small><b>$0<span className="per">/7d</span></b></div>
              <span>→</span>
              <div><small>DAILY</small><b>$17<span className="per">/mo</span></b></div>
              <span>or</span>
              <div><small>TRIPLE</small><b>$27<span className="per">/mo</span></b></div>
            </div>
            <div className="price-note"><span>Capsule storage</span><p><strong>Required from you.</strong> Portabase Cloud does not sell or host capsule storage. You pay S3/Drive/Dropbox/NAS yourself.</p></div>
          </div>
          <div className="price-card">
            <div className="price-ribbon">SQUARE · $17 OR $27 · YOU PROVIDE STORAGE</div>
            <div className="price-top">
              <span>PORTABASE CLOUD</span>
              <div className="price-stack">
                <b>$17<span className="per">/mo</span></b>
                <small className="list-price">1 escape per 24 hours · or upgrade to $27 for up to 3 escapes / day</small>
              </div>
              <p>Ops console, telemetry, multi-person alerts. Capsules encrypt on your runner and land in <strong>your</strong> storage.</p>
            </div>
            <div className="promo-chip"><strong>Payment: Square.</strong> Card required. Trial free 7 days → <strong>$17</strong> (1 escape/24h) or <strong>$27</strong> (up to 3 escapes/day). Storage is always bring-your-own.</div>
            <div className="purchase-definition">
              <span>WHAT YOU BRING</span>
              <strong>Capsule storage + runner secrets</strong>
              <p>Destination for <code>.pbase</code> capsules (S3/Drive/etc.) and passphrase on your machine. Cloud never stores those.</p>
            </div>
            <ul>
              <li><span>✓</span> Supabase projects only (launch)</li>
              <li><span>✓</span> $17 · 1 escape / 24h</li>
              <li><span>✓</span> $27 · up to 3 escapes / day</li>
              <li><span>✓</span> SMS on success &amp; failure · up to 12 agents</li>
              <li><span>✓</span> 7-day free trial · card on file</li>
              <li><span>✓</span> You provide capsule storage</li>
              <li><span>✓</span> Console · telemetry · alert chains</li>
              <li><span>✓</span> Keys &amp; capsules stay yours</li>
            </ul>
            <a className="button button-primary purchase" href={signedIn ? '/app/account?tab=billing' : '/login?mode=signup&next=/app'}>
              {signedIn ? 'Open console · start Square trial' : 'Sign in with Supabase Auth'} <Arrow />
            </a>
            <p className="checkout-hint">Already have an account? <a href="/login">Sign in</a></p>
            <div className="square-trust"><span><b>Square</b> · $17 · 1 escape/24h</span><span>$27 · up to 3 escapes/day</span><span>SMS · BYO storage</span></div>
          </div>
        </div>
      </section>
    </main>
    <Footer />
  </>;
}

function LegacyPurchaseNotice() {
  return <div className="thanks"><div className="thanks-card"><Logo href="/" /><div className="section-kicker green">MODEL UPDATE</div><h1>Portabase is open core + Cloud subscription.</h1><p>There is no $147 software unlock. The recovery engine is free on GitHub. Portabase Cloud is $17/mo (1 escape per 24h) or $27/mo (up to 3 escapes per day) — console, telemetry, and alert chains.</p><a className="button button-primary" href="/cloud">Open source vs Cloud <Arrow /></a><a className="button button-ghost" href="mailto:escape@portabase.dev?subject=Legacy Portabase purchase">Legacy purchase help <Arrow /></a></div></div>;
}

function Footer() {
  return <footer><div className="shell footer-main"><div><Logo href="/" /><p>Your Supabase Escape.<br />Open source. Cloud optional.</p></div><div><b>EXPLORE</b><a href="/#reality">The reality</a><a href="/#closures">Account closures</a><a href="/#stories">Real incidents</a><a href="/#escape">Escape plan</a><a href="/#audit">Risk check</a><a href="/security">Security &amp; trust</a><a href="/cloud">Cloud · $17 / $27</a></div><div><b>CONTACT</b><a href="mailto:escape@portabase.dev">escape@portabase.dev</a><a href="https://github.com/DataAutomation-ai" target="_blank" rel="noreferrer">GitHub · DataAutomation.ai</a><span>Independent product.<br />Not affiliated with Supabase.</span><span>Apache-2.0 open core. Cloud is ops subscription — never custody of keys or capsule contents. $17/mo · 1 escape/24h · or · $27/mo · up to 3 escapes/day.</span></div></div><div className="shell footer-bottom"><span>© 2026 Portabase</span><span>Your keys. Your cloud. Your way out.</span></div></footer>;
}

/**
 * Security & trust — customer picks posture: trust Portabase, mix controls, or maximum self-control.
 * Aesthetic: audit-brief instrument panel; memorable “choose your trust dial.”
 */
function SecurityPage() {
  useEffect(() => { document.title = 'Portabase — Security & trust'; window.scrollTo(0, 0); }, []);
  return (
    <div className="security-page">
      <header className="site-header security-header">
        <div className="shell nav-wrap">
          <Logo href="/" />
          <nav className="nav cloud-page-nav">
            <a href="#choose">Choose trust</a>
            <a href="#options">Controls</a>
            <a href="#retroactive">Past access</a>
            <a href="#honest">Honest limits</a>
            <a href="/cloud">Cloud pricing</a>
          </nav>
          <a className="button button-small desktop-cta" href="/login?next=/app">Start free trial <Arrow /></a>
        </div>
      </header>

      <main>
        <section className="security-hero">
          <div className="shell">
            <div className="section-kicker green">SECURITY · YOUR CHOICE</div>
            <h1>You don’t need to be a cloud expert.<br /><em>The serious options are still there.</em></h1>
            <p className="security-lead">
              Most people just want a recovery path that works. <strong>That’s fine.</strong> Start with “trust Portabase,” point capsules at storage you own, and go.
              For buyers (or future-you) who care about KMS, CloudTrail, and job logs: those controls are <strong>available and visible</strong> —
              not homework, but proof the product was built for scrutiny.
            </p>
            <div className="security-hero-proof">
              <span>Default: simple &amp; managed</span>
              <span>Vault stays yours</span>
              <span>Optional: trust us</span>
              <span>Optional: your KMS</span>
              <span>Optional: CloudTrail</span>
              <span>Optional: job logs</span>
            </div>
            <div className="security-honest-banner" role="note">
              <strong>Up front:</strong> On managed Cloud, a runner must use encryption material to do its job.
              That means <strong>there is still a possibility that Portabase can see or use a key</strong> during a run —
              especially on the simple “Trust Portabase” path. We reduce that risk with customer KMS, short job windows, and your audit trails.
              We will <strong>not</strong> pretend the risk is zero.
            </div>
          </div>
        </section>

        <section className="section security-picture" id="choose">
          <div className="shell">
            <div className="section-kicker">FOR EVERY KIND OF USER</div>
            <h2>Assurance without a security degree.</h2>
            <p className="security-prose">
              You should not have to configure AWS KMS to feel safe signing up. Seeing that <strong>customer KMS, CloudTrail, and CloudWatch exist as real options</strong>
              is itself a signal: we’re not hiding behind “just trust us” with nothing stronger behind the curtain.
              Use the simple path today. Grow into the locks if your team or auditors ever ask.
              Either way, read the honest line above: <strong>managed recovery is not the same as “we never see a key.”</strong>
            </p>
            <div className="security-tier-grid" id="tiers">
              <article className="security-tier security-tier-trust">
                <small>MOST PEOPLE START HERE</small>
                <h3>Trust Portabase</h3>
                <p className="security-tier-tag">No AWS jargon required</p>
                <p>We run the jobs. You connect Supabase and where capsules should live. You don’t need to know what KMS is. When you’re ready for more control, the stronger options are already on the menu.</p>
                <ul>
                  <li>Fastest path from signup to first protected capsule</li>
                  <li>We handle unattended schedules and staging</li>
                  <li>Your recovery files still sit in storage you own</li>
                  <li>Nothing locks you out of tighter security later</li>
                </ul>
                <div className="security-lock-foot">
                  Default human path — and the one where <strong>Portabase can see job keys</strong> by design so schedules work unattended.
                  Choose this only if that trade-off is acceptable.
                </div>
              </article>
              <article className="security-tier security-tier-mix">
                <small>WHEN SOMEONE ASKS “BUT HOW?”</small>
                <h3>Turn on proofs</h3>
                <p className="security-tier-tag">Assurance without going all-in</p>
                <p>Even if you never touch the knobs, it helps to know job logs, CloudTrail guidance, and customer KMS are real. When a cofounder, investor, or security person asks, you have answers — and optional settings — not hand-waving.</p>
                <ul>
                  <li>Show job history in the console</li>
                  <li>Share our CloudTrail / KMS setup guide if they care</li>
                  <li>Enable only what your team actually needs</li>
                </ul>
                <div className="security-lock-foot">Visibility builds confidence. You can adopt controls <strong>gradually</strong>.</div>
              </article>
              <article className="security-tier security-tier-max">
                <small>WHEN COMPLIANCE SHOWS UP</small>
                <h3>Maximum control</h3>
                <p className="security-tier-tag">For teams that live in AWS</p>
                <p>Your KMS + your CloudTrail + job CloudWatch. Built for people who already speak that language — or for the consultant they hire. You don’t have to start here.</p>
                <ul>
                  <li>Keys under your CMK, revocable grant</li>
                  <li>API audit in your account</li>
                  <li>Job logs you can read anytime</li>
                </ul>
                <div className="security-lock-foot">There when you need it. <strong>Not a barrier to getting started.</strong></div>
              </article>
            </div>
          </div>
        </section>

        <section className="section security-locks" id="options">
          <div className="shell">
            <div className="section-kicker green">OPTIONAL CONTROLS</div>
            <h2>Every option is available.<br />None are forced.</h2>
            <p className="security-prose">
              Skim this list even if you never configure it. Knowing the product <strong>can</strong> do customer KMS and audit trails is part of the trust story.
              Power users and future audits will care; everyone else can stay on Trust Portabase.
            </p>

            <div className="security-lock-grid">
              <article className="security-lock">
                <span className="security-lock-num">A</span>
                <h3>Trust Portabase (keys for ops)</h3>
                <p className="security-lock-tag">Optional · simple</p>
                <p>Allow Portabase to hold job encryption material (or a wrapped form) so schedules run without you pasting a passphrase each night. Capsules still write to <strong>your</strong> vault.</p>
                <ul>
                  <li>Best “just make it work” experience</li>
                  <li>You are choosing operational trust in Portabase</li>
                  <li>You can migrate to customer KMS without re-platforming the product</li>
                </ul>
                <div className="security-lock-foot">
                  Explicit trade: <strong>convenience for operational trust in us</strong>.
                  End of day: <strong>yes, we may be able to see or use that key material</strong> while the subscription and job path exist.
                </div>
              </article>

              <article className="security-lock">
                <span className="security-lock-num">B</span>
                <h3>Your KMS key</h3>
                <p className="security-lock-tag">Optional · crypto authority</p>
                <p>Protect capsules under a CMK in <strong>your</strong> AWS account. Our runner uses a <strong>limited role you grant</strong>. Revoke the grant → our crypto path ends.</p>
                <ul>
                  <li>You own the CMK</li>
                  <li>Least-privilege grant for runners</li>
                  <li>Revoke anytime without our help desk</li>
                </ul>
                <div className="security-lock-foot">
                  Best control story — still honest: for the seconds a job runs, the runner <strong>uses</strong> crypto under your grant.
                  That is not “we never touch a key”; it is “you own authority and can cut us off.”
                </div>
              </article>

              <article className="security-lock">
                <span className="security-lock-num">C</span>
                <h3>Your CloudTrail</h3>
                <p className="security-lock-tag">Always yours when AWS is recording</p>
                <p>
                  When Portabase acts against <strong>your</strong> AWS resources (your KMS, your vault bucket), those API calls are subject to
                  <strong> your CloudTrail</strong> if Trail is on in your account. That history lives in <em>your</em> account —
                  you do not file a ticket with us to “request” it. We publish filters and a setup guide so non-experts can turn Trail on early.
                </p>
                <ul>
                  <li><code>kms:Encrypt</code> / <code>kms:Decrypt</code> (when you use customer KMS)</li>
                  <li><code>s3:PutObject</code> on your vault prefix</li>
                  <li>Alerts on unexpected principals — in your AWS console</li>
                </ul>
                <div className="security-lock-foot">
                  Honest limit: CloudTrail only keeps what it recorded. If Trail was off, AWS cannot invent past events.
                  <strong> Enable Trail once; then access is continuous and retroactive within retention.</strong>
                  {' '}In Cloud: <strong>Account → CloudTrail live</strong> shows a near-live feed (demo until you connect a read role).
                </div>
              </article>

              <article className="security-lock">
                <span className="security-lock-num">D</span>
                <h3>Job CloudWatch + console</h3>
                <p className="security-lock-tag">Always recorded · always yours to open</p>
                <p>
                  Every managed job is written to Portabase job history and CloudWatch-style logs for your workspace.
                  You do <strong>not</strong> have to “turn on logging” or request access first.
                  Open the console later — or months later within retention — and still see what ran.
                </p>
                <ul>
                  <li>Always on for Cloud jobs (not an upsell switch)</li>
                  <li>Status: running · finished · failed · timestamps · error class</li>
                  <li>Retroactive browse in console / log group within published retention</li>
                </ul>
                <div className="security-lock-foot">
                  Assurance for non-experts: you can ignore logs until you care — <strong>the record still accumulated.</strong>
                  {' '}In Cloud: <strong>Account → CloudWatch live</strong> tails logs <strong>scoped to one secret</strong> (not your whole account).
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="section security-how" id="retroactive">
          <div className="shell">
            <div className="section-kicker green">RETROACTIVE ACCESS</div>
            <h2>You don’t have to ask permission to see the past.</h2>
            <p className="security-prose">
              Non-experts should not fear “we only keep logs if you configured monitoring.”
              For Cloud, job activity is retained by default. For AWS-side crypto and vault writes under <em>your</em> account,
              your CloudTrail (once enabled) is the permanent customer-owned audit trail.
            </p>
            <div className="security-table-wrap">
              <table className="security-table">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Always collected?</th>
                    <th>Who can open it later without a special request?</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Job history + CloudWatch-style job logs</td>
                    <td>Yes — every managed run</td>
                    <td>You — console / log access for your workspace, within retention</td>
                  </tr>
                  <tr>
                    <td>CloudTrail on your KMS / S3</td>
                    <td>Yes, if Trail is enabled in your AWS account</td>
                    <td>You — entirely in your AWS account; we never gate it</td>
                  </tr>
                  <tr>
                    <td>Capsule objects</td>
                    <td>Yes — written to your vault each successful job</td>
                    <td>You — your bucket, your IAM</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="section security-how">
          <div className="shell">
            <div className="section-kicker">ALWAYS TRUE</div>
            <h2>What does not change between options</h2>
            <ol className="security-steps">
              <li>
                <b>We stage on managed runners</b>
                <p>Cloud customers are not required to stage multi‑GB jobs on a laptop. Ephemeral runner disk does the work.</p>
              </li>
              <li>
                <b>Capsules go to your binary storage</b>
                <p>BYO destination (S3, etc.). You own lifecycle and storage bill. Portabase is not the permanent vault product.</p>
              </li>
              <li>
                <b>Job logs accumulate even if you never open them</b>
                <p>Retroactive access in the console (within retention). No “request CloudWatch access” ticket to see your own history.</p>
              </li>
              <li>
                <b>You can tighten later</b>
                <p>Start on Trust Portabase; add customer KMS when you want. CloudTrail in your account covers AWS-side activity once enabled.</p>
              </li>
              <li>
                <b>Standalone always exists</b>
                <p>Open-source engine: you run everything. Stage local or on your cloud. Zero Portabase compute required for recovery.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section security-honest" id="honest">
          <div className="shell">
            <div className="section-kicker red">HONEST LIMITS</div>
            <h2>We will not claim we can never see a key.</h2>
            <p className="security-prose" style={{ color: '#a7a6a1' }}>
              At the end of the day, on managed Cloud there remains a <strong>possibility that Portabase personnel or systems can see or use encryption material</strong>
              for a job — because encryption has to happen somewhere a runner controls for that window.
              Customer KMS, CloudTrail, short-lived sessions, and revoke rights <strong>reduce and contain</strong> that risk.
              They do not make it magically impossible. If zero vendor key access is a hard requirement, use the <strong>standalone open-source engine</strong> on infrastructure only you operate.
            </p>
            <div className="security-honest-grid">
              <article>
                <b>Not “logs alone = zero access forever”</b>
                <p>CloudWatch and CloudTrail show recorded events. They support trust; they don’t replace key design or revoke paths.</p>
              </article>
              <article>
                <b>Not “Trust Portabase = we never see the key”</b>
                <p>On the simple path we hold job encryption material so unattended schedules work. That is operational trust in us — full stop.</p>
              </article>
              <article>
                <b>Not “customer KMS = we never touch crypto”</b>
                <p>Your CMK means <strong>you</strong> own authority and can revoke us. During a granted job, the runner still <strong>uses</strong> the key path. Audit that in your CloudTrail.</p>
              </article>
            </div>
            <div className="security-table-wrap">
              <table className="security-table">
                <thead>
                  <tr>
                    <th>Choice</th>
                    <th>Who holds crypto authority</th>
                    <th>Best for</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Trust Portabase</td>
                    <td>Portabase (job material under our ops)</td>
                    <td>Speed, unattended schedules, less AWS setup</td>
                  </tr>
                  <tr>
                    <td>Job CloudWatch / console</td>
                    <td>Unchanged — adds visibility</td>
                    <td>Seeing runs without owning KMS yet</td>
                  </tr>
                  <tr>
                    <td>Your CloudTrail</td>
                    <td>Unchanged — audit in your account</td>
                    <td>Security / compliance review</td>
                  </tr>
                  <tr>
                    <td>Your KMS CMK</td>
                    <td>You (revocable grant to runners)</td>
                    <td>Strongest revoke + procurement story</td>
                  </tr>
                  <tr>
                    <td>All three locks</td>
                    <td>You + full audit + job logs</td>
                    <td>Maximum robustness</td>
                  </tr>
                  <tr>
                    <td>Standalone OSS</td>
                    <td>You entirely</td>
                    <td>Zero Portabase compute</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="section security-standalone">
          <div className="shell security-standalone-inner">
            <div>
              <div className="section-kicker">STANDALONE ENGINE</div>
              <h2>Prefer zero Portabase compute?</h2>
              <p>Run the open-source engine yourself. Stage on local disk or your own cloud VM. Same capsule idea — you operate the runner entirely. Cloud is optional ops, not a gate on recovery.</p>
            </div>
            <div className="security-standalone-actions">
              <a className="button button-primary" href="https://github.com/DataAutomation-ai" target="_blank" rel="noreferrer">GitHub · open source <Arrow /></a>
              <a className="button button-ghost" href="/cloud">Cloud vs open source <Arrow /></a>
            </div>
          </div>
        </section>

        <section className="section security-cta">
          <div className="shell security-cta-card">
            <div className="section-kicker green">NEXT</div>
            <h2>Ready to review the model with us?</h2>
            <p>We can walk your team through KMS grants, CloudTrail filters, and what the console shows for each job — before you put production data on a schedule.</p>
            <div className="security-cta-actions">
              <a className="button button-primary" href="mailto:escape@portabase.dev?subject=Security%20review%20—%20KMS%20%2B%20CloudTrail">Book a security walkthrough <Arrow /></a>
              <a className="button button-ghost" href="/login?next=/app">Start Cloud trial <Arrow /></a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function HomePage() {
  useEffect(() => { document.title = 'Portabase — Your Supabase Escape'; }, []);
  return <><Header /><main><Hero /><HeroConcept /><WhatIsThis /><WhyNow /><Reality /><ClosureRisk /><Stories /><Escape /><Audit /><Cutover /><PublicDeal /><CloudTeaser /></main><Footer /></>;
}

function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/thanks' || path === '/buy') return <LegacyPurchaseNotice />;
  if (path === '/login' || path === '/signup') return <LoginPage />;
  if (path === '/auth/callback') return <AuthCallbackPage />;
  if (path === '/app' || path === '/console' || path.startsWith('/app/')) return <AppPage />;
  if (path === '/cloud' || path === '/pricing') return <CloudPage />;
  if (path === '/security' || path === '/trust') return <SecurityPage />;
  return <HomePage />;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
