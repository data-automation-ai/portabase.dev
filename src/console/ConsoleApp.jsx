import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './console.css';
import './console-mobile.css';
import { Icon } from './icons.jsx';
import {
  loadConsoleState, saveConsoleState, resetConsoleState, updateConsoleState,
  emptyWorkspace, loadLiveConsoleState, saveLiveConsoleState,
} from './data/store.js';
import { CLOUD_VERSIONS, normalizeCloudVersion, getStoredCloudVersion, setStoredCloudVersion, isSupabaseOnlyLaunch } from '../lib/cloud-versions.js';
import { clearDemoMode, isRealSession, clearSession, loadSession, sessionCloudVersion, sessionUser } from '../lib/session.js';
import {
  cancelCloudSubscription,
  ensureSessionForVersion,
  fetchDashboard,
  fetchMe,
  fetchTelemetryEvents,
  startAddonCheckout,
  startTrialCheckout,
} from '../lib/cloud-api.js';
import { getCloudPlan } from '../lib/product.js';
import { preservePendingCheckout } from '../lib/checkout-confirmation.js';
import { CheckoutConfirmation } from './checkout-confirmation.jsx';
import { safeAuthReturnPath } from '../lib/auth-return.js';
import * as supabaseAuth from '../lib/supabase-auth.js';
import * as awsAuth from '../lib/cognito.js';
import {
  OverviewPage, ProjectsPage, ProjectDetailPage, RestoresPage,
  BackupsHubPage, AgentsHubPage, AlertsHubPage, AccountHubPage,
} from './pages.jsx';
import { StorageProvidersPage } from './storage-providers-page.jsx';
import { OneTwoThreeDone } from './one-two-three-done.jsx';
import { TelemetryPage } from './telemetry-page.jsx';
import { liveEventToHealthEvent } from '../lib/telemetry-view.js';
import { ConnectSupabaseFlow } from './connect-supabase.jsx';
import { CustomerDashboardPage } from './customer-dashboard.jsx';

/** Portabase-native IA — recovery ops only (not a Supabase Studio clone). */
const NAV = [
  { id: 'dashboard', label: '1-2-3 Backup', icon: 'capsule' },
  { id: 'storage', label: 'Connections & Vaults', icon: 'cloud' },
  { id: 'backups', label: 'Backup Capsules', icon: 'folder' },
  { id: 'restore', label: 'Restore & Replay', icon: 'restore' },
  { id: 'account', label: 'Account & Plan', icon: 'settings' },
];

const TITLES = Object.fromEntries(NAV.map(i => [i.id, i.label]));
const billingDate = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));

/** Map older / overly-generic paths → Portabase pages */
const ALIASES = {
  overview: 'home',
  capsules: 'backups',
  schedules: 'backups',
  destinations: 'storage',
  vaults: 'storage',
  storage: 'storage',
  restores: 'restore',
  activity: 'alerts',
  reports: 'telemetry',
  telemetry: 'telemetry',
  inspect: 'inspect',
  open: 'inspect',
  live: 'supabase-viewer',
  'supabase-viewer': 'supabase-viewer',
  studio: 'supabase-viewer',
  runners: 'agents',
  seal: 'agents',
  'seal-keys': 'agents',
  team: 'account',
  billing: 'account',
  settings: 'account',
  onboarding: 'dashboard',
  dashboard: 'dashboard',
  log: 'dashboard',
  'backup-log': 'dashboard',
  utilities: 'dashboard',
  charts: 'dashboard',
  sizer: 'dashboard',
  'table-sizer': 'dashboard',
};

function parseRoute() {
  const path = window.location.pathname.replace(/\/$/, '') || '/app';
  const params = new URLSearchParams(window.location.search);
  const parts = path.split('/').filter(Boolean);
  let page = 'home';
  let id = null;
  if (parts[0] === 'dashboard') {
    page = 'dashboard';
  } else if (parts[0] === 'app') {
    if (parts[1] === 'projects' && parts[2]) { page = 'project'; id = parts[2]; }
    else if (parts[1]) page = parts[1];
    else page = 'dashboard';
  } else if (parts[0] === 'tools' && parts[1] === 'supabase-viewer') {
    page = 'supabase-viewer';
  }
  if (window.location.hash.startsWith('#/')) {
    const [hashPath, hashQuery] = window.location.hash.slice(2).split('?');
    const h = hashPath.split('/');
    if (h[0] === 'projects' && h[1]) { page = 'project'; id = h[1]; }
    else if (h[0]) page = h[0];
    if (hashQuery) {
      const hashParams = new URLSearchParams(hashQuery);
      if (hashParams.get('tab') && !params.get('tab')) {
        params.set('tab', hashParams.get('tab'));
      }
    }
  }
  page = ALIASES[page] || page;
  const known = page === 'project' || TITLES[page];
  return {
    page: known ? page : 'home',
    id,
    version: normalizeCloudVersion(params.get('version') || sessionCloudVersion() || getStoredCloudVersion()),
    checkout: params.get('checkout'),
    attempt: params.get('attempt'),
    addon: params.get('addon'),
    accountTab: params.get('tab') || null,
    dashboardTab: params.get('section') || params.get('tab') || null,
  };
}

function isDemoMode() {
  if (isRealSession(loadSession())) { clearDemoMode(); return false; }
  return new URLSearchParams(window.location.search).get('demo') === '1'
    || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('portabase.console.demo') === '1');
}

function buildPath(page, { id, version, tab } = {}) {
  const v = version || getStoredCloudVersion();
  let path = '/dashboard';
  if (page === 'dashboard') path = '/dashboard';
  else if (page === 'home') path = '/app/home';
  else if (page === 'project' && id) path = `/app/projects/${id}`;
  else path = `/app/${page}`;
  const q = new URLSearchParams({ version: v });
  if (tab) q.set('tab', tab);
  if (isDemoMode()) q.set('demo', '1');
  return `${path}?${q}`;
}

export function ConsoleApp() {
  const [route, setRoute] = useState(() => parseRoute());
  const [checkout, setCheckout] = useState(() => route.checkout === 'complete' ? { attempt: route.attempt, addon: route.addon, version: route.version, verified: false } : null);
  const [state, setStateRaw] = useState(null);
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [search, setSearch] = useState('');
  const [liveJobs, setLiveJobs] = useState(null);
  const [liveDashboard, setLiveDashboard] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardUnavailable, setDashboardUnavailable] = useState(false);
  const [square, setSquare] = useState(null);
  const [telemetryStatus, setTelemetryStatus] = useState('loading');
  const [telemetryRefresh, setTelemetryRefresh] = useState(0);

  const version = route.version;
  const meta = CLOUD_VERSIONS[version] || CLOUD_VERSIONS.supabase;
  const user = sessionUser(loadSession());

  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);

  const setState = useCallback((mutator) => {
    const demo = isDemoMode();
    setStateRaw(current => {
      const base = current || (demo ? loadConsoleState(user) : loadLiveConsoleState(user));
      const draft = structuredClone(base);
      const next = typeof mutator === 'function' ? mutator(draft) : mutator;
      if (demo) saveConsoleState(next);
      else saveLiveConsoleState(next);
      return next;
    });
  }, [user]);

  const navigate = useCallback((page, opts = {}) => {
    const path = preservePendingCheckout(buildPath(page, { id: opts.id, version, tab: opts.tab }), checkout);
    window.history.pushState({}, '', path);
    setRoute(parseRoute());
    setSideOpen(false);
  }, [version, checkout]);

  const checkoutVerified = useCallback(result => {
    setCheckout(current => current?.verified ? current : { ...current, verified: true });
    setMe(current => ({ ...current, access: result.access, subscription: result.subscription }));
    if (result.subscription) setStateRaw(current => current ? { ...current, billing: { ...current.billing, ...result.subscription } } : current);
    const url = new URL(window.location.href);
    for (const key of ['checkout', 'attempt', 'addon']) url.searchParams.delete(key);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title = `${TITLES[route.page] || 'Console'} · Portabase Cloud`;
    setStoredCloudVersion(version);
    let cancelled = false;
    let demoMode = isDemoMode();
    setDashboardLoading(!demoMode);
    setDashboardUnavailable(false);
    (async () => {
      try {
        let session = await ensureSessionForVersion(version);
        if (isRealSession(session)) {
          clearDemoMode();
          demoMode = false;
          const url = new URL(window.location.href);
          url.searchParams.delete('demo');
          window.history.replaceState({}, '', url);
          setDashboardLoading(true);
        }
        if (!session && demoMode) {
          sessionStorage.setItem('portabase.console.demo', '1');
          session = {
            provider: version === 'aws' ? 'aws' : 'supabase',
            cloudVersion: version,
            accessToken: 'demo',
            user: { id: 'demo-user', email: 'demo@portabase.dev', name: 'Demo operator' },
          };
        }
        if (!session) {
          window.location.replace(`/login?version=${version}&next=${encodeURIComponent(safeAuthReturnPath(window.location.pathname + window.location.search))}`);
          return;
        }
        const profile = session.user || sessionUser(session) || { id: 'demo-user', email: 'demo@portabase.dev', name: 'Demo operator' };
        const consoleState = demoMode
          ? loadConsoleState({ ...profile, cloudVersion: version })
          : loadLiveConsoleState({ ...profile, cloudVersion: version });
        if (!cancelled) {
          setStateRaw(consoleState);
          setReady(true);
        }
        if (demoMode) {
          if (!cancelled) {
            setMe({ user: profile, access: { hasAccess: true, status: 'trialing', label: '7-day trial (demo)' }, subscription: consoleState.billing });
            setLiveJobs(null);
            setLiveDashboard(false);
            setSquare(null);
          }
          return;
        }
        try {
          const data = await fetchMe(version);
          if (!cancelled) {
            setMe(data);
            if (data.square) setSquare(data.square);
            if (data.subscription) {
              setStateRaw(s => {
                const next = { ...s, billing: { ...s.billing, ...data.subscription, cloudVersion: version } };
                saveLiveConsoleState(next);
                return next;
              });
            }
          }
        } catch (err) {
          if (err.status === 401) {
            clearSession();
            window.location.replace(`/login?version=${version}&next=${encodeURIComponent(safeAuthReturnPath(window.location.pathname + window.location.search))}`);
          }
        }
        try {
          const dash = await fetchDashboard(version);
          if (!cancelled) {
            setDashboardUnavailable(false);
            setLiveJobs(Array.isArray(dash.jobs) ? dash.jobs : []);
            setLiveDashboard(Boolean(dash.live));
            let discoveredProjects = null;
            try {
              const discRes = await fetch(`/api/cloud/oauth?provider=supabase&action=discover`);
              const discData = await discRes.json();
              if (discData?.ok && Array.isArray(discData.projects) && discData.projects.length > 0) {
                discoveredProjects = discData.projects.map(p => ({
                  id: `proj_${p.id.slice(0, 8)}`,
                  ref: p.id,
                  name: p.name || p.id,
                  region: p.region || 'us-east-1',
                  status: p.status === 'ACTIVE_HEALTHY' ? 'healthy' : (p.status || 'ready'),
                  scheduleEveryHours: 24,
                  rpoHours: null,
                  rpoTargetHours: 24,
                  agentId: null,
                  destinationIds: [],
                  layers: { database: true, auth: true, storage: true, functions: true },
                  createdAt: new Date().toISOString(),
                }));
              }
            } catch {
              // Discovery non-blocking
            }

            setStateRaw(s => {
              // An unproven response must supersede an old browser-cached MATCH.
              const shouldUpdateProjects = discoveredProjects && (!s.projects || s.projects.length === 0 || s.projects.some(p => p.ref === 'kiuwcdpjsdotkoojbkoi'));
              const next = {
                ...s,
                proofReport: dash.proof?.proven ? dash.proof : null,
                jobs: dash.jobs || [],
                ...(shouldUpdateProjects ? { projects: discoveredProjects } : {}),
              };
              saveLiveConsoleState(next);
              return next;
            });
          }
        } catch {
          if (!cancelled) {
            setDashboardUnavailable(true);
            setLiveJobs([]);
            setLiveDashboard(false);
          }
        } finally {
          if (!cancelled) setDashboardLoading(false);
        }
      } catch (e) {
        if (!cancelled) setAuthError(e.message || 'Could not load console');
      }
    })();
    return () => { cancelled = true; };
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || isDemoMode()) return;
    let cancelled = false;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const tel = await fetchTelemetryEvents(version);
        if (!tel || !Array.isArray(tel.events)) throw new Error('invalid_telemetry_response');
        if (!cancelled) {
          const live = tel.events.map(liveEventToHealthEvent);
          setStateRaw(s => {
            if (!s) return s;
            const next = { ...s, events: live, liveTelemetry: true };
            saveLiveConsoleState(next);
            return next;
          });
          setTelemetryStatus('ready');
        }
      } catch {
        if (!cancelled) setTelemetryStatus('error');
      } finally {
        fetching = false;
      }
    };
    setTelemetryStatus('loading');
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [version, ready, telemetryRefresh]);

  const startAddon = async () => {
    if (checkout && !checkout.verified && !isDemoMode()) { toast('Check your existing checkout above before starting another purchase.', 'danger'); return; }
    if (sessionStorage.getItem('portabase.console.demo') === '1') {
      setStateRaw((s) => {
        const next = { ...s, billing: { ...s.billing, extraTransfersAddon: true, transfersPer24h: 3 } };
        saveConsoleState(next);
        return next;
      });
      setMe((m) => (m ? { ...m, subscription: { ...m.subscription, extraTransfersAddon: true, transfersPer24h: 3 } } : m));
      toast('Demo: Extra transfers add-on on — up to 3 / 24h', 'ok');
      return;
    }
    setBusy(true);
    try {
      const result = await startAddonCheckout(version);
      if (result.url) window.location.href = result.url;
      else toast(result.message || 'Add-on checkout URL missing', 'danger');
    } catch (e) {
      if (e.data?.error === 'checkout_blocked' && e.data) setSquare(e.data);
      toast(e.message || 'Add-on checkout failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const startTrial = async (planId = 'cloud-17') => {
    if (checkout && !checkout.verified && !isDemoMode()) { toast('Check your existing checkout above before starting another purchase.', 'danger'); return; }
    if (sessionStorage.getItem('portabase.console.demo') === '1') {
      toast('Demo mode — connect auth to run real Square trial checkout', 'ok');
      return;
    }
    setBusy(true);
    try {
      const result = await startTrialCheckout(version, planId);
      if (result.alreadySubscribed) {
        toast('Already subscribed on this version', 'ok');
        const data = await fetchMe(version);
        setMe(data);
        return;
      }
      if (result.url) window.location.href = result.url;
      else toast('Checkout URL missing', 'danger');
    } catch (e) {
      if (e.data?.error === 'checkout_blocked' && e.data) setSquare(e.data);
      toast(e.message || 'Checkout failed', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const cancelSubscription = async () => {
    if (isDemoMode()) {
      toast('Demo mode does not change a Square subscription.', 'danger');
      return null;
    }
    setBusy(true);
    try {
      let result;
      try {
        result = await cancelCloudSubscription(version);
      } catch (error) {
        // A provider write can succeed before its response is lost. A fresh
        // provider-backed projection can safely turn that ambiguous reply into
        // a confirmed UI result; an unchanged record remains retryable.
        try {
          const data = await fetchMe(version);
          setMe(data);
          if (data.subscription) {
            setStateRaw(current => current
              ? { ...current, billing: { ...current.billing, ...data.subscription, cloudVersion: version } }
              : current);
          }
          const reconciled = Boolean(data.subscription?.cancellationEffectiveAt)
            || ['canceled', 'closed', 'refunded'].includes(data.subscription?.status);
          if (reconciled) {
            result = {
              cancellationConfirmed: true,
              cancellationEffectiveAt: data.subscription?.cancellationEffectiveAt || null,
              status: data.subscription?.status || 'cancellation_scheduled',
              hasAccess: data.access?.hasAccess === true,
            };
          }
        } catch { /* Preserve the original reconciled cancellation error. */ }
        if (!result) {
          toast(error.message || 'Cancellation could not be confirmed. Refresh and retry.', 'danger');
          throw error;
        }
      }
      try {
        const data = await fetchMe(version);
        setMe(data);
        if (data.subscription) {
          setStateRaw(current => current
            ? { ...current, billing: { ...current.billing, ...data.subscription, cloudVersion: version } }
            : current);
        }
      } catch {
        // The cancellation endpoint already performed provider readback. Keep
        // its confirmed effective date visible until the next account refresh.
        setMe(current => current ? {
          ...current,
          access: { ...current.access, hasAccess: result.hasAccess === true },
          subscription: { ...current.subscription, cancellationEffectiveAt: result.cancellationEffectiveAt || null },
        } : current);
        setStateRaw(current => current ? {
          ...current,
          billing: { ...current.billing, cancellationEffectiveAt: result.cancellationEffectiveAt || null },
        } : current);
      }
      const effective = result.cancellationEffectiveAt
        ? billingDate(result.cancellationEffectiveAt)
        : null;
      toast(effective ? `Renewal canceled · access continues through ${effective}` : 'Subscription cancellation confirmed.', 'ok');
      return result;
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    clearDemoMode();
    // Launch: Supabase Auth only. Cognito sign-out retained behind flag.
    if (version === 'aws' && !isSupabaseOnlyLaunch()) {
      window.location.href = awsAuth.signOut();
      return;
    }
    await supabaseAuth.signOut();
    window.location.href = '/';
  };

  const alertCount = useMemo(() => {
    if (!state) return 0;
    const projects = Array.isArray(state.projects) ? state.projects : [];
    const events = Array.isArray(state.events) ? state.events : [];
    return projects.filter(p => p.status !== 'healthy').length
      + events.filter(e => e.level === 'error' || e.level === 'warn').slice(0, 5).length;
  }, [state]);

  const filteredNav = useMemo(() => {
    if (!search.trim()) return NAV;
    const q = search.toLowerCase();
    return NAV.filter(i => i.label.toLowerCase().includes(q));
  }, [search]);

  if (authError) {
    return (
      <div className="pb-gate">
        <div className="pb-gate-card">
          <Icon name="warn" size={28} />
          <h1>Console unavailable</h1>
          <p>{authError}</p>
          <a className="pb-btn pb-btn-primary" href={`/login?version=${version}`}>Sign in again</a>
        </div>
      </div>
    );
  }

  if (!ready || !state) {
    return (
      <div className="pb-gate">
        <div className="pb-gate-card">
          <div className="pb-mono pb-faint">LOADING CONSOLE…</div>
          <h1>Portabase Cloud</h1>
          <p>Restoring session ({meta.label} version) and workspace state.</p>
        </div>
      </div>
    );
  }

  const pageProps = {
    state,
    me,
    setMe,
    setState,
    navigate,
    toast,
    params: { id: route.id },
    busy,
    startTrial,
    startAddon,
    cancelSubscription,
    demoMode: isDemoMode(),
    liveJobs,
    live: liveDashboard,
    square,
    telemetryStatus,
    refreshTelemetry: () => setTelemetryRefresh(value => value + 1),
    resetDemo: () => {
      const next = resetConsoleState({ ...user, cloudVersion: version });
      setStateRaw(next);
      toast('Demo data reset', 'ok');
    },
  };

  let body;
  switch (route.page) {
    case 'storage': body = <StorageProvidersPage {...pageProps} />; break;
    case 'backups': body = <BackupsHubPage {...pageProps} />; break;
    case 'restore': body = <RestoresPage {...pageProps} />; break;
    case 'account': body = <AccountHubPage {...pageProps} tab={route.accountTab} />; break;
    case 'dashboard':
    default:
      body = <OneTwoThreeDone {...pageProps} />;
      break;
  }

  const crumb = route.page === 'project'
    ? `Sources / ${state.projects.find(p => p.id === route.id)?.name || 'Detail'}`
    : (TITLES[route.page] || 'Home');

  return (
    <div className="pb-console pb-single-view">
      <header className="pb-top-clean">
        <div className="pb-top-clean-brand-nav">
          <a href="/" className="pb-top-clean-logo">
            <span className="logo-mark"><i /><i /><i /></span>
            <strong style={{ fontSize: '18px', color: '#f0f6fc', letterSpacing: '-0.02em' }}>PORTABASE</strong>
          </a>
          <nav className="pb-top-clean-nav">
            {NAV.map(item => (
              <button
                key={item.id}
                type="button"
                className={`pb-btn pb-btn-sm ${route.page === item.id ? 'pb-btn-primary' : 'pb-btn-ghost'}`}
                onClick={() => navigate(item.id)}
                style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Icon name={item.icon} size={14} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="pb-top-clean-user">
          <span className="pb-top-clean-email" style={{ fontSize: '12px', color: '#8b949e' }}>{me?.user?.email || user?.email}</span>
          <button type="button" className="pb-btn pb-btn-sm pb-btn-ghost pb-top-clean-signout" onClick={signOut} style={{ fontSize: '12px', color: '#8b949e' }}>
            <Icon name="logout" size={13} /> Sign Out
          </button>
        </div>
      </header>

      <div className="pb-body" style={{ flex: 1, width: '100%', maxWidth: route.page === 'dashboard' ? '100%' : '1024px', margin: '0 auto', padding: route.page === 'dashboard' ? '8px 12px' : '24px 16px' }}>
          {checkout && !isDemoMode() && <CheckoutConfirmation checkout={checkout} onVerified={checkoutVerified} />}
          {dashboardLoading && !isDemoMode() && ['dashboard', 'home'].includes(route.page) && <div className="pb-callout" role="status"><div>
            <strong>Loading account activity</strong>
            <p>Waiting for current job and subscription status.</p>
          </div></div>}
          {dashboardUnavailable && <div className="pb-callout danger" role="alert"><div>
            <strong>Account activity is unavailable</strong>
            <p>Job and subscription status could not be loaded. This is not confirmation that no jobs exist or that backups are healthy.</p>
            <button type="button" className="pb-btn" onClick={() => window.location.reload()}>Reload account activity</button>
          </div></div>}
          {!isDemoMode() && dashboardLoading && ['dashboard', 'home'].includes(route.page) ? null : body}
        </div>

      <div className="pb-toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`pb-toast ${t.tone === 'ok' ? 'ok' : 'danger'}`} role="status">{t.message}</div>
        ))}
      </div>
    </div>
  );
}

function BadgeInline({ status }) {
  const tone = status === 'active' || status === 'trialing' ? 'ok' : 'warn';
  return <span className={`pb-badge pb-badge-${tone}`}>{status}</span>;
}

export default ConsoleApp;
