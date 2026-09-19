import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { ZK_COPY } from '../lib/zero-knowledge.js';
import {
  LIVE_VIEWER_COPY,
  createLiveClient,
  fetchLiveCatalog,
  listLiveBuckets,
  listLiveObjects,
  liveCliFallback,
  managementApiBlockedReason,
  neverSendLiveSecretsTo,
  previewLiveRows,
  readLiveSession,
  wipeLiveSession,
  writeLiveSession,
} from '../lib/live-supabase.js';

function cell(value) {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export function SupabaseViewerPage({ toast, navigate }) {
  const existing = useMemo(() => readLiveSession(), []);
  const [url, setUrl] = useState(existing?.url || '');
  const [key, setKey] = useState(existing?.key || '');
  const [persist, setPersist] = useState(Boolean(existing?.key));
  const [client, setClient] = useState(null);
  const [connected, setConnected] = useState(Boolean(existing?.url && existing?.key));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('tables');
  const [tables, setTables] = useState([]);
  const [tableName, setTableName] = useState('');
  const [rows, setRows] = useState([]);
  const [buckets, setBuckets] = useState([]);
  const [bucketId, setBucketId] = useState('');
  const [objects, setObjects] = useState([]);
  const [error, setError] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');

  const connect = async (event) => {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const next = createLiveClient({ url, key });
      writeLiveSession({ url, key, persist });
      setClient(next);
      setConnected(true);
      const catalog = await fetchLiveCatalog({ url, key });
      setTables(catalog);
      toast?.('Connected in this browser only — nothing posted to Portabase', 'ok');
    } catch (err) {
      setConnected(false);
      setClient(null);
      setError(err.message || 'Could not reach your Supabase project from this browser.');
    } finally {
      setBusy(false);
    }
  };

  const wipe = () => {
    wipeLiveSession();
    setClient(null);
    setConnected(false);
    setKey('');
    setUrl('');
    setPersist(false);
    setTables([]);
    setRows([]);
    setBuckets([]);
    setObjects([]);
    setTableName('');
    setBucketId('');
    setError('');
    toast?.('Local keys wiped — Portabase never had them', 'ok');
  };

  const loadRows = async (name) => {
    setTableName(name);
    setBusy(true);
    setError('');
    try {
      const live = client || createLiveClient({ url, key });
      setRows(await previewLiveRows(live, { table: name }));
    } catch (err) {
      setRows([]);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const loadBuckets = async () => {
    setBusy(true);
    setError('');
    try {
      const live = client || createLiveClient({ url, key });
      const list = await listLiveBuckets(live);
      setBuckets(list);
      setTab('storage');
    } catch (err) {
      setBuckets([]);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const loadObjects = async (id) => {
    setBucketId(id);
    setBusy(true);
    setError('');
    try {
      const live = client || createLiveClient({ url, key });
      setObjects(await listLiveObjects(live, id));
    } catch (err) {
      setObjects([]);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const signInUser = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const live = client || createLiveClient({ url, key });
      const { error: authError } = await live.auth.signInWithPassword({ email: userEmail, password: userPassword });
      if (authError) throw authError;
      setUserPassword('');
      toast?.('Signed in to YOUR project in this tab. Portabase did not see the password.', 'ok');
    } catch (err) {
      setError(err.message || 'Sign-in stayed in this browser and failed.');
    } finally {
      setBusy(false);
    }
  };

  const startOAuth = async (provider) => {
    setBusy(true);
    setError('');
    try {
      const live = client || createLiveClient({ url, key });
      const redirectTo = `${window.location.origin}/app/supabase-viewer`;
      const { error: authError } = await live.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: false },
      });
      if (authError) throw authError;
    } catch (err) {
      setError(`${err.message || 'OAuth blocked'}. Add ${window.location.origin}/app/supabase-viewer to your Supabase Auth redirect URLs, or use the CLI. Portabase does not broker this.`);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pb-page-head">
        <div>
          <h1>Live Supabase</h1>
          <p>
            {LIVE_VIEWER_COPY.banner} {LIVE_VIEWER_COPY.contrast}
          </p>
        </div>
        <div className="pb-page-actions">
          <button type="button" className="pb-btn" onClick={() => navigate('inspect')}><Icon name="key" size={14} /> Capsule (ZK)</button>
          <button type="button" className="pb-btn" onClick={() => navigate('telemetry')}><Icon name="chart" size={14} /> Telemetry</button>
          {connected && <button type="button" className="pb-btn pb-btn-danger" onClick={wipe}>Wipe keys</button>}
        </div>
      </div>

      <div className="pb-callout info">
        <Icon name="shield" size={16} />
        <div>
          <strong>{LIVE_VIEWER_COPY.headline}</strong>
          <p>
            {LIVE_VIEWER_COPY.banner} Forbidden from Portabase: {neverSendLiveSecretsTo().join(' · ')}.
            Capsule law still: {ZK_COPY.cannotSee}
          </p>
        </div>
      </div>

      {!connected && (
        <form className="pb-card" style={{ maxWidth: 640 }} onSubmit={connect}>
          <div className="pb-field">
            <label>Project URL</label>
            <input
              name="projectUrl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xxxx.supabase.co"
              autoComplete="off"
              className="pb-mono"
            />
          </div>
          <div className="pb-field">
            <label>Anon or service_role key</label>
            <input
              name="projectKey"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              placeholder="stays in this browser"
            />
            <span className="pb-field-hint">
              Service role in a browser can read everything the key can. Prefer anon + RLS. We never POST this to /api.
            </span>
          </div>
          <label className="pb-check">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
            <span>Remember in this tab (sessionStorage) — {LIVE_VIEWER_COPY.persistRisk}</span>
          </label>
          <div className="pb-inline" style={{ marginTop: 14 }}>
            <button type="submit" className="pb-btn pb-btn-primary" disabled={busy}>Connect from this browser</button>
          </div>
          {error && <p className="pb-muted" style={{ color: 'var(--c-danger)', marginTop: 12 }}>{error}</p>}
        </form>
      )}

      {connected && (
        <>
          <div className="pb-tabs">
            <button type="button" className={tab === 'tables' ? 'is-active' : ''} onClick={() => setTab('tables')}>Tables</button>
            <button type="button" className={tab === 'storage' ? 'is-active' : ''} onClick={loadBuckets}>Storage</button>
            <button type="button" className={tab === 'auth' ? 'is-active' : ''} onClick={() => setTab('auth')}>Sign in (optional)</button>
            <button type="button" className={tab === 'cli' ? 'is-active' : ''} onClick={() => setTab('cli')}>CLI fallback</button>
          </div>

          {error && <div className="pb-callout danger" style={{ marginBottom: 12 }}><Icon name="warn" size={16} /><div><p style={{ margin: 0 }}>{error}</p></div></div>}

          {tab === 'tables' && (
            <div className="pb-live-split">
              <div className="pb-card">
                <div className="pb-card-head"><h3>Schemas / tables</h3><span>{tables.length} via PostgREST</span></div>
                <div className="pb-live-list">
                  {tables.length === 0 && <p className="pb-muted">No exposed tables for this key (RLS / grants). We do not fall back to Portabase.</p>}
                  {tables.map((t) => (
                    <button
                      type="button"
                      key={`${t.schema}.${t.name}`}
                      className={`pb-live-item${tableName === t.name ? ' is-on' : ''}`}
                      onClick={() => loadRows(t.name)}
                    >
                      <b>{t.name}</b>
                      <span>{t.schema} · {t.columns.length} cols</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="pb-card">
                <div className="pb-card-head"><h3>Row preview</h3><span>{tableName || 'pick a table'}</span></div>
                {!rows.length && <p className="pb-muted">Optional preview — results stay in this tab. {busy ? 'Loading…' : ''}</p>}
                {rows.length > 0 && (
                  <div className="pb-table-wrap">
                    <table className="pb-table">
                      <thead>
                        <tr>{Object.keys(rows[0]).map((col) => <th key={col}>{col}</th>)}</tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i}>{Object.keys(rows[0]).map((col) => <td key={col} className="mono">{cell(row[col])}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'storage' && (
            <div className="pb-live-split">
              <div className="pb-card">
                <div className="pb-card-head"><h3>Buckets</h3><span>live Storage API</span></div>
                <div className="pb-live-list">
                  {buckets.length === 0 && <p className="pb-muted">No buckets visible to this key.</p>}
                  {buckets.map((b) => (
                    <button type="button" key={b.id || b.name} className={`pb-live-item${bucketId === b.id || bucketId === b.name ? ' is-on' : ''}`} onClick={() => loadObjects(b.id || b.name)}>
                      <b>{b.name || b.id}</b>
                      <span>{b.public ? 'public' : 'private'}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="pb-card">
                <div className="pb-card-head"><h3>Objects</h3><span>{bucketId || 'pick a bucket'}</span></div>
                <p className="pb-faint">Live Supabase Storage — not capsule inventory. {ZK_COPY.headline} still applies to capsules.</p>
                {objects.length > 0 && (
                  <ul className="pb-muted" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
                    {objects.map((o) => (
                      <li key={o.id || o.name}><code>{o.name}</code> {o.metadata?.size != null ? `· ${o.metadata.size} B` : ''}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {tab === 'auth' && (
            <div className="pb-grid pb-grid-2">
              <form className="pb-card" onSubmit={signInUser}>
                <div className="pb-kpi-label">Optional user session (RLS)</div>
                <p className="pb-muted">Signs in against <em>your</em> Auth endpoint. Password never leaves this browser toward Portabase.</p>
                <div className="pb-field">
                  <label>Email</label>
                  <input type="email" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
                </div>
                <div className="pb-field">
                  <label>Password</label>
                  <input type="password" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} autoComplete="off" />
                </div>
                <button type="submit" className="pb-btn pb-btn-primary" disabled={busy}>Sign in on your project</button>
              </form>
              <div className="pb-card">
                <div className="pb-kpi-label">OAuth (your providers)</div>
                <p className="pb-muted">
                  Redirects to your Supabase Auth, then back here. Add this page as a redirect URL on <em>your</em> project.
                  Portabase does not broker OAuth tokens.
                </p>
                <div className="pb-inline">
                  <button type="button" className="pb-btn" onClick={() => startOAuth('google')}>Google (your project)</button>
                  <button type="button" className="pb-btn" onClick={() => startOAuth('github')}>GitHub (your project)</button>
                </div>
              </div>
            </div>
          )}

          {tab === 'cli' && (
            <div className="pb-card">
              <p className="pb-muted">{managementApiBlockedReason()}</p>
              <pre className="pb-code">{liveCliFallback()}</pre>
            </div>
          )}
        </>
      )}
    </>
  );
}
