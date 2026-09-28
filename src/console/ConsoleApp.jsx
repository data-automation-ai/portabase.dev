import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './console.css';
import { Icon } from './icons.jsx';
import {
  loadConsoleState, saveConsoleState, resetConsoleState, updateConsoleState,
  emptyWorkspace, loadLiveConsoleState, saveLiveConsoleState,
} from './data/store.js';
import { CLOUD_VERSIONS, normalizeCloudVersion, getStoredCloudVersion, setStoredCloudVersion, isSupabaseOnlyLaunch } from '../lib/cloud-versions.js';
import { clearSession, loadSession, sessionCloudVersion, sessionUser } from '../lib/session.js';
import { ensureSessionForVersion, fetchMe, fetchDashboard, startTrialCheckout, startAddonCheckout, confirmCheckout } from '../lib/cloud-api.js';
import { getCloudPlan } from '../lib/product.js';
import * as supabaseAuth from '../lib/supabase-auth.js';
import * as awsAuth from '../lib/cognito.js';
import {
  OverviewPage, ProjectsPage, ProjectDetailPage, RestoresPage,
  BackupsHubPage, AgentsHubPage, AlertsHubPage, AccountHubPage,
} from './pages.jsx';
import { TelemetryPage } from './telemetry-page.jsx';
import { OpenCapsulePage } from './open-capsule.jsx';
import { SupabaseViewerPage } from './supabase-viewer.jsx';
import { CustomerDashboardPage } from './customer-dashboard.jsx';

/** Portabase-native IA — recovery ops only (not a Supabase Studio clone). */
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'home', label: 'Ops home', icon: 'activity' },
  { id: 'projects', label: 'Sources', icon: 'folder' },
  { id: 'supabase-viewer', label: 'Live Supabase', icon: 'table' },
  { id: 'backups', label: 'Capsules', icon: 'capsule' },
  { id: 'telemetry', label: 'Telemetry', icon: 'chart' },
  { id: 'inspect', label: 'Open capsule', icon: 'key' },
  { id: 'agents', label: 'Agents', icon: 'cpu' },
  { id: 'alerts', label: 'Alerts', icon: 'bell' },
  { id: 'restore', label: 'Replay', icon: 'restore' },
  { id: 'account', label: 'Account', icon: 'settings' },
];

const TITLES = Object.fromEntries(NAV.map(i => [i.id, i.label]));

/** Map older / overly-generic paths → Portabase pages */
const ALIASES = {
  overview: 'home',
  capsules: 'backups',
  schedules: 'backups',
  destinations: 'account',
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
    const h = window.location.hash.slice(2).split('/');
    if (h[0] === 'projects' && h[1]) { page = 'project'; id = h[1]; }
    else if (h[0]) page = h[0];
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
  const [square, setSquare] = useState(null);

  const version = route.version;
  const meta = CLOUD_VERSIONS[version] || CLOUD_VERSIONS.supabase;
  const user = sessionUser(loadSession());

  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);

  const setState = useCallback((mutator) => {
    const demo = sessionStorage.getItem('portabase.console.demo') === '1'
      || new URLSearchParams(window.location.search).get('demo') === '1';
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
    const path = buildPath(page, { id: opts.id, version, tab: opts.tab });
    window.history.pushState({}, '', path);
    setRoute(parseRoute());
    setSideOpen(false);
  }, [version]);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title = `${TITLES[route.page] || 'Console'} · Portabase Cloud`;
    setStoredCloudVersion(version);
    let cancelled = false;
    const demoMode = new URLSearchParams(window.location.search).get('demo') === '1'
      || sessionStorage.getItem('portabase.console.demo') === '1';
    (async () => {
      try {
        let session = await ensureSessionForVersion(version);
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
          window.location.replace(`/login?version=${version}&next=${encodeURIComponent(`/app?version=${version}`)}`);
          return;
        }
        if (route.checkout === 'complete' && !demoMode) {
          try {
            const confirmed = await confirmCheckout({ attempt: route.attempt, version, addon: route.addon });
            toast(confirmed?.addon === 'extra-transfers'
              ? 'Extra transfers add-on is on — up to 3 / 24h'
              : 'Trial started — card on file', 'ok');
          } catch (e) {
            toast(e.message || 'Checkout confirmation pending', 'danger');
          }
          window.history.replaceState({}, '', buildPath(route.page === 'overview' ? 'overview' : route.page, { id: route.id, version }));
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
            window.location.replace(`/login?version=${version}&next=/dashboard`);
          }
        }
        try {
          const dash = await fetchDashboard(version);
          if (!cancelled) {
            setLiveJobs(Array.isArray(dash.jobs) ? dash.jobs : []);
            setLiveDashboard(Boolean(dash.live));
            if (dash.proof) {
              setStateRaw(s => {
                const next = { ...s, proofReport: dash.proof.proven ? dash.proof : s.proofReport, jobs: dash.jobs || [] };
                saveLiveConsoleState(next);
                return next;
              });
            } else {
              setStateRaw(s => {
                const next = { ...s, jobs: dash.jobs || [] };
                saveLiveConsoleState(next);
                return next;
              });
            }
          }
        } catch {
          if (!cancelled) {
            setLiveJobs([]);
            setLiveDashboard(false);
          }
        }
      } catch (e) {
        if (!cancelled) setAuthError(e.message || 'Could not load console');
      }
    })();
    return () => { cancelled = true; };
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAddon = async () => {
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

  const signOut = async () => {
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
    return state.projects.filter(p => p.status !== 'healthy').length
      + state.events.filter(e => e.level === 'error' || e.level === 'warn').slice(0, 5).length;
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
    setState,
    navigate,
    toast,
    params: { id: route.id },
    busy,
    startTrial,
    startAddon,
    demoMode: sessionStorage.getItem('portabase.console.demo') === '1',
    liveJobs,
    live: liveDashboard,
    square,
    resetDemo: () => {
      const next = resetConsoleState({ ...user, cloudVersion: version });
      setStateRaw(next);
      toast('Demo data reset', 'ok');
    },
  };

  let body;
  switch (route.page) {
    case 'projects': body = <ProjectsPage {...pageProps} />; break;
    case 'project': body = <ProjectDetailPage {...pageProps} />; break;
    case 'backups': body = <BackupsHubPage {...pageProps} />; break;
    case 'telemetry': body = <TelemetryPage {...pageProps} />; break;
    case 'inspect': body = <OpenCapsulePage {...pageProps} />; break;
    case 'supabase-viewer': body = <SupabaseViewerPage {...pageProps} />; break;
    case 'agents': body = <AgentsHubPage {...pageProps} tab={route.dashboardTab === 'seal' ? 'seal' : undefined} />; break;
    case 'alerts': body = <AlertsHubPage {...pageProps} />; break;
    case 'restore': body = <RestoresPage {...pageProps} />; break;
    case 'account': body = <AccountHubPage {...pageProps} tab={route.accountTab} />; break;
    case 'dashboard': body = <CustomerDashboardPage {...pageProps} section={route.dashboardTab === 'billing' ? 'overview' : (route.dashboardTab || 'overview')} />; break;
    default: body = <CustomerDashboardPage {...pageProps} section="overview" />;
  }

  const crumb = route.page === 'project'
    ? `Sources / ${state.projects.find(p => p.id === route.id)?.name || 'Detail'}`
    : (TITLES[route.page] || 'Home');

  return (
    <div className="pb-console">
      <aside className={`pb-side${sideOpen ? ' is-open' : ''}`}>
        <div className="pb-side-brand">
          <a href="/" className="logo-mark" aria-label="Portabase home"><i /><i /><i /></a>
          <b>Portabase</b>
          <em>Cloud</em>
        </div>
        <div className="pb-ws">
          <small>Workspace</small>
          <strong>{state.workspace.name}</strong>
          <span>{meta.short} · {getCloudPlan(state.billing?.plan || state.billing?.planId).shortLabel} · {state.billing.status}</span>
        </div>
        <nav className="pb-nav">
          <div className="pb-nav-section">Recovery</div>
          {filteredNav.map(item => (
            <button
              key={item.id}
              type="button"
              className={route.page === item.id || (route.page === 'project' && item.id === 'projects') ? 'is-active' : ''}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
              {item.id === 'alerts' && alertCount > 0 && <span className="pb-nav-badge">{Math.min(alertCount, 9)}</span>}
            </button>
          ))}
        </nav>
        <div className="pb-side-foot">
          <div className="pb-side-user">
            <div className="pb-avatar">{(me?.user?.email || user?.email || 'U').slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{me?.user?.name || user?.name || me?.user?.email || user?.email || 'Operator'}</strong>
              <span>{me?.user?.email || user?.email}</span>
            </div>
          </div>
          <button type="button" className="pb-btn pb-btn-sm" style={{ width: '100%' }} onClick={signOut}>
            <Icon name="logout" size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div className="pb-main">
        <header className="pb-top">
          <button type="button" className="pb-mobile-toggle" onClick={() => setSideOpen(o => !o)} aria-label="Menu">
            <Icon name="menu" size={18} />
          </button>
          <div className="pb-crumb">
            <span>Cloud</span>
            <span>/</span>
            <strong>{crumb}</strong>
          </div>
          <div className="pb-top-actions">
            <div className="pb-search">
              <Icon name="search" size={14} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter nav…" />
              <kbd>/</kbd>
            </div>
            <button type="button" className="pb-btn pb-btn-sm" onClick={() => navigate('account', { tab: 'billing' })}>
              <BadgeInline status={state.billing.status} />
              <span style={{ marginLeft: 6 }}>{getCloudPlan(me?.subscription?.plan || state.billing?.plan).shortLabel}</span>
            </button>
            <span className="pb-badge pb-badge-acid" style={{ height: 28, padding: '0 10px' }}>Supabase</span>
            <a className="pb-btn pb-btn-sm pb-btn-ghost" href="/cloud" target="_blank" rel="noreferrer">
              <Icon name="external" size={14} />
            </a>
          </div>
        </header>
        <div className="pb-body">{body}</div>
      </div>

      <div className="pb-toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`pb-toast ${t.tone === 'danger' ? 'danger' : 'ok'}`}>{t.message}</div>
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
