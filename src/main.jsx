import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { nightmares as stories } from './data/nightmares.js';
import { diagrams } from './data/diagrams.js';

const Arrow = () => <span aria-hidden="true">↗</span>;

const SupabaseMark = () => <svg className="supabase-mark" viewBox="0 0 109 113" role="img" aria-label="Supabase logo">
  <defs>
    <linearGradient id="supabase-a" x1="53.974" y1="38.974" x2="94.163" y2="55.829" gradientUnits="userSpaceOnUse"><stop stopColor="#249361" /><stop offset="1" stopColor="#3ECF8E" /></linearGradient>
    <linearGradient id="supabase-b" x1="36.156" y1="30.578" x2="54.484" y2="65.081" gradientUnits="userSpaceOnUse"><stop stopColor="#3ECF8E" /><stop offset="1" stopColor="#3ECF8E" stopOpacity="0" /></linearGradient>
  </defs>
  <path d="M63.708 110.284c-2.898 3.651-8.777 1.652-8.847-3.008L53.84 38.657h46.152c8.358 0 13.018 9.65 7.824 16.193l-44.108 55.434Z" fill="url(#supabase-a)" />
  <path d="M41.318 2.071c2.898-3.651 8.777-1.652 8.846 3.008l.447 68.618H5.034c-8.358 0-13.018-9.65-7.824-16.192L41.318 2.071Z" fill="url(#supabase-b)" />
</svg>;

async function beginCheckout() {
  const response = await fetch('/api/square/checkout', {
    method: 'POST',
    headers: { 'X-PortaBase-Attempt': crypto.randomUUID() },
  });
  const result = await response.json();
  if (!response.ok || !result.url || !result.orderId) throw new Error(result.error || 'Checkout is unavailable.');
  sessionStorage.setItem('portabase_square_order_id', result.orderId);
  window.location.assign(result.url);
}

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

function Logo() {
  return <a className="logo" href="#top" aria-label="PortaBase home"><span className="logo-mark"><i /><i /><i /></span><span>porta<b>base</b></span></a>;
}

function Header() {
  const [open, setOpen] = useState(false);
  return <header className="site-header">
    <div className="shell nav-wrap">
      <Logo />
      <button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? 'Close' : 'Menu'}</button>
      <nav className={open ? 'nav open' : 'nav'}>
        <a href="#what-is-this">What is this?</a><a href="#why-now">Why now</a><a href="#stories">Real incidents</a><a href="#escape">The escape plan</a><a href="#pricing">$147 one time</a>
      </nav>
      <a className="button button-small desktop-cta" href="#what-is-this">See how it works <Arrow /></a>
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
        <h1>A Supabase lockout can freeze your <em>entire business.</em></h1>
        <p className="hero-risk-headline"><strong>No API. No Auth. No dashboard. No reachable backups.</strong></p>
        <p className="hero-lead"><strong>PortaBase keeps a restorable copy outside Supabase.</strong> It automatically captures your database, Auth records, Storage files, and Edge Functions; encrypts and verifies them; and stores them somewhere you control. If one Supabase account is frozen, banned, or unreachable, you still have what you need to rebuild in a new account.</p>
        <div className="hero-analogy"><span aria-hidden="true">⌂</span><p><b>Your landlord changed the locks.</b> The backup stored inside the building is no help. PortaBase keeps your recovery copy in another building—tested, current, and under your control.</p></div>
        <div className="incident-factline"><b>MY INCIDENT · 95+ HOURS</b><span>“Billing dispute” cited</span><span>No details or paperwork</span><span>Card issuer found nothing identifiable</span><span>Singapore payment entity</span><span>No response from Supabase</span></div>
        <div className="hero-actions">
          <a className="button button-primary" href="#what-is-this">Build an independent recovery path <Arrow /></a>
          <a className="text-link" href="#stories">See what lockout looks like <span>↓</span></a>
        </div>
        <div className="hero-proof"><span>Database + Auth + Storage + Functions</span><span>Outside your Supabase account</span><span>Restore into a new account</span></div>
      </div>
      <figure className="lockout-evidence">
        <div className="evidence-label"><span><i /> Actual lockout</span><b>Not a mockup</b></div>
        <img src="/images/supabase-banned.jpg" alt="Actual Supabase sign-in screen showing the error: User is banned" />
        <figcaption><span>Account locked. Business frozen. Backups unreachable.</span><small>Actual founder scenario · identifying details redacted</small></figcaption>
       </figure>
      </div>
    </div>
    <div className="reality-ticker"><div><span>PROJECT DELETED</span><span>OWNER LOCKED OUT</span><span>PAYMENT FAILED</span><span>STORAGE NOT IN BACKUP</span><span>API KEYS REVOKED</span><span>SUPPORT TICKET OPEN</span><span>PROJECT DELETED</span><span>OWNER LOCKED OUT</span></div></div>
  </section>;
}

function WhatIsThis() {
  return <section className="section what-is-this" id="what-is-this">
    <div className="shell">
      <div className="section-kicker green">WHAT IS PORTABASE?</div>
      <div className="what-heading">
        <h2>Your customer-run<br />Supabase recovery utility.</h2>
        <div><p>Install PortaBase on a computer, server, NAS, or customer AWS account. Before there is a crisis, it captures the parts of your application needed for recovery, encrypts them locally, and sends the capsule directly to storage you own. The day your dashboard stops opening is the wrong day to discover your safety net was behind the same locked door.</p><p><strong>No PortaBase cloud account. No credential relay. No access to your backup contents. No second landlord.</strong></p></div>
      </div>
      <div className="definition-strip">
        <div><small>IT CAPTURES</small><b>Database + Auth<br />Storage objects<br />Edge Functions</b></div>
        <div><small>IT STORES IN</small><b>Google Drive<br />Dropbox / NAS<br />Customer AWS S3</b></div>
        <div><small>IT PROVES</small><b>Checksums<br />Authenticated decryption<br />Guarded restore plan</b></div>
        <div><small>IT NEVER GETS</small><b>Your credentials<br />Your encryption key<br />Your data</b></div>
      </div>
      <figure className="diagram-hero">
        <img src={diagrams[0].src} alt={diagrams[0].title} />
        <figcaption><b>{diagrams[0].title}</b><span>{diagrams[0].body}</span></figcaption>
      </figure>
      <div className="diagram-intro"><div><span>10 TECHNICAL DIAGRAMS</span><h3>Do not trust another vague “backup” promise.</h3></div><p>See every data path, trust boundary, capsule, and restore step before your business depends on it. A green checkmark means very little if nobody has proved where the files went, who holds the key, and whether a fresh project can actually be rebuilt.</p></div>
      <div className="diagram-grid">
        {diagrams.slice(1).map(diagram => <figure className="diagram-card" key={diagram.src}>
          <img loading="lazy" src={diagram.src} alt={diagram.title} />
          <figcaption><b>{diagram.title}</b><span>{diagram.body}</span></figcaption>
        </figure>)}
      </div>
      <div className="what-actions"><a className="button button-primary" href="#pricing">Get PortaBase Essentials — $147 <Arrow /></a><a className="button button-ghost" href="#stories">Review the real incidents <Arrow /></a></div>
    </div>
  </section>;
}

function WhyNow() {
  return <section className="section why-now" id="why-now">
    <div className="shell">
      <div className="love-note"><span>Let’s be clear</span><h2>Supabase is great.</h2><p>That is why so many prototypes quietly became real companies on it. But loving the building does not mean leaving your only exit key with the landlord.</p></div>
      <aside className="founder-note">
        <div className="founder-note-label"><span>FOUNDER’S NOTE</span><small>WHY THIS ISN’T AN ATTACK</small></div>
        <div className="founder-note-copy"><h3>I almost gave this product an angry name.</h3><p>“Supabase Sucks.” “Not So Supa.” Something that captured exactly how it felt to be locked out and unable to reach the business behind the screen.</p><div className="founder-incident"><span>THIS IS MY CURRENT SITUATION</span><p>Supabase cited a billing dispute. I received no transaction details, paperwork, or other explanation my credit-card company could identify. I contacted support. At the time of writing, <strong>95 hours have passed with absolutely no response from Supabase.</strong></p><p>Supabase’s own billing documentation says payments may appear from Singapore because its payment entity is there. There is nothing inherently wrong with that. But when a U.S. or other overseas customer is already disputing a vague billing claim, cross-border payment records, time zones, and remedies can add friction to an emergency that is already costing the business.</p><p>The business did not stop needing its database while the ticket waited. That is the danger PortaBase exists to make visible.</p></div><p>But an angry name still would not have been fair—or true. <strong>Supabase is an excellent product.</strong> It has introduced millions of people to databases, Auth, Storage, Functions, and the possibility of building a real application without first becoming a backend engineer.</p><p>PortaBase is not here to tell you to leave Supabase. It is here to point out one danger many builders never see: <strong>when the application, dashboard, support path, and backup all depend on the same account, one lock can stand between you and your entire business.</strong></p><b>Keep the platform. Remove the single point of failure.</b></div>
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
          <aside className="escalation-reality"><span>THIS IS NOT A BUSINESS CONTINUITY PLAN</span><blockquote>“See if you can find a GitHub maintainer. Maybe they can escalate it.”</blockquote><p>When the best remaining idea is to find a stranger on the internet who might know someone inside, you do not control the recovery of your business. You are asking for a favor while the clock runs.</p><b>PortaBase turns “please answer” into “restore the capsule.”</b></aside>
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

function Escape() {
  return <section className="section escape" id="escape">
    <div className="shell">
      <div className="section-kicker green">THE PORTABASE ESCAPE PLAN</div>
      <div className="escape-heading"><h2>When the front door fails,<br /><em>leave through your own.</em></h2><p>PortaBase assembles an encrypted recovery copy of your Supabase application inside storage you own. A locked dashboard becomes a recovery procedure—not a week of pleading for someone else to unlock your livelihood.</p></div>
      <div className="architecture">
        <div className="arch-node source"><small>RUNNING NORMALLY</small><b>Supabase</b><span>Database · Auth · Storage · Functions</span></div>
        <div className="arch-flow"><span>encrypted copy</span><i>→</i></div>
        <div className="arch-node vault"><small>ONLY YOU CONTROL</small><b>Your recovery vault</b><span>Google Drive · Dropbox · local/NAS · AWS S3</span><div className="shield">✓</div></div>
        <div className="arch-flow"><span>when needed</span><i>→</i></div>
        <div className="arch-node recovery"><small>FRESH RECOVERY TARGET</small><b>New Supabase</b><span>New account · New project · Restored</span></div>
      </div>
      <div className="steps">
        <article><span>1</span><div><h3>Install without surrendering credentials</h3><p>The utility runs in your environment. Credentials stay in your environment and never pass through PortaBase.</p></div></article>
        <article><span>2</span><div><h3>Capture the application—not just Postgres</h3><p>Database and Auth records, actual Storage objects, Function source, manifests and checksums become one encrypted recovery capsule.</p></div></article>
        <article><span>3</span><div><h3>Verify more than an upload message</h3><p>A file that uploaded is not automatically a business that can recover. PortaBase checks the destination copy, ciphertext, AES-GCM authentication, and decrypted payload. A missing layer is labeled partial, never green.</p></div></article>
        <article><span>4</span><div><h3>We guide the new-account recovery</h3><p>PortaBase automates as much as Supabase permits: it can provision a blank project, prepare its credentials, run a no-write preflight, or restore a limited validation sample into a disposable free project. Supabase rules still require you to handle identity, billing, and certain third-party security steps; PortaBase tells you exactly what to do next.</p></div></article>
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
          {complete && <div className="audit-result"><b>{score < 63 ? 'Your current plan depends on the thing that may fail.' : 'You have a foundation. Now prove the complete recovery path.'}</b><a href="mailto:escape@portabase.dev?subject=My PortaBase recovery score">Build my escape plan <Arrow /></a></div>}
        </>}
      </div>
    </div>
  </section>;
}

function Cutover() {
  return <section className="section cutover"><div className="shell cutover-card">
    <div><div className="section-kicker green">TWO RECOVERY PATHS</div><h2>Same capsule.<br />Different operating model.</h2><p>Essentials uses storage you already understand. AWS Recovery pre-provisions a dedicated vault, scheduled runner, alarms and guarded restore workspace for businesses that need stronger operational controls.</p><a className="button button-light" href="mailto:escape@portabase.dev?subject=Compare PortaBase packages">Compare the two paths <Arrow /></a></div>
    <div className="route-demo"><div className="route-url">CUSTOMER-OWNED RECOVERY <span>NO PORTABASE CLOUD ACCOUNT</span></div><div className="route-lines"><i /><i /></div><div className="route-targets"><div><small>ESSENTIALS</small><b>Drive or Dropbox</b><span className="online">● Lowest setup friction</span></div><div><small>AWS RECOVERY</small><b>S3 + Fargate</b><span>Vault and restore workspace</span></div></div><div className="switch"><span>Your credentials · Your encryption key · Your destination</span><b><i /></b></div></div>
  </div></section>;
}

function Pricing() {
  const [checkoutState, setCheckoutState] = useState('idle');
  const checkout = async () => {
    setCheckoutState('loading');
    try { await beginCheckout(); }
    catch { setCheckoutState('error'); }
  };
  return <section className="section pricing" id="pricing"><div className="shell pricing-grid">
    <div className="price-copy"><div className="section-kicker green">ONE-TIME MEANS ONE TIME</div><h2>Start simply.<br />Own the exit.</h2><p>$147 buys the utility that keeps your recovery copy outside the locked building. There is no monthly PortaBase bill, no new cloud dependency, and no reason to wait until a silent support inbox is deciding whether your company opens tomorrow.</p><div className="software-not-saas"><span>SOFTWARE, NOT ANOTHER SAAS</span><b>We sell you the tool. We never take custody of the keys.</b><p>PortaBase runs on your Windows, macOS, Linux, NAS, or customer-owned cloud account. Your Supabase credentials, encryption passphrase, AWS/GCP tokens, and recovery capsules stay in your environment. Square receives the purchase information required to process the order; PortaBase never receives the secrets that run your business.</p></div><div className="one-time-math"><div><small>ESSENTIALS TODAY</small><b>$147</b></div><span>+</span><div><small>PORTABASE / MONTH</small><b>$0</b></div></div><div className="trial-offer"><span>TRY THE REAL WORKFLOW FREE</span><b>No three-day countdown. A real workflow with a deliberately limited payload.</b><p>Use the trial indefinitely. It captures your database structure, up to five Storage objects, and up to two Edge Functions, then encrypts, transfers, verifies, and opens the guarded restore plan. It proves the workflow without pretending to be a complete recovery backup.</p><a className="button button-ghost" href="mailto:escape@portabase.dev?subject=Send me the PortaBase trial">Get the limited trial <Arrow /></a></div><div className="setup-paths"><span>CHOOSE HOW HANDS-ON YOU WANT TO BE</span><div><article><small>SIMPLE · NON-TECHNICAL</small><b>Sign in to Google Drive or Dropbox.</b><p>The guided setup connects storage you already understand and installs an automatic schedule on your chosen computer. No AWS account or cloud console required.</p></article><article><small>ADVANCED · CUSTOMER-OWNED AWS</small><b>Automate the runner, vault, logs, and alerts.</b><p>We help wire PortaBase into your AWS account with scheduling, S3 storage, observability, and failure notifications. We start with the smallest practical resource for your backup size and increase it only when the workload proves it is necessary.</p></article></div><a href="mailto:escape@portabase.dev?subject=Help me choose and install PortaBase">We will help script and install either path <Arrow /></a></div><div className="price-note"><span>Required</span><p>Essentials uses your Google Drive, Dropbox or local/NAS storage. AWS Recovery uses your AWS account. You pay those providers directly because the entire point is that PortaBase cannot become another company holding your only way out.</p></div></div>
    <div className="price-card">
      <div className="price-ribbon">DOWNLOADABLE SOFTWARE · LIFETIME LICENSE</div><div className="price-top"><span>PORTABASE ESSENTIALS</span><div><b>$147</b><small>USD · PAY ONCE</small></div><p>Backup-and-recovery software for one Supabase project.</p></div>
      <div className="purchase-definition"><span>WHAT YOU ARE BUYING</span><strong>A customer-run Supabase backup and recovery application.</strong><p>Install PortaBase in your own environment to schedule encrypted backups, verify them, and guide recovery into a fresh Supabase account. You receive a lifetime license for one project and one platform edition.</p></div>
      <div className="platform-choice"><span>CHOOSE YOUR PLATFORM</span><div><b>Windows</b><b>macOS <small>Apple</small></b><b>Linux</b></div><p>Your $147 purchase includes any one of these platform editions. Choose your edition during fulfillment.</p></div>
      <p className="updates-included"><strong>Every future PortaBase software update is included free.</strong> No update plan. No paid upgrade cycle.</p>
      <ul><li><span>✓</span> Guided Google Drive or Dropbox connection</li><li><span>✓</span> Local/NAS and advanced customer-owned AWS options</li><li><span>✓</span> Database/Auth, Storage objects and Function capture</li><li><span>✓</span> Guided new-account and project provisioning</li><li><span>✓</span> Limited restore drills on a disposable free project</li><li><span>✓</span> AES-256-GCM encrypted capsules</li><li><span>✓</span> Scheduling, verification and guarded retention</li><li><span>✓</span> Every future software update included free</li><li><span>✓</span> No PortaBase credential custody or telemetry</li></ul>
      <button className="button button-primary purchase" onClick={checkout} disabled={checkoutState === 'loading'}>{checkoutState === 'loading' ? 'Opening secure checkout…' : 'Buy the software — $147'} {checkoutState !== 'loading' && <Arrow />}</button>
      {checkoutState === 'error' && <p className="checkout-error">Checkout could not open. Email <a href="mailto:escape@portabase.dev?subject=Purchase PortaBase Essentials">escape@portabase.dev</a> and we will help immediately.</p>}
      <div className="square-trust"><span>Secure checkout by <b>Square</b></span><span><b>$0/month</b> · No renewal</span></div>
    </div>
  </div></section>;
}

function ThankYou() {
  const [paid, setPaid] = useState(null);
  useEffect(() => {
    const orderId = sessionStorage.getItem('portabase_square_order_id');
    if (!orderId) { setPaid(false); return; }
    fetch(`/api/square/order?order_id=${encodeURIComponent(orderId)}`).then(response => response.json()).then(result => setPaid(Boolean(result.paid))).catch(() => setPaid(false));
  }, []);
  if (paid === null) return <div className="thanks"><div className="thanks-card"><Logo /><h1>Confirming your payment…</h1><p>Square is securely confirming the completed order.</p></div></div>;
  if (!paid) return <div className="thanks"><div className="thanks-card"><Logo /><h1>We could not confirm this payment.</h1><p>No purchase is being claimed from the page URL alone. Contact us and we will verify it with Square.</p><a className="button button-primary" href="mailto:escape@portabase.dev?subject=PortaBase checkout verification">Get checkout help <Arrow /></a></div></div>;
  return <div className="thanks"><div className="thanks-card"><Logo /><div className="thanks-check">✓</div><div className="section-kicker green">ONE-TIME PAYMENT COMPLETE</div><h1>Your escape plan starts now.</h1><p>Square confirmed your one-time PortaBase payment. There is no monthly renewal. Check the email used at checkout for delivery and setup instructions.</p><a className="button button-primary" href="mailto:escape@portabase.dev?subject=PortaBase purchase help">I need purchase help <Arrow /></a><small>PortaBase never asks you to email Supabase or cloud credentials.</small></div></div>;
}

function CheckoutRedirect() {
  const [failed, setFailed] = useState(false);
  useEffect(() => { beginCheckout().catch(() => setFailed(true)); }, []);
  return <div className="thanks"><div className="thanks-card"><Logo /><h1>{failed ? 'Checkout needs a hand.' : 'Opening secure checkout…'}</h1><p>{failed ? 'Square Checkout could not open automatically. Contact us and we will help immediately.' : 'You are being redirected to Square for the one-time $147 purchase.'}</p>{failed && <a className="button button-primary" href="mailto:escape@portabase.dev?subject=Purchase PortaBase Essentials">Get checkout help <Arrow /></a>}</div></div>;
}

function Footer() {
  return <footer><div className="shell footer-main"><div><Logo /><p>Your Supabase escape plan.<br />Owned by you. Proven before you need it.</p></div><div><b>EXPLORE</b><a href="#reality">The reality</a><a href="#stories">Real incidents</a><a href="#escape">Escape plan</a><a href="#audit">Risk check</a><a href="#pricing">Purchase · $147</a></div><div><b>CONTACT</b><a href="mailto:escape@portabase.dev">escape@portabase.dev</a><span>Independent product.<br />Not affiliated with Supabase.</span><span>Payments securely processed by Square. Zero-custody refers to infrastructure credentials and capsule contents, not transaction records required to fulfill a purchase.</span></div></div><div className="shell footer-bottom"><span>© 2026 PortaBase</span><span>Your keys. Your cloud. Your way out.</span></div></footer>;
}

function App() {
  if (window.location.pathname === '/thanks') return <ThankYou />;
  if (window.location.pathname === '/buy') return <CheckoutRedirect />;
  return <><Header /><main><Hero /><WhatIsThis /><WhyNow /><Reality /><Stories /><Escape /><Audit /><Cutover /><Pricing /></main><Footer /></>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
