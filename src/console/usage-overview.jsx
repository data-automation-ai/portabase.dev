import React from 'react';
import { usageBytes, usageDate, usageDuration, usageView } from './usage-overview.mjs';
import './usage-overview.css';

export function UsageOverview({ snapshot, loading = false, refreshing = false, onRefresh, demoMode = false }) {
  const view = usageView(demoMode ? {} : snapshot);
  const usage = demoMode ? null : snapshot?.usage;
  const runtime = demoMode ? null : snapshot?.runnerUsage;
  const beacon = demoMode ? null : snapshot?.beaconUsage;
  const backup = view.available ? usage.lastBackup : null;
  const period = usage?.periodStart && usage?.periodEnd ? `${usageDate(usage.periodStart)} – ${usageDate(usage.periodEnd)}` : '30-day allowance';
  const noData = loading ? 'Loading usage…' : demoMode ? 'Live usage is unavailable in demo mode.' : !view.available ? 'Usage is unavailable. Refresh to try again.' : !view.recorded ? 'No metered jobs yet. Your allowance starts with the first recorded run.' : null;
  return <section className="pb-usage" aria-labelledby="usage-title">
    <header className="pb-usage-head">
      <div><span className="pb-usage-eyebrow">YOUR RECOVERY ACTIVITY</span><h2 id="usage-title">Every run, accounted for.</h2></div>
      <div className="pb-usage-period"><span>{period}</span><button type="button" onClick={onRefresh} disabled={refreshing || loading || demoMode} aria-label="Refresh usage">{refreshing ? 'Refreshing…' : '↻ Refresh'}</button></div>
    </header>
    {noData && <p className="pb-usage-notice" role="status">{noData}</p>}
    <div className="pb-usage-metrics">
      <article className="pb-usage-runtime">
        <h3>Runner hours</h3><div className="pb-usage-number">{view.runnerHours ?? '—'} <small>hrs</small></div>
        <p>{view.runtimeMeasured ? 'Measured cloud runner uptime' : runtime?.status === 'no_samples' ? 'No uptime samples reported yet' : 'Uptime readings unavailable'}</p>
        <span className="pb-usage-footnote">{runtime?.windowStart ? `${usageDate(runtime.windowStart)} – ${usageDate(runtime.windowEnd)}` : 'Last 30 days'} · readings can lag 5 minutes</span>
      </article>
      <article className="pb-usage-transfer">
        <div className="pb-usage-metric-label"><h3>Transfer allowance</h3>{view.allowance && <span>{usageBytes(view.allowance)} / 30 days</span>}</div>
        <div className="pb-usage-number">{usageBytes(view.charged)} <small>used</small></div>
        <div className="pb-usage-track" role={view.usedPercent === null ? undefined : 'meter'} aria-label="Transfer allowance used" aria-valuemin={0} aria-valuemax={view.allowance ?? undefined} aria-valuenow={view.charged ?? undefined} aria-valuetext={view.charged === null ? undefined : `${usageBytes(view.charged)} of ${usageBytes(view.allowance)}`}><span style={{width:`${view.usedPercent ?? 0}%`}} /></div>
        <p>{view.remaining !== null ? `${usageBytes(view.remaining)} available` : 'Allowance usage not yet recorded'}{view.recorded && usage.reservedBytes > 0 ? ` · ${usageBytes(usage.reservedBytes)} reserved` : ''}</p>
        <span className="pb-usage-footnote">{usage?.accountingEstimated ? 'Interrupted runs retain reserved allowance; actual bytes are unconfirmed' : view.recorded ? `${usageBytes(usage.outboundBytes)} total outbound` : 'Outbound transfers'}{view.allowance ? ' · initial binary snapshot covered by Portabase' : ''}</span>
      </article>
      <article className="pb-usage-jobs">
        <h3>Job results</h3><div className="pb-usage-outcomes"><div><strong>{view.recorded ? usage.succeeded : '—'}</strong><span><i className="pb-usage-dot"/>Succeeded</span></div><div><strong>{view.recorded ? usage.failed : '—'}</strong><span><i className="pb-usage-dot failed"/>Failed</span></div></div>
        <p>{view.recorded ? `${usage.running} in progress` : 'Backup and restore jobs'}</p><span className="pb-usage-footnote">Free keep-alive beacons reported separately</span>
      </article>
    </div>
    <div className="pb-usage-detail">
      <article className={`pb-usage-receipt ${view.verification.tone}`}>
        <div className="pb-usage-receipt-head"><h3>Last backup</h3><time dateTime={backup?.startedAt}>{backup ? usageDate(backup.startedAt, true) : 'No recorded backup'}</time></div>
        <div className="pb-usage-receipt-body"><span className="pb-usage-seal" aria-hidden="true">{view.verification.tone === 'verified' ? '✓' : view.verification.tone === 'failed' ? '!' : '·'}</span><div><strong>{!view.available ? 'Backup status unavailable' : view.verification.title}</strong><p>{!view.available ? 'Refresh to retrieve the latest backup receipt.' : view.verification.detail}</p></div></div>
        <dl className="pb-usage-receipt-stats"><div><dt>Duration</dt><dd>{usageDuration(backup?.durationMs)}</dd></div><div><dt>Bytes transferred</dt><dd title={typeof backup?.outboundBytes === 'number' ? `${backup.outboundBytes.toLocaleString()} bytes` : undefined}>{usageBytes(backup?.outboundBytes)}</dd></div><div><dt>Manifest</dt><dd>{backup?.status === 'succeeded' && backup?.manifestVerified === true ? 'Verified' : backup ? 'Not verified' : '—'}</dd></div></dl>
      </article>
      <article className="pb-usage-beacon">
        <div className="pb-usage-beacon-head"><h3>Destination keep-alive</h3><span>FREE</span></div>
        <strong>{beacon?.available !== true ? 'Beacon status unavailable' : beacon.lastBeacon?.status === 'succeeded' ? 'Last beacon succeeded' : beacon.lastBeacon?.status === 'failed' ? 'Last beacon failed' : 'No beacon result recorded'}</strong>
        <p>An opted-in destination receives a database query every 3 days to help prevent inactivity pauses.</p>
        <div className="pb-usage-beacon-meta">{beacon?.available === true ? `${beacon.jobsSucceeded ?? 0} succeeded · ${beacon.jobsFailed ?? 0} failed in 30 days` : 'Requires destination authorization and opt-in.'}{beacon?.lastBeacon?.finishedAt && <span> · {usageDate(beacon.lastBeacon.finishedAt, true)}</span>}</div>
        <span className="pb-usage-footnote">No charge against your transfer allowance. Provider availability is not guaranteed.</span>
      </article>
    </div>
  </section>;
}
