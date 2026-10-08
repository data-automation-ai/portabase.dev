import React, { useEffect, useRef, useState } from 'react';
import { createAgentToken, fetchAgents, revokeAgentToken, rotateAgentToken } from '../lib/cloud-api.js';
import { CLOUD_MAX_AGENTS } from '../lib/product.js';
import { ManifestSharing } from './manifest-sharing.jsx';
import { PrivateJobQueue } from './private-job-queue.jsx';

export function AgentCredentials() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [projectRef, setProjectRef] = useState('');
  // Credentials are shown once and never added to persisted console state.
  const [created, setCreated] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [confirmRotation, setConfirmRotation] = useState(null);
  const [rotationConsent, setRotationConsent] = useState(false);
  const [rotationNeedsRefresh, setRotationNeedsRefresh] = useState(false);
  const rotating = useRef(false);
  const [healthUnavailable, setHealthUnavailable] = useState(false);
  const [sharingAgentId, setSharingAgentId] = useState(null);
  const [jobAgentId, setJobAgentId] = useState(null);
  const revision = useRef(0);

  async function refresh() {
    setLoading(true);
    setError('');
    try { setAgents((await fetchAgents()).agents); setHealthUnavailable(false); setRotationNeedsRefresh(false); setConfirmRotation(null); setRotationConsent(false); }
    catch { setHealthUnavailable(true); setError('Could not load runner credentials. Retry before making changes.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    refresh();
    let cancelled = false;
    let fetching = false;
    const timer = setInterval(async () => {
      if (fetching) return;
      fetching = true;
      const before = revision.current;
      try {
        const result = await fetchAgents();
        if (!cancelled && before === revision.current) { setAgents(result.agents); setHealthUnavailable(false); }
      } catch { if (!cancelled) setHealthUnavailable(true); }
      finally { fetching = false; }
    }, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    revision.current++;
    setError('');
    try {
      const result = await createAgentToken({ name: name.trim(), projectRef: projectRef.trim() });
      setCreated(result);
      setAgents(previous => [...previous.filter(agent => agent.slot !== result.agent.slot), result.agent]);
      setName('');
    } catch (err) {
      setError(err.status === 409 ? 'All runner slots are in use. Revoke an unused credential first.' : 'Could not create the credential. Check the project reference and try again.');
    } finally { revision.current++; setBusy(false); }
  }
  async function revoke(id) {
    setBusy(true);
    revision.current++;
    setError('');
    try {
      const { agent } = await revokeAgentToken(id);
      setAgents(previous => previous.map(row => row.id === id ? agent : row));
      if (created?.agent.id === id) setCreated(null);
      setConfirmRevoke(null);
    } catch { setError('Could not revoke the credential. It may still be active; retry.'); }
    finally { revision.current++; setBusy(false); }
  }

  async function rotate() {
    if (rotating.current || busy || !confirmRotation || !rotationConsent || rotationNeedsRefresh) return;
    rotating.current = true; setBusy(true); revision.current++; setError(''); setCreated(null);
    const expected = confirmRotation;
    try {
      const result = await rotateAgentToken(expected.id, expected.credentialRevision ?? 0);
      if (result?.agent?.id !== expected.id || result.agent.projectRef !== expected.projectRef
        || result.agent.jobAccess !== true || result.agent.revokedAt
        || result.agent.credentialRevision !== (expected.credentialRevision ?? 0) + 1
        || typeof result.token !== 'string' || !/^pb_agent_[a-f0-9]{64}_\d{1,2}_[a-f0-9]{64}$/.test(result.token)) throw new Error('invalid_rotation_response');
      setCreated({ ...result, rotated: true });
      setAgents(previous => previous.map(agent => agent.id === expected.id ? result.agent : agent));
      setConfirmRotation(null); setRotationConsent(false);
    } catch (failure) {
      setRotationNeedsRefresh(true); setConfirmRotation(null); setRotationConsent(false);
      setError(failure.status === 409
        ? 'The credential changed or was revoked. Refresh runner credentials before reviewing another rotation.'
        : 'Token rotation was not confirmed. The old token may already be revoked. Refresh runner credentials, then explicitly rotate again if you did not receive the new token. No automatic retry was sent.');
    } finally { rotating.current = false; revision.current++; setBusy(false); }
  }

  const active = agents.filter(agent => !agent.revokedAt).length;
  const sharingAgent = agents.find(agent => agent.id === sharingAgentId);
  const jobAgent = agents.find(agent => agent.id === jobAgentId);
  return <div className="pb-card">
    <h2>Runner credentials</h2>
    <p>Each credential connects one runner to your account and project. Job-enabled credentials can report health and claim or finish that runner’s private jobs. They cannot list account jobs or read other runners’ reports.</p>
    {!loading && <section aria-label="Runner status" style={{ marginBottom: 24 }}>
      <h3>Runner status</h3>
      <p>States come from your runner’s reports. Reports older than 15 minutes are unconfirmed; a sleeping runner may intentionally be silent. A reported schedule does not confirm a future wake.</p>
      {healthUnavailable && <p role="alert">Runner health could not be refreshed. Current state is unknown.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>
        {agents.map(agent => <RunnerStatus key={agent.id} agent={agent} unavailable={healthUnavailable}
          onSharing={() => { setJobAgentId(null); setSharingAgentId(agent.id); }}
          onJob={() => { setSharingAgentId(null); setJobAgentId(agent.id); }} />)}
      </div>
      {!agents.length && <p>No connected runners have reported yet.</p>}
    </section>}
    {sharingAgent && <ManifestSharing key={sharingAgent.id} agent={sharingAgent} onClose={() => setSharingAgentId(null)} />}
    {jobAgent && <PrivateJobQueue key={jobAgent.id} agent={jobAgent} onClose={() => setJobAgentId(null)} />}
    {error && <div className="pb-callout warn" role="alert">{error}</div>}
    <div className="pb-inline" style={{ marginBottom: 16 }}>
      <span>{loading ? 'Loading runners…' : `${active} / ${CLOUD_MAX_AGENTS} active credentials`}</span>
      <button className="pb-btn" type="button" disabled={loading || busy} onClick={refresh}>Refresh</button>
    </div>
    {!loading && <div className="pb-table-wrap"><table className="pb-table">
      <thead><tr><th>Runner</th><th>Project reference</th><th>Credential</th><th>Access</th></tr></thead>
      <tbody>{agents.map(agent => <tr key={agent.id}>
        <td>{agent.name}</td><td><code>{agent.projectRef}</code></td><td>Ending {agent.tokenHint}</td>
        <td>{agent.revokedAt ? 'Revoked' : <>
          <p>{agent.jobAccess === true ? 'Private jobs and telemetry' : 'Telemetry only — private jobs require an upgrade'}</p>
          {confirmRevoke === agent.id
            ? <><span>Stop this credential from reporting or claiming private jobs? </span><button className="pb-btn" disabled={busy} onClick={() => revoke(agent.id)}>Confirm revoke</button> <button className="pb-btn" disabled={busy} onClick={() => setConfirmRevoke(null)}>Keep active</button></>
            : <><button className="pb-btn" disabled={busy || rotationNeedsRefresh} onClick={() => { setConfirmRevoke(agent.id); setConfirmRotation(null); }}>Revoke</button>{' '}
              <button className="pb-btn" disabled={busy || rotationNeedsRefresh} aria-label={`${agent.jobAccess === true ? 'Replace token' : 'Enable private jobs'} for ${agent.name}`}
                onClick={() => { setConfirmRotation(agent); setRotationConsent(false); setConfirmRevoke(null); }}>{agent.jobAccess === true ? 'Replace token' : 'Enable private jobs'}</button></>}
        </>}</td>
      </tr>)}</tbody>
    </table>{!agents.length && <p>No runner credentials yet.</p>}</div>}
    {confirmRotation && <section aria-label="Confirm runner token replacement" className="pb-callout warn" style={{ marginTop: 20 }}><div>
      <h3>Replace the token for {confirmRotation.name}</h3>
      <p>The old token stops working immediately. The runner ID and private configuration references stay the same. Install the new token in the runner before it can report or claim more jobs.</p>
      <label className="pb-check"><input type="checkbox" checked={rotationConsent} disabled={busy} onChange={event => setRotationConsent(event.target.checked)} />
        <span>I understand that the old token will be revoked and I must save the new token now.</span></label>
      <button className="pb-btn pb-btn-primary" type="button" disabled={busy || !rotationConsent} onClick={rotate}>Replace token and enable private jobs</button>{' '}
      <button className="pb-btn" type="button" disabled={busy} onClick={() => { setConfirmRotation(null); setRotationConsent(false); }}>Cancel replacement</button>
    </div></section>}
    {created ? <section aria-label="New runner credential" style={{ marginTop: 20 }}>
      <h3>Save your credential now</h3>
      {created.rotated && <p>The previous token is revoked. Update the runner with this replacement before resuming work.</p>}
      <p>Store this token in your runner’s secret manager as <code>PORTABASE_AGENT_TOKEN</code>. You cannot retrieve it later. Do not put it in a repository or send it to support.</p>
      <div className="pb-field">
        <label htmlFor="new-runner-token">Runner token</label>
        <input id="new-runner-token" value={created.token} readOnly autoComplete="off" spellCheck={false} onFocus={event => event.target.select()} />
      </div>
      <p>Set <code>PORTABASE_CLOUD_URL</code> to <code>https://portabase.dev</code>. Add this section to the runner configuration for project <code>{created.agent.projectRef}</code>:</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ cloud: { enabled: true, agentId: created.agent.id, tokenEnv: 'PORTABASE_AGENT_TOKEN' } }, null, 2)}</pre>
      <h4>Finish setup on the customer-controlled runner</h4>
      <p>Keep the private directory on durable storage controlled by you. It holds configuration, job journals, and recovery evidence. Supabase credentials and the capsule passphrase belong only in this runner environment.</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{`$env:PORTABASE_CLOUD_URL='https://portabase.dev'
$env:PORTABASE_AGENT_TOKEN='<saved token above>'
$env:PORTABASE_RUNNER_ID='${created.agent.id}'
$env:PORTABASE_PROJECT_REF='${created.agent.projectRef}'
$env:PORTABASE_RUNNER_CONFIG_DIR='<absolute-private-path-not-F>'

# Prepare the private configuration and download its opaque job reference
portabase ui --private-setup --config <absolute-private-path-not-F>/engine.json --no-open

# After importing and queueing that reference here, run the worker
node cloud/runner/supervisor.mjs`}</pre>
      <p>Open the loopback setup link on the runner, save the private configuration, download its opaque job reference, then use <strong>Queue private job</strong> for this runner. Creating a credential or reference does not start a backup.</p>
      <button className="pb-btn pb-btn-primary" type="button" onClick={() => setCreated(null)}>I saved it — hide token</button>
    </section> : <form onSubmit={create} style={{ marginTop: 20 }}>
      <h3>Connect a runner</h3>
      <div className="pb-field">
        <label htmlFor="runner-name">Runner name</label>
        <input id="runner-name" value={name} onChange={event => setName(event.target.value)} required maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9 ._\-]{0,63}" placeholder="Production recovery" />
      </div>
      <div className="pb-field">
        <label htmlFor="runner-project">Supabase project reference</label>
        <input id="runner-project" value={projectRef} onChange={event => setProjectRef(event.target.value)} required pattern="[a-z0-9]{20}" maxLength={20} placeholder="20-character project reference" autoCapitalize="none" spellCheck={false} />
      </div>
      <p>This identifies the project. It is not a database password or API key.</p>
      <button className="pb-btn pb-btn-primary" disabled={loading || busy || active >= CLOUD_MAX_AGENTS || Boolean(error)}>{busy ? 'Creating…' : 'Create runner credential'}</button>
    </form>}
  </div>;
}

const STATE_LABELS = { waiting: 'Waiting', starting: 'Starting', running: 'Running', completed: 'Completed', needs_attention: 'Needs attention', unknown: 'Unconfirmed' };
function reportTime(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not reported';
}
function RunnerStatus({ agent, unavailable, onSharing, onJob }) {
  const health = unavailable ? null : agent.health;
  const state = agent.revokedAt ? 'Reporting access revoked' : STATE_LABELS[health?.state] || 'Unconfirmed';
  return <article className="pb-card" aria-label={`Status for ${agent.name}`}>
    <h4 style={{ marginTop: 0 }}>{agent.name}</h4>
    <strong>{state}</strong>
    {health?.freshness === 'recent' && <span> · reported</span>}
    {!agent.revokedAt && (!health || health.freshness === 'missing') && <p>No report is available. Creating a credential does not prove the runner is running.</p>}
    {health?.freshness === 'stale' && <p>Last reported: {STATE_LABELS[health.lastKnownState] || 'Unconfirmed'}. Current operation has not been confirmed.</p>}
    <p>Last report: <time dateTime={health?.lastReportAt || undefined}>{reportTime(health?.lastReportAt)}</time></p>
    <p>Next scheduled run: <time dateTime={health?.nextScheduledAt || undefined}>{reportTime(health?.nextScheduledAt)}</time></p>
    <button type="button" className="pb-btn" onClick={onSharing} aria-label={`Manifest sharing for ${agent.name}`}>Manifest sharing</button>
    {!agent.revokedAt && agent.jobAccess !== true && <p>Enable private jobs in the credential controls below before queueing work.</p>}
    <button type="button" className="pb-btn" disabled={!!agent.revokedAt || agent.jobAccess !== true} onClick={onJob} aria-label={`Queue private job for ${agent.name}`} style={{ marginTop: 8 }}>Queue private job</button>
  </article>;
}
