import React, { useEffect, useMemo, useState } from 'react';
import { productConfig } from './lib/auth-config.js';
import {
  AWS_CLOUD_VERSION_ENABLED,
  CLOUD_VERSIONS,
  getStoredCloudVersion,
  isSupabaseOnlyLaunch,
  listCloudVersions,
  normalizeCloudVersion,
  setStoredCloudVersion,
  versionFromSearch,
} from './lib/cloud-versions.js';
import * as supabaseAuth from './lib/supabase-auth.js';
import * as awsAuth from './lib/cognito.js';
import { sessionCloudVersion } from './lib/session.js';
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
        <p>Portabase protects Supabase projects (database, Auth, Storage, Edge Functions). Sign in with Supabase Auth — email or Google.</p>
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

function AuthShell({ children, title, lead, version }) {
  const meta = CLOUD_VERSIONS[version] || CLOUD_VERSIONS.supabase;
  return (
    <div className="auth-page">
      <header className="site-header">
        <div className="shell nav-wrap">
          <Logo href="/" />
          <a className="button button-small desktop-cta" href="/cloud">Cloud pricing <Arrow /></a>
        </div>
      </header>
      <main className="auth-main">
        <div className="shell auth-shell">
          <div className="auth-copy">
            <div className="section-kicker green">PORTABASE CLOUD · SUPABASE</div>
            <h1>{title}</h1>
            <p>{lead}</p>
            <div className="version-callout">
              <span>LAUNCH · SUPABASE ONLY</span>
              <b>{meta.authLabel}</b>
              <p>{meta.description}</p>
            </div>
            <ul className="auth-bullets">
              <li><span>✓</span> Built for <strong>Supabase</strong> projects first</li>
              <li><span>✓</span> Google or email via <strong>Supabase Auth</strong></li>
              <li><span>✓</span> 7-day free trial — <strong>card required</strong> (Square)</li>
              <li><span>✓</span> Then <strong>${productConfig.priceMonthly}/mo</strong> · up to 12 agents</li>
              <li><span>✓</span> You provide binary storage · keys stay on your runner</li>
            </ul>
          </div>
          <div className="auth-card">{children}</div>
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
        className="button google-btn"
        disabled={busy}
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
      {error && <p className="auth-error" style={{ marginTop: 12 }}>{error}</p>}
    </>
  );
}

export function LoginPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const fromUrl = versionFromSearch(window.location.search);
  const [version, setVersion] = useState(fromUrl || getStoredCloudVersion());
  const initialMode = params.get('mode') === 'signup' ? 'signup' : params.get('mode') === 'forgot' ? 'forgot' : 'signin';
  const next = params.get('next') || '/app';
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

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
    ensureSessionForVersion(version).then(s => {
      if (s && sessionCloudVersion(s) === version) {
        window.location.replace(`/app?version=${version}`);
      }
    }).catch(() => {});
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
    window.location.assign(`/app?version=${version}`);
  };

  const minPassword = version === 'aws' ? 12 : 8;

  return (
    <AuthShell
      version={version}
      title={mode === 'signup' ? 'Create your Cloud account' : mode === 'forgot' ? 'Reset password' : 'Sign in to Cloud'}
      lead="Portabase Cloud launches for Supabase only. Sign in with email or Google, then start a $17/mo ops plan (Square) — you bring capsule storage."
    >
      <VersionPicker version={version} onChange={selectVersion} />

      <div className="auth-tabs" role="tablist">
        <button type="button" className={mode === 'signin' ? 'is-active' : ''} onClick={() => { setMode('signin'); setAwaitingConfirm(false); }}>Sign in</button>
        <button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => setMode('signup')}>Create account</button>
      </div>

      <GoogleButton
        version={version}
        next="/app"
        label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
      />
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
            <label>Name
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Optional" autoComplete="name" />
            </label>
          )}
          <label>Work email
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
          </label>
          <label>Password
            <input
              required
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={version === 'aws' ? '12+ chars, mixed case, number, symbol' : 'At least 8 characters'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={mode === 'signup' ? minPassword : 1}
            />
          </label>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          {mode === 'signin' && (
            <button type="button" className="auth-text-btn" onClick={() => setMode('forgot')}>Forgot password?</button>
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
          <label>Confirmation code
            <input required value={code} onChange={e => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" />
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
          <label>Email
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
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

      {message && <p className="auth-ok">{message}</p>}
      {error && <p className="auth-error">{error}</p>}
      <p className="auth-legal">
        Launch scope: <strong>Supabase projects only</strong> (database, Auth, Storage, Edge Functions).
        Identity: hosted Supabase Auth. Trial requires a card and becomes ${productConfig.priceMonthly}/mo after {productConfig.trialDays} days unless canceled.
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
    let next = sessionStorage.getItem('portabase.auth.next') || `/app?version=${version}`;

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
          const dest = next.includes('version=') ? next : (next.startsWith('/app') ? `/app?version=${version}` : next);
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
    <AuthShell version={getStoredCloudVersion()} title="Finishing sign-in…" lead="Completing OAuth for the Cloud version you selected.">
      {error ? (
        <>
          <p className="auth-error">{error}</p>
          <a className="button button-primary" href="/login">Back to sign in <Arrow /></a>
        </>
      ) : (
        <p className="auth-hint">One moment…</p>
      )}
    </AuthShell>
  );
}

/** Full professional Cloud console (Supabase-grade density). */
export function AppPage() {
  return <ConsoleApp />;
}
