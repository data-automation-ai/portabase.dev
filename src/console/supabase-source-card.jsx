import React, { useState, useEffect } from 'react';
import { LedIndicator } from './storage-led.jsx';

export function SupabaseSourceCard({ toast }) {
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [manualToken, setManualToken] = useState('');
  const [showManual, setShowManual] = useState(false);

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/cloud/oauth?provider=supabase&action=discover');
      if (res.ok) {
        const data = await res.json();
        setConnected(Boolean(data.databases?.length > 0 || data.projects?.length > 0));
      }
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const token = manualToken.trim();
      const url = token
        ? `/api/cloud/oauth?provider=supabase&action=test&token=${encodeURIComponent(token)}`
        : '/api/cloud/oauth?provider=supabase&action=test';
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok) {
        setConnected(true);
        setTestResult({ success: true, message: data.message || 'Supabase connection verified!' });
        toast?.(data.message || 'Supabase connection verified!', 'success');
      } else {
        setTestResult({ success: false, message: data.error || 'Connection check failed.' });
        toast?.(data.error || 'Supabase connection failed', 'error');
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message });
      toast?.(`Supabase test error: ${err.message}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/cloud/oauth?provider=supabase&action=disconnect');
      setConnected(false);
      setTestResult(null);
      toast?.('Disconnected Supabase session.', 'info');
    } catch (err) {
      toast?.(`Disconnect error: ${err.message}`, 'error');
    }
  };

  const getLedState = () => {
    if (testing) return 'yellow';
    if (testResult) {
      return testResult.success ? 'green' : (connected ? 'red-flash' : 'yellow-flash');
    }
    return connected ? 'green' : 'red';
  };

  return (
    <div className="pb-card" style={{ borderTop: '4px solid #3ECF8E', background: '#11151c', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Official Supabase Logo Mark */}
          <svg width="38" height="38" viewBox="0 0 109 113" fill="none">
            <path d="M63.708 110.284c-2.898 3.651-8.777 1.652-8.847-3.008L53.84 38.657h46.152c8.358 0 13.018 9.65 7.824 16.193l-44.108 55.434Z" fill="#3ECF8E" />
            <path d="M41.318 2.071c2.898-3.651 8.777-1.652 8.846 3.008l.447 68.618H5.034c-8.358 0-13.018-9.65-7.824-16.192L41.318 2.071Z" fill="#249361" />
          </svg>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '19px', color: '#f0f6fc', fontWeight: 600 }}>Primary Source: Supabase</h3>
              <span className="pb-badge pb-badge-neutral" style={{ fontSize: '11px', color: '#3ECF8E', borderColor: '#3ECF8E' }}>SOURCE DATABASE</span>
            </div>
            <small style={{ color: '#8b949e', fontSize: '12px' }}>OAuth 2.0 PKCE • Postgres DB, Auth Schema &amp; Storage Buckets</small>
          </div>
        </div>
        <LedIndicator state={getLedState()} />
      </div>

      <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.5, margin: '0 0 14px' }}>
        Connect your Supabase account using <strong>1-Click OAuth 2.0 PKCE</strong> to automatically discover organizations, projects, PostgreSQL database tables, views, and Storage buckets for capsule creation.
      </p>

      {testResult && (
        <div style={{ padding: '10px 14px', borderRadius: '6px', fontSize: '12px', marginBottom: 14, background: testResult.success ? '#0d281e' : '#3d1214', color: testResult.success ? '#3ecf8e' : '#ff7b72', border: `1px solid ${testResult.success ? '#238636' : '#da3633'}` }}>
          <strong>{testResult.success ? '✓ Verified: ' : '✕ Connection Problem: '}</strong>
          {testResult.message}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', paddingTop: '14px', borderTop: '1px solid #30363d' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <a
            href="/oauth/supabase/start"
            className="pb-btn pb-btn-primary"
            style={{ background: '#3ECF8E', borderColor: '#3ECF8E', color: '#0d1117', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
            </svg>
            {connected ? 'Reconnect Supabase (OAuth PKCE)' : 'Connect Supabase (OAuth PKCE)'}
          </a>

          <button
            type="button"
            className="pb-btn pb-btn-secondary"
            disabled={testing}
            onClick={handleTest}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {testing ? 'Testing Connection...' : 'Test Connection'}
          </button>

          {connected && (
            <button type="button" className="pb-btn pb-btn-ghost" onClick={handleDisconnect} style={{ color: '#8b949e' }}>
              Disconnect
            </button>
          )}

          <button
            type="button"
            className="pb-btn pb-btn-ghost pb-btn-sm"
            onClick={() => setShowManual(!showManual)}
            style={{ fontSize: '11px', color: '#58a6ff' }}
          >
            {showManual ? 'Hide Manual Token' : 'Or Test with Personal Access Token (PAT)'}
          </button>
        </div>

        <LedIndicator state={getLedState()} label="" size={11} />
      </div>

      {showManual && (
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #30363d' }}>
          <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '6px' }}>
            Supabase Personal Access Token (PAT) / Management Token (<code style={{ color: '#58a6ff' }}>sbp_...</code>)
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="password"
              placeholder="Paste sbp_... or access token to test"
              value={manualToken}
              onChange={e => setManualToken(e.target.value)}
              style={{ flex: 1, padding: '7px 10px', background: '#0d1117', border: '1px solid #30363d', borderRadius: '4px', color: '#c9d1d9', fontSize: '12px', fontFamily: 'monospace' }}
            />
            <button type="button" className="pb-btn pb-btn-sm pb-btn-secondary" disabled={testing || !manualToken.trim()} onClick={handleTest}>
              Test Token
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
