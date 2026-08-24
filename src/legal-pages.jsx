import React, { useEffect } from 'react';

const Arrow = () => <span aria-hidden="true">↗</span>;

function Logo({ href = '/' }) {
  return <a className="logo" href={href}><span className="logo-mark" aria-hidden="true"><i /><i /><i /></span><b>Portabase</b></a>;
}

function LegalShell({ title, kicker, children }) {
  return (
    <div className="auth-page">
      <header className="site-header">
        <div className="shell nav-wrap">
          <Logo href="/" />
          <a className="button button-small desktop-cta" href="/cloud">Cloud pricing <Arrow /></a>
        </div>
      </header>
      <main className="auth-main">
        <div className="shell" style={{ maxWidth: 720, padding: '48px 20px 80px' }}>
          <div className="section-kicker green">{kicker}</div>
          <h1 style={{ fontSize: 36, letterSpacing: '-0.03em', margin: '8px 0 12px' }}>{title}</h1>
          <p style={{ color: 'var(--muted, #8b929e)', marginBottom: 28 }}>DataAutomation.ai, LLC · portabase.dev · escape@portabase.dev</p>
          <div className="legal-doc" style={{ lineHeight: 1.65, fontSize: 15 }}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  useEffect(() => { document.title = 'Privacy · Portabase'; window.scrollTo(0, 0); }, []);
  return (
    <LegalShell title="Privacy" kicker="PORTABASE · PRIVACY">
      <p>Portabase is a Supabase Escape product. This page is what we actually collect for Portabase Cloud on portabase.dev — not a generic template.</p>
      <h2>Who we are</h2>
      <p>DataAutomation.ai, LLC operates Portabase. Contact: <a href="mailto:escape@portabase.dev">escape@portabase.dev</a>.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Account identity from Supabase Auth: email, user id, and (if you use Google) name and Google subject as Google and Supabase provide them.</li>
        <li>Billing records we create with Square: customer id, subscription id, order id, plan, trial/paid status. Square holds the card. We do not receive or store PAN, CVV, or full card numbers.</li>
        <li>Optional console settings you type (workspace name, destination labels, alert numbers). SMS numbers you add are stored so we can text run success/failure and key-access alerts.</li>
        <li>Agent health metadata only if you opt in.</li>
      </ul>
      <h2>What we do not collect as a vault</h2>
      <ul>
        <li>Encrypted recovery capsules (<code>.pbase</code>) — those go to storage you bring (S3, Dropbox, NAS, local).</li>
        <li>Your capsule encryption passphrase as our backup of your backup.</li>
        <li>Your Supabase database password or service-role key, unless you choose Cloud key custody for a managed runner.</li>
      </ul>
      <h2>Key custody (optional, Cloud only)</h2>
      <p>If you give Portabase a least-privilege source key so a managed runner can capture on a schedule, that key is used during the job window. There is a real possibility Portabase can see or use that material while the job runs. That is not zero-knowledge. The standalone open-source engine is the path that never hands us a key.</p>
      <h2>Google sign-in</h2>
      <p>Google sign-in uses an OAuth client registered for Portabase. We request basic profile scopes (openid, email, profile) to create your Cloud account. We do not use Google One Tap.</p>
      <h2>Processors</h2>
      <ul>
        <li>Supabase Auth and our control-plane project — identity.</li>
        <li>Square — checkout and subscriptions.</li>
        <li>Netlify — the website and Cloud API.</li>
        <li>AWS — operator secrets and, when you connect them, your CloudTrail/CloudWatch reads.</li>
      </ul>
      <h2>Retention</h2>
      <p>We keep Cloud account and billing records while the subscription exists and for a short period after you tap refund/close, so we can finish Square cancel/refund. Capsules in your vault stay there; we do not delete them when Cloud closes.</p>
      <h2>Your choices</h2>
      <p>Sign out at any time. During the trial or the 7-day money-back window you can tap Refund &amp; close account in Cloud → Plan. Email escape@portabase.dev to ask what we hold for your user id.</p>
      <p style={{ marginTop: 28, color: 'var(--muted, #8b929e)', fontSize: 13 }}>Last updated 2026-08-23.</p>
    </LegalShell>
  );
}

export function TermsPage() {
  useEffect(() => { document.title = 'Terms · Portabase'; window.scrollTo(0, 0); }, []);
  return (
    <LegalShell title="Terms" kicker="PORTABASE · TERMS">
      <p>These terms cover Portabase Cloud on portabase.dev. The recovery engine on GitHub is Apache-2.0; this page is the paid Cloud service.</p>
      <h2>The product</h2>
      <p>Portabase Cloud is ops: console, trial billing, telemetry, and alerts for Escapes of <strong>Supabase projects</strong> (database, Auth inventory, Storage objects, Edge Functions). You provide capsule storage. Portabase does not host recovery bytes as the vault.</p>
      <h2>Not affiliated</h2>
      <p>Portabase is not affiliated with Supabase, Inc.</p>
      <h2>Plans and trial</h2>
      <ul>
        <li>Daily Escape: $17/month, 1 escape per 24 hours.</li>
        <li>Triple Escape: $27/month, up to 3 escapes per day.</li>
        <li>7-day trial, card required, via Square. After the trial Square charges the card on file unless you cancel.</li>
        <li>Up to 12 agents per workspace.</li>
      </ul>
      <h2>Money-back</h2>
      <p>During the $0 trial, Refund &amp; close account cancels Square and closes Cloud; there is no charge to refund. Within 7 days of the first paid charge, the same button refunds that payment, cancels Square, and closes Cloud. After that window the button is gone. Capsules in your vault are not deleted.</p>
      <h2>Your responsibilities</h2>
      <ul>
        <li>You bring a destination for encrypted capsules.</li>
        <li>You keep passphrase and source credentials under your control unless you explicitly opt into Cloud key custody.</li>
        <li>Replay into a new blank project, never silently onto the live source.</li>
      </ul>
      <h2>Honest limits</h2>
      <p>Managed Cloud runners must use crypto during a job, so Portabase may see or use key material in that window. SMS send, Dropbox OAuth, and a fully managed capture runner are productized to different degrees — the console must not be read as a guarantee that every advertised ops nicety is live on day one. The open-source engine remains the restore path if Cloud is unavailable.</p>
      <h2>Acceptable use</h2>
      <p>Do not use Cloud to capture systems you do not own or to store unlawful content in destinations you attach. We may close an account that abuses the API or billing.</p>
      <h2>Contact</h2>
      <p><a href="mailto:escape@portabase.dev">escape@portabase.dev</a></p>
      <p style={{ marginTop: 28, color: 'var(--muted, #8b929e)', fontSize: 13 }}>Last updated 2026-08-23. DataAutomation.ai, LLC.</p>
    </LegalShell>
  );
}
