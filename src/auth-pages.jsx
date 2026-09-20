import React, { useEffect, useMemo, useState } from 'react';
import { productConfig } from './lib/auth-config.js';
import {
  AWS_CLOUD_VERSION_ENABLED,
  CLOUD_VERSIONS,
  getStoredCloudVersion,
  listCloudVersions,
  normalizeCloudVersion,
  setStoredCloudVersion,
  versionFromSearch,
} from './lib/cloud-versions.js';
import * as supabaseAuth from './lib/supabase-auth.js';
import * as awsAuth from './lib/cognito.js';
import { sessionUser, isSignedIn } from './lib/session.js';
import { ensureSessionForVersion } from './lib/cloud-api.js';
import { ConsoleApp } from './console/ConsoleApp.jsx';

const Arrow = () => <span aria-hidden="true">↗</span>;

function Logo({ href = '/' }) {
  return <a className="logo" href={href}><span className="logo-mark" aria-hidden="true"><i /><i /><i /></span><b>Portabase</b></a>;
}

function VersionPicker({ version, onChange }) {
  const versions = listCloudVersions();
  if (versions.length <= 1) {
    return (
      <div className="version-callout" style={{ marginBottom: 18, maxWidth: 'none' }}>
        <span>LAUNCH SCOPE</span>
        <b>Supabase only</b>
        <p>Portabase protects Supabase projects (database, Auth, Storage, Edge Functions). Sign in with Supabase Auth — email, Google, or GitHub.</p>
      </div>
    );
  }
  return (
    <div className="version-picker" role="tablist" aria-label="Cloud version">
      {versions.map(v => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={version === v.id}
          className={version === v.id ? 'is-active' : ''}
          onClick={() => onChange(v.id)}
        >
          <strong>{v.label}</strong>
          <span>{v.id === 'supabase' ? 'Supabase Auth' : 'Amazon Cognito'}</span>
        </button>
      ))}
    </div>
  );
}

function AuthShell({ children, title, lead, version, cardLabel }) {
  const meta = CLOUD_VERSIONS[version] || CLOUD_VERSIONS.supabase;
  return (
    <div className="auth-page">
      <a className="auth-skip" href="#auth-card">Skip to sign in</a>
      <header className="site-header auth-header">
        <div className="shell nav-wrap">
          <Logo href="/" />
          <nav className="auth-nav" aria-label="Auth">
            <a href="/cloud">Pricing</a>
            <a href="/security">Security</a>
            <a className="button button-small desktop-cta" href="/cloud">Cloud plans <Arrow /></a>
          </nav>
        </div>
      </header>
      <main className="auth-main">
        <div className="shell auth-shell">
          <div className="auth-copy">
            <div className="section-kicker green">PORTABASE CLOUD</div>
            <h1>{title}</h1>
            <p>{lead}</p>
            <div className="version-callout">
              <span>LAUNCH · SUPABASE ONLY</span>
              <b>{meta.authLabel}</b>
              <p>{meta.description}</p>
            </div>
            <ul className="auth-bullets">
              <li><span aria-hidden="true">1</span> Sign in with email, Google, or GitHub</li>
              <li><span aria-hidden="true">2</span> 7-day trial · card required · then {productConfig.priceRangeLabel}/mo</li>
              <li><span aria-hidden="true">3</span> You own the capsule vault. We never hold keys.</li>
            </ul>
          </div>
          <div className="auth-card" id="auth-card" aria-label={cardLabel || title}>{children}</div>
        </div>
      </main>
    </div>
  );
}

function GoogleButton({ version, next, label }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className="button oauth-btn oauth-btn-google"
        disabled={busy}
        aria-label={label}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            setStoredCloudVersion(version);
            sessionStorage.setItem('portabase.auth.next', next);
            sessionStorage.setItem('portabase.auth.version', version);
            if (version === 'aws') {
              window.location.href = awsAuth.googleSignInUrl({ next });
            } else {
              await supabaseAuth.signInWithGoogle({ next });
            }
          } catch (err) {
            setError(version === 'aws' ? awsAuth.describeCognitoError(err) : supabaseAuth.describeAuthError(err));
            setBusy(false);
          }
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c6.9 0 8.5-4.8 8.5-7.3 0-.5 0-.9-.1-1.3H12z" />
        </svg>
        {busy ? 'Redirecting…' : label}
      </button>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </>
  );
}

function GitHubButton({ version, next, label }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (version === 'aws') return null;
  return (
    <>
      <button
        type="button"
        className="button oauth-btn oauth-btn-github"
        disabled={busy}
        aria-label={label}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            setStoredCloudVersion(version);
            sessionStorage.setItem('portabase.auth.next', next);
            sessionStorage.setItem('portabase.auth.version', version);
            await supabaseAuth.signInWithGitHub({ next });
          } catch (err) {
            setError(supabaseAuth.describeAuthError(err));
            setBusy(false);
          }
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.36 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.9-1.32 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z" />
        </svg>
        {busy ? 'Redirecting…' : label}
      </button>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </>
  );
}

export function LoginPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const fromUrl = versionFromSearch(window.location.search);
  const [version, setVersion] = useState(fromUrl || getStoredCloudVersion());
  const initialMode = params.get('mode') === 'signup' ? 'signup' : params.get('mode') === 'forgot' ? 'forgot' : 'signin';
  const next = params.get('next') || '/dashboard';
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [checking, setChecking] = useState(!isSignedIn());
  const [showPassword, setShowPassword] = useState(false);

  const selectVersion = (v) => {
    const nextV = normalizeCloudVersion(v);
    setVersion(nextV);
    setStoredCloudVersion(nextV);
    setError('');
    setMessage('');
    setAwaitingConfirm(false);
    const url = new URL(window.location.href);
    url.searchParams.set('version', nextV);
    window.history.replaceState({}, '', url.toString());
  };

  useEffect(() => {
    document.title = `Sign in · Portabase Cloud (${CLOUD_VERSIONS[version].label})`;
    setStoredCloudVersion(version);
    let cancelled = false;
    setChecking(true);
    ensureSessionForVersion(version)
      .catch(() => null)
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [version]);

  const go = async (fn) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setStoredCloudVersion(version);
      await fn();
    } catch (err) {
      setError(version === 'aws' ? awsAuth.describeCognitoError(err) : supabaseAuth.describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const afterLogin = () => {
    const dest = next.startsWith('/') ? next : '/dashboard';
    window.location.assign(dest.includes('version=') ? dest : `${dest}${dest.includes('?') ? '&' : '?'}version=${version}`);
  };

  const signedInUser = sessionUser();
  if (checking && !isSignedIn()) {
    return (
      <AuthShell
        version={version}
        title="Checking session"
        lead="Restoring your Portabase Cloud session."
        cardLabel="Session check"
      >
        <div className="auth-loading" role="status" aria-live="polite">
          <span className="auth-spinner" aria-hidden="true" />
          <strong>Checking sign-in…</strong>
          <p>This takes a moment. We never display keys or capsule bytes here.</p>
        </div>
      </AuthShell>
    );
  }

  if (isSignedIn()) {
    return (
      <AuthShell
        version={version}
        title="You're signed in"
        lead="Continue to the customer dashboard, or sign out on this device."
        cardLabel="Signed-in session"
      >
        <div className="auth-signed-in">
          <div className="auth-signed-in-avatar">{(signedInUser?.email || 'U').slice(0, 1).toUpperCase()}</div>
          <strong>{signedInUser?.name || signedInUser?.email || 'Operator'}</strong>
          <span>{signedInUser?.email}</span>
          <a className="button button-primary" href={`/dashboard?version=${version}`}>Open dashboard</a>
          <button
            type="button"
            className="button button-ghost auth-signout"
            onClick={async () => {
              await supabaseAuth.signOut();
              window.location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </AuthShell>
    );
  }

  const minPassword = version === 'aws' ? 12 : 8;

  return (
    <AuthShell
      version={version}
      title={mode === 'signup' ? 'Create your Cloud account' : mode === 'forgot' ? 'Reset password' : 'Sign in to Cloud'}
      lead="Email, magic link, Google, or GitHub. Then $7 / $17 / $37 via Square. You bring capsule storage. We never learn your passphrase."
      cardLabel={mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Sign in'}
    >
      <VersionPicker version={version} onChange={selectVersion} />

      <div className="auth-tabs" role="tablist" aria-label="Account mode">
        <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'is-active' : ''} onClick={() => { setMode('signin'); setAwaitingConfirm(false); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => setMode('signup')}>Create account</button>
      </div>

      <div className="auth-oauth">
        <GoogleButton
          version={version}
          next={next}
          label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
        />
        <GitHubButton
          version={version}
          next={next}
          label={mode === 'signup' ? 'Sign up with GitHub' : 'Continue with GitHub'}
        />
      </div>
      <div className="auth-divider"><span>or email</span></div>

      {(mode === 'signin' || mode === 'signup') && !awaitingConfirm && (
        <form
          className="auth-form"
          onSubmit={e => {
            e.preventDefault();
            if (mode === 'signup') {
              go(async () => {
                if (version === 'aws') {
                  await awsAuth.signUpWithEmail({ email, password, name });
                  setAwaitingConfirm(true);
                  setMessage('Check your email for a Cognito confirmation code.');
                } else {
                  const result = await supabaseAuth.signUpWithEmail({ email, password, name });
                  if (result.needsEmailConfirmation) {
                    setAwaitingConfirm(true);
                    setMessage('Check your email for a Supabase confirmation link, then sign in.');
                  } else {
                    afterLogin();
                  }
                }
              });
            } else {
              go(async () => {
                if (version === 'aws') await awsAuth.signInWithEmail({ email, password });
                else await supabaseAuth.signInWithEmail({ email, password });
                afterLogin();
              });
            }
          }}
        >
          {mode === 'signup' && (
            <label htmlFor="auth-name">Name
              <input id="auth-name" value={name} onChange={e => setName(e.target.value)} placeholder="Optional" autoComplete="name" />
            </label>
          )}
          <label htmlFor="auth-email">Work email
            <input id="auth-email" required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" aria-invalid={Boolean(error)} aria-describedby={error ? 'auth-error' : undefined} />
          </label>
          <label htmlFor="auth-password">Password
            <span className="auth-password-row">
              <input
                id="auth-password"
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={version === 'aws' ? '12+ chars, mixed case, number, symbol' : 'At least 8 characters'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? minPassword : 1}
              />
              <button type="button" className="auth-reveal" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>
          <button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in with password'}
          </button>
          {mode === 'signin' && (
            <div className="auth-alt">
              <button
                type="button"
                className="button button-ghost auth-magic"
                disabled={busy || !email || magicSent}
                onClick={() => go(async () => {
                  await supabaseAuth.signInWithMagicLink({ email, next });
                  setMagicSent(true);
                  setMessage('Magic link sent. Check your email — the link returns here. Portabase never sees your passphrase.');
                })}
              >
                {magicSent ? 'Magic link sent' : 'Email a magic link instead'}
              </button>
              <p className="auth-hint">Password signs you in now. A magic link is a one-time email — same account, no passphrase sent to Portabase.</p>
              <button type="button" className="auth-text-btn" onClick={() => setMode('forgot')}>Forgot password?</button>
            </div>
          )}
        </form>
      )}

      {awaitingConfirm && version === 'supabase' && (
        <div className="auth-form">
          <p className="auth-hint">Confirmation email sent to <strong>{email}</strong>. Open the link, then sign in.</p>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => go(async () => {
            await supabaseAuth.resendSignupEmail({ email });
            setMessage('Confirmation email resent.');
          })}>Resend confirmation email</button>
          <button type="button" className="auth-text-btn" onClick={() => { setAwaitingConfirm(false); setMode('signin'); }}>Back to sign in</button>
        </div>
      )}

      {awaitingConfirm && version === 'aws' && (
        <form className="auth-form" onSubmit={e => {
          e.preventDefault();
          go(async () => {
            await awsAuth.confirmSignUp({ email, code });
            await awsAuth.signInWithEmail({ email, password });
            afterLogin();
          });
        }}>
          <p className="auth-hint">Enter the Cognito confirmation code emailed to <strong>{email}</strong>.</p>
          <label htmlFor="auth-code">Confirmation code
            <input id="auth-code" required value={code} onChange={e => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" />
          </label>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Confirming…' : 'Confirm & sign in'}</button>
          <button type="button" className="auth-text-btn" disabled={busy} onClick={() => go(async () => {
            await awsAuth.resendConfirmation({ email });
            setMessage('A new code was sent.');
          })}>Resend code</button>
        </form>
      )}

      {mode === 'forgot' && (
        <form className="auth-form" onSubmit={e => {
          e.preventDefault();
          if (version === 'supabase') {
            go(async () => {
              await supabaseAuth.requestPasswordReset({ email });
              setMessage('If that email exists, Supabase sent a password reset link.');
            });
          } else if (!code) {
            go(async () => {
              await awsAuth.forgotPassword({ email });
              setMessage('If that email exists, Cognito sent a reset code.');
            });
          } else {
            go(async () => {
              await awsAuth.confirmForgotPassword({ email, code, password });
              setMessage('Password updated. Sign in with the new password.');
              setMode('signin');
              setCode('');
            });
          }
        }}>
          <label htmlFor="auth-reset-email">Email
            <input id="auth-reset-email" required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          </label>
          {version === 'aws' && (
            <>
              <label>Reset code (after email arrives)
                <input value={code} onChange={e => setCode(e.target.value)} placeholder="Optional until code arrives" autoComplete="one-time-code" />
              </label>
              {code && (
                <label>New password
                  <input required type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} autoComplete="new-password" />
                </label>
              )}
            </>
          )}
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : version === 'aws' && code ? 'Set new password' : 'Send reset'}
          </button>
          <button type="button" className="auth-text-btn" onClick={() => setMode('signin')}>Back to sign in</button>
        </form>
      )}

      {message && <p className="auth-ok" role="status">{message}</p>}
      {error && <p className="auth-error" id="auth-error" role="alert">{error}</p>}
      <p className="auth-legal">
        Launch scope: <strong>Supabase projects only</strong> (database, Auth, Storage, Edge Functions).
        Identity: hosted Supabase Auth (email, magic link, Google, GitHub). Trial requires a card and becomes {productConfig.priceRangeLabel}/mo after {productConfig.trialDays} days unless canceled.
        Portabase is provably zero-knowledge of customer encryption keys and capsule contents.
        {AWS_CLOUD_VERSION_ENABLED ? '' : ' AWS Cognito Cloud is not offered yet.'}
      </p>
    </AuthShell>
  );
}

export function AuthCallbackPage() {
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Signing in · Portabase Cloud';
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error_description') || params.get('error');
    const state = params.get('state') || '';
    let version = versionFromSearch(window.location.search)
      || sessionStorage.getItem('portabase.auth.version')
      || getStoredCloudVersion();
      let next = sessionStorage.getItem('portabase.auth.next') || `/dashboard?version=${version}`;

    if (state.includes('version:aws')) version = 'aws';
    if (state.includes('version:supabase')) version = 'supabase';
    const nextMatch = state.match(/next:([^|]+)/);
    if (nextMatch) {
      try { next = decodeURIComponent(nextMatch[1]); } catch { /* keep */ }
    }

    version = normalizeCloudVersion(version);
    setStoredCloudVersion(version);

    if (err) {
      setError(err);
      return;
    }

    const finish = (sessionPromise) => {
      sessionPromise
        .then(() => {
          sessionStorage.removeItem('portabase.auth.next');
          sessionStorage.removeItem('portabase.auth.version');
          const dest = next.includes('version=') ? next : (next.startsWith('/app') || next.startsWith('/dashboard') ? `${next}${next.includes('?') ? '&' : '?'}version=${version}` : next);
          window.location.replace(dest);
        })
        .catch(e => setError(version === 'aws' ? awsAuth.describeCognitoError(e) : supabaseAuth.describeAuthError(e)));
    };

    if (version === 'aws') {
      const code = params.get('code');
      if (!code) {
        setError('Missing authorization code from Cognito.');
        return;
      }
      finish(awsAuth.exchangeCodeForTokens(code));
    } else {
      finish(supabaseAuth.completeOAuthCallback());
    }
  }, []);

  return (
    <AuthShell version={getStoredCloudVersion()} title={error ? 'Sign-in did not finish' : 'Finishing sign-in'} lead={error ? 'The identity provider returned an error. Nothing was stored except this message.' : 'Completing OAuth for the Cloud version you selected.'} cardLabel="Auth callback">
      {error ? (
        <div className="auth-callback-error">
          <p className="auth-error" role="alert">{error}</p>
          <a className="button button-primary" href="/login">Back to sign in <Arrow /></a>
        </div>
      ) : (
        <div className="auth-loading" role="status" aria-live="polite">
          <span className="auth-spinner" aria-hidden="true" />
          <strong>Completing sign-in…</strong>
          <p>Returning you to the dashboard.</p>
        </div>
      )}
    </AuthShell>
  );
}

/** Full professional Cloud console (Supabase-grade density). */
export function AppPage() {
  return <ConsoleApp />;
}
