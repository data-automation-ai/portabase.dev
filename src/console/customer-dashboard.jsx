import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { DualBarChart, EmptyChart, LineChart, StackedBarChart } from './charts.jsx';
import { BarGauge } from './gauges.jsx';
import { formatDuration } from './data/store.js';
import {
  ADDON_TRANSFERS_PER_24H,
  BASE_TRANSFERS_PER_24H,
  TRANSFER_WINDOW_HOURS,
  extraTransfersAddonPriceLabel,
  getCloudPlan,
} from '../lib/product.js';
import { planAllowsOptionalSms } from '../lib/sms-safe.js';
import { buildDashboardModel, jobsFromConsoleState } from '../lib/dashboard-view.js';
import { KEYS_COPY } from '../data/never-hold-keys.js';
import { formatGiB, formatHumanSize } from '../lib/human-size.js';
import { formatOperatorTime } from '../lib/operator-time.js';
import { JobSetupWizard, TableSizer } from './table-sizer.jsx';

function Badge({ tone, children }) {
  const t = tone === 'ok' || tone === 'COMPLETE' || tone === 'green' || tone === 'MATCH'
    ? 'ok'
    : tone === 'warn' || tone === 'PENDING' || tone === 'running'
      ? 'warn'
      : tone === 'danger' || tone === 'FAILED' || tone === 'red' || tone === 'error'
        ? 'danger'
        : tone === 'acid' ? 'acid' : tone === 'info' ? 'info' : '';
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

function TimeCell({ iso }) {
  const t = formatOperatorTime(iso);
  return (
    <span className="pb-time" title={t.iso || undefined}>
      <strong>{t.relative}</strong>
      <em>{t.absolute}</em>
    </span>
  );
}

export function useDashboardModel({ state, me, demoMode, liveJobs, live, square }) {
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
      square: square || me?.square || null,
    });
  }, [state, me, demoMode, liveJobs, live, square]);
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
  square,
}) {
  const model = useDashboardModel({ state, me, demoMode, liveJobs, live, square });
  const [tab, setTab] = useState(section);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [wizard, setWizard] = useState(false);
  const [sizerPlan, setSizerPlan] = useState(me?.subscription?.plan || state?.billing?.planId || 'cloud-free');
  const [sizerSelection, setSizerSelection] = useState(state?.jobInclude || {});
  const [excludeBinaries, setExcludeBinaries] = useState(Boolean(state?.jobInclude?.excludeBinaries));
  const plan = getCloudPlan(me?.subscription?.plan || state?.billing?.planId || state?.billing?.plan);
  const smsAllowed = planAllowsOptionalSms(plan.id);
  const selectedJob = model.telemetry.find((job) => job.id === selectedJobId) || null;

  useEffect(() => {
    if (section && section !== tab) setTab(section);
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next) => {
    setTab(next);
    navigate?.('dashboard', { tab: next === 'overview' ? null : next });
  };

  const openJob = (id) => {
    setSelectedJobId(id);
    go('overview');
  };

  return (
    <>
      <PageHead
        title="Dashboard"
        subtitle="Job status, table sizer, sealed sizes, and utilities. Include list and hashes only — never keys or row bodies."
        actions={
          <>
            <button type="button" className="pb-btn" onClick={() => navigate('account', { tab: 'billing' })}>
              <Icon name="card" size={14} /> Account
            </button>
            <button type="button" className="pb-btn" onClick={() => navigate('projects')}>
              <Icon name="plus" size={14} /> Add source
            </button>
            <button type="button" className="pb-btn pb-btn-primary" onClick={() => { setTab('sizer'); setWizard(true); }}>
              <Icon name="table" size={14} /> New job · sizer
            </button>
          </>
        }
      />

      {model.demo && (
        <div className="pb-sample-banner" role="status">
          <span className="pb-sample-chip">SAMPLE</span>
          <strong>Demo workspace</strong>
          <p>This is labeled sample data, not a live customer project. The proof lamp stays red.</p>
        </div>
      )}

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

      <div className="pb-keys-strip" role="note">
        <Icon name="key" size={18} />
        <div>
          <span>CONTROL PLANE · BLIND</span>
          <strong>{KEYS_COPY.dashTitle}</strong>
          <p>{KEYS_COPY.dashBody}</p>
          <p className="pb-keys-honest">{KEYS_COPY.honest}</p>
          <button type="button" className="pb-text-link" onClick={() => navigate?.('agents', { tab: 'seal' })}>
            Seal keys to runner
          </button>
        </div>
      </div>

      <AccountStrip
        model={model}
        plan={plan}
        me={me}
        state={state}
        startTrial={startTrial}
        startAddon={startAddon}
        busy={busy}
        navigate={navigate}
      />

      <div className="pb-tabs pb-tabs-mobile" role="tablist" aria-label="Dashboard sections">
        {[
          ['overview', 'Telemetry'],
          ['charts', 'Charts'],
          ['sizer', 'Table sizer'],
          ['sizes', 'Capsule sizes'],
          ['log', 'Backup log'],
          ['utilities', 'Utilities'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-active' : ''}
            onClick={() => go(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <TelemetrySection model={model} navigate={navigate} onOpenJob={openJob} />}
      {tab === 'charts' && <ChartsSection model={model} plan={plan} />}
      {tab === 'sizer' && (
        <TableSizer
          inventory={model.inventory}
          planId={sizerPlan}
          onPlanId={setSizerPlan}
          selection={sizerSelection}
          onSelection={setSizerSelection}
          excludeBinaries={excludeBinaries}
          onExcludeBinaries={setExcludeBinaries}
          demo={model.demo}
        />
      )}
      {tab === 'sizes' && <SizesSection model={model} onOpenJob={openJob} />}
      {tab === 'log' && <BackupLogSection model={model} onOpenJob={openJob} />}
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

      {selectedJob && (
        <JobDrawer job={selectedJob} demo={model.demo} proof={model.proof} onClose={() => setSelectedJobId(null)} />
      )}
      {wizard && (
        <JobSetupWizard
          inventory={model.inventory}
          demo={model.demo}
          planId={sizerPlan}
          onClose={() => setWizard(false)}
          toast={toast}
          onConfirm={(spec) => {
            setSizerSelection({
              includeTables: spec.includeTables,
              excludeTables: spec.excludeTables,
              includeBuckets: spec.includeBuckets,
              excludeBuckets: spec.excludeBuckets,
            });
            setExcludeBinaries(spec.excludeBinaries);
            setState?.((s) => {
              s.jobInclude = {
                includeTables: spec.includeTables,
                excludeTables: spec.excludeTables,
                includeBuckets: spec.includeBuckets,
                excludeBuckets: spec.excludeBuckets,
                estimatedBytes: spec.estimatedBytes,
                planId: spec.planId,
                excludeBinaries: spec.excludeBinaries,
              };
              return s;
            });
          }}
        />
      )}
    </>
  );
}

function AccountStrip({ model, plan, me, state, startTrial, startAddon, busy, navigate }) {
  const sub = me?.subscription || state?.billing || {};
  const status = sub.status || state?.billing?.status || 'none';
  const strip = model.billingStrip;
  const square = strip.square;
  const next = strip.nextPlan;
  return (
    <div className="pb-card pb-account-strip">
      <div className="pb-grid pb-grid-4 pb-account-grid">
        <div>
          <div className="pb-kpi-label">Plan</div>
          <div className="pb-kpi-value pb-kpi-tight">{strip.planName}</div>
          <div className="pb-inline" style={{ marginTop: 8 }}>
            <Badge tone={status === 'active' || status === 'trialing' ? 'ok' : 'warn'}>{status}</Badge>
            <Badge tone="acid">{strip.shortLabel}</Badge>
          </div>
        </div>
        <div>
          <div className="pb-kpi-label">Allowance</div>
          <div className="pb-kpi-value pb-kpi-tight">{strip.allowanceLabel}</div>
          <p className="pb-muted pb-strip-note">
            {sub.extraTransfersAddon ? ADDON_TRANSFERS_PER_24H : BASE_TRANSFERS_PER_24H} transfer / {TRANSFER_WINDOW_HOURS}h
            {sub.extraTransfersAddon ? '' : ` · extra ${extraTransfersAddonPriceLabel(plan.id)}`}
          </p>
        </div>
        <div>
          <div className="pb-kpi-label">Upgrade</div>
          {next ? (
            <>
              <div className="pb-kpi-value pb-kpi-tight">{next.title}</div>
              <p className="pb-muted pb-strip-note">${next.priceMonthlyUsd}/mo · {next.storageCapLabel}</p>
            </>
          ) : (
            <p className="pb-muted pb-strip-note">Daily Escape is the top public plan.</p>
          )}
        </div>
        <div>
          <div className="pb-kpi-label">Square checkout</div>
          <div className="pb-inline" style={{ marginTop: 6 }}>
            <Badge tone={square.ready ? 'ok' : 'danger'}>{square.ready ? 'Ready' : 'Blocked'}</Badge>
            {square.mode && <Badge tone="info">{square.mode}</Badge>}
          </div>
          <p className="pb-muted pb-strip-note">{square.message}</p>
          {!square.ready && (
            <p className="pb-mono pb-faint" style={{ margin: '6px 0 0', fontSize: 11 }}>
              {square.missing.join(', ')}
            </p>
          )}
        </div>
      </div>
      <div className="pb-inline pb-account-actions">
        {!(me?.access?.hasAccess) && (
          <button
            type="button"
            className="pb-btn pb-btn-primary"
            disabled={busy || strip.checkoutDisabled}
            onClick={() => startTrial?.(plan.id)}
          >
            {busy ? 'Opening Square…' : `Start trial · $${plan.priceMonthlyUsd}/mo`}
          </button>
        )}
        {next && me?.access?.hasAccess && (
          <button
            type="button"
            className="pb-btn pb-btn-primary"
            disabled={busy || strip.checkoutDisabled}
            onClick={() => startTrial?.(next.id)}
          >
            Upgrade to {next.shortLabel}
          </button>
        )}
        {!sub.extraTransfersAddon && (
          <button type="button" className="pb-btn" disabled={busy || strip.checkoutDisabled} onClick={() => startAddon?.()}>
            Extra transfers
          </button>
        )}
        <button type="button" className="pb-btn pb-btn-ghost" onClick={() => navigate('account', { tab: 'billing' })}>Manage</button>
      </div>
    </div>
  );
}

function TelemetrySection({ model, navigate, onOpenJob }) {
  const strip = model.strip || {};
  const latest = strip.latest;
  return (
    <div className="pb-stack">
      <div className="pb-status-strip" aria-label="Telemetry status">
        <div>
          <div className="pb-kpi-label">Last job</div>
          <strong>{latest ? latest.type : '—'}</strong>
          <span>{latest ? formatOperatorTime(latest.startedAt).relative : 'No jobs'}</span>
        </div>
        <div>
          <div className="pb-kpi-label">Status</div>
          <strong>{latest ? <Badge tone={latest.status}>{latest.status}</Badge> : '—'}</strong>
          <span>{strip.successCount || 0} ok · {strip.failCount || 0} fail</span>
        </div>
        <div>
          <div className="pb-kpi-label">Last sealed</div>
          <strong>{formatGiB(strip.lastSizeBytes)}</strong>
          <span>{formatHumanSize(strip.lastSizeBytes)}</span>
        </div>
        <div>
          <div className="pb-kpi-label">Proof</div>
          <strong><Badge tone={strip.proofTone === 'green' ? 'ok' : 'danger'}>{strip.proofLabel || 'RED'}</Badge></strong>
          <span>{model.proof.proven ? 'MATCH report on file' : 'Not proven'}</span>
        </div>
        <div>
          <div className="pb-kpi-label">Source</div>
          <strong>{model.demo ? 'SAMPLE' : model.live ? 'Live' : 'Workspace'}</strong>
          <span>{model.empty ? 'Empty' : `${strip.jobCount} jobs`}</span>
        </div>
      </div>

      {model.empty ? (
        <div className="pb-empty">
          <Icon name="chart" size={28} />
          <h3>No telemetry yet</h3>
          <p>When a Cloud Runner or the free CLI reports a job, you will see status, phase, timestamps, object counts, sizes, destination kind, runner region, and safe error codes — never keys or capsule bytes.</p>
          <button type="button" className="pb-btn pb-btn-primary" onClick={() => navigate('projects')}>Connect a source</button>
        </div>
      ) : (
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
                <tr
                  key={job.id}
                  id={`job-${job.id}`}
                  className="row-link"
                  tabIndex={0}
                  onClick={() => onOpenJob(job.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenJob(job.id); } }}
                >
                  <td>
                    <div className="pb-cell-main">
                      <strong>{job.type}</strong>
                      <span className="mono">{job.jobId || job.id}</span>
                    </div>
                  </td>
                  <td><Badge tone={job.status}>{job.status}</Badge></td>
                  <td className="mono">{job.phase || '—'}</td>
                  <td><TimeCell iso={job.startedAt} /></td>
                  <td><TimeCell iso={job.finishedAt} /></td>
                  <td className="mono">{job.objectCount || '—'}</td>
                  <td className="mono">{formatHumanSize(job.sizeBytes)}</td>
                  <td><Badge tone="info">{job.destinationKind}</Badge></td>
                  <td className="mono">{job.region || '—'}</td>
                  <td className="mono">{job.errorCode || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pb-faint" style={{ fontSize: 12 }}>
        Times in America/New_York. Safe error codes only. Object names, row bodies, and sealing keys are never stored on Portabase servers.
      </p>
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
        <div className="pb-card-head">
          <h3>Job success / fail</h3>
          <span>{mocked ? 'SAMPLE · 7-day' : '7-day'}</span>
        </div>
        <DualBarChart rows={model.charts.series} mocked={mocked} />
      </div>
      <div className="pb-card">
        <div className="pb-card-head">
          <h3>Capsule size over time</h3>
          <span>ciphertext totals</span>
        </div>
        <LineChart rows={model.charts.series} valueKey="sizeBytes" label="Sealed size" format={formatHumanSize} mocked={mocked} />
      </div>
      <div className="pb-card">
        <div className="pb-card-head">
          <h3>Bytes / day vs plan</h3>
          <span>{plan.shortLabel}</span>
        </div>
        <BarGauge
          used={model.charts.usage.usedBytes}
          cap={model.charts.usage.capBytes}
          label={`Used vs ${plan.storageCapLabel}`}
          usedLabel={formatGiB(model.charts.usage.usedBytes)}
          capLabel={model.charts.usage.capLabel}
          tone={model.charts.usage.percent > 85 ? 'warn' : 'ok'}
          mocked={mocked}
        />
        <div style={{ marginTop: 16 }}>
          <LineChart rows={model.charts.series} valueKey="sizeBytes" label="Bytes / day" format={formatHumanSize} mocked={mocked} />
        </div>
      </div>
      <div className="pb-card">
        <div className="pb-card-head">
          <h3>Objects per job</h3>
          <span>per day</span>
        </div>
        <LineChart rows={model.charts.series} valueKey="objectCount" label="Objects reported" mocked={mocked} />
        {sizeRows.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <StackedBarChart rows={sizeRows} format={formatHumanSize} mocked={mocked} />
          </div>
        )}
      </div>
    </div>
  );
}

function SizesSection({ model, onOpenJob }) {
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
      {model.demo && <p className="pb-faint" style={{ margin: 0 }}>SAMPLE sizes — not a live vault inventory.</p>}
      {model.sizes.map((row) => (
        <button type="button" className="pb-card pb-size-card" key={row.jobId} onClick={() => onOpenJob(row.jobId)}>
          <div className="pb-card-head">
            <h3>Capsule {row.jobId}</h3>
            <span>{row.destinationKind}</span>
          </div>
          <div className="pb-size-hero">
            <div className="pb-kpi-value">{formatGiB(row.totalBytes)}</div>
            <span>{formatHumanSize(row.totalBytes)} sealed</span>
          </div>
          <p className="pb-muted" style={{ margin: '6px 0 14px' }}>
            {row.objectCount ? `${row.objectCount} objects · ` : ''}
            {row.hasBreakdown ? 'Layer breakdown from telemetry hashes/counts' : 'Total only — layer breakdown not reported'}
          </p>
          <div className="pb-grid pb-grid-4 pb-size-layers">
            {row.layers.filter((l) => l.id !== 'other' || l.bytes).map((layer) => (
              <div key={layer.id}>
                <div className="pb-kpi-label">{layer.label}</div>
                <div className="pb-mono">{formatGiB(layer.bytes)}</div>
                <div className="pb-faint" style={{ fontSize: 11 }}>{formatHumanSize(layer.bytes)}</div>
                <div className="pb-progress"><i style={{ width: `${row.totalBytes ? Math.round((layer.bytes / row.totalBytes) * 100) : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

function BackupLogSection({ model, onOpenJob }) {
  if (model.empty || !model.log.length) {
    return (
      <div className="pb-empty">
        <Icon name="clock" size={28} />
        <h3>Backup log is empty</h3>
        <p>Capture and restore jobs will list here with status, duration, size, destination, and MATCH / red lamp. The lamp stays red until a real compare is MATCH.</p>
      </div>
    );
  }
  return (
    <div className="pb-table-wrap">
      <table className="pb-table">
        <thead>
          <tr>
            <th>When</th><th>Type</th><th>Status</th><th>Duration</th>
            <th>Size</th><th>Destination</th><th>Lamp</th>
          </tr>
        </thead>
        <tbody>
          {model.log.map((row) => (
            <tr
              key={row.id}
              className="row-link"
              tabIndex={0}
              onClick={() => onOpenJob(row.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenJob(row.id); } }}
            >
              <td><TimeCell iso={row.startedAt} /></td>
              <td><strong>{row.type}</strong></td>
              <td><Badge tone={row.status}>{row.status}</Badge></td>
              <td className="mono">{formatDuration(row.durationMs)}</td>
              <td className="mono">{formatHumanSize(row.sizeBytes)}</td>
              <td><Badge tone="info">{row.destinationKind}</Badge></td>
              <td><Badge tone={row.lamp.tone === 'green' ? 'ok' : 'danger'}>{row.lamp.label}</Badge></td>
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
    <div className="pb-util-grid">
      <section className="pb-util-group">
        <h2>Health</h2>
        <div className="pb-grid pb-grid-2">
          <div className="pb-card">
            <div className="pb-card-head"><h3>Doctor preflight</h3><span>{u.doctor?.mocked ? 'SAMPLE' : 'report'}</span></div>
            {!u.doctor ? (
              <p className="pb-muted">No doctor report yet. Run <code className="pb-mono">portabase doctor</code> on the runner.</p>
            ) : (
              <>
                <Badge tone={u.doctor.status === 'ok' ? 'ok' : 'warn'}>{u.doctor.status}</Badge>
                <p className="pb-faint" style={{ marginTop: 8 }}>{u.doctor.checkedAt ? formatOperatorTime(u.doctor.checkedAt).label : ''}</p>
                <ul className="pb-muted pb-check-list">
                  {u.doctor.checks.map((check) => (
                    <li key={check.id}>{check.ok ? '✓' : '×'} {check.id} — {check.detail}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="pb-card">
            <div className="pb-card-head"><h3>Verify result</h3><span>{u.verify?.mocked ? 'SAMPLE' : 'report'}</span></div>
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
      </section>

      <section className="pb-util-group">
        <h2>Engine</h2>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Flags used</h3><span>existing CLI only</span></div>
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
      </section>

      <section className="pb-util-group">
        <h2>Destinations</h2>
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
      </section>

      <section className="pb-util-group">
        <h2>Schedules</h2>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Cadence</h3><span>1 transfer / {TRANSFER_WINDOW_HOURS}h included</span></div>
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
                      <td><TimeCell iso={sch.lastRunAt} /></td>
                      <td><TimeCell iso={sch.nextRunAt} /></td>
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
      </section>

      <section className="pb-util-group">
        <h2>SMS</h2>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Status alerts</h3><span>$17 optional</span></div>
          {!smsAllowed ? (
            <p className="pb-muted">SMS is optional on Daily Escape ($17) — not on Cloud Free or $7.</p>
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
      </section>
    </div>
  );
}

function JobDrawer({ job, demo, proof, onClose }) {
  const started = formatOperatorTime(job.startedAt);
  const finished = formatOperatorTime(job.finishedAt);
  const fields = [
    ['Type', job.type],
    ['Status', job.status],
    ['Phase', job.phase || '—'],
    ['Started', started.label],
    ['Finished', finished.label],
    ['Duration', formatDuration(job.durationMs)],
    ['Objects', job.objectCount || '—'],
    ['Sealed size', `${formatGiB(job.sizeBytes)} (${formatHumanSize(job.sizeBytes)})`],
    ['Destination', job.destinationKind],
    ['Region', job.region || '—'],
    ['Error', job.errorCode || '—'],
    ['Job id', job.jobId || job.id],
    ['Capsule hash', job.capsuleHash ? `${job.capsuleHash.slice(0, 12)}…` : '—'],
  ];
  return (
    <div className="pb-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="pb-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pb-drawer-head">
          <div>
            <div className="pb-inline">
              {demo && <span className="pb-sample-chip">SAMPLE</span>}
              <Badge tone={job.status}>{job.status}</Badge>
              <Badge tone={proof?.proven && job.capsuleHash === proof.capsuleHash ? 'ok' : 'danger'}>
                {proof?.proven && job.capsuleHash === proof.capsuleHash ? 'MATCH' : 'Not proven'}
              </Badge>
            </div>
            <h2 id="job-drawer-title">{job.type} · {job.jobId || job.id}</h2>
          </div>
          <button type="button" className="pb-btn pb-btn-icon" onClick={onClose} aria-label="Close job detail">
            <Icon name="x" size={16} />
          </button>
        </div>
        <dl className="pb-drawer-dl">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="mono">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="pb-faint" style={{ margin: '16px 0 0', fontSize: 12 }}>
          {job.destinationHint}
        </p>
      </aside>
    </div>
  );
}

export function formatJobDuration(ms) {
  return formatDuration(ms);
}
