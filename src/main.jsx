import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const Arrow = () => <span aria-hidden="true">↗</span>;
const checkoutUrl = import.meta.env.VITE_SQUARE_CHECKOUT_URL || 'mailto:escape@portabase.dev?subject=Purchase PortaBase Essentials';

const stories = [
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
        <a href="#why-now">Why now</a><a href="#reality">The reality</a><a href="#stories">Real incidents</a><a href="#escape">The escape plan</a><a href="#pricing">$47 one time</a>
      </nav>
      <a className="button button-small desktop-cta" href="#audit">Check your exposure <Arrow /></a>
    </div>
  </header>;
}

function Hero() {
  return <section className="hero" id="top">
    <div className="hero-noise" />
    <div className="shell hero-grid">
      <div className="hero-copy">
        <div className="eyebrow"><span className="pulse" /> Supabase is great. A single point of failure isn’t.</div>
        <h1>Your recovery plan<br />cannot be <em>“pray.”</em></h1>
        <p className="hero-lead">When production is down and the dashboard won’t open, your database, users and files are behind the same locked door. The published Pro support path is email. Your customers will not wait 24–48 hours.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="#audit">Find out if “pray” is your plan <Arrow /></a>
          <a className="text-link" href="#stories">Read the real incidents <span>↓</span></a>
        </div>
        <div className="hero-proof"><span>Zero credential custody</span><span>Customer-owned cloud</span><span>$47 once · $0 monthly</span></div>
      </div>
      <div className="lockout-card" aria-label="Account lockout simulation">
        <div className="window-bar"><div><i /><i /><i /></div><span>app.supabase.com</span><b>•••</b></div>
        <div className="lockout-body">
          <div className="warning-icon">!</div>
          <div className="system-label">ACCESS ERROR</div>
          <h2>We couldn’t load<br />your organization.</h2>
          <p>Your projects may be unavailable. Contact support if the problem continues.</p>
          <button>Try again</button>
          <div className="support-line"><span>Pro support target*</span><strong>24–48 hours</strong></div>
        </div>
        <div className="clock-strip"><span>Ticket submitted. Now what?</span><b>47:59:42</b></div>
      </div>
    </div>
    <div className="reality-ticker"><div><span>PROJECT DELETED</span><span>OWNER LOCKED OUT</span><span>PAYMENT FAILED</span><span>STORAGE NOT IN BACKUP</span><span>API KEYS REVOKED</span><span>SUPPORT TICKET OPEN</span><span>PROJECT DELETED</span><span>OWNER LOCKED OUT</span></div></div>
  </section>;
}

function WhyNow() {
  return <section className="section why-now" id="why-now">
    <div className="shell">
      <div className="love-note"><span>Let’s be clear</span><h2>Supabase is great.</h2><p>It made a serious backend accessible to people who could never have assembled one alone. That is precisely why this matters.</p></div>
      <div className="growth-grid">
        <div className="growth-stat"><strong>~10M</strong><span>developers building on Supabase</span><a href="https://supabase.com/blog/supabase-series-f" target="_blank" rel="noreferrer">Supabase, June 2026 <Arrow /></a></div>
        <div className="growth-copy">
          <div className="section-kicker green">SUCCESS CREATED A NEW REALITY</div>
          <h3>The weekend prototype became a real business before anyone wrote the disaster plan.</h3>
          <p>Supabase became the default backend for a generation of AI builders. Lovable, Bolt, v0 and other tools can put a production database behind an idea in minutes. Millions of people arrived. Many are now running businesses that are too important to wait—but too small to buy enterprise support.</p>
          <div className="support-gap">
            <div><small>PRO · FROM $25/MO</small><b>Email support</b><span>No guaranteed support SLA</span></div>
            <div><small>TEAM · FROM $599/MO</small><b>Priority email</b><span>Support SLAs begin here</span></div>
            <div><small>ENTERPRISE</small><b>Private Slack</b><span>Premium 24×7 support</span></div>
          </div>
          <p className="gap-close">There is nothing unreasonable about that support model. But if your production site is down on Pro, the published path is email. There is no published Pro phone number or private live-support channel. A Supabase representative has said the target is 24–48 hours and can run longer under volume. At that moment, without an independent recovery path, the technical plan is reduced to <em>send the email and pray.</em></p>
          <div className="source-links"><a href="https://supabase.com/solutions/vibe-coders" target="_blank" rel="noreferrer">Supabase for Vibe Coders <Arrow /></a><a href="https://supabase.com/pricing" target="_blank" rel="noreferrer">Published support tiers <Arrow /></a><a href="https://www.reddit.com/r/Supabase/comments/1kbj0sh/supabase_threatened_to_delete_all_my_work_after/" target="_blank" rel="noreferrer">24–48 hour support statement <Arrow /></a></div>
        </div>
      </div>
    </div>
  </section>;
}

function Reality() {
  return <section className="section reality" id="reality">
    <div className="shell">
      <div className="section-kicker">THE BLUNT REALITY</div>
      <div className="split-heading"><h2>A backup you can’t reach<br />is not your backup.</h2><p>Supabase can be an excellent place to run your application. It should not be the only place from which your application can be recovered.</p></div>
      <div className="reality-grid">
        <article><span>01</span><h3>The dashboard is a dependency.</h3><p>If account access, billing, SSO or the management plane fails, the button you planned to use may be behind the failure.</p></article>
        <article><span>02</span><h3>Database backup is not application recovery.</h3><p>Storage bytes, Functions, secrets, Auth configuration, URLs and integrations require their own recovery path.</p></article>
        <article><span>03</span><h3>Deletion can erase the safety net.</h3><p>Supabase states that deleting a project permanently removes its data and associated backups. There is no undo button.</p></article>
        <article><span>04</span><h3>Pro support is an email path.</h3><p>The public pricing page advertises email support for Pro. It does not publish a Pro support chat or phone hotline.</p></article>
      </div>
      <div className="wake-up">
        <div className="wake-time">06:41 <small>AM</small></div>
        <div><div className="section-kicker">A VERY POSSIBLE MORNING</div><h3>You wake up. The site is down. You can’t log in.</h3><p>The status page is green. Password recovery is going nowhere. Support has your ticket. The clock has your business.</p></div>
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
  const [shown, setShown] = useState(6);
  return <section className="section stories" id="stories">
    <div className="shell">
      <div className="section-kicker red">THIS HAS ALREADY HAPPENED</div>
      <div className="split-heading"><h2>We are not<br />making this up.</h2><p>These are firsthand posts, confirmed outages and public support threads from Supabase users. Every case links to its source. Every correction and dispute stays attached.</p></div>
      <div className="story-grid">
        {stories.slice(0, shown).map((story, index) => <a className="story-card" href={story.href} target="_blank" rel="noreferrer" key={story.title}>
          <div className="story-meta"><span>{story.tag}</span><b>{String(index + 1).padStart(2, '0')}</b></div>
          <h3>{story.title}</h3><p>{story.body}</p>
          <div className="story-source"><span>{story.source}<small>{story.verified}</small></span><Arrow /></div>
        </a>)}
      </div>
      {shown < stories.length && <button className="button button-ghost load-more" onClick={() => setShown(stories.length)}>Show all {stories.length} reports <span>↓</span></button>}
      <p className="source-note">Community reports are not independent findings of fault. They are included because each illustrates a real continuity failure mode—provider-caused, customer-caused or still disputed.</p>
    </div>
  </section>;
}

function Escape() {
  return <section className="section escape" id="escape">
    <div className="shell">
      <div className="section-kicker green">THE PORTABASE ESCAPE PLAN</div>
      <div className="escape-heading"><h2>When the front door fails,<br /><em>leave through your own.</em></h2><p>PortaBase continuously assembles an encrypted recovery copy of your Supabase application inside storage you own—without a PortaBase cloud account in the middle.</p></div>
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
        <article><span>3</span><div><h3>Verify more than an upload message</h3><p>PortaBase checks the destination copy, ciphertext, AES-GCM authentication and decrypted payload. A missing layer is labeled partial, never green.</p></div></article>
        <article><span>4</span><div><h3>Create fresh, restore and cut over</h3><p>The guarded restore refuses the source project and requires an exact new target confirmation. Platform settings that cannot be exported remain on the checklist.</p></div></article>
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
      <div className="audit-intro"><div className="section-kicker">60-SECOND RECOVERY CHECK</div><h2>Could your business survive losing the dashboard tonight?</h2><p>No credentials. No signup. Nothing leaves this browser.</p>{!started && <button className="button button-primary" onClick={() => setStarted(true)}>Check my exposure <Arrow /></button>}
        <div className="privacy-stamp"><span>⊘</span><div><b>ZERO-KNOWLEDGE CHECK</b><small>Your answers are never transmitted or stored.</small></div></div>
      </div>
      <div className={started ? 'audit-panel active' : 'audit-panel'}>
        {!started ? <div className="audit-placeholder"><div className="radar"><i /><i /><i /><b>?</b></div><span>8 questions. One uncomfortable answer.</span></div> : <>
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
  return <section className="section pricing" id="pricing"><div className="shell pricing-grid">
    <div className="price-copy"><div className="section-kicker green">ONE-TIME MEANS ONE TIME</div><h2>Start simply.<br />Own the exit.</h2><p>PortaBase Essentials is a one-time utility license with no renewal and no monthly PortaBase bill. Install it on a machine you control and keep using Supabase normally.</p><div className="one-time-math"><div><small>ESSENTIALS TODAY</small><b>$47</b></div><span>+</span><div><small>PORTABASE / MONTH</small><b>$0</b></div></div><div className="aws-upsell"><span>AWS RECOVERY</span><b>Need a provisioned recovery account?</b><p>CloudFormation creates the S3/KMS vault, Fargate schedule, logs, alarms and dormant restore task inside your AWS account. It is a separate one-time package sized to your recovery requirements.</p><a href="mailto:escape@portabase.dev?subject=PortaBase AWS Recovery">Request AWS Recovery pricing <Arrow /></a></div><div className="price-note"><span>Required</span><p>Essentials uses your Google Drive, Dropbox or local/NAS storage. AWS Recovery uses your AWS account. Provider usage and a fresh Supabase target are paid directly by you.</p></div></div>
    <div className="price-card">
      <div className="price-ribbon">NO MONTHLY PORTABASE FEE</div><div className="price-top"><span>PORTABASE ESSENTIALS</span><div><b>$47</b><small>USD · PAY ONCE</small></div><p>Customer-run recovery utility for one Supabase project.</p></div>
      <ul><li><span>✓</span> Google Drive, Dropbox or local/NAS destination</li><li><span>✓</span> Database/Auth, Storage objects and Function capture</li><li><span>✓</span> AES-256-GCM encrypted capsules</li><li><span>✓</span> Immutable transfer and destination verification</li><li><span>✓</span> Scheduling, durable status and guarded retention</li><li><span>✓</span> Dry-run-first restore into a fresh project</li><li><span>✓</span> No PortaBase credential custody or telemetry</li></ul>
      <a className="button button-primary purchase" href={checkoutUrl}>Buy Essentials — $47 <Arrow /></a>
      <div className="square-trust"><span>Secure checkout by <b>Square</b></span><span><b>$0/month</b> · No renewal</span></div>
    </div>
  </div></section>;
}

function ThankYou() {
  return <div className="thanks"><div className="thanks-card"><Logo /><div className="thanks-check">✓</div><div className="section-kicker green">ONE-TIME PAYMENT COMPLETE</div><h1>Your escape plan starts now.</h1><p>Square has processed your only PortaBase payment. There is no monthly renewal. Check the email used at checkout for delivery and setup instructions.</p><a className="button button-primary" href="mailto:escape@portabase.dev?subject=PortaBase purchase help">I need purchase help <Arrow /></a><small>PortaBase never asks you to email Supabase or cloud credentials.</small></div></div>;
}

function Footer() {
  return <footer><div className="shell footer-main"><div><Logo /><p>Your Supabase escape plan.<br />Owned by you. Proven before you need it.</p></div><div><b>EXPLORE</b><a href="#reality">The reality</a><a href="#stories">Real incidents</a><a href="#escape">Escape plan</a><a href="#audit">Risk check</a><a href="#pricing">Purchase · $47</a></div><div><b>CONTACT</b><a href="mailto:escape@portabase.dev">escape@portabase.dev</a><span>Independent product.<br />Not affiliated with Supabase.</span><span>Payments securely processed by Square. Zero-custody refers to infrastructure credentials and capsule contents, not transaction records required to fulfill a purchase.</span></div></div><div className="shell footer-bottom"><span>© 2026 PortaBase</span><span>Your keys. Your cloud. Your way out.</span></div></footer>;
}

function App() {
  if (window.location.pathname === '/thanks') return <ThankYou />;
  return <><Header /><main><Hero /><WhyNow /><Reality /><Stories /><Escape /><Audit /><Cutover /><Pricing /></main><Footer /></>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
