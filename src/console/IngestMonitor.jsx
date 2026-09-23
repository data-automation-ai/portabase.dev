import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { formatBytes } from './data/store.js';
import {
  createIngestState,
  applyIngestEvent,
  databaseProgress,
  storageProgress,
  throughput,
  etaSeconds,
  phaseLabel,
} from './data/ingest-stream.js';

/**
 * Live capsule ingestion monitor.
 *
 * Shows, in near real time, which table is being read and how far the capture has actually
 * progressed. Meters are weighted by estimated bytes (pg_total_relation_size), never by table
 * count — see data/ingest-stream.js for why that distinction matters.
 */

const PHASE_ORDER = ['scan', 'database', 'storage', 'functions', 'package', 'encrypt', 'transfer'];

function fmtDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Size-weighted table strip: each table's width is its share of total bytes. */
function TableWeightStrip({ tables, totalBytes }) {
  const segments = useMemo(() => {
    if (!totalBytes) return [];
    // Only render segments wide enough to see; the tail is aggregated so 588 tables
    // don't become 588 sub-pixel slivers that read as visual noise.
    const sorted = [...tables].sort((a, b) => b.bytes - a.bytes);
    const shown = sorted.filter(t => t.bytes / totalBytes >= 0.004).slice(0, 60);
    const restBytes = totalBytes - shown.reduce((s, t) => s + t.bytes, 0);
    const restDone = sorted
      .filter(t => !shown.includes(t) && t.state === 'done')
      .reduce((s, t) => s + t.bytes, 0);
    return [
      ...shown.map(t => ({ key: t.key, pct: (t.bytes / totalBytes) * 100, done: t.state === 'done', label: t.key, bytes: t.bytes })),
      ...(restBytes > 0
        ? [{ key: '__rest__', pct: (restBytes / totalBytes) * 100, done: false, partial: restDone / restBytes, label: `${sorted.length - shown.length} smaller tables`, bytes: restBytes }]
        : []),
    ];
  }, [tables, totalBytes]);

  if (!segments.length) return null;
  return (
    <div className="pb-ing-strip" role="img" aria-label="Capture progress by table size">
      {segments.map(seg => (
        <span
          key={seg.key}
          className={`pb-ing-seg${seg.done ? ' is-done' : ''}`}
          style={{ width: `${seg.pct}%` }}
          title={`${seg.label} · ${formatBytes(seg.bytes)}`}
        >
          {seg.partial > 0 && !seg.done ? <i style={{ width: `${seg.partial * 100}%` }} /> : null}
        </span>
      ))}
    </div>
  );
}

function Meter({ label, ratio, detail, tone = 'acid', note }) {
  const pct = Math.round((ratio || 0) * 100);
  return (
    <div className="pb-ing-meter">
      <div className="pb-ing-meter-head">
        <span className="pb-ing-meter-label">{label}</span>
        <span className="pb-ing-meter-pct" style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
      </div>
      <div
        className={`pb-ing-bar tone-${tone}`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="pb-ing-meter-foot">
        <span>{detail}</span>
        {note ? <span className="pb-ing-note">{note}</span> : null}
      </div>
    </div>
  );
}

export function IngestMonitor({ state: ingest, source, onStop }) {
  const db = databaseProgress(ingest);
  const storage = storageProgress(ingest);
  const rate = throughput(ingest);
  const eta = etaSeconds(ingest);
  const running = ingest.status === 'running';

  const activeTable = ingest.log.find(l => l.phase === 'database')?.text || null;
  const elapsed = ingest.startedAt ? (Date.now() - ingest.startedAt) / 1000 : 0;

  return (
    <div className={`pb-ing${running ? ' is-live' : ''}`}>
      <div className="pb-ing-top">
        <div className="pb-ing-title">
          <span className={`pb-ing-dot state-${ingest.status}`} aria-hidden="true" />
          <div>
            <h3>
              {ingest.status === 'running' ? 'Ingesting' : ingest.status === 'done' ? 'Ingestion complete' : ingest.status === 'failed' ? 'Ingestion failed' : 'Idle'}
              {source ? <span className="pb-ing-src">{source}</span> : null}
            </h3>
            <p className="pb-ing-sub">
              {ingest.status === 'idle'
                ? 'No capture running.'
                : `${phaseLabel(ingest.phase)} · elapsed ${fmtDuration(elapsed)}${rate ? ` · ${formatBytes(rate)}/s` : ''}`}
            </p>
          </div>
        </div>
        {running && onStop ? (
          <button type="button" className="pb-btn pb-btn-ghost pb-btn-sm" onClick={onStop}>Stop</button>
        ) : null}
      </div>

      {ingest.status === 'failed' && ingest.error ? (
        <p className="pb-ing-error" role="alert"><Icon name="warn" size={13} /> {ingest.error}</p>
      ) : null}

      <div className="pb-ing-phases" aria-label="Capture phases">
        {PHASE_ORDER.map(p => {
          const reached = PHASE_ORDER.indexOf(ingest.phase) >= PHASE_ORDER.indexOf(p) || ingest.status === 'done';
          const active = ingest.phase === p && running;
          return (
            <span key={p} className={`pb-ing-phase${reached ? ' is-reached' : ''}${active ? ' is-active' : ''}`}>
              {phaseLabel(p)}
            </span>
          );
        })}
      </div>

      <div className="pb-ing-meters">
        <Meter
          label="Database"
          ratio={db.ratio}
          tone="acid"
          detail={db.basis === 'bytes'
            ? `${formatBytes(db.done)} of ${formatBytes(db.total)} · ${ingest.tablesDone}/${ingest.tables.length || '—'} tables`
            : `${db.done}/${db.total} tables`}
          note={db.basis === 'count' ? 'estimated by table count — engine sent no size data' : null}
        />
        <Meter
          label="Storage objects"
          ratio={storage.ratio}
          tone="info"
          detail={storage.total
            ? `${storage.completed.toLocaleString()} / ${storage.total.toLocaleString()} objects · ${formatBytes(ingest.storage.bytes)}`
            : 'no objects yet'}
        />
      </div>

      {ingest.totalTableBytes > 0 ? (
        <div className="pb-ing-block">
          <div className="pb-ing-block-head">
            <span>Tables by size</span>
            <span className="pb-ing-eta">{running && eta != null ? `~${fmtDuration(eta)} remaining` : ''}</span>
          </div>
          <TableWeightStrip tables={ingest.tables} totalBytes={ingest.totalTableBytes} />
          <p className="pb-ing-legend">
            Width = share of total bytes. Filled = captured. Largest tables dominate the run.
          </p>
        </div>
      ) : null}

      <div className="pb-ing-live">
        <div className="pb-ing-block-head">
          <span>{running ? 'Now reading' : 'Last read'}</span>
          {ingest.storage.current ? <span className="pb-ing-eta">{ingest.storage.completed.toLocaleString()} objects</span> : null}
        </div>
        <p className="pb-ing-current mono">
          {ingest.status === 'done'
            ? `Capture ${ingest.captureStatus || 'finished'} — nothing in flight`
            : activeTable || ingest.storage.current || ingest.functions.current || (running ? 'starting…' : '—')}
        </p>
        <ul className="pb-ing-feed">
          {ingest.log.slice(0, 14).map((entry, i) => (
            <li key={`${entry.at}-${i}`} className={`ph-${entry.phase}`}>
              <span className="pb-ing-feed-phase">{entry.phase}</span>
              <span className="pb-ing-feed-text mono">{entry.text}</span>
              {entry.rows ? <span className="pb-ing-feed-meta">{entry.rows.toLocaleString()} rows</span> : null}
              {entry.bytes ? <span className="pb-ing-feed-meta">{formatBytes(entry.bytes)}</span> : null}
            </li>
          ))}
          {!ingest.log.length ? <li className="pb-ing-feed-empty">Waiting for the first event…</li> : null}
        </ul>
      </div>
    </div>
  );
}

/**
 * Drives IngestMonitor from a live event source.
 * `subscribe` receives a callback for each parsed event and returns an unsubscribe function,
 * which keeps this component independent of transport (SSE, websocket, or the demo replayer).
 */
export function useIngestStream(subscribe) {
  const [state, setState] = useState(createIngestState);
  const reset = useCallback(() => setState(createIngestState()), []);
  const subRef = useRef(subscribe);
  subRef.current = subscribe;

  useEffect(() => {
    if (!subscribe) return undefined;
    const off = subscribe(event => setState(prev => applyIngestEvent(prev, event)));
    return () => { if (typeof off === 'function') off(); };
  }, [subscribe]);

  return [state, reset];
}
