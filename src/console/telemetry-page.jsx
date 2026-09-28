import React, { useMemo } from 'react';
import { Icon } from './icons.jsx';
import { BarGauge, RingGauge } from './gauges.jsx';
import { DualBarChart, LineChart } from './charts.jsx';
import { buildTelemetryModel, telemetryForbiddenCopy } from '../lib/telemetry-view.js';
import { ZK_COPY } from '../lib/zero-knowledge.js';
import { formatBytes, formatDuration, relativeTime } from './data/store.js';
import { getCloudPlan, storageUsage } from '../lib/product.js';

export function TelemetryPage({ state, navigate }) {
  const model = useMemo(() => buildTelemetryModel(state), [state]);
  const plan = getCloudPlan(state.billing?.planId || state.billing?.plan);
  const usage = storageUsage(model.totals.encryptedBytes, plan.id);
  const t = model.totals;

  return (
    <>
      <div className="pb-page-head">
        <div>
          <h1>Telemetry</h1>
          <p>
            Graphical health signals from opt-in runner reports — success, timing, encrypted-byte totals, workers, plan cap, transfers / 24h, rescue readiness.
            {ZK_COPY.headline}. {ZK_COPY.cannotSee}
          </p>
        </div>
        <div className="pb-page-actions">
          <button type="button" className="pb-btn" onClick={() => navigate('backups')}><Icon name="capsule" size={14} /> Manage capsules</button>
          <button type="button" className="pb-btn pb-btn-primary" onClick={() => navigate('inspect')}><Icon name="key" size={14} /> Open capsule locally</button>
        </div>
      </div>

      <div className="pb-callout info">
        <Icon name="shield" size={16} />
        <div>
          <strong>{ZK_COPY.headline} · health signals only</strong>
          <p>
            {ZK_COPY.architecture} Forbidden from Cloud: {telemetryForbiddenCopy().join(' · ')}.
            Series below are demo aggregates until live ingest is connected.
          </p>
        </div>
      </div>

      <div className="pb-grid pb-grid-4" style={{ marginBottom: 14 }}>
        <div className="pb-card">
          <RingGauge
            value={t.success + t.failed ? (t.success / (t.success + t.failed)) * 100 : 0}
            label="Job success"
            detail={`${t.success} ok · ${t.failed} failed`}
            tone={t.failed ? 'warn' : 'ok'}
            mocked
          />
        </div>
        <div className="pb-card">
          <RingGauge
            value={state.capsules?.length ? (t.rescueReady / state.capsules.length) * 100 : 0}
            label="Rescue readiness"
            detail={`${t.rescueReady} verify-green`}
            tone={t.rescueReady ? 'ok' : 'warn'}
            mocked
          />
        </div>
        <div className="pb-card">
          <BarGauge
            used={usage.usedBytes}
            cap={usage.capBytes}
            label={`Plan usage · ${plan.shortLabel}`}
            usedLabel={formatBytes(t.encryptedBytes)}
            capLabel={usage.capLabel}
            tone={usage.percent > 85 ? 'warn' : 'ok'}
            mocked
          />
        </div>
        <div className="pb-card">
          <RingGauge
            value={t.agentsTotal ? (t.agentsOnline / t.agentsTotal) * 100 : 0}
            label="Worker health"
            detail={`${t.agentsOnline}/${t.agentsTotal} online`}
            tone={t.agentsOnline ? 'ok' : 'danger'}
            mocked
          />
        </div>
      </div>

      <div className="pb-grid pb-grid-2" style={{ marginBottom: 14 }}>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Success vs fail</h3><span>7-day</span></div>
          <DualBarChart rows={model.series} mocked />
        </div>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Encrypted bytes (aggregate)</h3><span>ciphertext totals</span></div>
          <LineChart
            rows={model.series}
            valueKey="encryptedBytes"
            label="Sealed size reported by runner"
            format={formatBytes}
            mocked
          />
        </div>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Job duration</h3><span>avg {formatDuration(t.avgDurationMs)}</span></div>
          <LineChart
            rows={model.series}
            valueKey="durationMs"
            label="Capture duration"
            format={formatDuration}
            mocked
          />
        </div>
        <div className="pb-card">
          <div className="pb-card-head"><h3>Drift checks</h3><span>opt-in --report-drift</span></div>
          <div className="pb-grid pb-grid-2">
            <div>
              <div className="pb-kpi-label">Pass (verify-green)</div>
              <div className="pb-kpi-value">{t.driftPass}</div>
            </div>
            <div>
              <div className="pb-kpi-label">Fail counts</div>
              <div className="pb-kpi-value" style={{ color: 'var(--c-danger)' }}>{t.driftFail}</div>
            </div>
          </div>
          <p className="pb-muted" style={{ margin: '12px 0 0', fontSize: 12.5 }}>
            Counts only — MD5 / row-count / RBAC. No table dumps, no object lists.
          </p>
        </div>
      </div>

      <div className="pb-card">
        <div className="pb-card-head"><h3>Status timeline</h3><button type="button" className="pb-btn pb-btn-sm pb-btn-ghost" onClick={() => navigate('alerts')}>Alerts</button></div>
        <div className="pb-timeline">
          {model.timeline.map((e) => (
            <div className="pb-timeline-item" key={e.id}>
              <div className={`pb-timeline-dot ${e.level === 'error' ? 'error' : e.level === 'warn' ? 'warn' : e.level === 'ok' ? 'ok' : 'info'}`} />
              <div>
                <strong style={{ fontSize: 13 }}>{e.type} · {e.summary}</strong>
                <div className="pb-faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {e.projectRef} · {relativeTime(e.occurredAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
