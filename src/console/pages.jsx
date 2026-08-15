import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import {
  formatBytes, formatDuration, relativeTime, rpoStatus, uid,
  updateConsoleState,
} from './data/store.js';
import {
  CLOUD_MAX_AGENTS,
  CLOUD_PLANS,
  CLOUD_DEFAULT_PLAN_ID,
  agentSlotsUsed,
  getCloudPlan,
} from '../lib/product.js';
import { IngestMonitor } from './IngestMonitor.jsx';
import { createIngestState, applyIngestEvent } from './data/ingest-stream.js';
import { demoIngestSource } from './data/ingest-demo.js';

function Badge({ tone, children }) {
  const t = tone === 'ok' || tone === 'online' || tone === 'healthy' || tone === 'COMPLETE' || tone === 'running' || tone === 'completed' || tone === 'active' || tone === 'trialing'
    ? 'ok'
    : tone === 'warn' || tone === 'degraded' || tone === 'Approaching breach' || tone === 'PENDING'
      ? 'warn'
      : tone === 'danger' || tone === 'error' || tone === 'FAILED' || tone === 'offline' || tone === 'canceled'
        ? 'danger'
        : tone === 'acid' || tone === 'info' ? (tone === 'acid' ? 'acid' : 'info') : '';
  return <span className={`pb-badge${t ? ` pb-badge-${t}` : ''}`}>{children}</span>;
}

function Modal({ title, children, onClose, footer, large }) {
  return (
    <div className="pb-modal-backdrop" onClick={onClose} role="presentation">
      <div className={`pb-modal${large ? ' pb-modal-lg' : ''}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="pb-modal-head">
          <h2>{title}</h2>
          <button type="button" className="pb-btn pb-btn-icon pb-btn-ghost" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="pb-modal-body">{children}</div>
        {footer && <div className="pb-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function Empty({ icon = 'folder', title, body, action }) {
  return (
    <div className="pb-empty">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

function PageHead({ title, subtitle, actions }) {
  return (
    <div className="pb-page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="pb-page-actions">{actions}</div>}
    </div>
  );
}

function copyText(text, toast) {
  navigator.clipboard?.writeText(text).then(() => toast?.('Copied to clipboard', 'ok')).catch(() => toast?.('Could not copy', 'danger'));
}

/* ─── HOME ─── */
export function OverviewPage({ state, navigate, toast }) {
  const healthy = state.projects.filter(p => p.status === 'healthy').length;
  const issues = state.projects.filter(p => p.status !== 'healthy').length;
  const lastEvents = [...state.events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, 6);
  const spark = [0.4, 0.7, 0.55, 0.9, 0.65, 1, 0.8, 0.95, 0.7, 0.85, 1, 0.6].map((h, i) => ({ h, fail: i === 4 || i === 9 }));
  const trialDays = Math.max(0, Math.ceil((new Date(state.billing.trialEndsAt) - Date.now()) / 86400e3));
  const success = state.capsules.filter(c => c.status === 'COMPLETE').length;
  const failed = state.capsules.filter(c => c.status === 'FAILED').length;

  return (
    <>
      <PageHead
        title="Recovery status"
        subtitle="Did last night’s capsule land? Can you restore without the Supabase dashboard? Keys stay on your runners."
        actions={
          <>
            <button type="button" className="pb-btn" onClick={() => navigate('restore')}><Icon name="restore" size={14} /> Replay to new account</button>
            <button type="button" className="pb-btn pb-btn-primary" onClick={() => navigate('projects')}><Icon name="plus" size={14} /> Add source</button>
          </>
        }
      />

      {state.billing.status === 'trialing' && (
        <div className="pb-callout warn">
          <Icon name="clock" size={18} />
          <div>
            <strong>Trial · {trialDays} day{trialDays === 1 ? '' : 's'} remaining</strong>
            <p>Card on file. Auto-converts to ${(state.billing.priceMonthlyCents / 100).toFixed(0)}/mo unless canceled. Manage under Billing.</p>
          </div>
        </div>
      )}

      {issues > 0 && (
        <div className="pb-callout danger">
          <Icon name="warn" size={18} />
          <div>
            <strong>{issues} project{issues === 1 ? '' : 's'} need attention</strong>
            <p>RPO risk or recent failures detected. Review projects and the alert chain.</p>
          </div>
        </div>
      )}

      <div className="pb-grid pb-grid-4" style={{ marginBottom: 14 }}>
        <div className="pb-card">
          <div className="pb-kpi-label">Sources</div>
          <div className="pb-kpi-value">{state.projects.length}</div>
          <div className="pb-kpi-meta">{healthy} OK · {issues} need attention</div>
        </div>
        <div className="pb-card">
          <div className="pb-kpi-label">Agents online</div>
          <div className="pb-kpi-value">{state.agents.filter(a => a.status === 'online').length}<span style={{ fontSize: 16, color: 'var(--c-faint)' }}>/{state.agents.length}</span></div>
          <div className="pb-kpi-meta">{state.agents.length}/{CLOUD_MAX_AGENTS} plan slots · {relativeTime(state.agents[0]?.lastSeenAt)}</div>
        </div>
        <div className="pb-card">
          <div className="pb-kpi-label">Verified capsules</div>
          <div className="pb-kpi-value">{state.capsules.filter(c => c.verified).length}</div>
          <div className="pb-kpi-meta">{success} ok · {failed} failed</div>
          <div className="pb-spark" aria-hidden="true">{spark.map((s, i) => <i key={i} className={s.fail ? 'fail' : ''} style={{ height: `${s.h * 100}%` }} />)}</div>
        </div>
        <div className="pb-card">
          <div className="pb-kpi-label">Freshest RPO</div>
          <div className="pb-kpi-value">{Math.min(...state.projects.map(p => p.rpoHours || 999)).toFixed(1)}<span style={{ fontSize: 14, color: 'var(--c-faint)' }}>h</span></div>
          <div className="pb-kpi-meta">Age of newest good capsule</div>
        </div>
      </div>

      <div className="pb-split">
        <div className="pb-card">
          <div className="pb-card-head"><h3>Sources you protect</h3><button type="button" className="pb-btn pb-btn-sm pb-btn-ghost" onClick={() => navigate('projects')}>All sources</button></div>
          <div className="pb-table-wrap" style={{ border: 0 }}>
            <table className="pb-table" style={{ minWidth: 0 }}>
              <thead><tr><th>Source</th><th>RPO</th><th>Status</th><th>Last success</th></tr></thead>
              <tbody>
                {state.projects.map(p => {
                  const rs = rpoStatus(p);
                  return (
                    <tr key={p.id} className="row-link" onClick={() => navigate('project', { id: p.id })}>
                      <td><div className="pb-cell-main"><strong>{p.name}</strong><span className="mono">{p.ref}</span></div></td>
                      <td><Badge tone={rs.tone}>{p.rpoHours != null ? `${p.rpoHours}h` : '—'}</Badge></td>
                      <td><Badge tone={p.status}>{p.status}</Badge></td>
                      <td className="mono">{relativeTime(p.lastSuccessAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="pb-card-head"><h3>RPO vs target</h3></div>
            {state.projects.map(p => {
              const pct = p.rpoHours == null ? 0 : Math.min(100, Math.round((p.rpoTargetHours / Math.max(p.rpoHours, 0.1)) * 100));
              const rs = rpoStatus(p);
              return (
                <div key={p.id} style={{ marginBottom: 12 }}>
                  <div className="pb-inline"><strong style={{ fontSize: 12 }}>{p.name}</strong><span className="pb-mono pb-right pb-faint">{p.rpoHours ?? '—'}h / {p.rpoTargetHours}h</span></div>
                  <div className="pb-progress"><i style={{ width: `${pct}%`, background: rs.tone === 'ok' ? 'var(--c-ok)' : rs.tone === 'warn' ? 'var(--c-warn)' : 'var(--c-danger)' }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="pb-card">
          <div className="pb-card-head"><h3>What just happened</h3><button type="button" className="pb-btn pb-btn-sm pb-btn-ghost" onClick={() => navigate('alerts')}>Alerts</button></div>
          <div className="pb-timeline">
            {lastEvents.map(e => (
              <div className="pb-timeline-item" key={e.id}>
                <div className={`pb-timeline-dot ${e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : e.level === 'ok' ? 'ok' : 'info'}`} />
                <div>
                  <strong style={{ fontSize: 13 }}>{e.summary}</strong>
                  <div className="pb-faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {e.projectRef} · {relativeTime(e.occurredAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Hubs (flat Portabase IA) ─── */
export function BackupsHubPage(props) {
  const [tab, setTab] = useState('capsules');
  return (
    <>
      <PageHead title="Backups" subtitle="Encrypted capsules on your destinations, plus the schedule Cloud expects agents to meet." />
      <div className="pb-tabs">
        <button type="button" className={tab === 'capsules' ? 'is-active' : ''} onClick={() => setTab('capsules')}>Capsules</button>
        <button type="button" className={tab === 'live' ? 'is-active' : ''} onClick={() => setTab('live')}>Live capture</button>
        <button type="button" className={tab === 'schedules' ? 'is-active' : ''} onClick={() => setTab('schedules')}>Schedule</button>
      </div>
      {tab === 'capsules' ? <CapsulesPage {...props} embedded />
        : tab === 'live' ? <LiveIngestPage {...props} embedded />
          : <SchedulesPage {...props} embedded />}
    </>
  );
}

/* ─── LIVE INGESTION ───
   Real-time view of a capture as it reads the customer's Supabase project. */
export function LiveIngestPage({ state: consoleState, embedded }) {
  const [ingest, setIngest] = useState(createIngestState);
  const [running, setRunning] = useState(false);
  const stopRef = React.useRef(null);

  const start = useCallback(() => {
    if (stopRef.current) stopRef.current();
    setIngest(createIngestState());
    setRunning(true);
    stopRef.current = demoIngestSource(event => {
      setIngest(prev => applyIngestEvent(prev, event));
      if (event.phase === 'done' || event.phase === 'failed') setRunning(false);
    });
  }, []);

  const stop = useCallback(() => {
    if (stopRef.current) stopRef.current();
    stopRef.current = null;
    setRunning(false);
  }, []);

  useEffect(() => () => { if (stopRef.current) stopRef.current(); }, []);

  const source = consoleState?.projects?.[0]?.projectRef || 'ekklokrukxmqlahtonnc';
  const idle = ingest.status === 'idle';

  const body = (
    <>
      <div className="pb-inline" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <p style={{ margin: 0, color: 'var(--c-muted)', fontSize: 12.5 }}>
          Progress is weighted by estimated table size, not table count — a few large tables
          dominate most captures.
        </p>
        <button type="button" className="pb-btn pb-btn-primary" onClick={start} disabled={running}>
          {running ? 'Capture running…' : idle ? 'Start capture' : 'Run again'}
        </button>
      </div>
      {idle ? (
        <div className="pb-empty">
          <h3>No capture running</h3>
          <p>
            Start a capture to watch each table stream into the capsule in real time, with a
            size-weighted progress meter and a live read of the object being ingested.
          </p>
          <button type="button" className="pb-btn pb-btn-primary" onClick={start}>Start capture</button>
        </div>
      ) : (
        <IngestMonitor state={ingest} source={source} onStop={running ? stop : null} />
      )}
    </>
  );
  if (embedded) return body;
  return (
    <>
      <PageHead title="Live capture" subtitle="Watch objects enter the capsule as the Escape runs." />
      {body}
    </>
  );
}

export function AgentsHubPage(props) {
  const [tab, setTab] = useState('agents');
  const used = props.state?.agents?.length || 0;
  return (
    <>
      <PageHead title="Agents" subtitle={`Customer-run boxes that report health. Cloud plan: up to ${CLOUD_MAX_AGENTS} agents (${used} in use). Optional managed runners for hosted compute.`} />
      <div className="pb-tabs">
        <button type="button" className={tab === 'agents' ? 'is-active' : ''} onClick={() => setTab('agents')}>Your agents</button>
        <button type="button" className={tab === 'runners' ? 'is-active' : ''} onClick={() => setTab('runners')}>Managed runners</button>
      </div>
      {tab === 'agents' ? <AgentsPage {...props} embedded /> : <RunnersPage {...props} embedded />}
    </>
  );
}

export function AlertsHubPage(props) {
  const [tab, setTab] = useState('sms');
  return (
    <>
      <PageHead title="Alerts" subtitle="SMS on success, failure, and every source-key access · escalation chains · channels." />
      <div className="pb-tabs">
        <button type="button" className={tab === 'sms' ? 'is-active' : ''} onClick={() => setTab('sms')}>SMS texts</button>
        <button type="button" className={tab === 'policies' ? 'is-active' : ''} onClick={() => setTab('policies')}>Escalation</button>
        <button type="button" className={tab === 'channels' ? 'is-active' : ''} onClick={() => setTab('channels')}>Channels</button>
        <button type="button" className={tab === 'feed' ? 'is-active' : ''} onClick={() => setTab('feed')}>Event feed</button>
      </div>
      {tab === 'feed'
        ? <ActivityPage {...props} embedded />
        : <AlertsPage {...props} forcedTab={tab === 'channels' ? 'channels' : tab === 'sms' ? 'sms' : 'policies'} embedded />}
    </>
  );
}

export function AccountHubPage(props) {
  const initial = ['billing', 'team', 'destinations', 'settings', 'audit', 'cloudwatch'].includes(props.tab)
    ? props.tab
    : 'billing';
  const [tab, setTab] = useState(initial);
  return (
    <>
      <PageHead title="Account" subtitle="Plan, people, destinations, and trust settings for this Cloud workspace." />
      <div className="pb-tabs">
        <button type="button" className={tab === 'billing' ? 'is-active' : ''} onClick={() => setTab('billing')}>Plan</button>
        <button type="button" className={tab === 'team' ? 'is-active' : ''} onClick={() => setTab('team')}>Team</button>
        <button type="button" className={tab === 'destinations' ? 'is-active' : ''} onClick={() => setTab('destinations')}>Destinations</button>
        <button type="button" className={tab === 'cloudwatch' ? 'is-active' : ''} onClick={() => setTab('cloudwatch')}>CloudWatch live</button>
        <button type="button" className={tab === 'audit' ? 'is-active' : ''} onClick={() => setTab('audit')}>CloudTrail live</button>
        <button type="button" className={tab === 'settings' ? 'is-active' : ''} onClick={() => setTab('settings')}>Settings</button>
      </div>
      {tab === 'billing' && <BillingPage {...props} embedded />}
      {tab === 'team' && <TeamPage {...props} embedded />}
      {tab === 'destinations' && <DestinationsPage {...props} embedded />}
      {tab === 'cloudwatch' && <CloudWatchLivePage {...props} embedded />}
      {tab === 'audit' && <CloudTrailLivePage {...props} embedded />}
      {tab === 'settings' && <SettingsPage {...props} embedded />}
    </>
  );
}

/* ─── PROJECTS (sources) ─── */
export function ProjectsPage({ state, navigate, toast, setState }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', ref: '', region: 'us-east-1', everyHours: 12 });

  const add = () => {
    if (!form.name.trim() || !/^[a-z0-9]{20}$/i.test(form.ref.trim())) {
      toast('Name and 20-char project ref required', 'danger');
      return;
    }
    setState(s => {
      s.projects.unshift({
        id: uid('proj'),
        ref: form.ref.trim().toLowerCase(),
        name: form.name.trim(),
        region: form.region,
        status: 'healthy',
        scheduleEveryHours: Number(form.everyHours) || 12,
        lastSuccessAt: null,
        lastFailureAt: null,
        rpoHours: null,
        rpoTargetHours: Number(form.everyHours) || 12,
        agentId: null,
        destinationIds: [],
        layers: { database: true, auth: true, storage: true, functions: true },
        createdAt: new Date().toISOString(),
      });
      s.onboarding.steps.project = true;
      s.events.unshift({ id: uid('evt'), type: 'project.created', projectRef: form.ref.trim().toLowerCase(), agentId: null, occurredAt: new Date().toISOString(), summary: `Project “${form.name.trim()}” added`, level: 'info' });
      return s;
    });
    setOpen(false);
    setForm({ name: '', ref: '', region: 'us-east-1', everyHours: 12 });
    toast('Project added', 'ok');
  };

  return (
    <>
      <PageHead
        title="Sources"
        subtitle="Supabase projects you protect. We only store labels and refs — never service keys."
        actions={<button type="button" className="pb-btn pb-btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Add source</button>}
      />
      <div className="pb-table-wrap">
        <table className="pb-table">
          <thead>
            <tr>
              <th>Project</th><th>Region</th><th>Schedule</th><th>RPO</th><th>Target</th><th>Agent</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {state.projects.map(p => {
              const agent = state.agents.find(a => a.id === p.agentId);
              const rs = rpoStatus(p);
              return (
                <tr key={p.id} className="row-link" onClick={() => navigate('project', { id: p.id })}>
                  <td><div className="pb-cell-main"><strong>{p.name}</strong><span className="mono">{p.ref}</span></div></td>
                  <td className="mono">{p.region}</td>
                  <td>every {p.scheduleEveryHours}h</td>
                  <td><Badge tone={rs.tone}>{p.rpoHours != null ? `${p.rpoHours}h` : '—'}</Badge></td>
                  <td className="mono">≤ {p.rpoTargetHours}h</td>
                  <td>{agent ? agent.name : <span className="pb-faint">Unassigned</span>}</td>
                  <td><Badge tone={p.status}>{p.status}</Badge></td>
                  <td><Icon name="chevron" size={14} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal
          title="Add monitored project"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="pb-btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="pb-btn pb-btn-primary" onClick={add}>Add project</button>
            </>
          }
        >
          <div className="pb-callout info">
            <Icon name="shield" size={16} />
            <div>
              <strong>Cloud never holds project secrets</strong>
              <p>Store the service role / DB URL only on your agent runner. This form is display metadata.</p>
            </div>
          </div>
          <div className="pb-field"><label>Display name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Primary app" /></div>
          <div className="pb-field"><label>Supabase project ref</label><input value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} placeholder="abcdefghijklmnopqrst" className="pb-mono" /><span className="pb-field-hint">20-character ref from the project URL</span></div>
          <div className="pb-field"><label>Region label</label>
            <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })}>
              {['us-east-1', 'us-west-1', 'eu-west-1', 'eu-central-1', 'ap-southeast-1'].map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="pb-field"><label>RPO target (hours)</label><input type="number" min={1} value={form.everyHours} onChange={e => setForm({ ...form, everyHours: e.target.value })} /></div>
        </Modal>
      )}
    </>
  );
}

export function ProjectDetailPage({ state, params, navigate, toast, setState }) {
  const project = state.projects.find(p => p.id === params.id);
  const [tab, setTab] = useState('overview');
  if (!project) {
    return <Empty title="Project not found" body="It may have been removed." action={<button type="button" className="pb-btn" onClick={() => navigate('projects')}>Back to projects</button>} />;
  }
  const agent = state.agents.find(a => a.id === project.agentId);
  const caps = state.capsules.filter(c => c.projectId === project.id || c.projectRef === project.ref);
  const dests = state.destinations.filter(d => project.destinationIds?.includes(d.id));
  const rs = rpoStatus(project);

  const remove = () => {
    if (!confirm(`Remove “${project.name}” from monitoring? Capsules on your destinations are not deleted.`)) return;
    setState(s => {
      s.projects = s.projects.filter(p => p.id !== project.id);
      return s;
    });
    toast('Project removed from Cloud', 'ok');
    navigate('projects');
  };

  return (
    <>
      <PageHead
        title={project.name}
        subtitle={<span className="pb-mono">{project.ref} · {project.region}</span>}
        actions={
          <>
            <button type="button" className="pb-btn" onClick={() => navigate('projects')}>All projects</button>
            <button type="button" className="pb-btn pb-btn-danger" onClick={remove}>Remove</button>
          </>
        }
      />
      <div className="pb-inline" style={{ marginBottom: 16, gap: 10 }}>
        <Badge tone={project.status}>{project.status}</Badge>
        <Badge tone={rs.tone}>{rs.label}</Badge>
        <span className="pb-muted">Last success {relativeTime(project.lastSuccessAt)}</span>
      </div>
      <div className="pb-tabs">
        {['overview', 'capsules', 'layers', 'settings'].map(t => (
          <button key={t} type="button" className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'overview' && (
        <div className="pb-grid pb-grid-3">
          <div className="pb-card"><div className="pb-kpi-label">RPO age</div><div className="pb-kpi-value">{project.rpoHours ?? '—'}{project.rpoHours != null && <span style={{ fontSize: 14 }}>h</span>}</div><div className="pb-kpi-meta">Target ≤ {project.rpoTargetHours}h</div></div>
          <div className="pb-card"><div className="pb-kpi-label">Agent</div><div className="pb-kpi-value" style={{ fontSize: 18 }}>{agent?.name || 'None'}</div><div className="pb-kpi-meta">{agent ? `${agent.status} · ${relativeTime(agent.lastSeenAt)}` : 'Assign under Agents'}</div></div>
          <div className="pb-card"><div className="pb-kpi-label">Destinations</div><div className="pb-kpi-value">{dests.length}</div><div className="pb-kpi-meta">{dests.map(d => d.kind).join(' · ') || 'None linked'}</div></div>
          <div className="pb-card" style={{ gridColumn: '1 / -1' }}>
            <div className="pb-card-head"><h3>Recent capsules</h3><button type="button" className="pb-btn pb-btn-sm pb-btn-ghost" onClick={() => navigate('capsules')}>All capsules</button></div>
            <CapsuleTable capsules={caps.slice(0, 5)} state={state} />
          </div>
        </div>
      )}
      {tab === 'capsules' && <CapsuleTable capsules={caps} state={state} />}
      {tab === 'layers' && (
        <div className="pb-grid pb-grid-2">
          {Object.entries(project.layers).map(([k, on]) => (
            <div className="pb-card" key={k}>
              <div className="pb-inline"><strong style={{ textTransform: 'capitalize' }}>{k}</strong><Badge tone={on ? 'ok' : 'warn'}>{on ? 'Captured' : 'Off'}</Badge></div>
              <p className="pb-muted" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
                {k === 'database' && 'Logical dump of schemas and data on the agent.'}
                {k === 'auth' && 'Auth users / identities metadata recoverable with the capsule.'}
                {k === 'storage' && 'Object bytes copied — not just Storage metadata.'}
                {k === 'functions' && 'Edge Function source and config snapshots.'}
              </p>
            </div>
          ))}
        </div>
      )}
      {tab === 'settings' && (
        <div className="pb-card" style={{ maxWidth: 520 }}>
          <div className="pb-field"><label>Display name</label><input defaultValue={project.name} onBlur={e => {
            const name = e.target.value.trim();
            if (!name) return;
            setState(s => { const p = s.projects.find(x => x.id === project.id); if (p) p.name = name; return s; });
            toast('Saved', 'ok');
          }} /></div>
          <div className="pb-field"><label>RPO target hours</label><input type="number" defaultValue={project.rpoTargetHours} onBlur={e => {
            setState(s => { const p = s.projects.find(x => x.id === project.id); if (p) { p.rpoTargetHours = Number(e.target.value) || 12; p.scheduleEveryHours = p.rpoTargetHours; } return s; });
            toast('RPO target updated', 'ok');
          }} /></div>
          <p className="pb-field-hint">Schedule cadence is enforced on the agent. Cloud only monitors whether heartbeats meet this target.</p>
        </div>
      )}
    </>
  );
}

function CapsuleTable({ capsules, state }) {
  return (
    <div className="pb-table-wrap">
      <table className="pb-table">
        <thead>
          <tr><th>Capsule</th><th>Status</th><th>Verified</th><th>Destination</th><th>Size</th><th>Duration</th><th>When</th></tr>
        </thead>
        <tbody>
          {capsules.length === 0 && <tr><td colSpan={7} className="pb-muted">No capsules reported yet.</td></tr>}
          {capsules.map(c => {
            const dest = state.destinations.find(d => d.id === c.destinationId);
            return (
              <tr key={c.id}>
                <td className="mono">{c.id}</td>
                <td><Badge tone={c.status}>{c.status}</Badge></td>
                <td><Badge tone={c.verified ? 'ok' : 'danger'}>{c.verified ? 'green' : 'failed'}</Badge></td>
                <td>{dest?.name || c.destinationKind}</td>
                <td className="mono">{formatBytes(c.sizeBytes)}</td>
                <td className="mono">{formatDuration(c.durationMs)}</td>
                <td className="mono">{relativeTime(c.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── AGENTS ─── */
export function AgentsPage({ state, toast, setState, embedded }) {
  const [open, setOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState(null);
  const [name, setName] = useState('');
  const slots = agentSlotsUsed(state.agents.length);

  const createAgent = () => {
    if (agentSlotsUsed(state.agents.length).atLimit) {
      toast(`Plan limit: ${CLOUD_MAX_AGENTS} agents on Cloud`, 'danger');
      return;
    }
    const token = `pb_live_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const id = uid('agent');
    setState(s => {
      if (s.agents.length >= CLOUD_MAX_AGENTS) return s;
      s.agents.unshift({
        id,
        name: name.trim() || `agent-${s.agents.length + 1}`,
        hostname: '—',
        status: 'offline',
        version: '—',
        projectId: null,
        lastSeenAt: null,
        tokenPrefix: token.slice(0, 12),
        tokenHint: `••••••••${token.slice(-4)}`,
        os: 'unknown',
        createdAt: new Date().toISOString(),
      });
      s.onboarding.steps.agent = true;
      return s;
    });
    setCreatedToken(token);
    setName('');
    toast('Agent token created — copy it now', 'ok');
  };

  const body = (
    <>
      <div className="pb-inline" style={{ marginBottom: 12 }}>
        <Badge tone={slots.atLimit ? 'warn' : 'acid'}>{slots.used} / {slots.max} agents</Badge>
        <span className="pb-muted" style={{ fontSize: 12.5 }}>Cloud · up to {CLOUD_MAX_AGENTS} agents · $17 or $27/mo</span>
        <button
          type="button"
          className="pb-btn pb-btn-primary pb-right"
          disabled={slots.atLimit}
          onClick={() => {
            if (slots.atLimit) return toast(`Plan limit: ${CLOUD_MAX_AGENTS} agents`, 'danger');
            setOpen(true);
            setCreatedToken(null);
          }}
        >
          <Icon name="plus" size={14} /> New agent token
        </button>
      </div>
      {slots.atLimit && (
        <div className="pb-callout warn" style={{ marginBottom: 12 }}>
          <Icon name="warn" size={16} />
          <div>
            <strong>Agent limit reached</strong>
            <p>Cloud includes up to {CLOUD_MAX_AGENTS} agents. Revoke an unused agent or contact escape@portabase.dev for a higher tier.</p>
          </div>
        </div>
      )}
      <div className="pb-table-wrap">
        <table className="pb-table">
          <thead><tr><th>Agent</th><th>Status</th><th>Version</th><th>Host</th><th>Token</th><th>Last seen</th><th>Project</th></tr></thead>
          <tbody>
            {state.agents.map(a => {
              const proj = state.projects.find(p => p.id === a.projectId);
              return (
                <tr key={a.id}>
                  <td><strong>{a.name}</strong></td>
                  <td><Badge tone={a.status}>{a.status}</Badge></td>
                  <td className="mono">{a.version}</td>
                  <td className="mono">{a.hostname}</td>
                  <td className="mono">{a.tokenPrefix}…{a.tokenHint?.replace(/•/g, '')}</td>
                  <td className="mono">{relativeTime(a.lastSeenAt)}</td>
                  <td>{proj?.name || <span className="pb-faint">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal
          title="Create agent token"
          onClose={() => setOpen(false)}
          footer={!createdToken ? (
            <>
              <button type="button" className="pb-btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="pb-btn pb-btn-primary" onClick={createAgent}>Generate token</button>
            </>
          ) : (
            <button type="button" className="pb-btn pb-btn-primary" onClick={() => setOpen(false)}>Done</button>
          )}
        >
          {!createdToken ? (
            <>
              <div className="pb-field"><label>Agent name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="escape-runner-2" /></div>
              <p className="pb-field-hint">Install on the runner with PORTABASE_CLOUD_TOKEN. Telemetry stays opt-in and allowlisted.</p>
            </>
          ) : (
            <>
              <div className="pb-callout warn">
                <Icon name="key" size={16} />
                <div><strong>Shown once</strong><p>Store this token in your runner secret store. Cloud only keeps a hash/prefix.</p></div>
              </div>
              <div className="pb-code">{createdToken}</div>
              <button type="button" className="pb-btn" style={{ marginTop: 12 }} onClick={() => copyText(createdToken, toast)}><Icon name="copy" size={14} /> Copy token</button>
              <div className="pb-code" style={{ marginTop: 14 }}>{`# on the runner
export PORTABASE_CLOUD_ENABLED=1
export PORTABASE_CLOUD_TOKEN=${createdToken.slice(0, 16)}…
export PORTABASE_CLOUD_ENDPOINT=https://portabase.dev/api/cloud/telemetry`}</div>
            </>
          )}
        </Modal>
      )}
    </>
  );
  if (embedded) return body;
  return (
    <>
      <PageHead title="Agents" subtitle="Tokens identify the runner — never Supabase credentials." />
      {body}
    </>
  );
}

/* ─── CAPSULES ─── */
export function CapsulesPage({ state, embedded }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const list = useMemo(() => state.capsules.filter(c => {
    if (status !== 'all' && c.status !== status) return false;
    if (q && !`${c.id} ${c.projectRef} ${c.destinationKind}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [state.capsules, q, status]);

  const body = (
    <>
      <div className="pb-inline" style={{ marginBottom: 14 }}>
        <div className="pb-search" style={{ minWidth: 220 }}><Icon name="search" size={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" /></div>
        <select className="pb-btn" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="COMPLETE">COMPLETE</option>
          <option value="FAILED">FAILED</option>
        </select>
      </div>
      <CapsuleTable capsules={list} state={state} />
    </>
  );
  if (embedded) return body;
  return (
    <>
      <PageHead title="Capsules" subtitle="Encrypted recovery artifacts. Bytes stay on your destinations." />
      {body}
    </>
  );
}

/* ─── SCHEDULES ─── */
export function SchedulesPage({ state, setState, toast, embedded }) {
  const table = (
      <div className="pb-table-wrap">
        <table className="pb-table">
          <thead><tr><th>Project</th><th>Every</th><th>Timezone</th><th>Enabled</th><th>Last run</th><th>Next expected</th><th /></tr></thead>
          <tbody>
            {state.schedules.map(sch => {
              const p = state.projects.find(x => x.id === sch.projectId);
              return (
                <tr key={sch.id}>
                  <td><strong>{p?.name || '—'}</strong></td>
                  <td className="mono">{sch.everyHours}h</td>
                  <td className="mono">{sch.timezone}</td>
                  <td>
                    <button type="button" className="pb-btn pb-btn-sm" onClick={() => {
                      setState(s => { const x = s.schedules.find(y => y.id === sch.id); if (x) x.enabled = !x.enabled; return s; });
                      toast(sch.enabled ? 'Schedule paused' : 'Schedule enabled', 'ok');
                    }}>{sch.enabled ? 'On' : 'Off'}</button>
                  </td>
                  <td className="mono">{relativeTime(sch.lastRunAt)}</td>
                  <td className="mono">{relativeTime(sch.nextRunAt)}</td>
                  <td><Badge tone={sch.enabled ? 'ok' : 'warn'}>{sch.enabled ? 'armed' : 'paused'}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
  );
  if (embedded) return table;
  return (
    <>
      <PageHead title="Schedule" subtitle="Expected escape cadence. Misses fire alert chains." />
      {table}
    </>
  );
}

/* ─── DESTINATIONS ─── */
export function DestinationsPage({ state, setState, toast, embedded }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'local', path: './portabase-capsules/vault' });
  const add = () => {
    if (!form.name.trim()) return toast('Name required', 'danger');
    setState(s => {
      s.destinations.push({ id: uid('dest'), name: form.name.trim(), kind: form.kind, status: 'idle', path: form.path || form.kind, lastWriteAt: null, createdAt: new Date().toISOString() });
      s.onboarding.steps.destination = true;
      return s;
    });
    setOpen(false);
    setForm({ name: '', kind: 'local', path: './portabase-capsules/vault' });
    toast(form.kind === 'local' ? 'Local Starter label saved · wire folder on agent (≤100 MB)' : 'Destination registered (credentials stay on agent)', 'ok');
  };
  const body = (
    <>
      <div className="pb-callout warn" style={{ marginBottom: 12 }}>
        <Icon name="shield" size={16} />
        <div>
          <strong>Required: your binary storage</strong>
          <p>Cloud does not host capsules. Prefer <strong>S3</strong> or <strong>Dropbox</strong>. No third-party vault yet? Use <strong>Local Starter</strong> — encrypted capsules on the agent machine (or USB/NAS path) while each capsule stays ≤ <strong>100 MB</strong>. Same-disk is not full Escape if the laptop dies.</p>
        </div>
      </div>
      <div className="pb-callout" style={{ marginBottom: 12 }}>
        <Icon name="folder" size={16} />
        <div>
          <strong>Local Starter (≤100 MB)</strong>
          <p className="pb-muted" style={{ margin: '6px 0 0' }}>On the runner: <code className="pb-mono">provider.type = &quot;local&quot;</code> and a folder path. Engine refuses oversized capsules unless you set <code className="pb-mono">allowLargeLocal</code>. Passphrase still never leaves the runner.</p>
        </div>
      </div>
      <div className="pb-inline" style={{ marginBottom: 12 }}>
        <button type="button" className="pb-btn pb-btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Add your storage</button>
      </div>
      <div className="pb-grid pb-grid-3">
        {state.destinations.map(d => (
          <div className="pb-card" key={d.id}>
            <div className="pb-inline"><Badge tone={d.status === 'ok' ? 'ok' : 'info'}>{d.kind}</Badge><Badge tone={d.status}>{d.status}</Badge></div>
            <h3 style={{ margin: '12px 0 6px', fontSize: 15 }}>{d.name}</h3>
            <div className="pb-mono pb-muted">{d.path}</div>
            <div className="pb-faint" style={{ marginTop: 10, fontSize: 12 }}>Last write {relativeTime(d.lastWriteAt)}</div>
          </div>
        ))}
      </div>
      {open && (
        <Modal title="Your binary storage" onClose={() => setOpen(false)} footer={<><button type="button" className="pb-btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="pb-btn pb-btn-primary" onClick={add}>Save label</button></>}>
          <p className="pb-field-hint" style={{ marginBottom: 12 }}>This registers a destination label for the console. Wire real credentials on the runner (rclone / env) — never upload keys here.</p>
          <div className="pb-field"><label>Name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="prod-s3-vault" /></div>
          <div className="pb-field"><label>Kind</label>
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
              <option value="local">local · Starter ≤100 MB (this PC / USB / NAS)</option>
              <option value="s3">s3 · Amazon S3</option>
              <option value="dropbox">dropbox</option>
              <option value="gdrive">gdrive · coming soon</option>
              <option value="nas">nas</option>
            </select>
          </div>
          <div className="pb-field"><label>Path label</label><input value={form.path} onChange={e => setForm({ ...form, path: e.target.value })} placeholder={form.kind === 'local' ? './portabase-capsules/vault' : 's3://bucket/prefix'} className="pb-mono" /></div>
          {form.kind === 'local' && (
            <p className="pb-field-hint">Local Starter: agent enforces ≤100 MB per capsule. Prefer S3/Dropbox for production Escape.</p>
          )}
        </Modal>
      )}
    </>
  );
  if (embedded) return body;
  return (
    <>
      <PageHead title="Capsule storage (yours)" subtitle="Required. Cloud does not include object storage — you bring the bucket, drive, or Local Starter folder." />
      {body}
    </>
  );
}

/* ─── REPLAY (validate capsule → new Supabase account/project) ─── */
const REPLAY_STEPS = [
  { id: 'select', label: 'Select verified capsule' },
  { id: 'decrypt', label: 'Decrypt & authenticate bundle' },
  { id: 'guard', label: 'Refuse if target is the source' },
  { id: 'preflight', label: 'Blank-target preflight (new account)' },
  { id: 'restore', label: 'Restore DB · Auth · Storage · Functions' },
  { id: 'proof', label: 'Read-back proof & evidence' },
];

function buildReplayCli({ capsulePath, targetRef }) {
  return `# On your runner (secrets never go to Portabase Cloud)
export PORTABASE_ENCRYPTION_PASSPHRASE='…'          # local only
export PORTABASE_TARGET_PROJECT_REF='${targetRef}'
export PORTABASE_TARGET_SUPABASE_URL='https://${targetRef}.supabase.co'
export PORTABASE_TARGET_SERVICE_ROLE_KEY='…'         # NEW project only
export PORTABASE_TARGET_DB_URL='postgresql://…'      # NEW project only
export SUPABASE_ACCESS_TOKEN='…'                     # deploy Functions to target

# 1) Optional dry preflight (no writes)
portabase replay --capsule ${capsulePath || './portabase-capsules/<id>'} --confirm-target ${targetRef} --preflight

# 2) Full validation — restores into the NEW project
portabase replay --capsule ${capsulePath || './portabase-capsules/<id>'} --confirm-target ${targetRef}
`;
}

export function RestoresPage({ state, setState, toast }) {
  const verifiedCaps = state.capsules.filter(c => c.status === 'COMPLETE');
  const [wizard, setWizard] = useState(false);
  const [capsuleId, setCapsuleId] = useState(verifiedCaps.find(c => c.verified)?.id || verifiedCaps[0]?.id || '');
  const [targetRef, setTargetRef] = useState('');
  const [confirmRef, setConfirmRef] = useState('');
  const [ackBlank, setAckBlank] = useState(false);
  const [ackNotSource, setAckNotSource] = useState(false);
  const [runningId, setRunningId] = useState(null);
  const [selectedHistory, setSelectedHistory] = useState(null);

  const capsule = state.capsules.find(c => c.id === capsuleId);
  const sourceRef = capsule?.projectRef || state.projects[0]?.ref || '';
  const targetOk = /^[a-z0-9]{20}$/i.test(targetRef.trim());
  const confirmOk = confirmRef.trim() === targetRef.trim() && targetOk;
  const notSource = targetRef.trim().toLowerCase() !== sourceRef.toLowerCase();
  const canStart = capsule && confirmOk && notSource && ackBlank && ackNotSource;

  const openWizard = () => {
    setWizard(true);
    setTargetRef('');
    setConfirmRef('');
    setAckBlank(false);
    setAckNotSource(false);
    setCapsuleId(verifiedCaps.find(c => c.verified)?.id || verifiedCaps[0]?.id || '');
  };

  const startReplay = () => {
    if (!canStart) {
      toast('Complete all guards: capsule, matching new ref, not source, blank ack', 'danger');
      return;
    }
    const id = uid('rpl');
    const startedAt = new Date().toISOString();
    const steps = REPLAY_STEPS.map(s => ({ ...s, status: 'pending', detail: '' }));
    const record = {
      id,
      kind: 'replay',
      projectId: state.projects.find(p => p.ref === sourceRef)?.id || null,
      sourceRef,
      mode: 'replay',
      status: 'running',
      evidenceStatus: null,
      targetRef: targetRef.trim().toLowerCase(),
      startedAt,
      finishedAt: null,
      durationMs: null,
      capsuleId: capsule.id,
      steps,
      cli: buildReplayCli({ targetRef: targetRef.trim().toLowerCase() }),
    };
    setState(s => {
      s.restores.unshift(record);
      s.onboarding.steps.drill = true;
      s.events.unshift({
        id: uid('evt'),
        type: 'restore.started',
        projectRef: sourceRef,
        agentId: null,
        occurredAt: startedAt,
        summary: `Replay started → ${record.targetRef}`,
        level: 'info',
      });
      return s;
    });
    setRunningId(id);
    setWizard(false);
    setSelectedHistory(id);
    toast('Replay running — validating into new project', 'ok');

    // Simulate agent-side pipeline (Cloud only tracks; real work is CLI/agent)
    let stepIndex = 0;
    const details = {
      select: `Capsule ${capsule.id.slice(0, 12)}… · ${capsule.verified ? 'verify green' : 'unverified'}`,
      decrypt: 'AES-256-GCM auth + checksums OK',
      guard: `${record.targetRef} ≠ ${sourceRef}`,
      preflight: 'applicationTables=0 authUsers=0 storageBuckets=0 edgeFunctions=0',
      restore: 'Layers written to blank target',
      proof: 'Read-back inventory matches capsule layers',
    };
    const tick = () => {
      stepIndex += 1;
      setState(s => {
        const r = s.restores.find(x => x.id === id);
        if (!r || r.status !== 'running') return s;
        for (let i = 0; i < stepIndex && i < r.steps.length; i += 1) {
          r.steps[i].status = 'ok';
          r.steps[i].detail = details[r.steps[i].id] || 'OK';
        }
        if (stepIndex >= REPLAY_STEPS.length) {
          const finishedAt = new Date().toISOString();
          r.status = 'passed';
          r.evidenceStatus = capsule.verified ? 'RECOVERY_DATA_PATH_VERIFIED' : 'PARTIAL_OK';
          r.finishedAt = finishedAt;
          r.durationMs = new Date(finishedAt) - new Date(r.startedAt);
          s.events.unshift({
            id: uid('evt'),
            type: 'restore.completed',
            projectRef: sourceRef,
            agentId: null,
            occurredAt: finishedAt,
            summary: `Replay passed → ${record.targetRef}`,
            level: 'ok',
          });
        }
        return s;
      });
      if (stepIndex < REPLAY_STEPS.length) {
        setTimeout(tick, 700);
      } else {
        setRunningId(null);
        toast('Replay passed — capsule validated on new account', 'ok');
      }
    };
    setTimeout(tick, 500);
  };

  const history = [...state.restores].sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  const active = history.find(r => r.id === (selectedHistory || runningId)) || history[0];

  return (
    <>
      <PageHead
        title="Replay"
        subtitle="Validate a recovery bundle by restoring it into a brand-new Supabase project (new account is fine). Source is never written."
        actions={<button type="button" className="pb-btn pb-btn-primary" onClick={openWizard}><Icon name="restore" size={14} /> New replay</button>}
      />

      <div className="pb-callout info">
        <Icon name="shield" size={16} />
        <div>
          <strong>What Replay proves</strong>
          <p>
            Decrypt + integrity of the capsule, then a full write into a <em>blank</em> target ref that is not the source.
            That is the only honest “this capsule restores” test. Cloud tracks the run; the agent/CLI holds target credentials.
          </p>
        </div>
      </div>

      <div className="pb-split">
        <div className="pb-stack">
          <div className="pb-card">
            <div className="pb-card-head"><h3>Replay history</h3><span>{history.length} runs</span></div>
            <div className="pb-table-wrap" style={{ border: 0 }}>
              <table className="pb-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr><th>When</th><th>Source → target</th><th>Status</th><th>Evidence</th></tr>
                </thead>
                <tbody>
                  {history.length === 0 && (
                    <tr><td colSpan={4} className="pb-muted">No replays yet. Start one to validate a capsule against a new project.</td></tr>
                  )}
                  {history.map(r => (
                    <tr key={r.id} className="row-link" onClick={() => setSelectedHistory(r.id)}>
                      <td className="mono">{relativeTime(r.startedAt)}</td>
                      <td>
                        <div className="pb-cell-main">
                          <strong className="mono" style={{ fontSize: 12 }}>{r.sourceRef || '—'} → {r.targetRef || '—'}</strong>
                          <span className="mono">{r.mode || r.kind || 'replay'}</span>
                        </div>
                      </td>
                      <td><Badge tone={r.status}>{r.status}</Badge></td>
                      <td className="mono" style={{ fontSize: 11 }}>{r.evidenceStatus || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pb-card">
            <div className="pb-card-head"><h3>Agent command</h3><span>runner-side</span></div>
            <p className="pb-muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 12.5 }}>
              Real validation runs on infrastructure you control. Paste target secrets only into the runner env.
            </p>
            <div className="pb-code">{buildReplayCli({
              targetRef: active?.targetRef || 'YOUR_NEW_PROJECT_REF',
              capsulePath: active?.capsuleId ? `./portabase-capsules/${active.capsuleId}` : undefined,
            })}</div>
            <button
              type="button"
              className="pb-btn pb-btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => copyText(buildReplayCli({
                targetRef: active?.targetRef || 'YOUR_NEW_PROJECT_REF',
                capsulePath: active?.capsuleId ? `./portabase-capsules/${active.capsuleId}` : undefined,
              }), toast)}
            >
              <Icon name="copy" size={14} /> Copy CLI
            </button>
          </div>
        </div>

        <div className="pb-card">
          <div className="pb-card-head">
            <h3>{active ? 'Run detail' : 'No run selected'}</h3>
            {active && <Badge tone={active.status}>{active.status}</Badge>}
          </div>
          {!active && <p className="pb-muted">Start a replay to see step-by-step validation.</p>}
          {active && (
            <>
              <dl className="pb-stack" style={{ marginBottom: 14, fontSize: 12.5 }}>
                <div className="pb-inline"><span className="pb-faint">Source</span><span className="pb-mono pb-right">{active.sourceRef || '—'}</span></div>
                <div className="pb-inline"><span className="pb-faint">New target</span><span className="pb-mono pb-right">{active.targetRef || '—'}</span></div>
                <div className="pb-inline"><span className="pb-faint">Capsule</span><span className="pb-mono pb-right">{active.capsuleId}</span></div>
                <div className="pb-inline"><span className="pb-faint">Evidence</span><span className="pb-mono pb-right">{active.evidenceStatus || '—'}</span></div>
                <div className="pb-inline"><span className="pb-faint">Duration</span><span className="pb-mono pb-right">{formatDuration(active.durationMs)}</span></div>
              </dl>
              <div className="pb-timeline">
                {(active.steps?.length ? active.steps : REPLAY_STEPS.map(s => ({ ...s, status: active.status === 'passed' ? 'ok' : 'pending', detail: '' }))).map(step => (
                  <div className="pb-timeline-item" key={step.id}>
                    <div className={`pb-timeline-dot ${step.status === 'ok' ? 'ok' : step.status === 'failed' ? 'error' : 'info'}`} />
                    <div>
                      <strong style={{ fontSize: 13 }}>{step.label}</strong>
                      {step.detail && <div className="pb-faint" style={{ fontSize: 11.5, marginTop: 2 }}>{step.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {wizard && (
        <Modal
          title="New replay — validate on a new account"
          large
          onClose={() => setWizard(false)}
          footer={
            <>
              <button type="button" className="pb-btn" onClick={() => setWizard(false)}>Cancel</button>
              <button type="button" className="pb-btn pb-btn-primary" disabled={!canStart} onClick={startReplay}>
                Start replay validation
              </button>
            </>
          }
        >
          <div className="pb-callout warn">
            <Icon name="warn" size={16} />
            <div>
              <strong>Create a fresh Supabase project first</strong>
              <p>New org/account is fine. Target must be empty. Never enter production source credentials as the target.</p>
            </div>
          </div>

          <div className="pb-field">
            <label>Capsule to validate</label>
            <select value={capsuleId} onChange={e => setCapsuleId(e.target.value)}>
              {verifiedCaps.length === 0 && <option value="">No COMPLETE capsules</option>}
              {verifiedCaps.map(c => (
                <option key={c.id} value={c.id}>
                  {c.id.slice(0, 18)}… · {c.projectRef} · {c.verified ? 'verified' : 'unverified'} · {relativeTime(c.createdAt)}
                </option>
              ))}
            </select>
            {capsule && (
              <span className="pb-field-hint">Source project ref: <span className="pb-mono">{capsule.projectRef}</span> — target must differ</span>
            )}
          </div>

          <div className="pb-field">
            <label>New project ref (target account)</label>
            <input
              className="pb-mono"
              value={targetRef}
              onChange={e => setTargetRef(e.target.value.trim())}
              placeholder="20-char ref of the NEW project"
              autoComplete="off"
            />
            {targetRef && !targetOk && <span className="pb-field-hint" style={{ color: 'var(--c-danger)' }}>Expected a 20-character Supabase project ref</span>}
            {targetOk && !notSource && <span className="pb-field-hint" style={{ color: 'var(--c-danger)' }}>Target cannot equal the source project</span>}
          </div>

          <div className="pb-field">
            <label>Type the new ref again to confirm</label>
            <input
              className="pb-mono"
              value={confirmRef}
              onChange={e => setConfirmRef(e.target.value.trim())}
              placeholder="Must match exactly"
              autoComplete="off"
            />
            {confirmRef && !confirmOk && <span className="pb-field-hint" style={{ color: 'var(--c-danger)' }}>Confirmation does not match</span>}
          </div>

          <label className="pb-check">
            <input type="checkbox" checked={ackNotSource} onChange={e => setAckNotSource(e.target.checked)} />
            <span>I confirm this target is <strong>not</strong> the production/source project ({sourceRef || 'source'}).</span>
          </label>
          <label className="pb-check">
            <input type="checkbox" checked={ackBlank} onChange={e => setAckBlank(e.target.checked)} />
            <span>I confirm the target is a <strong>blank</strong> new project (no app tables, Auth users, Storage, or Functions).</span>
          </label>

          <p className="pb-field-hint" style={{ marginTop: 12 }}>
            Target service role / DB URL stay on the agent. Portabase Cloud only records source ref, target ref, capsule id, and step status.
          </p>
        </Modal>
      )}
    </>
  );
}

/* ─── ALERTS ─── */
export function AlertsPage({ state, setState, toast, forcedTab, embedded }) {
  const [tab, setTab] = useState(forcedTab || 'sms');
  const active = forcedTab || tab;
  const sms = state.sms || { onFailure: true, onSuccess: true, numbers: [], recent: [] };
  const [newPhone, setNewPhone] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const setSms = (patch) => {
    setState(s => {
      s.sms = { ...(s.sms || {}), ...patch };
      return s;
    });
  };

  const addNumber = () => {
    const e164 = newPhone.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(e164)) {
      toast('Use E.164 format, e.g. +15551234567', 'danger');
      return;
    }
    setState(s => {
      s.sms = s.sms || { numbers: [], recent: [], onFailure: true, onSuccess: true };
      s.sms.numbers = s.sms.numbers || [];
      s.sms.numbers.push({
        id: uid('sms'),
        e164,
        label: newLabel.trim() || 'Mobile',
        verified: false,
        enabled: true,
      });
      return s;
    });
    setNewPhone('');
    setNewLabel('');
    toast('Number added — verify before live alerts', 'ok');
  };

  const inner = (
    <>
      {!embedded && (
        <div className="pb-tabs">
          <button type="button" className={active === 'sms' ? 'is-active' : ''} onClick={() => setTab('sms')}>SMS texts</button>
          <button type="button" className={active === 'policies' ? 'is-active' : ''} onClick={() => setTab('policies')}>Escalation</button>
          <button type="button" className={active === 'channels' ? 'is-active' : ''} onClick={() => setTab('channels')}>Channels</button>
        </div>
      )}

      {active === 'sms' && (
        <div className="pb-stack" style={{ gap: 14 }}>
          <div className="pb-callout info">
            <Icon name="bell" size={16} />
            <div>
              <strong>Automatic SMS at run time</strong>
              <p>
                When a managed escape finishes, enabled numbers get a short text for <strong>success</strong> and/or <strong>failure</strong>.
                Also useful: quiet hours (success only), verified numbers only, and delivery history.
              </p>
            </div>
          </div>
          <div className="pb-grid pb-grid-2">
            <div className="pb-card">
              <h3 style={{ marginTop: 0 }}>When to text</h3>
              <label className="pb-check">
                <input type="checkbox" checked={!!sms.onFailure} onChange={e => { setSms({ onFailure: e.target.checked }); toast('Saved', 'ok'); }} />
                <span>On failure (recommended — always leave on)</span>
              </label>
              <label className="pb-check">
                <input type="checkbox" checked={!!sms.onSuccess} onChange={e => { setSms({ onSuccess: e.target.checked }); toast('Saved', 'ok'); }} />
                <span>On success (confirm the run completed)</span>
              </label>
              <label className="pb-check">
                <input type="checkbox" checked={!!sms.quietHoursEnabled} onChange={e => { setSms({ quietHoursEnabled: e.target.checked }); toast('Saved', 'ok'); }} />
                <span>Quiet hours suppress <em>success</em> only (failures still send)</span>
              </label>
              {sms.quietHoursEnabled && (
                <div className="pb-inline" style={{ marginTop: 10, gap: 10 }}>
                  <div className="pb-field" style={{ margin: 0 }}><label>From</label>
                    <input value={sms.quietStart || '22:00'} onChange={e => setSms({ quietStart: e.target.value })} />
                  </div>
                  <div className="pb-field" style={{ margin: 0 }}><label>To</label>
                    <input value={sms.quietEnd || '07:00'} onChange={e => setSms({ quietEnd: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
            <div className="pb-card">
              <h3 style={{ marginTop: 0 }}>Add number</h3>
              <div className="pb-field"><label>Mobile (E.164)</label>
                <input className="pb-mono" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="+15551234567" />
              </div>
              <div className="pb-field"><label>Label</label>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="On-call" />
              </div>
              <button type="button" className="pb-btn pb-btn-primary" onClick={addNumber}>Add number</button>
              <p className="pb-field-hint" style={{ marginTop: 10 }}>Verify before live traffic. STOP handling and carrier compliance apply in production.</p>
            </div>
          </div>

          <div className="pb-table-wrap">
            <table className="pb-table">
              <thead>
                <tr><th>Label</th><th>Number</th><th>Verified</th><th>Enabled</th><th /></tr>
              </thead>
              <tbody>
                {(sms.numbers || []).length === 0 && (
                  <tr><td colSpan={5} className="pb-muted">No numbers yet — add one above.</td></tr>
                )}
                {(sms.numbers || []).map(n => (
                  <tr key={n.id}>
                    <td><strong>{n.label}</strong></td>
                    <td className="mono">{n.e164}</td>
                    <td><Badge tone={n.verified ? 'ok' : 'warn'}>{n.verified ? 'verified' : 'pending'}</Badge></td>
                    <td>
                      <button type="button" className="pb-btn pb-btn-sm" onClick={() => {
                        setState(s => {
                          const x = (s.sms?.numbers || []).find(y => y.id === n.id);
                          if (x) x.enabled = !x.enabled;
                          return s;
                        });
                      }}>{n.enabled ? 'On' : 'Off'}</button>
                    </td>
                    <td className="pb-inline" style={{ gap: 6 }}>
                      {!n.verified && (
                        <button type="button" className="pb-btn pb-btn-sm" onClick={() => {
                          setState(s => {
                            const x = (s.sms?.numbers || []).find(y => y.id === n.id);
                            if (x) x.verified = true;
                            return s;
                          });
                          toast('Marked verified (demo)', 'ok');
                        }}>Verify</button>
                      )}
                      <button type="button" className="pb-btn pb-btn-sm" onClick={() => {
                        toast(`Test SMS queued to ${n.e164} (demo)`, 'ok');
                        setState(s => {
                          s.sms = s.sms || { recent: [] };
                          s.sms.recent = s.sms.recent || [];
                          s.sms.recent.unshift({
                            id: uid('dlv'),
                            at: new Date().toISOString(),
                            event: 'sms.test',
                            to: n.e164,
                            status: 'sent',
                            body: 'Portabase test · SMS channel OK',
                          });
                          return s;
                        });
                      }}>Test</button>
                      <button type="button" className="pb-btn pb-btn-sm pb-btn-danger" onClick={() => {
                        setState(s => {
                          s.sms.numbers = (s.sms.numbers || []).filter(x => x.id !== n.id);
                          return s;
                        });
                        toast('Number removed', 'ok');
                      }}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pb-card">
            <h3 style={{ marginTop: 0 }}>Recent deliveries</h3>
            <div className="pb-timeline">
              {(sms.recent || []).slice(0, 12).map(d => (
                <div className="pb-timeline-item" key={d.id}>
                  <div className={`pb-timeline-dot ${d.status === 'sent' ? 'ok' : d.status === 'failed' ? 'error' : 'info'}`} />
                  <div>
                    <div className="pb-inline">
                      <strong>{d.event}</strong>
                      <Badge tone={d.status === 'sent' ? 'ok' : 'warn'}>{d.status}</Badge>
                      <span className="pb-faint pb-mono">{relativeTime(d.at)}</span>
                    </div>
                    <div className="pb-faint" style={{ marginTop: 4, fontSize: 12 }}>{d.to} · {d.body}</div>
                  </div>
                </div>
              ))}
              {!(sms.recent || []).length && <p className="pb-muted">No SMS deliveries yet.</p>}
            </div>
          </div>
        </div>
      )}

      {active === 'policies' && state.alertPolicies.map(pol => (
        <div className="pb-card" key={pol.id} style={{ marginBottom: 12 }}>
          <div className="pb-card-head">
            <h3>{pol.name}</h3>
            <button type="button" className="pb-btn pb-btn-sm" onClick={() => {
              setState(s => { const p = s.alertPolicies.find(x => x.id === pol.id); if (p) p.enabled = !p.enabled; return s; });
              setState(s => { s.onboarding.steps.alert = true; return s; });
              toast(pol.enabled ? 'Policy disabled' : 'Policy enabled', 'ok');
            }}>{pol.enabled ? 'Enabled' : 'Disabled'}</button>
          </div>
          <div className="pb-inline" style={{ marginBottom: 12 }}>{pol.eventTypes.map(t => <Badge key={t} tone="info">{t}</Badge>)}</div>
          <div className="pb-stack">
            {pol.steps.map(st => (
              <div key={st.order} className="pb-inline" style={{ padding: '8px 10px', background: 'var(--c-bg)', borderRadius: 6, border: '1px solid var(--c-border)' }}>
                <Badge tone="acid">Step {st.order}</Badge>
                <span>after {st.delaySeconds === 0 ? 'immediate' : `${st.delaySeconds / 60}m`}</span>
                <strong>→ {st.channelLabel}</strong>
              </div>
            ))}
          </div>
        </div>
      ))}
      {active === 'channels' && (
        <div className="pb-grid pb-grid-2">
          {state.alertChannels.map(ch => (
            <div className="pb-card" key={ch.id}>
              <div className="pb-inline"><Badge tone="info">{ch.kind}</Badge><Badge tone={ch.enabled ? 'ok' : 'warn'}>{ch.enabled ? 'on' : 'off'}</Badge></div>
              <h3 style={{ margin: '10px 0 6px' }}>{ch.label}</h3>
              <div className="pb-mono pb-muted">{Object.values(ch.config).join(' · ')}</div>
              <button type="button" className="pb-btn pb-btn-sm" style={{ marginTop: 12 }} onClick={() => {
                setState(s => { const c = s.alertChannels.find(x => x.id === ch.id); if (c) c.enabled = !c.enabled; return s; });
              }}>{ch.enabled ? 'Disable' : 'Enable'}</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
  if (embedded) return inner;
  return (
    <>
      <PageHead title="Alerts" subtitle="SMS on success, failure, and every source-key access · escalation chains · channels." />
      {inner}
    </>
  );
}

export function ActivityPage({ state, embedded }) {
  const events = [...state.events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  const feed = (
      <div className="pb-card">
        <div className="pb-timeline">
          {events.map(e => (
            <div className="pb-timeline-item" key={e.id}>
              <div className={`pb-timeline-dot ${e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : e.level === 'ok' ? 'ok' : 'info'}`} />
              <div>
                <div className="pb-inline"><strong>{e.summary}</strong><span className="pb-faint pb-mono">{relativeTime(e.occurredAt)}</span></div>
                <div className="pb-faint" style={{ marginTop: 4, fontSize: 12 }}>
                  {e.projectRef || 'workspace'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
  );
  if (embedded) return feed;
  return (
    <>
      <PageHead title="Events" subtitle="Allowlisted health events only." />
      {feed}
    </>
  );
}

export function RunnersPage({ state, setState, toast, embedded }) {
  const grid = (
      <div className="pb-grid pb-grid-2">
        {state.runners.map(r => {
          const p = state.projects.find(x => x.id === r.projectId);
          return (
            <div className="pb-card" key={r.id}>
              <div className="pb-inline"><Badge tone={r.status}>{r.status}</Badge><Badge tone="acid">{r.isolation}</Badge></div>
              <h3 style={{ margin: '12px 0 6px' }}>{r.name}</h3>
              <div className="pb-muted">Source · {p?.name || '—'}</div>
              <div className="pb-mono pb-faint" style={{ marginTop: 8 }}>{r.ecsService || 'No service'}</div>
              {r.lastError && <div className="pb-callout warn" style={{ marginTop: 12 }}><div><p>{r.lastError}</p></div></div>}
              <div className="pb-inline" style={{ marginTop: 14 }}>
                <button type="button" className="pb-btn pb-btn-sm" onClick={() => {
                  setState(s => { const x = s.runners.find(y => y.id === r.id); if (x) { x.status = x.status === 'running' ? 'stopped' : 'running'; x.updatedAt = new Date().toISOString(); x.lastError = null; } return s; });
                  toast('Runner state updated', 'ok');
                }}>{r.status === 'running' ? 'Stop' : 'Start'}</button>
                <span className="pb-faint pb-mono">{relativeTime(r.updatedAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
  );
  if (embedded) return grid;
  return (
    <>
      <PageHead title="Managed runners" subtitle="Optional hosted compute. Default is your agent." />
      {grid}
    </>
  );
}

/* ─── TEAM ─── */
export function TeamPage({ state, setState, toast, embedded }) {
  const [email, setEmail] = useState('');
  const invite = () => {
    if (!email.includes('@')) return toast('Valid email required', 'danger');
    setState(s => {
      s.members.push({ id: uid('user'), email: email.trim().toLowerCase(), name: email.split('@')[0], role: 'member', lastActiveAt: null });
      return s;
    });
    setEmail('');
    toast('Invite recorded', 'ok');
  };
  const body = (
    <>
      <div className="pb-card" style={{ marginBottom: 14, maxWidth: 480 }}>
        <div className="pb-field"><label>Invite email</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@company.com" /></div>
        <button type="button" className="pb-btn pb-btn-primary" onClick={invite}>Invite</button>
      </div>
      <div className="pb-table-wrap">
        <table className="pb-table">
          <thead><tr><th>Member</th><th>Role</th><th>Last active</th><th /></tr></thead>
          <tbody>
            {state.members.map(m => (
              <tr key={m.id}>
                <td><div className="pb-cell-main"><strong>{m.name}</strong><span>{m.email}</span></div></td>
                <td>
                  <select className="pb-btn pb-btn-sm" value={m.role} onChange={e => {
                    setState(s => { const x = s.members.find(y => y.id === m.id); if (x) x.role = e.target.value; return s; });
                  }}>
                    {['owner', 'admin', 'member', 'viewer'].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="mono">{relativeTime(m.lastActiveAt)}</td>
                <td>
                  {m.role !== 'owner' && (
                    <button type="button" className="pb-btn pb-btn-sm pb-btn-danger" onClick={() => {
                      setState(s => { s.members = s.members.filter(x => x.id !== m.id); return s; });
                      toast('Member removed', 'ok');
                    }}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
  if (embedded) return body;
  return (<><PageHead title="Team" subtitle="Who can see this workspace." />{body}</>);
}

export function BillingPage({ state, me, startTrial, busy, setState, toast, embedded }) {
  const b = { ...state.billing, ...(me?.subscription || {}) };
  const planId = b.plan && CLOUD_PLANS[b.plan] ? b.plan : (state.billing.planId || CLOUD_DEFAULT_PLAN_ID);
  const plan = getCloudPlan(planId);
  const trialDays = b.trialEndsAt ? Math.max(0, Math.ceil((new Date(b.trialEndsAt) - Date.now()) / 86400e3)) : null;
  const used24 = Number(b.cyclesUsedLast24h ?? state.billing.cyclesUsedLast24h) || 0;

  const selectPlan = (id) => {
    if (setState) {
      setState(s => {
        s.billing = { ...s.billing, planId: id, plan: id };
        return s;
      });
    }
    toast?.(getCloudPlan(id).shortLabel, 'ok');
  };

  const body = (
    <>
      <div className="pb-callout warn" style={{ marginBottom: 14 }}>
        <Icon name="cloud" size={16} />
        <div>
          <strong>You provide capsule storage</strong>
          <p>
            Two plans via Square: <strong>$17/mo</strong> = 1 escape per 24 hours;
            {' '}<strong>$27/mo</strong> = up to 3 escapes per day.
            Capsules land in <em>your</em> S3, Dropbox, NAS, or Local Starter folder.
          </p>
        </div>
      </div>
      <div className="pb-grid pb-grid-2" style={{ marginBottom: 14 }}>
        {Object.values(CLOUD_PLANS).map(p => (
          <button
            type="button"
            key={p.id}
            className="pb-card"
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              borderColor: plan.id === p.id ? 'var(--acid, #c9ff4a)' : undefined,
              boxShadow: plan.id === p.id ? '0 0 0 1px rgba(201,255,74,.45)' : undefined,
            }}
            onClick={() => selectPlan(p.id)}
          >
            <div className="pb-kpi-label">{p.title}</div>
            <div className="pb-kpi-value" style={{ fontSize: 28 }}>${p.priceMonthlyUsd}<span style={{ fontSize: 14 }}>/mo</span></div>
            <div className="pb-kpi-meta">{p.cadenceLabel}</div>
            {plan.id === p.id && <Badge tone="acid">Selected</Badge>}
          </button>
        ))}
      </div>
      <div className="pb-grid pb-grid-2">
        <div className="pb-card">
          <div className="pb-kpi-label">Plan · Square</div>
          <div className="pb-kpi-value" style={{ fontSize: 22 }}>${plan.priceMonthlyUsd}/mo</div>
          <div className="pb-kpi-meta">{plan.shortLabel}</div>
          <div style={{ marginTop: 14 }} className="pb-inline">
            <Badge tone={b.status || state.billing.status}>{b.status || state.billing.status}</Badge>
            <Badge tone="acid">Square</Badge>
            <Badge tone="info">{plan.escapesPerDay || plan.cyclesPerDay} escapes / day max</Badge>
          </div>
          {(b.status || state.billing.status) === 'trialing' && trialDays != null && (
            <p className="pb-muted" style={{ marginTop: 12 }}>Trial ends in {trialDays} day(s) · then billed on the card on file</p>
          )}
          {!(me?.access?.hasAccess) && (
            <button
              type="button"
              className="pb-btn pb-btn-primary"
              style={{ marginTop: 16 }}
              disabled={busy}
              onClick={() => startTrial?.(plan.id)}
            >
              {busy ? 'Opening Square…' : `Pay with Square · 7-day trial then $${plan.priceMonthlyUsd}/mo`}
            </button>
          )}
        </div>
        <div className="pb-card">
          <div className="pb-kpi-label">Escapes (per day)</div>
          <p className="pb-muted" style={{ margin: '8px 0 12px', fontSize: 13, lineHeight: 1.5 }}>
            Plan allowance: <strong>{plan.escapesPerDay || plan.cyclesPerDay}</strong>. Used last 24h: <strong>{used24}</strong> / {plan.escapesPerDay || plan.cyclesPerDay}.
          </p>
          <ul className="pb-muted" style={{ margin: '14px 0 0', paddingLeft: 18, lineHeight: 1.55, fontSize: 13 }}>
            <li>Console · SMS success/failure · ≤{CLOUD_MAX_AGENTS} agents</li>
            <li>$17 · 1 escape / 24h · or · $27 · up to 3 escapes / day</li>
            <li>Not capsule storage (you provide)</li>
            <li>Not encryption keys or Supabase secrets</li>
          </ul>
          <div className="pb-callout info" style={{ marginTop: 16 }}>
            <div>
              <strong>Payment method</strong>
              <p>{state.billing.paymentMethod || 'None yet — complete Square checkout'}</p>
              <p style={{ marginTop: 6 }}>SMS: Alerts → SMS texts · success + failure at run time</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
  if (embedded) return body;
  return (<><PageHead title="Plan" subtitle="Square · $17 (1 escape/24h) or $27 (up to 3 escapes/day) · you provide capsule storage." />{body}</>);
}

export function SettingsPage({ state, setState, toast, resetDemo, embedded }) {
  const s = state.settings;
  const set = (key, value) => {
    setState(st => { st.settings[key] = value; return st; });
    toast('Saved', 'ok');
  };
  const body = (
      <div className="pb-grid pb-grid-2">
        <div className="pb-card">
          <h3 style={{ marginTop: 0 }}>Telemetry</h3>
          <label className="pb-check"><input type="checkbox" checked={s.telemetryOptIn} onChange={e => set('telemetryOptIn', e.target.checked)} /><span>Opt-in health telemetry</span></label>
          <label className="pb-check"><input type="checkbox" checked={s.requireVerifyGreen} onChange={e => set('requireVerifyGreen', e.target.checked)} /><span>Require verify-green</span></label>
          <div className="pb-field" style={{ marginTop: 12 }}><label>Timezone</label>
            <select value={s.timezone} onChange={e => set('timezone', e.target.value)}>
              {['America/New_York', 'America/Los_Angeles', 'UTC', 'Europe/London'].map(z => <option key={z}>{z}</option>)}
            </select>
          </div>
        </div>
        <div className="pb-card">
          <h3 style={{ marginTop: 0 }}>Never stored in Cloud</h3>
          <div className="pb-stack">
            {['Encryption passphrase', 'Service role / secret keys', 'Capsule bytes'].map(item => (
              <div key={item} className="pb-inline" style={{ padding: '8px 10px', border: '1px solid var(--c-border)', borderRadius: 6 }}>
                <Icon name="shield" size={14} /><span>{item}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: '14px 0 0', color: 'var(--c-muted)', fontSize: 12, lineHeight: 1.5 }}>
            CloudTrail API events are read live from <em>your</em> AWS account (when connected). See Account → CloudTrail live.
          </p>
          <button type="button" className="pb-btn pb-btn-danger" style={{ marginTop: 18 }} onClick={() => {
            if (confirm('Reset console demo data?')) resetDemo();
          }}>Reset demo data</button>
        </div>
      </div>
  );
  if (embedded) return body;
  return (<><PageHead title="Settings" subtitle="Workspace prefs. No secrets forms." />{body}</>);
}

function demoTrailEvents(vaultHint = 's3://company-portabase/prod') {
  const now = Date.now();
  const row = (minsAgo, eventName, eventSource, username, resources, errorCode = null) => ({
    id: `demo_${minsAgo}_${eventName}`,
    eventTime: new Date(now - minsAgo * 60e3).toISOString(),
    eventName,
    eventSource,
    username,
    resources,
    readOnly: /Get|Describe|List|Lookup/i.test(eventName),
    errorCode,
    awsRegion: 'us-east-1',
    sourceIPAddress: 'portabase-runner',
  });
  return [
    row(2, 'PutObject', 's3.amazonaws.com', 'portabase-runner-session', [`${vaultHint}/capsules/…/capsule.pbase`]),
    row(3, 'Encrypt', 'kms.amazonaws.com', 'portabase-runner-session', ['arn:aws:kms:us-east-1:…:key/cmk-…']),
    row(4, 'GenerateDataKey', 'kms.amazonaws.com', 'portabase-runner-session', ['arn:aws:kms:us-east-1:…:key/cmk-…']),
    row(18, 'PutObject', 's3.amazonaws.com', 'portabase-runner-session', [`${vaultHint}/capsules/…/checksums.sha256`]),
    row(19, 'Decrypt', 'kms.amazonaws.com', 'portabase-runner-session', ['arn:aws:kms:us-east-1:…:key/cmk-…']),
    row(95, 'LookupEvents', 'cloudtrail.amazonaws.com', 'portabase-audit-session', ['—']),
    row(120, 'PutObject', 's3.amazonaws.com', 'portabase-runner-session', [`${vaultHint}/capsules/…/capsule.json`]),
  ];
}

function demoCloudWatchLines(secretId, secretLabel) {
  const now = Date.now();
  const line = (secAgo, level, message) => ({
    id: `cw_${secAgo}_${level}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date(now - secAgo * 1000).toISOString(),
    message: `[${level}] secret=${secretId} ${message}`,
    logStreamName: `secret/${secretId}/job/job_demo`,
    ingestionTime: new Date(now - secAgo * 1000).toISOString(),
  });
  return [
    line(8, 'INFO', `job started · label="${secretLabel}" · scope=secret-only`),
    line(12, 'INFO', 'runner assumed task role · stream secret/' + secretId),
    line(40, 'INFO', 'capture.database · ok'),
    line(95, 'INFO', 'capture.storage · objects=… · no secret values logged'),
    line(120, 'INFO', 'kms.GenerateDataKey · via customer grant (if configured)'),
    line(140, 'INFO', 's3.PutObject · capsule.pbase · vault prefix only'),
    line(155, 'INFO', 'job finished · status=COMPLETE · durationMs=…'),
    line(400, 'INFO', 'heartbeat · secret still registered · no value materialization'),
  ];
}

/**
 * Live CloudWatch feed scoped to one workspace secret.
 * Always-on recording; live tail in console; API redacts secret-shaped strings.
 */
export function CloudWatchLivePage({ state, setState, toast, embedded }) {
  const secrets = state.secrets || [];
  const cw = state.cloudWatchLive || { secretId: secrets[0]?.id, livePollSeconds: 8, mode: 'demo' };
  const [secretId, setSecretId] = useState(cw.secretId || secrets[0]?.id || 'sec_prod_primary');
  const secretMeta = secrets.find(s => s.id === secretId) || { id: secretId, label: secretId };
  const [events, setEvents] = useState(() => demoCloudWatchLines(secretId, secretMeta.label));
  const [live, setLive] = useState(false);
  const [polling, setPolling] = useState(true);
  const [status, setStatus] = useState('Demo feed — scoped to selected secret');
  const [error, setError] = useState('');
  const [scope, setScope] = useState({
    logGroupName: `/portabase/tenants/…/secrets/${secretId}`,
    logStreamNamePrefix: `secret/${secretId}`,
  });

  const fetchLogs = useCallback(async () => {
    const sid = secretId;
    const label = (state.secrets || []).find(s => s.id === sid)?.label || sid;
    try {
      const headers = { 'Content-Type': 'application/json' };
      try {
        const session = JSON.parse(localStorage.getItem('portabase.session') || 'null');
        const token = session?.accessToken || session?.idToken;
        if (token) headers.Authorization = `Bearer ${token}`;
        if (session?.cloudVersion) headers['X-Portabase-Cloud-Version'] = session.cloudVersion;
      } catch { /* demo */ }
      const res = await fetch('/api/cloud/cloudwatch-live', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          secretId: sid,
          workspaceId: state.workspace?.id || state.cloudWatchLive?.workspaceId,
          region: state.cloudWatchLive?.region || 'us-east-1',
          lookbackMinutes: 360,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.live && Array.isArray(data.events) && data.events.length) {
        setLive(true);
        setEvents(data.events);
        setScope(data.scope || scope);
        setStatus(`Live · secret ${sid} · ${data.events.length} lines · ${new Date(data.polledAt || Date.now()).toLocaleTimeString()}`);
        setError('');
        setState(st => {
          st.cloudWatchLive = {
            ...(st.cloudWatchLive || {}),
            secretId: sid,
            lastPolledAt: data.polledAt,
            mode: 'live',
          };
          return st;
        });
      } else {
        setLive(false);
        setEvents(demoCloudWatchLines(sid, label));
        setScope({
          logGroupName: data.scope?.logGroupName || `/portabase/tenants/…/secrets/${sid}`,
          logStreamNamePrefix: data.scope?.logStreamNamePrefix || `secret/${sid}`,
        });
        setStatus(
          data.mode === 'setup'
            ? `Demo · log group not yet created for this secret (will appear after first managed job)`
            : `Demo live · scoped to ${sid}` + (data.error ? ` · API: ${data.error.slice(0, 80)}` : ''),
        );
        setError(data.mode === 'error' ? (data.error || '') : '');
      }
    } catch (e) {
      setLive(false);
      setEvents(demoCloudWatchLines(sid, label));
      setStatus(`Demo · API offline (${e.message || 'network'})`);
    }
  }, [secretId, state.secrets, state.workspace?.id, state.cloudWatchLive, setState, scope]);

  useEffect(() => {
    setEvents(demoCloudWatchLines(secretId, secretMeta.label));
    fetchLogs();
  }, [secretId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!polling) return undefined;
    const sec = Math.max(5, Number(state.cloudWatchLive?.livePollSeconds) || 8);
    const id = setInterval(fetchLogs, sec * 1000);
    return () => clearInterval(id);
  }, [polling, fetchLogs, state.cloudWatchLive?.livePollSeconds]);

  useEffect(() => {
    if (live || !polling) return undefined;
    const id = setInterval(() => {
      setEvents(prev => {
        const tick = {
          id: `cw_tick_${Date.now()}`,
          timestamp: new Date().toISOString(),
          message: `[INFO] secret=${secretId} heartbeat · scope=secret-only · no values logged`,
          logStreamName: `secret/${secretId}/job/job_demo`,
        };
        return [tick, ...prev].slice(0, 60);
      });
      setStatus(`Demo live · secret ${secretId} · ${new Date().toLocaleTimeString()}`);
    }, 12000);
    return () => clearInterval(id);
  }, [live, polling, secretId]);

  const body = (
    <div className="pb-stack" style={{ gap: 16 }}>
      <div className="pb-card">
        <div className="pb-inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 6px' }}>CloudWatch live · secret-scoped</h3>
            <p style={{ margin: 0, color: 'var(--c-muted)', fontSize: 13, maxWidth: 620, lineHeight: 1.5 }}>
              Tail Portabase runner logs for <strong>one secret at a time</strong> — not your whole AWS account.
              Always recorded for managed jobs; open anytime (including retroactively within retention).
              Secret <em>values</em> are never written to these lines.
            </p>
          </div>
          <div className="pb-inline" style={{ gap: 8 }}>
            <Badge tone={live ? 'ok' : 'warn'}>{live ? 'LIVE' : 'DEMO'}</Badge>
            <button type="button" className="pb-btn" onClick={() => setPolling(p => !p)}>{polling ? 'Pause' : 'Resume'}</button>
            <button type="button" className="pb-btn pb-btn-primary" onClick={() => { fetchLogs(); toast('Refreshed', 'ok'); }}>Refresh</button>
          </div>
        </div>
        <div className="pb-field" style={{ marginTop: 14, maxWidth: 420 }}>
          <label>Secret scope</label>
          <select
            value={secretId}
            onChange={e => {
              const id = e.target.value;
              setSecretId(id);
              setState(st => {
                st.cloudWatchLive = { ...(st.cloudWatchLive || {}), secretId: id };
                return st;
              });
            }}
          >
            {(secrets.length ? secrets : [{ id: secretId, label: secretId }]).map(s => (
              <option key={s.id} value={s.id}>{s.label} · {s.id}</option>
            ))}
          </select>
        </div>
        <p className="mono" style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--c-faint)' }}>{status}</p>
        {error && <p style={{ margin: '8px 0 0', color: 'var(--c-danger)', fontSize: 12 }}>{error}</p>}
      </div>

      <div className="pb-grid pb-grid-2">
        <div className="pb-card">
          <h3 style={{ marginTop: 0 }}>Scope (this secret only)</h3>
          <div className="pb-stack" style={{ gap: 8 }}>
            <div className="pb-inline" style={{ justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--c-muted)' }}>Log group</span>
              <code className="mono" style={{ fontSize: 11 }}>{scope.logGroupName}</code>
            </div>
            <div className="pb-inline" style={{ justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--c-muted)' }}>Stream prefix</span>
              <code className="mono" style={{ fontSize: 11 }}>{scope.logStreamNamePrefix}</code>
            </div>
            <div className="pb-inline" style={{ justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--c-muted)' }}>Secret</span>
              <code className="mono" style={{ fontSize: 11 }}>{secretId}</code>
            </div>
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--c-faint)', lineHeight: 1.5 }}>
            Other customers’ secrets and other workspaces are not readable here.
            Cross-tenant isolation is by log group path + authz on the API.
          </p>
        </div>
        <div className="pb-card">
          <h3 style={{ marginTop: 0 }}>What you will not see</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--c-muted)', fontSize: 13, lineHeight: 1.55 }}>
            <li>Passphrases, service-role keys, or raw secret payloads</li>
            <li>Other secrets’ log streams</li>
            <li>Account-wide CloudWatch (use your AWS console for that)</li>
          </ul>
          <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--c-faint)', lineHeight: 1.5 }}>
            For AWS API audit of <em>your</em> KMS/S3, use <strong>CloudTrail live</strong>.
            For “did Portabase run my job?”, use this feed.
          </p>
        </div>
      </div>

      <div className="pb-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          fontFamily: 'var(--mono)',
          fontSize: 11.5,
          lineHeight: 1.55,
          maxHeight: 420,
          overflow: 'auto',
          background: '#0a0c0f',
          padding: '14px 16px',
        }}
        >
          {events.length === 0 && <div style={{ color: 'var(--c-faint)' }}>No log lines in lookback window.</div>}
          {events.map(ev => (
            <div key={ev.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--c-faint)' }}>{ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '—'}</span>
              <span style={{ color: /ERROR|FAIL/i.test(ev.message) ? 'var(--c-danger)' : /WARN/i.test(ev.message) ? 'var(--c-warn)' : 'var(--c-acid)' }}>
                {ev.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (embedded) return body;
  return (
    <>
      <PageHead title="CloudWatch live" subtitle="Runner logs scoped to one secret." />
      {body}
    </>
  );
}

/**
 * Live CloudTrail feed in hosted console.
 * Demo mode streams sample events; production POSTs to /api/cloud/audit-trail with customer role.
 */
export function CloudTrailLivePage({ state, setState, toast, embedded }) {
  const audit = state.auditTrail || {
    enabled: true, livePollSeconds: 20, region: 'us-east-1', roleArn: '', externalId: '', vaultPrefixHint: '', connected: false, mode: 'demo',
  };
  const [events, setEvents] = useState(() => demoTrailEvents(audit.vaultPrefixHint));
  const [live, setLive] = useState(false);
  const [polling, setPolling] = useState(true);
  const [status, setStatus] = useState(audit.mode === 'live' ? 'Live (customer Trail)' : 'Demo feed — connect your role for real Trail');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({
    roleArn: audit.roleArn || '',
    externalId: audit.externalId || '',
    region: audit.region || 'us-east-1',
    vaultPrefixHint: audit.vaultPrefixHint || '',
  });

  const saveConnection = () => {
    setState(st => {
      st.auditTrail = {
        ...(st.auditTrail || {}),
        ...draft,
        connected: Boolean(draft.roleArn.trim()),
        mode: draft.roleArn.trim() ? 'live' : 'demo',
      };
      return st;
    });
    toast(draft.roleArn.trim() ? 'CloudTrail role saved — polling live' : 'Cleared role — demo feed', 'ok');
  };

  const fetchTrail = useCallback(async () => {
    const roleArn = (state.auditTrail?.roleArn || draft.roleArn || '').trim();
    if (!roleArn) {
      setLive(false);
      setEvents(demoTrailEvents(state.auditTrail?.vaultPrefixHint || draft.vaultPrefixHint));
      setStatus('Demo feed — events illustrate what live Trail looks like');
      setError('');
      return;
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      try {
        const session = JSON.parse(localStorage.getItem('portabase.session') || 'null');
        const token = session?.accessToken || session?.idToken;
        if (token) headers.Authorization = `Bearer ${token}`;
        if (session?.cloudVersion) headers['X-Portabase-Cloud-Version'] = session.cloudVersion;
      } catch { /* demo */ }
      const res = await fetch('/api/cloud/audit-trail', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          roleArn,
          externalId: state.auditTrail?.externalId || draft.externalId,
          region: state.auditTrail?.region || draft.region,
          resourceContains: state.auditTrail?.vaultPrefixHint || draft.vaultPrefixHint,
          lookbackMinutes: 360,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.live && Array.isArray(data.events)) {
        setLive(true);
        setEvents(data.events);
        setStatus(`Live · ${data.events.length} events · polled ${new Date(data.polledAt || Date.now()).toLocaleTimeString()}`);
        setError('');
        setState(st => {
          st.auditTrail = { ...(st.auditTrail || {}), lastPolledAt: data.polledAt, mode: 'live', connected: true };
          return st;
        });
      } else if (data.mode === 'setup' || !roleArn) {
        setLive(false);
        setEvents(demoTrailEvents(draft.vaultPrefixHint));
        setStatus(data.message || 'Connect IAM role for live Trail');
        setError('');
      } else {
        setLive(false);
        setError(data.error || 'Lookup failed');
        setStatus('Live lookup failed — showing last demo sample');
        setEvents(prev => (prev.length ? prev : demoTrailEvents(draft.vaultPrefixHint)));
      }
    } catch (e) {
      setLive(false);
      setError(e.message || 'Network error');
      setEvents(demoTrailEvents(draft.vaultPrefixHint));
      setStatus('Offline / API unavailable — demo feed');
    }
  }, [state.auditTrail, draft.roleArn, draft.externalId, draft.region, draft.vaultPrefixHint, setState]);

  useEffect(() => {
    fetchTrail();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!polling) return undefined;
    const sec = Math.max(10, Number(state.auditTrail?.livePollSeconds) || 20);
    const id = setInterval(fetchTrail, sec * 1000);
    return () => clearInterval(id);
  }, [polling, fetchTrail, state.auditTrail?.livePollSeconds]);

  // Soft live feel in demo: occasionally prepend a synthetic event
  useEffect(() => {
    if (live || !polling) return undefined;
    const id = setInterval(() => {
      setEvents(prev => {
        const next = demoTrailEvents(state.auditTrail?.vaultPrefixHint || draft.vaultPrefixHint);
        next[0] = {
          ...next[0],
          id: `demo_tick_${Date.now()}`,
          eventTime: new Date().toISOString(),
          eventName: Math.random() > 0.5 ? 'PutObject' : 'Encrypt',
        };
        return [next[0], ...prev].slice(0, 40);
      });
      setStatus(`Demo live · updated ${new Date().toLocaleTimeString()}`);
    }, 22000);
    return () => clearInterval(id);
  }, [live, polling, state.auditTrail?.vaultPrefixHint, draft.vaultPrefixHint]);

  const body = (
    <div className="pb-stack" style={{ gap: 16 }}>
      <div className="pb-card">
        <div className="pb-inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 6px' }}>CloudTrail live</h3>
            <p style={{ margin: 0, color: 'var(--c-muted)', fontSize: 13, maxWidth: 560, lineHeight: 1.5 }}>
              Watch API activity in <strong>your</strong> AWS account as Portabase runners use your vault and KMS.
              Near-real-time (usually 1–5 minutes behind AWS). No capsule bytes or passphrases appear here.
            </p>
          </div>
          <div className="pb-inline" style={{ gap: 8 }}>
            <Badge tone={live ? 'ok' : 'warn'}>{live ? 'LIVE' : 'DEMO'}</Badge>
            <button type="button" className="pb-btn" onClick={() => setPolling(p => !p)}>{polling ? 'Pause' : 'Resume'}</button>
            <button type="button" className="pb-btn pb-btn-primary" onClick={() => { fetchTrail(); toast('Refreshed', 'ok'); }}>Refresh</button>
          </div>
        </div>
        <p className="mono" style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--c-faint)' }}>{status}</p>
        {error && <p style={{ margin: '8px 0 0', color: 'var(--c-danger)', fontSize: 12 }}>{error}</p>}
      </div>

      <div className="pb-grid pb-grid-2">
        <div className="pb-card">
          <h3 style={{ marginTop: 0 }}>Connect your Trail (optional)</h3>
          <p style={{ color: 'var(--c-muted)', fontSize: 12, lineHeight: 1.5 }}>
            Create a role in <em>your</em> account that trusts Portabase and allows <code>cloudtrail:LookupEvents</code>.
            Paste the role ARN. External ID recommended. Trail must already be enabled in your account for history.
          </p>
          <div className="pb-field"><label>Role ARN</label>
            <input value={draft.roleArn} onChange={e => setDraft(d => ({ ...d, roleArn: e.target.value }))} placeholder="arn:aws:iam::123456789012:role/portabase-trail-read" />
          </div>
          <div className="pb-field"><label>External ID</label>
            <input value={draft.externalId} onChange={e => setDraft(d => ({ ...d, externalId: e.target.value }))} placeholder="workspace external id" />
          </div>
          <div className="pb-field"><label>Region</label>
            <input value={draft.region} onChange={e => setDraft(d => ({ ...d, region: e.target.value }))} />
          </div>
          <div className="pb-field"><label>Vault prefix filter (optional)</label>
            <input value={draft.vaultPrefixHint} onChange={e => setDraft(d => ({ ...d, vaultPrefixHint: e.target.value }))} placeholder="s3://your-bucket/prefix" />
          </div>
          <button type="button" className="pb-btn pb-btn-primary" onClick={saveConnection}>Save connection</button>
        </div>
        <div className="pb-card">
          <h3 style={{ marginTop: 0 }}>What you will see</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--c-muted)', fontSize: 13, lineHeight: 1.55 }}>
            <li><code>kms:Encrypt</code> / <code>Decrypt</code> when using your CMK</li>
            <li><code>s3:PutObject</code> when capsules land in your vault</li>
            <li>Principal / session that Portabase used</li>
            <li>Errors if a grant was revoked or denied</li>
          </ul>
          <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--c-faint)', lineHeight: 1.5 }}>
            Without a role, this panel still runs a <strong>demo live feed</strong> so the product is understandable before AWS setup.
            Job history in the console is always recorded separately (see Security page).
          </p>
          <a className="pb-btn" style={{ marginTop: 14, display: 'inline-flex' }} href="/security#options" target="_blank" rel="noreferrer">Security &amp; trust ↗</a>
        </div>
      </div>

      <div className="pb-table-wrap">
        <table className="pb-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Source</th>
              <th>Principal</th>
              <th>Resources</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--c-muted)' }}>No events in lookback window.</td></tr>
            )}
            {events.map(ev => (
              <tr key={ev.id}>
                <td className="mono">{ev.eventTime ? new Date(ev.eventTime).toLocaleString() : '—'}</td>
                <td><strong>{ev.eventName}</strong></td>
                <td className="mono">{ev.eventSource}</td>
                <td className="mono" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.username}</td>
                <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{(ev.resources || []).join(', ') || '—'}</td>
                <td>{ev.errorCode ? <Badge tone="danger">{ev.errorCode}</Badge> : <Badge tone="ok">ok</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (embedded) return body;
  return (
    <>
      <PageHead title="CloudTrail live" subtitle="Near-real-time API activity from your AWS account." />
      {body}
    </>
  );
}

export { Badge, Modal, Empty, PageHead, copyText };
