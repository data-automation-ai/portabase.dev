import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { DualBarChart, EmptyChart, LineChart, StackedBarChart } from './charts.jsx';
import { BarGauge } from './gauges.jsx';
import { formatBytes, formatDuration, relativeTime } from './data/store.js';
import {
  ADDON_TRANSFERS_PER_24H,
  BASE_TRANSFERS_PER_24H,
  TRANSFER_WINDOW_HOURS,
  extraTransfersAddonPriceLabel,
  getCloudPlan,
} from '../lib/product.js';
import { planAllowsOptionalSms } from '../lib/sms-safe.js';
import { buildDashboardModel, jobsFromConsoleState } from '../lib/dashboard-view.js';

function Badge({ tone, children }) {
  const t = tone === 'ok' || tone === 'COMPLETE' || tone === 'green' || tone === 'MATCH'
    ? 'ok'
    : tone === 'warn' || tone === 'PENDING' || tone === 'running'
      ? 'warn'
      : tone === 'danger' || tone === 'FAILED' || tone === 'red' || tone === 'error'
        ? 'danger'
        : tone === 'acid' ? 'acid' : '';
  return <span className={`pb-badge${t ? ` pb-badge-${t}` : ''}`}>{children}</span>;
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

export function useDashboardModel({ state, me, demoMode, liveJobs, live }) {
  return useMemo(() => {
    const billing = { ...(state?.billing || {}), ...(me?.subscription || {}) };
    const jobs = liveJobs
      || (demoMode ? jobsFromConsoleState(state) : (state?.jobs || []));
    return buildDashboardModel({
      jobs,
      billing,
      proof: state?.proofReport,
      demoMode: Boolean(demoMode),
      live: Boolean(live) && !demoMode,
      schedules: state?.schedules || [],
      sms: state?.sms || {},
      doctor: state?.doctor || null,
      verify: state?.verify || null,
    });
  }, [state, me, demoMode, liveJobs, live]);
}

export function CustomerDashboardPage({
  state,
  me,
  demoMode,
  navigate,
  startTrial,
  startAddon,
  busy,
  liveJobs,
  live,
  setState,
  toast,
  section = 'overview',
}) {
  const model = useDashboardModel({ state, me, demoMode, liveJobs, live });
  const [tab, setTab] = useState(section);
  const plan = getCloudPlan(me?.subscription?.plan || state?.billing?.planId || state?.billing?.plan);
  const smsAllowed = planAllowsOptionalSms(plan.id);

  const go = (next) => {
    setTab(next);
    navigate?.('dashboard', { tab: next === 'overview' ? null : next });
  };

  return (
    <>
      <PageHead
        title="Customer dashboard"
        subtitle="Telemetry, capsule sizes, backup log, and utilities. Control plane stores metadata and hashes only — never keys or capsule bytes."
        actions={
          <>
            <button type="button" className="pb-btn" onClick={() => navigate('account', { tab: 'billing' })}>
              <Icon name="card" size={14} /> Account / billing
            </button>
            <button type="button" className="pb-btn pb-btn-primary" onClick={() => navigate('projects')}>
              <Icon name="plus" size={14} /> Add source
            </button>
          </>
        }
      />

      <div className={`pb-callout ${model.proof.proven ? 'ok' : 'danger'}`} data-proof-tone={model.proof.tone}>
        <Icon name={model.proof.proven ? 'shield' : 'warn'} size={18} />
        <div>
          <strong>{model.proof.proven ? 'Dry-run MATCH' : 'Proof lamp · RED'}</strong>
          <p>
            {model.proof.detail} The lamp stays red until a real dry-run or compare from the free CLI / Cloud Runner reports MATCH.
            Demo and empty workspaces cannot turn this green.
          </p>
        </div>
      </div>

      <div className={`pb-callout ${model.demo ? 'warn' : model.empty ? 'info' : 'ok'}`}>
        <Icon name={model.demo ? 'spark' : 'chart'} size={16} />
        <div>
          <strong>{model.demo ? 'Sample UI' : model.empty ? 'No jobs yet' : model.live ? 'Live telemetry' : 'Workspace telemetry'}</strong>
          <p>{model.labeled}</p>
        </div>
      </div>

      <AccountStrip
        plan={plan}
        me={me}
        state={state}
        startTrial={startTrial}
        startAddon={startAddon}
        busy={busy}
        navigate={navigate}
      />

      <div className="pb-tabs pb-tabs-mobile">
        {[
          ['overview', 'Telemetry'],
          ['charts', 'Charts'],
          ['sizes', 'Capsule sizes'],
          ['log', 'Backup log'],
          ['utilities', 'Utilities'],
        ].map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'is-active' : ''} onClick={() => go(id)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && <TelemetrySection model={model} navigate={navigate} />}
      {tab === 'charts' && <ChartsSection model={model} plan={plan} />}
      {tab === 'sizes' && <SizesSection model={model} />}
      {tab === 'log' && <BackupLogSection model={model} navigate={navigate} />}
      {tab === 'utilities' && (
        <UtilitiesSection
          model={model}
          state={state}
          setState={setState}
          toast={toast}
          smsAllowed={smsAllowed}
          plan={plan}
        />
      )}
    </>
  );
}

function AccountStrip({ plan, me, state, startTrial, startAddon, busy, navigate }) {
  const sub = me?.subscription || state?.billing || {};
  const status = sub.status || state?.billing?.status || 'none';
  return (
    <div className="pb-card pb-account-strip" style={{ marginBottom: 16 }}>
      <div className="pb-grid pb-grid-3">
        <div>
          <div className="pb-kpi-label">Plan</div>
          <div className="pb-kpi-value" style={{ fontSize: 20 }}>{plan.shortLabel}</div>
          <div className="pb-inline" style={{ marginTop: 8 }}>
            <Badge tone={status === 'active' || status === 'trialing' ? 'ok' : 'warn'}>{status}</Badge>
            <Badge tone="acid">Square</Badge>
          </div>
        </div>
        <div>
          <div className="pb-kpi-label">Transfers / {TRANSFER_WINDOW_HOURS}h</div>
          <div className="pb-kpi-value" style={{ fontSize: 20 }}>
            {sub.extraTransfersAddon ? ADDON_TRANSFERS_PER_24H : BASE_TRANSFERS_PER_24H}
          </div>
          <p className="pb-muted" style={{ margin: '8px 0 0', fontSize: 12.5 }}>
            Extra transfers {sub.extraTransfersAddon ? 'on' : `off · ${extraTransfersAddonPriceLabel(plan.id)}`}
          </p>
        </div>
        <div>
          <div className="pb-kpi-label">Billing</div>
          <p className="pb-muted" style={{ margin: '8px 0 10px', fontSize: 12.5 }}>
            {sub.squareSubscriptionId
              ? `Square subscription on file. Manage the card in Square (Louis pins the customer portal).`
              : 'No Square portal link is wired yet. Checkout starts the 7-day trial (card required).'}
          </p>
          <div className="pb-inline">
            {!(me?.access?.hasAccess) && (
              <button type="button" className="pb-btn pb-btn-primary" disabled={busy} onClick={() => startTrial?.(plan.id)}>
                {busy ? 'Opening Square…' : `Start trial · $${plan.priceMonthlyUsd}/mo`}
              </button>
            )}
            {!sub.extraTransfersAddon && (
              <button type="button" className="pb-btn" disabled={busy} onClick={() => startAddon?.()}>
                Extra transfers
              </button>
            )}
            <button type="button" className="pb-btn pb-btn-ghost" onClick={() => navigate('account', { tab: 'billing' })}>Manage</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TelemetrySection({ model, navigate }) {
  if (model.empty) {
    return (
      <div className="pb-empty">
        <Icon name="chart" size={28} />
        <h3>No telemetry yet</h3>
        <p>When a Cloud Runner or the free CLI reports a job, you will see status, phase, timestamps, object counts, sizes, destination kind, runner region, and safe error codes — never keys or capsule bytes.</p>
        <button type="button" className="pb-btn pb-btn-primary" onClick={() => navigate('projects')}>Connect a source</button>
      </div>
    );
  }
  return (
    <div className="pb-stack">
      <div className="pb-table-wrap">
        <table className="pb-table">
          <thead>
            <tr>
              <th>Job</th><th>Status</th><th>Phase</th><th>Started</th><th>Finished</th>
              <th>Objects</th><th>Size</th><th>Dest</th><th>Region</th><th>Error</th>
            </tr>
          </thead>
          <tbody>
            {model.telemetry.map((job) => (
              <tr key={job.id} id={`job-${job.id}`}>
                <td>
                  <div className="pb-cell-main">
                    <strong>{job.type}</strong>
                    <span className="mono">{job.jobId || job.id}</span>
                  </div>
                </td>
                <td><Badge tone={job.status}>{job.status}</Badge></td>
                <td className="mono">{job.phase || '—'}</td>
                <td className="mono">{relativeTime(job.startedAt)}</td>
                <td className="mono">{job.finishedAt ? relativeTime(job.finishedAt) : '—'}</td>
                <td className="mono">{job.objectCount || '—'}</td>
                <td className="mono">{formatBytes(job.sizeBytes)}</td>
                <td><Badge tone="info">{job.destinationKind}</Badge></td>
                <td className="mono">{job.region || '—'}</td>
                <td className="mono">{job.errorCode || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pb-faint" style={{ fontSize: 12 }}>Safe error codes only. Object names, row bodies, and sealing keys are never stored on Portabase servers.</p>
    </div>
  );
}

function ChartsSection({ model, plan }) {
  const mocked = model.demo;
  if (model.empty) {
    return (
      <div className="pb-grid pb-grid-2">
        <div className="pb-card">
          <div className="pb-card-head"><h3>Job success / fail</h3><span>7-day</span></div>
          <EmptyChart label="No jobs yet — charts stay empty until a runner reports." />
        </div>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Capsule size over time</h3></div>
          <EmptyChart label="No capsule sizes yet." />
        </div>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Bytes / day vs plan</h3><span>{plan.shortLabel}</span></div>
          <EmptyChart label={`Plan allowance is ${plan.storageCapLabel}. Nothing transferred yet.`} />
        </div>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Objects per job</h3></div>
          <EmptyChart label="Object counts appear after a capture reports metadata." />
        </div>
      </div>
    );
  }
  const sizeRows = model.sizes.map((row, i) => ({
    label: `#${i + 1}`,
    database: row.layers.find((l) => l.id === 'database')?.bytes || 0,
    storage: row.layers.find((l) => l.id === 'storage')?.bytes || 0,
    functions: row.layers.find((l) => l.id === 'functions')?.bytes || 0,
  }));
  return (
    <div className="pb-grid pb-grid-2">
      <div className="pb-card">
        <div className="pb-card-head"><h3>Job success / fail</h3><span>7-day</span></div>
        <DualBarChart rows={model.charts.series} mocked={mocked} />
      </div>
      <div className="pb-card">
        <div className="pb-card-head"><h3>Capsule size over time</h3><span>ciphertext totals</span></div>
        <LineChart rows={model.charts.series} valueKey="sizeBytes" label="Sealed size" format={formatBytes} mocked={mocked} />
      </div>
      <div className="pb-card">
        <div className="pb-card-head"><h3>Bytes / day vs plan</h3><span>{plan.shortLabel}</span></div>
        <BarGauge
          used={model.charts.usage.usedBytes}
          cap={model.charts.usage.capBytes}
          label={`Used vs ${plan.storageCapLabel}`}
          usedLabel={formatBytes(model.charts.usage.usedBytes)}
          capLabel={model.charts.usage.capLabel}
          tone={model.charts.usage.percent > 85 ? 'warn' : 'ok'}
          mocked={mocked}
        />
        <LineChart rows={model.charts.series} valueKey="sizeBytes" label="Bytes transferred / day" format={formatBytes} mocked={mocked} />
      </div>
      <div className="pb-card">
        <div className="pb-card-head"><h3>Object counts</h3><span>per day / per job</span></div>
        <LineChart rows={model.charts.series} valueKey="objectCount" label="Objects reported" mocked={mocked} />
        {sizeRows.length > 0 && (
          <StackedBarChart rows={sizeRows} format={formatBytes} mocked={mocked} />
        )}
      </div>
    </div>
  );
}

function SizesSection({ model }) {
  if (model.empty || !model.sizes.length) {
    return (
      <div className="pb-empty">
        <Icon name="capsule" size={28} />
        <h3>No capsule sizes yet</h3>
        <p>Per-job totals and DB / Storage / Functions breakdown appear when the runner reports layer hashes or byte counts. Portabase never stores capsule bytes.</p>
      </div>
    );
  }
  return (
    <div className="pb-stack">
      {model.sizes.map((row) => (
        <div className="pb-card" key={row.jobId}>
          <div className="pb-card-head">
            <h3>Capsule {row.jobId}</h3>
            <span>{row.destinationKind}</span>
          </div>
          <div className="pb-kpi-value" style={{ fontSize: 22 }}>{formatBytes(row.totalBytes)}</div>
          <p className="pb-muted" style={{ margin: '6px 0 12px' }}>
            {row.objectCount ? `${row.objectCount} objects · ` : ''}
            {row.hasBreakdown ? 'Layer breakdown from telemetry hashes/counts' : 'Total only — layer breakdown not reported'}
          </p>
          <div className="pb-grid pb-grid-3">
            {row.layers.filter((l) => l.id !== 'other' || l.bytes).map((layer) => (
              <div key={layer.id}>
                <div className="pb-kpi-label">{layer.label}</div>
                <div className="pb-mono">{formatBytes(layer.bytes)}</div>
                <div className="pb-progress"><i style={{ width: `${row.totalBytes ? Math.round((layer.bytes / row.totalBytes) * 100) : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BackupLogSection({ model, navigate }) {
  if (model.empty || !model.log.length) {
    return (
      <div className="pb-empty">
        <Icon name="clock" size={28} />
        <h3>Backup log is empty</h3>
        <p>Capture and restore jobs will list here with status, started/finished, size, and MATCH / red lamp. The lamp stays red until a real compare is MATCH.</p>
      </div>
    );
  }
  return (
    <div className="pb-table-wrap">
      <table className="pb-table">
        <thead>
          <tr>
            <th>When</th><th>Type</th><th>Status</th><th>Started</th><th>Finished</th>
            <th>Size</th><th>Lamp</th><th />
          </tr>
        </thead>
        <tbody>
          {model.log.map((row) => (
            <tr key={row.id}>
              <td className="mono">{relativeTime(row.startedAt)}</td>
              <td><strong>{row.type}</strong></td>
              <td><Badge tone={row.status}>{row.status}</Badge></td>
              <td className="mono">{row.startedAt ? new Date(row.startedAt).toLocaleString() : '—'}</td>
              <td className="mono">{row.finishedAt ? new Date(row.finishedAt).toLocaleString() : '—'}</td>
              <td className="mono">{formatBytes(row.sizeBytes)}</td>
              <td><Badge tone={row.lamp.tone === 'green' ? 'ok' : 'danger'}>{row.lamp.label}</Badge></td>
              <td>
                <button type="button" className="pb-btn pb-btn-sm" onClick={() => navigate('dashboard', { tab: 'overview' })}>
                  Detail
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UtilitiesSection({ model, state, setState, toast, smsAllowed, plan }) {
  const u = model.utilities;
  const toggleSms = (key, value) => {
    setState?.((s) => {
      s.sms = { ...(s.sms || {}), [key]: value, optIn: key === 'optIn' ? value : (s.sms?.optIn || value) };
      return s;
    });
    toast?.('SMS preference saved locally — status only, never keys', 'ok');
  };
  const toggleSchedule = (id) => {
    setState?.((s) => {
      const row = (s.schedules || []).find((x) => x.id === id);
      if (row) row.enabled = !row.enabled;
      return s;
    });
    toast?.('Schedule updated', 'ok');
  };

  return (
    <div className="pb-stack">
      <div className="pb-grid pb-grid-2">
        <div className="pb-card">
          <div className="pb-card-head"><h3>Doctor preflight</h3><span>{u.doctor?.mocked ? 'sample' : 'report'}</span></div>
          {!u.doctor ? (
            <p className="pb-muted">No doctor report yet. Run <code className="pb-mono">portabase doctor</code> on the runner.</p>
          ) : (
            <>
              <Badge tone={u.doctor.status === 'ok' ? 'ok' : 'warn'}>{u.doctor.status}</Badge>
              <p className="pb-faint" style={{ marginTop: 8 }}>{u.doctor.checkedAt ? relativeTime(u.doctor.checkedAt) : ''}</p>
              <ul className="pb-muted" style={{ margin: '12px 0 0', paddingLeft: 18 }}>
                {u.doctor.checks.map((check) => (
                  <li key={check.id}>{check.ok ? '✓' : '×'} {check.id} — {check.detail}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Verify result</h3><span>{u.verify?.mocked ? 'sample' : 'report'}</span></div>
          {!u.verify ? (
            <p className="pb-muted">No verify result yet. Run <code className="pb-mono">portabase verify</code> on the machine that holds the capsule.</p>
          ) : (
            <>
              <Badge tone={u.verify.status === 'verified' ? 'ok' : 'warn'}>{u.verify.status}</Badge>
              {u.verify.capsuleHash && <p className="pb-mono pb-faint" style={{ marginTop: 10 }}>sha256 {u.verify.capsuleHash.slice(0, 12)}…</p>}
            </>
          )}
        </div>
      </div>

      <div className="pb-card">
        <div className="pb-card-head"><h3>Engine flags used</h3><span>existing CLI only</span></div>
        {!u.flags.length ? (
          <p className="pb-muted">No capture flags reported. Cloud surfaces <code className="pb-mono">--exclude-binaries</code> and <code className="pb-mono">--exclude-table-list</code> when the runner used them. No new free-CLI flags.</p>
        ) : (
          <div className="pb-inline">
            {u.flags.map((flag) => (
              <Badge key={`${flag.id}-${flag.value}`} tone="info">
                {flag.cli}{flag.value !== true ? ` ${flag.value}` : ''}{flag.surfaceOnly ? ' (reported)' : ''}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="pb-card">
        <div className="pb-card-head"><h3>Open / download capsule</h3><span>customer-owned path</span></div>
        <p className="pb-muted" style={{ marginTop: 0 }}>
          Portabase never holds capsule bytes. Open the destination you own.
        </p>
        {(u.destinations.length ? u.destinations : [{ kind: 'unknown', hint: 'Connect a destination. Vault stays yours.' }]).map((d) => (
          <div key={d.kind} className="pb-callout info" style={{ marginTop: 10 }}>
            <Icon name="folder" size={16} />
            <div>
              <strong>{d.kind}</strong>
              <p>{d.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="pb-card">
        <div className="pb-card-head"><h3>Schedule</h3><span>1 transfer / {TRANSFER_WINDOW_HOURS}h included</span></div>
        {!u.schedules.length ? (
          <p className="pb-muted">No schedules yet. Cadence is enforced on the runner; Cloud records expected hours only.</p>
        ) : (
          <div className="pb-table-wrap" style={{ border: 0 }}>
            <table className="pb-table" style={{ minWidth: 0 }}>
              <thead><tr><th>Every</th><th>Timezone</th><th>Last</th><th>Next</th><th /></tr></thead>
              <tbody>
                {u.schedules.map((sch) => (
                  <tr key={sch.id}>
                    <td className="mono">{sch.everyHours}h</td>
                    <td className="mono">{sch.timezone}</td>
                    <td className="mono">{relativeTime(sch.lastRunAt)}</td>
                    <td className="mono">{relativeTime(sch.nextRunAt)}</td>
                    <td>
                      <button type="button" className="pb-btn pb-btn-sm" onClick={() => toggleSchedule(sch.id)}>
                        {sch.enabled ? 'On' : 'Off'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="pb-card">
        <div className="pb-card-head"><h3>SMS alerts</h3><span>$17 optional · status only</span></div>
        {!smsAllowed ? (
          <p className="pb-muted">SMS is optional on Daily Escape ($17) and Scale ($37) — not on {plan.shortLabel}.</p>
        ) : (
          <>
            <p className="pb-muted">{u.sms.note}</p>
            <label className="pb-check">
              <input type="checkbox" checked={!!state?.sms?.optIn || !!u.sms.optIn} onChange={(e) => toggleSms('optIn', e.target.checked)} />
              <span>Enable SMS status alerts</span>
            </label>
            <label className="pb-check">
              <input type="checkbox" checked={state?.sms?.onFailure !== false} onChange={(e) => toggleSms('onFailure', e.target.checked)} />
              <span>Text on failure</span>
            </label>
            <label className="pb-check">
              <input type="checkbox" checked={!!state?.sms?.onSuccess} onChange={(e) => toggleSms('onSuccess', e.target.checked)} />
              <span>Text on success</span>
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export function formatJobDuration(ms) {
  return formatDuration(ms);
}
