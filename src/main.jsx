import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './recovery-home.css';
import { CasesSection as Stories } from './cases/cases-section.jsx';
import { modelLayers } from './data/diagrams.js';
import { HOMEPAGE_FAQ } from './data/faq.js';
import { closureReasons, closureCases } from './data/closure-cases.js';
import { InstallCta } from './install-cta.jsx';

/* Route-level code splitting: keep console, auth, docs, legal and backend out of
   the landing bundle so the homepage ships only what it renders. */
const AppPage = lazy(() => import('./auth-pages.jsx').then(m => ({ default: m.AppPage })));
const AuthCallbackPage = lazy(() => import('./auth-pages.jsx').then(m => ({ default: m.AuthCallbackPage })));
const LoginPage = lazy(() => import('./auth-pages.jsx').then(m => ({ default: m.LoginPage })));
const BackendPage = lazy(() => import('./backend-page.jsx').then(m => ({ default: m.BackendPage })));
const DocsPage = lazy(() => import('./site-pages.jsx').then(m => ({ default: m.DocsPage })));
const CasesManagePage = lazy(() => import('./cases/cases-manage.jsx').then(m => ({ default: m.CasesManagePage })));
const CasesSubmitPage = lazy(() => import('./cases/cases-manage.jsx').then(m => ({ default: m.CasesSubmitPage })));
const LegalPage = lazy(() => import('./site-pages.jsx').then(m => ({ default: m.LegalPage })));

const PageFallback = () => <main className="shell" style={{ padding: '120px 24px', color: '#b4b4ae' }}>Loading…</main>;
const Lazy = ({ children }) => <Suspense fallback={<PageFallback />}>{children}</Suspense>;
import { isSignedIn, loadSession, sessionUser } from './lib/session.js';
import { CLOUD_FREE, planPriceRangeLabel, publicCloudPlans } from './lib/product.js';
import { isCloudConsolePath, isDocsPath } from './lib/site-links.js';

const Arrow = () => <span aria-hidden="true">↗</span>;

const SupabaseMark = () => <svg className="supabase-mark" viewBox="0 0 109 113" role="img" aria-label="Supabase logo">
  <defs>
    <linearGradient id="supabase-a" x1="53.974" y1="38.974" x2="94.163" y2="55.829" gradientUnits="userSpaceOnUse"><stop stopColor="#249361" /><stop offset="1" stopColor="#3ECF8E" /></linearGradient>
    <linearGradient id="supabase-b" x1="36.156" y1="30.578" x2="54.484" y2="65.081" gradientUnits="userSpaceOnUse"><stop stopColor="#3ECF8E" /><stop offset="1" stopColor="#3ECF8E" stopOpacity="0" /></linearGradient>
  </defs>
  <path d="M63.708 110.284c-2.898 3.651-8.777 1.652-8.847-3.008L53.84 38.657h46.152c8.358 0 13.018 9.65 7.824 16.193l-44.108 55.434Z" fill="url(#supabase-a)" />
  <path d="M41.318 2.071c2.898-3.651 8.777-1.652 8.846 3.008l.447 68.618H5.034c-8.358 0-13.018-9.65-7.824-16.192L41.318 2.071Z" fill="url(#supabase-b)" />
</svg>;


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

let starterAvailabilityRequest;
function useStarterAvailability() {
  const [ready,setReady]=useState(false);
  useEffect(()=>{let active=true;starterAvailabilityRequest ||= fetch('/api/auth/config',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(data=>data.commerce?.managedStarterEnabled===true).catch(()=>false);
    starterAvailabilityRequest.then(value=>{if(active)setReady(value);});return()=>{active=false;};},[]);
  return ready;
}
function TopAnnouncementBanner() {
  const starterReady=useStarterAvailability();
  return (
    <aside className="pb-top-announcement-banner" aria-label="Special pricing announcement" style={{
      background: 'linear-gradient(90deg, #132a1e 0%, #1f4a33 50%, #132a1e 100%)',
      borderBottom: '1px solid rgba(62, 207, 142, 0.3)',
      color: '#f0fdf4',
      padding: '9px 16px',
      fontSize: '13px',
      fontWeight: 500,
      textAlign: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      zIndex: 100,
      position: 'relative',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#3ecf8e', boxShadow: '0 0 6px #3ecf8e' }}></span>
        <strong style={{ color: '#fff', fontWeight: 700 }}>{starterReady?'9 dollars per month for secure protection.':'$9 Starter — coming soon.'}</strong>
      </span>
      <a href="/login?mode=signup&next=/dashboard" style={{
        background: '#3ecf8e',
        color: '#0d1117',
        fontSize: '12px',
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: '999px',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        transition: 'transform 0.15s ease',
      }}>
        Get Started <span aria-hidden="true">&rarr;</span>
      </a>
    </aside>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(() => sessionUser(loadSession()));
  useEffect(() => {
    const sync = () => setUser(isSignedIn() ? sessionUser(loadSession()) : null);
    window.addEventListener('portabase-auth', sync);
    sync();
    return () => window.removeEventListener('portabase-auth', sync);
  }, []);
  return <>
    <TopAnnouncementBanner />
    <header className="site-header">
      <div className="shell nav-wrap">
        <Logo href="/#top" />
        <button className="menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? 'Close' : 'Menu'}</button>
        <nav className={open ? 'nav open' : 'nav'}>
          <a href="/#escape">Escape</a>
          <a href="/#recovery-overview">Recovery</a>
          <a href="/#cli-vs-cloud">CLI vs Cloud</a>
          <a href="/#faq">FAQ</a>
          <a href="/#stories">Incidents</a>
          <a href="/docs">Docs</a>
          <a href="/security">Security</a>
          <a href="/cloud">Pricing</a>
        </nav>
        <a className="button button-small header-sign-in" style={{marginLeft:'auto',whiteSpace:'nowrap',flexShrink:0}} href={user ? '/dashboard' : '/login?next=/dashboard'}>
          Sign in <Arrow />
        </a>
      </div>
    </header>
  </>;
}

function Hero() {
  const heroChecklist = [
    ['Open Source NPM Package', 'Install via npx portabase (Apache-2.0) — audit every line of code yourself.'],
    ['Attested Secure Enclave', 'Managed jobs process keys inside Google Confidential Space with Intel TDX after workload verification.'],
    ['Backup your Supabase to a New or Separate Account', 'Rebuild into a clean contingency Supabase account when locked out.'],
    ['Customer-Owned Recovery Copies', 'Managed runs use a configured S3 or Dropbox vault; the standalone CLI also supports local storage.'],
    ['Usage and Verification in Your Dashboard', 'See measured runtime, transferred bytes and reported backup completeness.'],
    ['Captures What Platform Backups Miss', 'Full Database + Auth users + Storage file bytes + Edge Function source.'],
    ['Reported Backup Verification', 'Review recorded hash checks and completeness; test a restore to establish recovery readiness.'],
    ['Recovery Without the Hosted Console', 'Use the compatible CLI with your capsule, recovery key and every referenced binary version; destination access is still required.'],
  ];

  return <section className="hero recovery-hero" id="top">
    <div className="shell recovery-layout">
      <div className="recovery-copy">
        <p className="recovery-intro">You built it with Supabase. Now people depend on it.</p>
        <aside className="recovery-positioning"><h2>Keep a recovery path—even if you lose access to your account.</h2><p>Portabase complements your business-grade backup solution. It keeps an independent recovery copy for a different kind of emergency: account lockout, suspension, or loss of access to your provider. Set it up and verify your recovery copy before an incident occurs.</p></aside>
        <h1>Could your business survive 48 hours offline?</h1>
        <p className="recovery-question">What if you lost your Supabase account for good?</p>
        <p className="recovery-lead">Your side project has real customers now. A locked account could put their data, your app, and the backups you need out of reach.</p>
        <p className="recovery-answer">Portabase keeps an encrypted recovery copy outside Supabase, in storage you control — free via the open-source CLI, with a $9 managed Starter offering being prepared for release.</p>
        <div className="hero-tdx-callout">
          <div className="hero-tdx-header">
            <div aria-label="Google Cloud and Intel TDX" style={{display:'flex',alignItems:'center',gap:24,flexWrap:'wrap',marginBottom:18}}><img src="/gcp-logo.png" alt="Google Cloud" style={{height:44,width:'auto',maxWidth:'48%',objectFit:'contain'}}/><img src="/intel-tdx-logo.png" alt="Intel TDX" style={{height:44,width:'auto',maxWidth:'40%',objectFit:'contain'}}/></div>
            <span className="hero-tdx-badge">BUILT ON GOOGLE CONFIDENTIAL SPACE + INTEL TDX · NOT AN EVERYDAY VM</span>
            <h2 className="hero-tdx-title">Engineered from the boot sequence up to lock out the “Landlord.”</h2>
          </div>
          <div className="hero-tdx-grid">
            <div className="hero-tdx-card">
              <div className="hero-tdx-label">01 · THE VM TRUST PROBLEM</div>
              <h3>Why ordinary cloud VMs fail the trust test</h3>
              <p>On a normal everyday VM, the “Landlord” (the cloud operator, hypervisor, or host root admin) can read plaintext RAM, inspect disks, attach a debugger, or SSH into the machine while your database and keys are in flight.</p>
            </div>
            <div className="hero-tdx-card">
              <div className="hero-tdx-label">02 · HARDWARE MEASUREMENT</div>
              <h3>Hardware-locked from the boot sequence up</h3>
              <p>Portabase’s managed runner boots inside an <strong>Intel TDX (Trust Domain Extensions)</strong> Confidential VM running Google Confidential Space. From the very first boot instruction, hardware root-of-trust and vTPM measure the firmware, OS, and exact container SHA-256 hash.</p>
            </div>
            <div className="hero-tdx-card">
              <div className="hero-tdx-label">03 · SILICON-LEVEL SHIELD</div>
              <h3>Encrypted memory and a restricted workload</h3>
              <p>Intel TDX protects workload memory from the host hypervisor. The approved workload disables debugging and requires Secure Boot. The browser checks Google-signed evidence, the approved container digest and its session public key before releasing recovery material; hosted OAuth backends handle provider authorization before that handoff.</p>
            </div>
            <div className="hero-tdx-card">
              <div className="hero-tdx-label">04 · RETAINED RECOVERY DATA</div>
              <h3>Recover without the hosted console</h3>
              <p>Encrypted recovery formats use <code>AES-256-GCM</code>. Keep the capsule, recovery key and every binary version referenced by its manifest. Use a compatible CLI to open retained data without the hosted console, and test recovery into a separate destination before relying on it.</p>
            </div>
          </div>
          <div className="hero-tdx-modes-cta">
            <div className="hero-tdx-modes-header">
              <span className="hero-tdx-modes-badge">3 MODES OF OPERATION</span>
              <span className="hero-tdx-modes-sub">Managed modes execute inside an attested Intel TDX enclave</span>
            </div>
            <div className="hero-tdx-modes">
              <div className="hero-tdx-mode">
                <strong>1. Source → Capsule → Destination</strong>
                <span>Encrypted vault capsule + restore into separate account</span>
              </div>
              <div className="hero-tdx-mode">
                <strong>2. Source → Destination</strong>
                <span>Direct enclave migration — no retained capsule</span>
              </div>
              <div className="hero-tdx-mode">
                <strong>3. Source → Capsule Only / Capsule → Destination</strong>
                <span>Capture standalone capsule only, or restore existing capsule</span>
              </div>
            </div>
            <div className="hero-tdx-actions">
              <a className="button button-primary" href="/login?mode=signup&next=/dashboard">Explore the recovery dashboard (10 GB Free) <Arrow /></a>
              <a className="button button-ghost" href="/cloud#subscribe">View $9 Starter availability <Arrow /></a>
              <a className="button button-ghost" href="#install-cli">Decrypt / Verify Offline (Free CLI) <Arrow /></a>
            </div>
          </div>
        </div>
        <ul className="hero-checklist" aria-label="Portabase recovery capabilities">
          {heroChecklist.map(([title, desc]) => (
            <li key={title} className="hero-checklist-item">
              <span className="hero-check-icon" aria-hidden="true">✓</span>
              <div>
                <strong>{title}</strong>
                <span>{desc}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="recovery-actions">
          <a className="button button-primary" href="/login?mode=signup&next=/dashboard">Explore the recovery dashboard <Arrow /></a>
          <a className="button button-ghost" href="/cloud#subscribe">See Plans ($0 Free · $9/mo) <Arrow /></a>
          <a className="button button-ghost" href="https://www.npmjs.com/package/portabase" target="_blank" rel="noreferrer">View on npm <Arrow /></a>
          <a className="recovery-evidence-link" href="#stories">Read the real cases <span aria-hidden="true">↓</span></a>
        </div>
        <p className="recovery-note">Set it up before a lockout. Keep the copy. Test the restore.</p>
      </div>
      <div className="recovery-evidence-col">
        <p className="recovery-fire-quote">
          “Portabase is like fire insurance for your Supabase account. You can only get Fire Insurance <strong>BEFORE</strong> the fire...”
        </p>
        <figure className="recovery-evidence">
          <div className="recovery-evidence-heading">Why Portabase exists</div>
          <picture>
            <source srcSet="/images/banned.webp" type="image/webp" />
            <img src="/images/banned.png" width="1376" height="1143" alt="The founder’s Supabase sign-in screen showing Error: User is banned, circled in red." />
          </picture>
          <figcaption>The founder’s actual lockout. The reason we built a way to keep a recovery copy outside the account.</figcaption>
        </figure>
      </div>
    </div>
  </section>;
}

function RecoveryOverviewImage() {
  return <section className="recovery-overview" id="recovery-overview" aria-label="How Portabase recovery works">
    <div className="shell">
      <a href="/images/portabase-secure-enclave-flow.png" target="_blank" rel="noreferrer" aria-label="Open the Portabase recovery diagram at full size">
        <img src="/images/portabase-secure-enclave-flow.png" width="2014" height="780" alt="Portabase recovery diagram: copy the Supabase database, Edge Functions and Storage into a capsule; save it to customer storage and restore into a contingency account. The diagram shows the Google Cloud and Intel TDX secure enclave, its Google attestation certificate, and console reporting flow." />
      </a>
    </div>
  </section>;
}

function RecoveryUseCases() {
  return <section className="section recovery-use-cases" aria-labelledby="recovery-use-cases-title">
    <div className="shell">
      <div className="section-kicker green">YOUR RECOVERY PLAN</div>
      <h2 id="recovery-use-cases-title">A recovery plan for the way you use Supabase.</h2>
      <div className="recovery-use-case-grid">
        <article><span className="recovery-use-case-label">SMALL PROJECTS</span><h3>A small project can still be critical.</h3>
          <p>A free Supabase project can power a serious application or an entire business. Portabase’s $9/month service is designed to maintain a recovery copy in a separate Supabase account, optionally in another region—for example, the US and Europe. When both projects fit Supabase’s free-plan size and feature limits, the destination can also use the free tier.</p>
          <p className="recovery-use-case-note">10 GB outbound transfer per 30 days. We cover the first binary snapshot; afterward, only new or changed binary objects transfer. Selected database tables receive a full capture each run.</p>
        </article>
        <article><span className="recovery-use-case-label">INDEPENDENT ACCESS</span><h3>Keep your recovery account independent.</h3>
          <p>If GitHub is your only route into Supabase, losing access to GitHub can also block access to your Supabase dashboard. The <a href="#stories">public reports below</a> describe this failure mode. Give your contingency account a separate email-and-password login, enable Supabase-supported two-factor authentication, and keep its recovery credentials safely accessible.</p>
          <p className="recovery-use-case-note">A free destination keep-alive beacon is included every three days. Check its status in your console; provider pausing policies still apply.</p>
        </article>
        <article><span className="recovery-use-case-label">LARGER WORKLOADS</span><h3>More data. More control.</h3>
          <p>For workloads measured in hundreds of gigabytes, plan runner capacity, storage and transfer around your actual needs. Use our free, open-source CLI from npm to run backups in your own environment and keep recovery data in storage you control, including AWS S3, Dropbox and Cloudflare R2 through compatible configuration.</p>
          <p className="recovery-use-case-note">Cloud infrastructure and storage-provider charges remain separate.</p>
          <a href="https://www.npmjs.com/package/portabase" target="_blank" rel="noreferrer">Explore the open-source CLI <Arrow /></a>
        </article>
      </div>
    </div>
  </section>;
}

function SecureEnclaveRecovery() {
  return <section className="section secure-enclave-recovery" id="secure-enclave">
    <div className="shell">
      <div className="section-kicker green">SECURE ENCLAVE · VERIFIED BEFORE KEY RELEASE</div>
      <div className="split-heading"><h2>Your recovery runs inside a Secure Enclave.</h2><p>Google Confidential Space and Intel TDX protect the managed workload. Your client checks the attestation before encrypting job credentials to the enclave.</p></div>
      <div className="enclave-capability-grid">
        <article><span>01 · MEASURED WORKLOAD</span><h3>Google Confidential Space.<br />Intel TDX.</h3><p>The approved container image is pinned by its SHA-256 digest. Google-signed evidence identifies the measured workload and its Confidential Space environment.</p></article>
        <article><span>02 · VERIFIED KEY RELEASE</span><h3>Encrypted memory.<br />An attested session.</h3><p>The verifier checks the Google project, image digest, Intel TDX hardware, secure boot and disabled debugging. It also binds the enclave’s session key to the evidence before releasing encrypted job material.</p></article>
        <article><span>03 · CUSTOMER-OWNED RECOVERY</span><h3>Your encrypted copies.<br />Your recovery key.</h3><p>Encrypted capsules and binary manifests belong in your configured vault. The account dashboard receives usage and verification metadata; it is not your recovery vault.</p></article>
      </div>
      <div className="enclave-spec-strip"><span><b>Compute</b> Google Confidential Space</span><span><b>Hardware</b> Intel TDX</span><span><b>Workload pin</b> SHA-256</span><span><b>Capsule encryption</b> AES-256-GCM</span></div>
      <p className="enclave-trust-note">Managed recovery processes plaintext and key material inside an attested enclave in Portabase’s Google Cloud project. Attestation verifies the approved workload; it does not remove all trust in its code or operator. For infrastructure you operate yourself, use the open-source CLI.</p>
    </div>
  </section>;
}

function Faq() {
  return <section className="section faq" id="faq">
    <div className="shell">
      <div className="section-kicker green">Q&amp;A</div>
      <div className="split-heading">
        <h2>Straight answers.</h2>
        <p>Supabase is the product you build on. Portabase is the escape hatch. No invented stats. No fake proven-green.</p>
      </div>
      <div className="faq-list">
        {HOMEPAGE_FAQ.map((item, i) => (
          <details key={item.q} className="faq-item" open={i === 0}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  </section>;
}

function CliVsCloud() {
  const rows = [
    ['Who runs it', 'You, on infrastructure you control.', 'Google Confidential Space with Intel TDX; job material released after attestation verification.'],
    ['License & price', 'Free, open-source Apache-2.0 CLI. No Portabase subscription.', '$9/month Starter: one source project and one backup per 24 hours.'],
    ['Transfer allowance', 'Your infrastructure and storage provider’s limits and charges.', '10 decimal GB outbound per fixed 30-day allowance; provider charges remain separate.'],
    ['First binary snapshot', 'You maintain the baseline in storage you control.', 'Portabase covers the initial binary snapshot; those binary bytes do not consume the allowance.'],
    ['Later backups', 'Configure captures for your workload.', 'Only new or changed binary objects transfer; the encrypted baseline is retained. Selected database content is captured in full each run.'],
    ['Recovery destination', 'Your configured vault and a separate Supabase project.', 'Customer-controlled encrypted vault and a separately authorized Supabase destination.'],
    ['Scheduling & keep-alive', 'You configure your scheduler.', 'Opt-in free destination beacon every 72 hours; activity may reduce inactivity pauses, without a guarantee.'],
    ['Verification', 'Inspect engine checks and test recovery yourself.', 'Dashboard shows reported verification and completeness; a successful upload alone is not a recovery drill.'],
  ];
  return <section className="section cli-vs-cloud" id="cli-vs-cloud">
    <div className="shell">
      <div className="section-kicker">FREE CLI · CLOUD</div>
      <div className="split-heading">
        <h2>Free open-source CLI vs Cloud.</h2>
        <p>Choose who operates recovery. The CLI runs in your environment; managed Cloud runs the engine inside an attested Secure Enclave with usage reporting in your account.</p>
      </div>
      <div className="cli-free-path">
        <p className="cli-free-lead"><strong>The CLI is free. Infrastructure has its own costs.</strong> Run the Apache-2.0 engine on your own machine, VM or container without a Portabase subscription. Compute, storage and transfer charges depend on your providers.</p>
        <p>A contingency Supabase project can use its free tier when your database, binary objects and required features each fit the provider’s current limits. Database and object-storage allowances are separate; capsule size alone does not determine eligibility.</p>
      </div>
      <div className="compare-table-wrap cli-cloud-table-wrap">
        <table className="compare-table cli-cloud-table">
          <thead>
            <tr>
              <th>Compare</th>
              <th>Free open-source CLI<br /><span>You run it</span></th>
              <th>Portabase Cloud<br /><span>Convenience</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cli, cloud]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{cli}</td>
                <td>{cloud}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cli-cloud-note">Managed jobs process plaintext and keys inside Portabase-operated Google Cloud infrastructure. Confirm your destination and verify recovery before an incident; a keep-alive beacon cannot prevent every provider pause, suspension or termination.</p>
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
          <a className="button button-primary" href="https://github.com/data-automation-ai/portabase.dev" target="_blank" rel="noreferrer">Browse the open-source engine <Arrow /></a>
          <a className="button button-ghost" href="/cloud">See open source vs Cloud <Arrow /></a>
        </div>
      </div>
        <div className="what-actions">
        <a className="button button-primary" href="/cloud">Cloud vs open source <Arrow /></a>
        <a className="button button-ghost" href="/backend">Backend · capsules &amp; workers <Arrow /></a>
        <a className="button button-ghost" href="#escape">See the escape plan <Arrow /></a>
      </div>
    </div>
  </section>;
}

function WhyNow() {
  return <section className="section why-now" id="why-now">
    <div className="shell">
      <div className="love-note"><span>Let’s be clear</span><h2>Supabase is great.</h2><p>That is why so many prototypes quietly became real companies on it. But loving the building does not mean leaving your only exit key with the landlord.</p></div>
      <div className="hero-analogy"><span aria-hidden="true">⌂</span><p><b>Your landlord changed the locks.</b> The backup inside the building is not an Escape. Portabase keeps your way out in another building—tested, current, and under your control.</p></div>
      <div className="growth-grid">
        <div className="growth-stat"><strong>~10M</strong><span>developers building on Supabase—and every one may need help someday</span><a href="https://supabase.com/blog/supabase-series-f" target="_blank" rel="noreferrer">Supabase, June 2026 <Arrow /></a></div>
        <div className="growth-copy">
          <div className="section-kicker green">SUCCESS CREATED A NEW REALITY</div>
          <h3>The weekend prototype became a real business before anyone wrote the disaster plan.</h3>
          <p>Lovable, Bolt, v0 and other tools can put a production database behind an idea in minutes. Then the prototype gets customers, payments, years of records, and employees who need it tomorrow morning. The technical shortcut becomes the heart of a business long before anyone asks the brutal question: what happens if the owner cannot log in?</p>
          <div className="scale-warning"><span>NEARLY 10 MILLION DEVELOPERS. ONE SUPPORT QUEUE.</span><h4>Extraordinary for Supabase. Terrifying when your company is the one that needs help now.</h4><p>Mass adoption proves the product works. It also means your business emergency enters a platform operating at enormous scale. On Pro, the published offering lists email support—but no support SLA, phone line, live chat, designated support contact, or dedicated urgent-outage escalation lane. Those protections begin appearing on higher tiers.</p><p>Maybe success broke the queue. Ten million builders, one published email path for Pro, a 48-hour target. Your emergency lands wherever it lands.</p><b>Your outage may be existential to you. To a platform serving millions, it is still a ticket.</b></div>
          <div className="support-gap">
            <div><small>PRO · FROM $25/MO</small><b>Email support</b><span>No guaranteed support SLA</span></div>
            <div><small>TEAM · FROM $599/MO</small><b>Priority email</b><span>Support SLAs begin here</span></div>
            <div><small>ENTERPRISE</small><b>Private Slack</b><span>Premium 24×7 support</span></div>
          </div>
          <p className="gap-close">If your production site is down on Pro, the published path is email. There is no published Pro phone number or private live-support channel. A Supabase representative has said the target is 24–48 hours and can run longer under volume; public reports on this page describe outages and support waits stretching far beyond that. Can your company afford to lose tomorrow’s orders, customers, and reputation while the inbox stays silent? When your business goes down at 10am, it can be 10pm where your ticket gets read.</p>
          <aside className="escalation-reality"><span>THIS IS NOT A BUSINESS CONTINUITY PLAN</span><blockquote>“See if you can find a GitHub maintainer. Maybe they can escalate it.”</blockquote><p>When the best remaining idea is to find a stranger on the internet who might know someone inside, you do not control the recovery of your business. You are asking for a favor while the clock runs.</p><b>Portabase turns “please answer” into “restore the capsule.”</b></aside>
          <div className="source-links"><a href="https://supabase.com/solutions/vibe-coders" target="_blank" rel="noreferrer">Supabase for Vibe Coders <Arrow /></a><a href="https://supabase.com/pricing" target="_blank" rel="noreferrer">Published support tiers <Arrow /></a><a href="https://supabase.com/docs/guides/platform/billing-faq" target="_blank" rel="noreferrer">Billing FAQ <Arrow /></a><a href="https://www.reddit.com/r/Supabase/comments/1kbj0sh/supabase_threatened_to_delete_all_my_work_after/" target="_blank" rel="noreferrer">24–48 hour support statement <Arrow /></a></div>
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
            <small>THE ESCAPE</small>
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

/** Two lockout archetypes: severe (no recourse) vs inconvenient (recoverable, barely). Neither offers retroactive rescue. */
function TwoScenarios() {
  return (
    <section className="section" id="lockout-types">
      <div className="shell">
        <div className="section-kicker red">TWO WAYS THIS HAPPENS</div>
        <div className="split-heading">
          <h2>Not every lockout looks the same.</h2>
          <p>Both end the same way without a capsule already in place: you're the one who needed the insurance, and it's too late to buy it.</p>
        </div>
        <div className="esc-cmp-panels">
          <article className="esc-cmp-panel esc-cmp-panel-locked">
            <header>
              <small>SEVERE · NO RECOURSE</small>
              <h3>The account is gone</h3>
            </header>
            <div className="esc-cmp-lock" aria-hidden="true">
              <div className="esc-cmp-lock-door">
                <i />
                <b>BANNED</b>
                <span>No login · no API · no dashboard</span>
              </div>
              <div className="esc-cmp-lock-arrow">⇢</div>
              <div className="esc-cmp-lock-vault esc-cmp-lock-vault-dead">
                <b>Nothing left to reach</b>
                <span>Database, backups, support — all behind the same wall</span>
              </div>
            </div>
            <ul className="esc-cmp-bullets">
              <li>No connection string works — the project itself is unreachable</li>
              <li>A pre-incident capsule is the only way out</li>
              <li>Without one, there is nothing left to do</li>
            </ul>
          </article>

          <article className="esc-cmp-panel">
            <header>
              <small>INCONVENIENT · BARELY RECOVERABLE</small>
              <h3>The console is gone, the database isn't</h3>
            </header>
            <div className="esc-cmp-lock" aria-hidden="true">
              <div className="esc-cmp-lock-door">
                <i />
                <b>MFA / IDENTITY LOCKED</b>
                <span>Dashboard login fails</span>
              </div>
              <div className="esc-cmp-lock-arrow">⇢</div>
              <div className="esc-cmp-lock-vault">
                <b>DB connection string still works</b>
                <span>If you kept it somewhere else — most people don't</span>
              </div>
            </div>
            <ul className="esc-cmp-bullets">
              <li>Source keys are separate from console login — sometimes that saves you</li>
              <li>Recovery depends on having saved a credential you probably didn't think to save</li>
              <li>Effort, luck, and technical comfort required — not a plan</li>
            </ul>
          </article>
        </div>
        <p className="esc-cmp-foot">
          Neither panel is a pitch to call us mid-incident — we don't do retroactive rescue.
          Both are the reason to already have a capsule before you need one.
        </p>
      </div>
    </section>
  );
}

/** Conceptual runner architecture: sealed isolated container, keys decrypted only inside it, tunnel is break-glass access only. */
function RunnerArchitectureDiagram() {
  const box = { border: '1px solid var(--paper-line-strong)', borderRadius: 'var(--radius)', background: 'var(--paper-raised)', padding: '16px 18px' };
  return (
    <section className="section" id="how-the-runner-works" style={{ background: 'var(--paper)' }}>
      <div className="shell">
        <div className="section-kicker green">CONCEPTUAL · HOW MANAGED ESCAPE IS DESIGNED TO WORK</div>
        <div className="split-heading">
          <h2>A sealed container, not a shared server.</h2>
          <p>Conceptual illustration of the managed-runner design — not a live dashboard. Your source credentials are sealed to a container built only for your job, run in an isolated cloud environment, and never decrypted anywhere Portabase's own systems can read them.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, alignItems: 'stretch', marginTop: 24 }}>
          <div style={box}>
            <b>1. You seal your keys</b>
            <p style={{ color: 'var(--ink-muted)', fontSize: 14, marginTop: 8 }}>Your browser encrypts your Supabase credentials to a key only your job's container can unwrap. Portabase's servers see ciphertext only.</p>
          </div>
          <div style={box}>
            <b>2. An isolated container runs, then disappears</b>
            <p style={{ color: 'var(--ink-muted)', fontSize: 14, marginTop: 8 }}>A short-lived, per-customer container spins up in an isolated cloud environment, decrypts your keys <em>inside itself only</em>, runs the capture, and is destroyed. Nothing persists.</p>
          </div>
          <div style={box}>
            <b>3. The capsule goes to your vault</b>
            <p style={{ color: 'var(--ink-muted)', fontSize: 14, marginTop: 8 }}>The encrypted capsule lands in storage you own — Dropbox, S3, NAS. Portabase never holds a copy.</p>
          </div>
          <div style={box}>
            <b>4. Break-glass access is yours alone</b>
            <p style={{ color: 'var(--ink-muted)', fontSize: 14, marginTop: 8 }}>An encrypted tunnel lets <em>you</em> reach your own container for debugging (e.g. <code>portabase doctor</code>) — never a bypass of capsule encryption, and never a path in for Portabase.</p>
          </div>
        </div>
        <p className="esc-cmp-foot">
          This describes the managed-runner design, not a claim that automatic scheduled runs are live today —
          check the Cloud page for what's currently shipped versus what's on the roadmap.
        </p>
      </div>
    </section>
  );
}

function Escape() {
  return <section className="section escape" id="escape">
    <div className="shell">
      <div className="section-kicker green">THE ESCAPE</div>
      <div className="escape-heading"><h2>When the front door fails,<br /><em>leave through your own.</em></h2><p><strong>Escape</strong> is a customer-owned way out of a Supabase lockout — not a second landlord. Open-source engine builds the encrypted capsule in storage you own (DB, Auth, Storage bytes, Functions). Cloud (this site) keeps the Escape easy with GUI, configuration, and telemetry — and who to wake if the job goes quiet.</p></div>
      <EscapeVsSupabaseDiagram />
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
      <p>No S3, Dropbox, or Google Drive yet? <strong>Local Starter</strong> keeps encrypted capsules on this computer (or USB/NAS) while each capsule is ≤ 100 MB. Prefer Dropbox, Google Drive, or S3 when you can — Portabase never hosts recovery bytes.</p>
      <a className="button button-light" href="/cloud">Compare the two paths <Arrow /></a>
    </div>
    <div className="vault-demo" role="img" aria-label="Customer-owned vault destinations: Amazon S3, Dropbox, Google Drive, and Local Starter under 100 MB available; Google Cloud Storage, Azure Blob, Backblaze B2, and Cloudflare R2 coming soon">
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
        <div className="vault-grid live">
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
              <svg viewBox="0 0 32 32" fill="none"><path d="M10 22l6-10 6 10H10z" stroke="currentColor" strokeWidth="1.4"/><path d="M16 12l6 10h6L22 12h-6z" stroke="currentColor" strokeWidth="1.4"/></svg>
            </span>
            <div>
              <small>CLOUD DRIVE</small>
              <b>Google Drive</b>
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
            <small>ENTERPRISE OBJECT STORE</small>
            <b>Google Cloud Storage</b>
            <span>Direct GCS bucket archive</span>
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
      <p className="cloud-section-lead">Recovery bytes and encryption keys stay on infrastructure you control. Cloud is an optional side channel for health and alerts — never the place capsules live. Full sequence: <a href="/backend" style={{ color: 'var(--acid)', fontWeight: 700 }}>Backend · capsules &amp; workers ↗</a>.</p>

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
              <strong>Same open-source engine</strong>
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
  const reasons = closureReasons;
  const cases = useMemo(
    () => closureCases
      .slice().sort((a, b) => b.date.localeCompare(a.date) || (b.impact || 0) - (a.impact || 0)),
    [],
  );

  return <section className={`section closure-risk${variant === 'cloud' ? ' closure-risk-cloud' : ''}`} id="closures">
    <div className="shell">
      <div className="section-kicker red">PUBLIC REPORTS · NOT LEGAL FINDINGS</div>
      <div className="split-heading">
        <h2>Accounts close without a usable exit.</h2>
        <p>These are first-hand public posts from GitHub Discussions, Reddit, and mirrored Discord support threads. Exact source URLs are preserved. Posts are at least several months old where durable IDs allow. A report is what someone said happened — not independent proof of cause, and not a claim that every ban is wrongful.</p>
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
                  <em>{reason.provider}</em>
                </div>
                <p>{reason.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

    </div>
  </section>;
}

function CloudTeaser() {
  const starterReady=useStarterAvailability();
  return <section className="section cloud-teaser" id="cloud-teaser">
    <div className="shell cloud-teaser-card">
      <div>
        <div className="section-kicker green">ESCAPE OPS</div>
        <h2>Open source is the Escape.<br />Cloud keeps the Escape running.</h2>
        <p><strong>Supabase only.</strong> GitHub = free Escape engine. <strong>This site</strong> = hosted <strong>GUI</strong>, guided configuration, <strong>telemetry</strong>, and optional SMS on $17 — so the Escape is not a forgotten cron job. <strong>Cloud Free</strong> is 10 GB, manual only. Paid: <strong>$9/mo</strong> (1 project, 1 backup / 24h, 10 GB outbound / 30 days) or <strong>$17/mo</strong> (unlimited projects, capsules up to 25 GB, 3 capsules / day). You provide capsule storage. Managed jobs process keys inside an attested secure enclave. Restore into your <strong>contingency account</strong> — a separate Supabase account with independent access; free-tier eligibility depends on provider limits. Refunds are self-serve: full within 8 days, prorated after, one button, no email required.</p>
        <p className="cloud-insurance"><strong>Both versions are fire insurance — and insurance only works before the fire.</strong> The free CLI is the policy you write yourself: a recovery copy made before a lockout and kept under separate access. Cloud adds managed execution, usage reporting and verification metadata; you still need to run and test your recovery plan. A proven restore is the payout — your business rebuilt in a new account while the old one is still locked. Nobody is glad they paid the premium. Everyone is glad they had the policy.</p>
        <div className="cloud-teaser-actions">
          <a className="button button-primary" href="/login?mode=signup&next=/app">Start free trial <Arrow /></a>
          <a className="button button-ghost" href="/backend">Backend · how it talks <Arrow /></a>
          <a className="button button-ghost" href="/cloud">Open source vs Cloud <Arrow /></a>
        </div>
      </div>
      <div className="cloud-teaser-price">
        <span>GUI · CONFIG · TELEMETRY · SMS</span>
        <b>$9<small>/mo</small></b>
        <em>{starterReady?'Card required for the 7-day trial':'Coming soon · checkout not open'}</em>
        <p>{starterReady?'$9 monthly after the trial':'Managed runner release validation'}</p>
      </div>
    </div>
  </section>;
}

/** Opportunity deal framing: keep Supabase, remove SPOF */
function PublicDeal() {
  return <section className="section" id="deal">
    <div className="shell">
      <div className="section-kicker green">YOUR SUPABASE ESCAPE</div>
      <div className="split-heading">
        <h2>Keep Supabase.<br /><em>Own the Escape.</em></h2>
        <p>Portabase is your <strong>Supabase Escape</strong> — open source, Supabase-only. Encrypted capsule you control (database, Auth, <strong>Storage objects</strong>, <strong>Edge Functions</strong>) so lockout is not the end. This website is Cloud convenience: <strong>GUI, easier configuration, and telemetry</strong> — so the Escape stays real day to day, not a dusty script.</p>
      </div>
      <div className="gap-callout" style={{ marginTop: 28, marginBottom: 8, padding: '22px 24px', border: '1px solid var(--paper-line-strong)', background: 'var(--paper-2)', borderRadius: 8 }}>
        <div className="section-kicker green" style={{ marginBottom: 10 }}>SUPABASE PLATFORM BACKUPS · THE GAP</div>
        <h3 style={{ margin: '0 0 12px', fontSize: 22, letterSpacing: '-.03em', color: 'var(--ink)' }}>Their backup is not a full product escape hatch.</h3>
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 15, lineHeight: 1.65, maxWidth: 820 }}>
          Supabase documents that <strong>database backups do not include objects stored via the Storage API</strong> — the database holds <em>metadata</em> about files, not the file bytes themselves.
          <a href="https://supabase.com/docs/guides/platform/backups" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-ink)', fontWeight: 700 }}> Official backups docs ↗</a>
          {' '}Edge Function source is managed outside that Postgres snapshot path — a DB-only restore does not bring back your Storage files or redeploy Functions for you.
          <strong style={{ color: 'var(--ink)' }}> Portabase captures Storage object bytes and Function source as first-class layers.</strong>
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
        <a className="button button-ghost" href="/backend">How the backend works <Arrow /></a>
        <a className="button button-ghost" href="https://github.com/data-automation-ai/portabase.dev" target="_blank" rel="noreferrer">Open-source engine <Arrow /></a>
      </div>
    </div>
  </section>;
}

function CloudPage() {
  const starterReady=useStarterAvailability();
  const signedIn = isSignedIn();

  useEffect(() => {
    document.title = 'Portabase Cloud — Cross-Account Supabase Recovery & Pricing';
    if (window.location.hash === '#subscribe') {
      document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return <>
    <header className="site-header">
      <div className="shell nav-wrap">
        <Logo href="/" />
        <nav className="nav cloud-page-nav">
          <a href="#subscribe">Plans &amp; Pricing</a>
          <a href="#new-account">New-Account Restore</a>
          <a href="#compare">CLI vs Cloud</a>
          <a href="#keys">Zero-Knowledge Keys</a>
          <a href="/docs">Docs</a>
          <a href={signedIn ? '/dashboard' : '/login'}>{signedIn ? 'Dashboard' : 'Sign in'}</a>
        </nav>
        <a className="button button-small desktop-cta" href={signedIn ? '/dashboard' : '/login?mode=signup&next=/dashboard'}>
          {signedIn ? 'Open dashboard' : 'Start 7-day trial'} <Arrow />
        </a>
      </div>
    </header>

    <main className="cloud-page">
      <section className="section cloud-hero" style={{ paddingBottom: 36 }}>
        <div className="shell">
          <div className="section-kicker green">PORTABASE CLOUD · CROSS-ACCOUNT RECOVERY</div>
          <h1>When an account is locked,<br />you restore into a <em>new account</em> — not just a new database.</h1>
          <p className="cloud-hero-lead">
            If Supabase restricts or bans your login, your entire organization is unreachable. Official platform backups sit behind that same locked door.
            Portabase captures your <strong>Postgres database, Auth user directory, Storage object bytes, and Edge Functions</strong> into an encrypted capsule in your own vault — ready to restore into a <strong>completely separate Supabase account under a different email address</strong>.
          </p>
          <div className="cloud-hero-actions">
            <a className="button button-primary" href={signedIn ? '/dashboard' : '/login?mode=signup&next=/dashboard'}>Start 7-day free trial <Arrow /></a>
            <a className="button button-ghost" href="#subscribe">View plans ($0 · $9/mo) <Arrow /></a>
            <a className="button button-ghost" href="/dashboard?demo=1">Interactive demo <Arrow /></a>
            <a className="button button-ghost" href="https://github.com/data-automation-ai/portabase.dev" target="_blank" rel="noreferrer">Open-source CLI (`npx portabase`) <Arrow /></a>
          </div>
        </div>
      </section>

      <section className="section pricing" id="subscribe" style={{ paddingTop: 24 }}>
        <div className="shell">
          <div className="price-copy" style={{ maxWidth: 820, marginBottom: 28 }}>
            <div className="section-kicker green">PLANS &amp; PRICING · YOUR VAULT · ATTESTED WORKLOAD</div>
            <h2>Cloud Free and $9 Starter. Check availability before you subscribe.</h2>
            <p>
              The open-source CLI engine (<code>npx portabase</code>) is free forever on your own machine.
              <strong> Portabase Cloud</strong> adds the web dashboard, table &amp; bucket sizer and cross-account recovery controls. Starter runs are interactive; unattended attested backups are not enabled.
              <strong> Cloud Free</strong> includes up to 10 GB for manual runs (The free plan has no scheduled service).
              Paid plans start with a <strong>7-day free trial</strong> at <strong>$9/mo</strong> via Square, with an anytime <strong>+$8/mo in-app expansion</strong> ($17/mo total) for unlimited projects, capsules up to 25 GB, and 3 capsules / day.
            </p>
          </div>
          <div className="plan-grid plan-grid-3">
            <article className="price-card plan-card plan-card-free" key={CLOUD_FREE.id}>
              <div className="price-ribbon price-ribbon-free">NO SCHEDULE</div>
              <div className="price-top">
                <span>{CLOUD_FREE.title.toUpperCase()}</span>
                <div className="price-stack">
                  <b>$0<span className="per">/mo</span></b>
                  <small className="list-price">1 project · up to {CLOUD_FREE.storageCapLabel}</small>
                </div>
                <p>Manual backups and cross-account restore checks for projects up to 10 GB. Capsules land in <strong>your</strong> storage.</p>
              </div>
              <ul>
                <li><span>✓</span> 1 Supabase project (up to {CLOUD_FREE.storageCapLabel})</li>
                <li><span>✓</span> Restore into any separate Supabase account</li>
                <li><span>✓</span> Dashboard · manual runs</li>
                <li><span>✓</span> <strong>No scheduled service</strong></li>
                <li><span>✓</span> Table + bucket sizer to fit 10 GB</li>
                <li><span>✓</span> Your Google Drive, Dropbox, S3, or disk</li>
              </ul>
              <a className="button button-ghost purchase" href={signedIn ? '/dashboard' : '/login?mode=signup&next=/dashboard'}>
                {signedIn ? 'Open dashboard' : 'Start Cloud Free'} <Arrow />
              </a>
            </article>
            {publicCloudPlans().map((plan) => {
              const isBase = plan.id === 'cloud-9';
              return (
                <article className={`price-card plan-card${isBase ? ' is-featured' : ''}`} key={plan.id}>
                  {isBase ? (
                    <div className="price-ribbon">MOST TEAMS · START HERE</div>
                  ) : (
                    <div className="price-ribbon price-ribbon-free">IN-APP EXPANSION · +$10/MO</div>
                  )}
                  <div className="price-top">
                    <span>{isBase ? 'STARTER ESCAPE' : 'DAILY ESCAPE (IN-APP UPGRADE)'}</span>
                    <div className="price-stack">
                      <b>${plan.priceMonthlyUsd}<span className="per">/mo</span></b>
                      <small className="list-price">
                        {isBase ? starterReady ? '7-day trial · 10 GB outbound / 30 days' : 'Coming soon · checkout not open' : '$17/mo total · 7-day free trial'}
                      </small>
                    </div>
                    <p>
                      {isBase
                        ? `${plan.cadenceLabel}. Interactive attested runs and encrypted recovery copies in your vault; automatic backup scheduling is not enabled.`
                        : `${plan.cadenceLabel}. Unlimited projects and larger capacity for growing teams — upgrade anytime in-app.`}
                    </p>
                  </div>
                  <ul>
                    <li><span>✓</span> {plan.databasesLabel} (up to {plan.storageCapLabel})</li>
                    <li><span>✓</span> {plan.transfersPer24h} backup{plan.transfersPer24h === 1 ? '' : 's'} / 24h allowance</li>
                    <li><span>✓</span> Restore to a brand-new account &amp; email</li>
                    <li><span>✓</span> {isBase ? '10 GB outbound / 30 days · initial binary snapshot covered' : 'Capsule creation up to 25 GB'}</li>
                    <li><span>✓</span> {plan.smsOptional ? 'Automated SMS alerts on success & failure' : 'Email & dashboard status telemetry'}</li>
                    <li><span>✓</span> Selective table + bucket sizer</li>
                    <li><span>✓</span> Encrypted inside an attested secure enclave</li>
                  </ul>
                  {isBase&&!starterReady ? <button type="button" className="button button-primary purchase" disabled>Coming soon · release validation</button> : (
                  <a className={`button ${isBase ? 'button-primary' : 'button-ghost'} purchase`} href={signedIn ? `/app/account?tab=billing&plan=${plan.id}` : `/login?mode=signup&next=${encodeURIComponent(`/app/account?tab=billing&plan=${plan.id}`)}`}>
                    {signedIn ? (isBase ? 'Subscribe to Starter ($9/mo)' : 'Upgrade to Daily ($17/mo)') : 'Start 7-day free trial'} <Arrow />
                  </a>
                  )}
                </article>
              );
            })}
          </div>
          <p className="checkout-hint" style={{ marginTop: 16 }}>
            Already have an account? <a href="/login">Sign in</a> · Need manual secret contingency details? Read the <a href="/docs/manual-contingency">Manual effort contingency guide</a>.
          </p>
        </div>
      </section>

      <section className="section" id="new-account">
        <div className="shell">
          <div className="section-kicker green">CROSS-ACCOUNT ESCAPE · DIFFERENT EMAIL</div>
          <div className="split-heading">
            <h2>Why you restore into a new account — not just a new database.</h2>
            <p>When an account is suspended, locked by MFA, or flagged by automated billing/abuse filters, you cannot log in to create a second project inside that same organization.</p>
          </div>
          <div className="subscribe-case">
            <article>
              <small>01 · ACCOUNT-LEVEL LOCKOUT</small>
              <b>Your original login is blocked.</b>
              <p>A platform suspension locks the entire Supabase account associated with your primary email — blocking dashboard access, support tickets, and internal database snapshots all at once.</p>
            </article>
            <article>
              <small>02 · YOUR CAPSULE SITS OUTSIDE</small>
              <b>Encrypted in your own Drive, Dropbox, or S3.</b>
              <p>Because Portabase writes AES-256-GCM capsules directly to storage you own outside of Supabase, your backup is never trapped inside the locked organization.</p>
            </article>
            <article>
              <small>03 · NEW ACCOUNT, NEW EMAIL</small>
              <b>Restore into a clean Supabase account.</b>
              <p>Create a brand-new Supabase account with a different email address, spin up a blank target project, and restore your schema, data, Auth users, Storage files, and Edge Functions into it.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section" id="recovery-ladder">
        <div className="shell">
          <div className="section-kicker green">RECOVERY LADDER · COLD / WARM / HOT</div>
          <div className="split-heading">
            <h2>How fast is the way out?</h2>
            <p>Every plan starts with an encrypted escape you already hold. Higher tiers shorten the walk back — but a hot replica is never promised.</p>
          </div>
          <div className="subscribe-case">
            <article><small>01 · COLD · EVERY PLAN</small><b>Encrypted escape in your Dropbox.</b><p>Each capsule is encrypted and stored in storage you own (Google Drive, Dropbox, S3, or disk). Recovery means a fresh project in a separate account plus a guarded restore.</p></article>
            <article><small>02 · WARM · $17 / PREMIUM</small><b>Standby project, refreshed on schedule.</b><p>A standby Supabase project in a second account refreshed on schedule, plus the re-adapt runbook. Re-pointable in an hour, not a millisecond — recovery work, not failover magic.</p></article>
            <article><small>03 · HOT · NEVER PROMISED</small><b>No hot replica. No instant cutover claim.</b><p>Anyone promising a millisecond Supabase failover is selling a different product. Portabase gives you the verified capsule, the cross-account restore engine, and the <a href="/docs/manual-contingency">manual secret contingency</a> runbook.</p></article>
          </div>
        </div>
      </section>

      <section className="section cloud-compare" id="compare">
        <div className="shell">
          <div className="section-kicker">SIDE BY SIDE</div>
          <h2>Free Open-Source CLI vs. Portabase Cloud</h2>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Free CLI (<code>npx portabase</code>)<br /><span>Apache-2.0 · Run on your machine</span></th>
                  <th>Portabase Cloud<br /><span>Free 10 GB · $9 (10 GB transfer / 30 days) · $17 (25 GB captures)</span></th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Full encrypted capture (Postgres DB, Auth, Storage bytes, Edge Functions)</td><td className="yes">Yes</td><td className="yes">Yes — same engine</td></tr>
                <tr><td>Restore into a <strong>new Supabase account</strong> (different email)</td><td className="yes">Yes</td><td className="yes">Yes</td></tr>
                <tr><td>Your own vault (Google Drive, Dropbox, AWS S3, local disk)</td><td className="yes">Yes</td><td className="yes">Yes — you own the capsules</td></tr>
                <tr><td>Keys &amp; capsule passphrase invisible to Portabase.dev</td><td className="yes">Yes (local only)</td><td className="yes">Yes (status &amp; hashes only)</td></tr>
                <tr><td>Web GUI, visual table + bucket sizer &amp; readiness lamp</td><td className="no">CLI flags only</td><td className="yes">Yes · included</td></tr>
                <tr><td>Automated scheduled backups</td><td className="yes">DIY cron / Task Scheduler</td><td className="mid">Free and $9 Starter backups are interactive. Legacy $17 runner scheduling is separate from the attested workflow.</td></tr>
                <tr><td>Automated SMS alerts on backup success &amp; failure</td><td className="no">No</td><td className="yes">Included on $17/mo</td></tr>
                <tr><td>Works offline even if Portabase.dev is unreachable</td><td className="yes">Yes</td><td className="yes">Yes — capsules decrypt with the CLI</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section cloud-keys" id="keys">
        <div className="shell">
          <div className="section-kicker green">ZERO-KNOWLEDGE BOUNDARY</div>
          <div className="split-heading">
            <h2>Your keys and capsule bytes never live on Portabase.dev.</h2>
            <p>Portabase Cloud is the control and scheduling console — never the custodian of your database credentials or backup archives.</p>
          </div>
          <div className="subscribe-case">
            <article>
              <small>01 · INVISIBLE KEYS</small>
              <b>Service-role keys &amp; passphrases stay on your runner.</b>
              <p>The Portabase Cloud API enforces a strict schema allowlist that rejects database URLs, service-role keys, and encryption passphrases. Only job status, timestamps, byte sizes, and SHA-256 hashes reach the dashboard.</p>
            </article>
            <article>
              <small>02 · CUSTOMER-OWNED VAULT</small>
              <b>Capsules write directly to your storage.</b>
              <p>Every capsule is sealed with AES-256-GCM (<code>scrypt</code> key derivation) and uploaded straight to your Google Drive, Dropbox, S3 bucket, or disk.</p>
            </article>
            <article>
              <small>03 · HONEST CONTINGENCY</small>
              <b>Know what Supabase marks write-only.</b>
              <p>Supabase Edge Function secret values and OAuth secrets cannot be exported by any API. Read our <a href="/docs/manual-contingency">Manual effort contingency guide</a> (with a ready-to-run Python bridge) so your new account is ready at cutover.</p>
            </article>
          </div>
        </div>
      </section>
    </main>
    <Footer />
  </>;
}

function LegacyPurchaseNotice() {
  return <div className="thanks"><div className="thanks-card"><Logo href="/" /><div className="section-kicker green">MODEL UPDATE</div><h1>Portabase is open core + Cloud subscription.</h1><p>There is no $147 software unlock. The recovery engine is free on GitHub. Portabase Cloud is Cloud Free 10 GB, then $9/mo (10 GB transfer / 30 days) or $17/mo (25 GB captures) — console, table sizer, telemetry, and alert chains. Managed jobs process keys inside an attested enclave; your vault remains separate.</p><a className="button button-primary" href="/cloud">Open source vs Cloud <Arrow /></a><a className="button button-ghost" href="mailto:escape@portabase.dev?subject=Legacy Portabase purchase">Legacy purchase help <Arrow /></a></div></div>;
}

function Footer() {
  return <footer><div className="shell footer-main"><div><Logo href="/" /><p>Your Supabase Escape.<br />Open source. Cloud optional.</p></div><div><b>EXPLORE</b><a href="/#recovery-overview">Recovery</a><a href="/#faq">FAQ</a><a href="/#reality">The reality</a><a href="/#stories">Real incidents</a><a href="/#escape">Escape plan</a><a href="/#audit">Risk check</a><a href="/docs">Docs</a><a href="/security">Security &amp; trust</a><a href="/cloud">Cloud · {planPriceRangeLabel()}</a><a href="/legal">Legal and Terms of Use</a></div><div><b>CONTACT</b><a href="mailto:escape@portabase.dev">escape@portabase.dev</a><a href="https://github.com/DataAutomation-ai/portabase-CLI" target="_blank" rel="noreferrer">GitHub · portabase-CLI</a><span>Independent product.<br />Not affiliated with Supabase, Inc.</span><span>Apache-2.0 open core. Managed jobs process keys inside an attested Secure Enclave; the standalone CLI runs on infrastructure you operate. Cloud Free 10 GB · $9 (10 GB transfer / 30 days) · $17 (25 GB captures).</span></div></div><div className="shell footer-bottom"><span>© 2026 Portabase</span><span>Your keys. Your vault. Your way out.</span></div></footer>;
}

/**
 * Security & trust — customer picks posture: trust Portabase, mix controls, or maximum self-control.
 * Aesthetic: audit-brief instrument panel; memorable “choose your trust dial.”
 */
function SecurityPage() {
  useEffect(() => { document.title = 'Portabase — Secure Enclave security & trust'; window.scrollTo(0, 0); }, []);
  return <div className="security-page"><Header /><main>
    <section className="security-hero"><div className="shell">
      <div className="section-kicker green">SECURITY &amp; TRUST · GOOGLE CONFIDENTIAL SPACE + INTEL TDX</div>
      <h1>Verify the workload.<br /><em>Then release the keys.</em></h1>
      <p className="security-lead">Managed Portabase recovery runs inside a Secure Enclave: an Intel TDX Confidential VM running Google Confidential Space. A verified, encrypted session connects your client to the approved workload before recovery credentials are released.</p>
      <p>Plaintext and keys are processed inside that enclave in a Portabase-operated Google Cloud project. This is a specific, verifiable trust boundary—not a promise that you never trust Portabase, Google, Intel or the recovery code.</p>
      <div className="security-cta-actions"><a className="button button-primary" href="#attestation">Review the checks <Arrow /></a><a className="button button-ghost" href="#security-limits">Read the limits <Arrow /></a></div>
    </div></section>
    <SecureEnclaveRecovery />
    <section className="section" id="attestation"><div className="shell">
      <div className="section-kicker green">BEFORE CREDENTIAL RELEASE</div><h2>A session must pass every required check.</h2>
      <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>Check</th><th>What the verifier requires</th></tr></thead><tbody>
        <tr><td>Google-signed evidence</td><td>A valid signature from Google’s attestation keys, expected issuer and audience, fresh timestamps and the client’s challenge.</td></tr>
        <tr><td>Approved environment</td><td>The expected Google project, Intel TDX hardware, secure boot and disabled debugging, plus supported Confidential Space attributes.</td></tr>
        <tr><td>Approved workload</td><td>The pinned SHA-256 container image and expected entry point. Unexpected command or environment overrides fail verification.</td></tr>
        <tr><td>Session key binding</td><td>The enclave’s public key must match the attested evidence. The encrypted command binds the session identifier and challenge. Credentials are encrypted to the verified key.</td></tr>
        <tr><td>Authenticated command</td><td>The encrypted command binds the customer, operation and unique request. Replies are encrypted for the requesting client; invalid or replayed messages are rejected.</td></tr>
      </tbody></table></div>
      <p className="enclave-trust-note">Technical references: <a href="https://docs.cloud.google.com/docs/security/confidential-space" target="_blank" rel="noreferrer">Google Confidential Space security</a> · <a href="https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/token-claims?hl=en" target="_blank" rel="noreferrer">Google attestation token claims</a>.</p>
      <p className="enclave-trust-note">Secure boot, measured workload identity and hardware-encrypted memory address different risks. They do not establish that the application code has no bugs. The approved image and verifier still need review, and the publisher controls future releases. The hosted browser verifier and release policy are served by the same operator; independently pinning and distributing a verifier remains a separate trust control.</p>
    </div></section>
    <section className="section" id="keys-protected"><div className="shell">
      <div className="section-kicker green">KEYS, MANIFESTS &amp; RECOVERY COPIES</div><h2>Keep recovery independent of the runner’s lifetime.</h2>
      <div className="enclave-capability-grid">
        <article><span>RECOVERY KEY</span><h3>A key you must retain.</h3><p>Your recovery key protects the encrypted profile and recovery data. Keep a separate, accessible copy. The hardware’s temporary memory-encryption key is not a replacement for your recovery key.</p></article>
        <article><span>AUTHENTICATED ENCRYPTION</span><h3>Capsules and manifests.</h3><p>Capsules use AES-256-GCM. Managed manifest and binary-catalog keys are derived from the recovery key with purpose-specific HKDF separation. Authentication failures stop reads; plaintext manifests are not a substitute for a verified catalog.</p></article>
        <article><span>DURABLE CUSTOMER VAULT</span><h3>State that survives a restart.</h3><p>Encrypted manifests and retained binary versions live in the configured external vault and are loaded for later jobs. Changed objects add versions; unchanged objects remain referenced by the catalog. Losing the required baseline or key can prevent recovery.</p></article>
      </div>
      <p className="enclave-trust-note">The $9 policy covers the initial binary snapshot, then transfers new or changed binary objects. Database content selected for a backup is captured in full each run. This is not database change-data capture or continuous replication.</p>
    </div></section>
    <section className="section" id="security-data"><div className="shell">
      <div className="section-kicker green">WHERE INFORMATION GOES</div><h2>A clear boundary for each service.</h2>
      <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>Location</th><th>Information and responsibility</th></tr></thead><tbody>
        <tr><td>Attested managed runner</td><td>Processes authorized source data, plaintext and credentials while the workload runs. It performs capture, encryption, verification and the requested restore.</td></tr>
        <tr><td>Customer vault</td><td>Stores encrypted recovery copies, binary versions and manifests. You control provider access, retention and the recovery key. Provider outages or deletion still affect availability.</td></tr>
        <tr><td>Account control plane</td><td>Stores account, billing, connection and job metadata. Hosted OAuth authorization backends receive provider grants before the attested handoff; legacy provider cookie formats differ. The recovery key is never sent to that grant bridge, and the console is not your recovery vault.</td></tr>
        <tr><td>Usage service</td><td>Records bytes, duration, results and reported completeness. Usage commands require separate workload attestation bound to the exact receipt. Ordinary sign-in or a general attestation response cannot manufacture trusted usage.</td></tr>
        <tr><td>Browser</td><td>Verifies the session, handles the recovery key for encrypted commands and retains the encrypted profile where configured. Browser compromise or malicious extensions can still expose material before it enters the enclave.</td></tr>
      </tbody></table></div>
    </div></section>
    <section className="section" id="security-beacons"><div className="shell">
      <div className="section-kicker green">OPTIONAL DESTINATION KEEP-ALIVE</div><h2>A separate, revocable authorization.</h2>
      <p>The free beacon can perform an authorized read-only activity query every 72 hours. It is separate from backup transfer allowance and does not require your recovery key or capsule plaintext. A beacon may reduce inactivity pauses; it cannot guarantee that Supabase will keep an account or project active.</p>
      <p>Unattended beacon operation requires explicit opt-in. Its destination OAuth grant is encrypted for the delegated service and protected by Google Cloud KMS and IAM. The provider grant can have broader privileges than the read-only query the worker performs: this is an operational trust decision, not a database-enforced read-only credential. You can disable the delegation and revoke provider access.</p>
      <p className="enclave-trust-note">A configured schedule is not proof of a successful beacon. Check its last result. Missing authorization, unavailable services or an unready worker must remain visible as unavailable or failed.</p>
    </div></section>
    <section className="section" id="security-limits"><div className="shell">
      <div className="section-kicker green">HONEST LIMITS</div><h2>Security evidence has a scope.</h2>
      <div className="enclave-capability-grid">
        <article><span>ATTESTATION</span><h3>Identity, not infallibility.</h3><p>Attestation identifies the approved environment and code. It does not eliminate application vulnerabilities, source-provider compromise, denial of service, operator release authority or every hardware risk.</p></article>
        <article><span>RECOVERY VERIFICATION</span><h3>Completeness stays explicit.</h3><p>A completed upload is not a successful restore. Omitted tables or binary objects remain excluded. Dashboard results distinguish incomplete, selected and verified output; a full recovery drill into a separate project is additional evidence.</p></article>
        <article><span>RELEASE &amp; REVIEW</span><h3>Judge the running session.</h3><p>This page describes the managed design and its implemented checks. It does not certify that every hosted workflow is enabled, that an independent verifier has been distributed, or that a full production recovery drill has passed. Use the actual session attestation and job evidence.</p></article>
      </div>
    </div></section>
    <section className="section security-standalone"><div className="shell">
      <div className="section-kicker green">SELF-OPERATED ALTERNATIVE</div><h2>Prefer infrastructure you operate yourself?</h2>
      <p>The free Apache-2.0 CLI runs in your own environment with your own credentials, schedule and storage. No Portabase subscription is required. You remain responsible for the host, encryption key, provider charges and recovery testing.</p>
      <div className="security-cta-actions"><a className="button button-primary" href="https://www.npmjs.com/package/portabase" target="_blank" rel="noreferrer">Open-source CLI <Arrow /></a><a className="button button-ghost" href="https://github.com/data-automation-ai/portabase.dev" target="_blank" rel="noreferrer">Review the source <Arrow /></a><a className="button button-ghost" href="mailto:escape@portabase.dev?subject=Secure%20Enclave%20security%20review">Discuss a security review <Arrow /></a></div>
    </div></section>
  </main><Footer /></div>;
}

/** Bottom use cases: one-sentence summaries that expand for the curious. */
function UseCases() {
  const cases = [
    { tag: 'LOCKED OUT · FREE', title: 'Locked out of a free project with no backups at all.', body: 'Free-tier projects get no automated backups, no daily snapshots, zero days retention. Portabase captures your database, Auth, Storage files, and Functions into a capsule you own. A separate free Supabase project is suitable when the database, object storage and required features each fit its current limits.' },
    { tag: 'BUSINESS · PAID', title: 'A paid project goes down and support is an email queue.', body: 'Outside of Enterprise, help is an email queue with about a 48-hour turnaround. Your capsule already sits outside the ticket queue, ready to restore as a project in a different account while you wait.' },
    { tag: 'VIBE-CODED', title: 'Dozens of Edge Functions a database copy will never save.', body: 'Tools like Claude Code and Codex can scaffold dozens of Edge Functions in an afternoon. A pg_dump copies the database and nothing else. Portabase captures function source as a first-class layer.' },
    { tag: 'BLOBS · HUGE TABLES', title: 'Too big to copy whole, too important to skip.', body: 'Binary objects and giant tables blow up every naive backup. The free CLI has include and exclude controls for tables and buckets, so the capsule fits whatever vault you can store.' },
    { tag: 'CUTOVER', title: 'Migrating, handing off, or just want a way back.', body: 'Snapshot before a migration, a contractor handoff, or a risky deploy. If the new direction fails, the capsule restores the project as it was, in a different account if needed. You also pick the new project’s region at creation — the same restore doubles as a deliberate move to another region.', link: ['which account to restore into', '/docs/restore-targets'] },
  ];
  return <section className="section use-cases" id="use-cases">
    <div className="shell">
      <div className="section-kicker green">USE CASES</div>
      <div className="split-heading"><h2>Which one<br />are you?</h2><p>One sentence each. Open any of them for the details.</p></div>
      <div className="use-case-list">
        {cases.map((item) => (
          <details key={item.tag} className="use-case-row">
            <summary><span className="use-case-tag">{item.tag}</span><span className="use-case-title">{item.title}</span></summary>
            <p>{item.body}{item.link ? (<span> See <a href={item.link[1]}>{item.link[0]}</a>.</span>) : null}</p>
          </details>
        ))}
      </div>
    </div>

      <figure className="hero-concept">
        <img src="/images/escape-vaults.jpg" alt="Your Supabase Escape: courier carries the sealed capsule from the locked project to your vault (S3, Dropbox, Drive, or your disk), then restores it" width="2014" height="780" />
        <figcaption><span>From locked project to your vault to restored.</span><small>The whole story on one screen</small></figcaption>
      </figure>
  </section>;
}

function ClosingCta() {
  return <section className="section closing-cta" id="closing-cta" aria-labelledby="closing-cta-title">
    <div className="shell closing-cta-card">
      <div className="section-kicker green">GET FIRE INSURANCE BEFORE THE FIRE · 3 MODES OF OPERATION</div>
      <h2 id="closing-cta-title">Don’t wait for a lockout to test your escape.</h2>
      <p className="closing-cta-lead">
        Managed recovery jobs use an attested <strong>Google Confidential Space (Intel TDX)</strong> enclave; the open-source CLI runs on infrastructure you operate. Keep your encrypted capsule, recovery key and every referenced binary version together. A compatible CLI can open retained recovery data without the hosted console; restoring into Supabase still requires destination access and a tested recovery procedure.
      </p>
      <div className="closing-cta-actions">
        <a className="button button-primary" href="/login?mode=signup&next=/dashboard">Explore the recovery dashboard <Arrow /></a>
        <a className="button button-ghost" href="/cloud#subscribe">View $9 Starter availability <Arrow /></a>
        <a className="button button-ghost" href="https://www.npmjs.com/package/portabase" target="_blank" rel="noreferrer">Run Open-Source CLI (npx portabase) <Arrow /></a>
      </div>
      <p className="closing-cta-note">Test with isolated projects · No credit card required for free runs · Open-source Apache-2.0 engine</p>
    </div>
  </section>;
}

function HomePage() {
  useEffect(() => { document.title = 'Portabase — Your Supabase Escape'; }, []);
  return <><Header /><main><Hero /><RecoveryOverviewImage /><RecoveryUseCases /><Stories /><WhyNow /><Reality /><ClosureRisk /><TwoScenarios /><MidPageCta /><WhatIsThis /><SecureEnclaveRecovery /><CliVsCloud /><RunnerArchitectureDiagram /><Escape /><InstallCta Arrow={Arrow} /><Faq /><Audit /><Cutover /><PublicDeal /><CloudTeaser /><UseCases /><ClosingCta /></main><Footer /></>;
}

/** Mid-page conversion point placed at the emotional peak, after Stories + TwoScenarios. */
function MidPageCta() {
  return <section className="section" id="mid-cta">
    <div className="shell install-cta-card">
      <div>
        <div className="section-kicker green">THE OTHER ENDING</div>
        <h2>Every story above ends the same way without a capsule.</h2>
        <p>With one, it ends in a restore: your encrypted capsule rebuilds into a brand-new Supabase account — often a free one — while the original account is still locked. That is fire insurance for your Supabase account: the CLI is the policy you write once for free; Cloud is the premium that keeps it current, watched, and ready to pay out.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="#escape">Build your Escape <Arrow /></a>
          <a className="button button-ghost" href="/login?mode=signup&next=/app">Start free Cloud trial <Arrow /></a>
        </div>
      </div>
    </div>
  </section>;
}

function ConfidentialCallbackPage() {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const fullUrl = typeof window !== 'undefined' ? window.location.href : '';
  const localCallback = `http://127.0.0.1:58441/confidential/callback${search}`;
  useEffect(() => {
    if (search.includes('code=') && search.includes('state=')) {
      window.location.replace(localCallback);
    }
  }, [search, localCallback]);
  return <main className="shell" style={{ padding: '80px 24px', maxWidth: 680, margin: '0 auto', color: '#e6edf3' }}>
    <div style={{ background: '#111824', border: '1px solid #233044', borderRadius: 10, padding: 28 }}>
      <div className="section-kicker green">INTEL TDX ENCLAVE OAUTH HANDOFF</div>
      <h1 style={{ fontSize: 24, margin: '8px 0 12px' }}>Completing Enclave OAuth Connection…</h1>
      <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
        Redirecting your single-use authorization code to your local Confidential Space helper (<code>127.0.0.1:58441</code>) so the Intel TDX enclave can exchange it directly. Works from both standard and Incognito/Private windows.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18 }}>
        <a className="button button-primary" href={localCallback}>Continue to Local Enclave Helper (127.0.0.1:58441) →</a>
        <button type="button" className="button button-ghost" onClick={() => navigator.clipboard?.writeText(fullUrl)}>Copy Callback URL</button>
      </div>
    </div>
  </main>;
}

function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const loc = `${window.location.pathname}${window.location.search}`;
  if (path === '/confidential/callback') return <ConfidentialCallbackPage />;
  if (path === '/thanks' || path === '/buy') return <LegacyPurchaseNotice />;
  if (path === '/login' || path === '/signup') return <Lazy><LoginPage /></Lazy>;
  if (path === '/auth/callback') return <Lazy><AuthCallbackPage /></Lazy>;
  /* pathname + search so /dashboard?demo=1 never falls through to HomePage */
  if (isCloudConsolePath(path) || isCloudConsolePath(loc)) return <Lazy><AppPage /></Lazy>;
  if (path === '/cloud' || path === '/pricing') return <CloudPage />;
  if (path === '/security' || path === '/trust') return <SecurityPage />;
  if (path === '/backend') return <Lazy><BackendPage Logo={Logo} Arrow={Arrow} Footer={Footer} /></Lazy>;
  if (isDocsPath(path) || path === '/docs') return <Lazy><DocsPage Logo={Logo} Arrow={Arrow} Footer={Footer} /></Lazy>;
  if (path === '/cases/manage') return <Lazy><CasesManagePage Logo={Logo} Footer={Footer} /></Lazy>;
  if (path === '/cases/submit') return <Lazy><CasesSubmitPage Logo={Logo} Footer={Footer} /></Lazy>;
  if (path === '/legal' || path === '/disclaimer') return <Lazy><LegalPage Logo={Logo} Arrow={Arrow} Footer={Footer} /></Lazy>;
  return <HomePage />;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
