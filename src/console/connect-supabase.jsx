import React, { useEffect, useRef, useState } from 'react';
import { fetchAgents } from '../lib/cloud-api.js';
import { sampleSizeInventory } from '../lib/table-sizer.js';
import { PrivateJobQueue } from './private-job-queue.jsx';
import { TableSizer } from './table-sizer.jsx';

function SampleSelection({ plan }) {
  const [selection, setSelection] = useState({});
  const [excludeBinaries, setExcludeBinaries] = useState(false);
  return <section className="pb-stack" aria-label="Sample backup selection">
    <div className="pb-sample-banner" role="status"><span className="pb-sample-chip">SAMPLE</span>
      <strong>Sample backup selection</strong><p>Explore sample table and bucket sizes. This does not connect a source, save a private configuration or queue a job.</p></div>
    <TableSizer inventory={sampleSizeInventory()} planId={plan?.id || 'cloud-free'} onPlanId={() => {}}
      selection={selection} onSelection={setSelection} excludeBinaries={excludeBinaries}
      onExcludeBinaries={setExcludeBinaries} demo compact />
  </section>;
}

/** The account dashboard accepts opaque references; source setup stays on the runner. */
export function ConnectSupabaseFlow({ demo = false, plan, navigate, operation = 'backup' }) {
  return demo ? <SampleSelection plan={plan} /> : <PrivateSourceSetup navigate={navigate} operation={operation} />;
}

function PrivateSourceSetup({ navigate, operation }) {
  const replay = operation === 'replay';
  const [agents, setAgents] = useState([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [selectedId, setSelectedId] = useState(null);
  const [connMethod, setConnMethod] = useState('oauth');
  const revision = useRef(0);
  async function refresh() {
    const request = ++revision.current;
    setLoading(true); setError(''); setSelectedId(null); setAgents([]);
    try {
      const result = await fetchAgents();
      if (!Array.isArray(result?.agents)) throw new Error('invalid_agents');
      if (request === revision.current) setAgents(result.agents.filter(agent => !agent.revokedAt));
    } catch {
      if (request === revision.current) setError('Could not load your registered runners. Retry before importing a job reference.');
    } finally { if (request === revision.current) setLoading(false); }
  }
  useEffect(() => { refresh(); return () => { revision.current++; }; }, []);
  const selected = agents.find(agent => agent.id === selectedId);
  return <section className="pb-stack" aria-label="Private Supabase setup" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
    <div className="pb-card">
      <h3>{replay ? 'Review a recovery capsule on your private runner' : 'Choose backup contents on your private runner'}</h3>
      <p>{replay ? 'Authenticate and inspect an encrypted capsule, review its capture log, and save a restore selection on the private runner. Bring only its downloaded replay reference back here.' : 'Use the private runner workspace to inspect Supabase table and bucket inventory, choose what to include, and save a configuration. Bring only its downloaded job reference back here. This view does not provide SQL editing.'}</p>
      <div className="pb-callout warn" role="note"><div><strong>Hosted private workspace access is not available yet.</strong>
        <p>The current setup view runs on a customer-controlled runner and listens on its loopback address. This dashboard cannot launch or open a remote runner workspace.</p></div></div>
      <ol>
        <li>Register a runner in your account, then configure that runner with its ID, source project, credentials, capsule passphrase and private directory. Source credentials belong in the runner environment.</li>
        <li>On that runner, launch the private {replay ? 'capsule review' : 'setup'} view using its existing engine configuration. Replace path placeholders below with paths inside its private directory.</li>
        <li>Open the printed session URL in a browser in that runner environment. {replay ? 'Inspect the capsule, select table rows, buckets and functions, and save the plan. Confirm a different recovery target to create and download a replay reference.' : 'Inspect the source, select tables and buckets, save the private configuration, then download its job reference.'}</li>
        <li>Select the matching registered runner below, import the reference and explicitly queue the job. The worker must be configured and running separately.</li>
      </ol>
      <div className="pb-card" style={{ marginTop: 12, marginBottom: 12, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Runner connection options</h4>
        <p style={{ margin: '0 0 10px', fontSize: 13, opacity: 0.85 }}>Choose how your runner connects to Supabase Management API:</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            type="button"
            className={`pb-btn pb-btn-sm ${connMethod === 'oauth' ? 'pb-btn-primary' : ''}`}
            aria-pressed={connMethod === 'oauth'}
            style={{ fontSize: 12, whiteSpace: 'normal', textAlign: 'left' }}
            onClick={() => setConnMethod('oauth')}
          >
            Connect with Supabase OAuth (PKCE)
          </button>
          <button
            type="button"
            className={`pb-btn pb-btn-sm ${connMethod === 'refresh-token' ? 'pb-btn-primary' : ''}`}
            aria-pressed={connMethod === 'refresh-token'}
            style={{ fontSize: 12, whiteSpace: 'normal', textAlign: 'left' }}
            onClick={() => setConnMethod('refresh-token')}
          >
            Connect with Refresh Token (sbr_...)
          </button>
          <button
            type="button"
            className={`pb-btn pb-btn-sm ${connMethod === 'pat' ? 'pb-btn-primary' : ''}`}
            aria-pressed={connMethod === 'pat'}
            style={{ fontSize: 12, whiteSpace: 'normal', textAlign: 'left' }}
            onClick={() => setConnMethod('pat')}
          >
            Connect with Personal Access Token (sbp_...)
          </button>
        </div>
        {connMethod === 'oauth' && (
          <div className="pb-callout" style={{ fontSize: 13 }}>
            <div>
              <strong>1-Click Supabase OAuth (PKCE)</strong>
              <p style={{ margin: '4px 0 6px' }}>
                Launch runner setup (<code>portabase ui --private-setup</code>) and click <strong>Connect with Supabase OAuth</strong>. Authorize via Supabase in your browser; tokens are stored locally on the runner with automatic refresh.
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(0,0,0,0.2)', padding: 6, borderRadius: 4, overflowWrap: 'anywhere' }}>
                PORTABASE_RUNNER_CONFIG_DIR=&lt;private-root&gt;<br />
                SUPABASE_OAUTH_CLIENT_ID=&lt;custom-client-id-optional&gt;
              </div>
            </div>
          </div>
        )}
        {connMethod === 'refresh-token' && (
          <div className="pb-callout" style={{ fontSize: 13 }}>
            <div>
              <strong>OAuth Refresh Token (<code>sbr_...</code>)</strong>
              <p style={{ margin: '4px 0 6px' }}>
                Ideal for headless runners or CI/CD without browser interaction. The runner automatically exchanges the refresh token for a short-lived access token before each operation.
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(0,0,0,0.2)', padding: 6, borderRadius: 4, overflowWrap: 'anywhere' }}>
                SUPABASE_REFRESH_TOKEN=sbr_...<br />
                portabase probe --project-ref &lt;project-ref&gt; --refresh-token sbr_...
              </div>
            </div>
          </div>
        )}
        {connMethod === 'pat' && (
          <div className="pb-callout" style={{ fontSize: 13 }}>
            <div>
              <strong>Personal Access Token (<code>sbp_...</code>)</strong>
              <p style={{ margin: '4px 0 6px' }}>
                Static personal access token generated from your Supabase Dashboard &gt; Account &gt; Access Tokens. Stored strictly within the runner environment.
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(0,0,0,0.2)', padding: 6, borderRadius: 4, overflowWrap: 'anywhere' }}>
                SUPABASE_ACCESS_TOKEN=sbp_...<br />
                portabase probe --project-ref &lt;project-ref&gt; --access-token sbp_...
              </div>
            </div>
          </div>
        )}
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{replay
        ? 'portabase ui --private-capsule-review --capsule <private-root>/capsule --config <private-root>/engine.json --review-max-cipher-bytes <limit> --review-max-expanded-bytes <limit> --no-open'
        : 'portabase ui --private-setup --config <private-root>/engine.json --no-open'}</pre>
      <p>The runner needs <code>PORTABASE_RUNNER_CONFIG_DIR</code>, <code>PORTABASE_RUNNER_ID</code> and <code>PORTABASE_PROJECT_REF</code>. Its engine configuration must keep backup and status directories inside that private directory. F: paths are refused.</p>
      {replay && <p>The encrypted capsule, engine configuration and decryption key must already be present in the runner environment. Configure <code>PORTABASE_TARGET_PROJECT_REF</code> for a different recovery project. Review limits are positive byte counts; expanded bytes must be at least 1024. The separate worker also needs its review limits, target credentials and tools. This page uploads no capsule or key; source recovery is not proven until a restore and application checks pass.</p>}
      <p>Saved legacy dashboard selections are not imported automatically. Review and recreate the selection in the private workspace. Creating a reference does not run a backup or prove recovery.</p>
      {navigate && <button type="button" className="pb-btn" onClick={() => navigate('agents')}>Manage runner credentials</button>}
    </div>
    <div className="pb-card">
      <h3>Import a private job reference</h3>
      <p>Choose the runner that created the file. Registration alone does not establish that the runner is online or ready to execute. Telemetry-only credentials must be upgraded in Runner credentials before queueing.</p>
      <button type="button" className="pb-btn" disabled={loading} onClick={refresh}>{loading ? 'Loading runners…' : 'Refresh registered runners'}</button>
      {error && <p role="alert">{error}</p>}
      {!loading && !error && agents.length === 0 && <p>No active runner credentials are registered. Register a runner before importing its reference.</p>}
      <div className="pb-stack" style={{ marginTop: 12 }}>
        {agents.map(agent => <button type="button" className="pb-btn" key={agent.id}
          disabled={agent.jobAccess !== true}
          style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', display: 'block', width: '100%', height: 'auto', minHeight: 36, textAlign: 'left' }}
          aria-pressed={selectedId === agent.id} onClick={() => setSelectedId(agent.id)}>
          {agent.jobAccess === true ? 'Import reference for' : 'Upgrade required for'} {agent.name || 'registered runner'} · <span style={{ overflowWrap: 'anywhere' }}>{agent.id}</span>
        </button>)}
      </div>
    </div>
    {selected && <PrivateJobQueue key={selected.id} agent={selected} onClose={() => setSelectedId(null)} />}
  </section>;
}
