import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { formatHumanSize } from '../lib/human-size.js';
import {
  applySelection,
  controlPlaneJobSpec,
  meterPlanCards,
  planFit,
  recommendPlan,
  sampleSizeInventory,
  suggestExcludesToFit,
  summarizeSelection,
  unmeasuredItems,
} from '../lib/table-sizer.js';

function Bar({ ratio, over }) {
  const pct = Math.min(100, Math.max(0, Math.round((ratio || 0) * 100)));
  return (
    <div className={`pb-sizer-bar${over ? ' is-over' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function RowToggle({ checked, onChange, label, meta, size, tone }) {
  return (
    <label className={`pb-sizer-row${checked ? '' : ' is-off'}${tone === 'danger' ? ' is-omit' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="pb-sizer-row-main">
        <strong className="pb-mono">{label}</strong>
        <em>{meta}</em>
      </span>
      <span className="pb-sizer-row-size pb-mono">
        {!checked && <b className="pb-sizer-omit-tag">NOT COVERED</b>}
        {size}
      </span>
    </label>
  );
}

export function TableSizer({
  inventory,
  planId = 'cloud-free',
  onPlanId,
  selection,
  onSelection,
  excludeBinaries = false,
  onExcludeBinaries,
  demo = false,
  compact = false,
}) {
  const inv = inventory?.empty === false || inventory?.tables
    ? inventory
    : (demo ? sampleSizeInventory() : inventory);
  const cards = meterPlanCards();
  const applied = useMemo(() => applySelection(inv, selection), [inv, selection]);
  const summary = useMemo(() => summarizeSelection(inv, selection), [inv, selection]);
  const fit = planFit(summary.includedBytes, planId);
  const recommended = useMemo(() => recommendPlan(summary.includedBytes), [summary.includedBytes]);
  const unmeasured = useMemo(() => unmeasuredItems(inv), [inv]);
  const spec = useMemo(
    () => controlPlaneJobSpec({ inventory: inv, selection, planId, excludeBinaries }),
    [inv, selection, planId, excludeBinaries],
  );

  const toggleTable = (key, included) => {
    const nextInclude = applied.tables.filter((row) => (row.key === key ? included : row.included)).map((row) => row.key);
    const nextExclude = applied.tables.filter((row) => (row.key === key ? !included : !row.included)).map((row) => row.key);
    onSelection?.({
      ...selection,
      includeTables: nextInclude,
      excludeTables: nextExclude,
    });
  };
  const toggleBucket = (key, included) => {
    const nextInclude = applied.buckets.filter((row) => (row.key === key ? included : row.included)).map((row) => row.key);
    const nextExclude = applied.buckets.filter((row) => (row.key === key ? !included : !row.included)).map((row) => row.key);
    onSelection?.({
      ...selection,
      includeBuckets: nextInclude,
      excludeBuckets: nextExclude,
    });
  };
  const setAll = (kind, included) => {
    if (kind === 'tables') {
      onSelection?.({
        ...selection,
        includeTables: included ? applied.tables.map((row) => row.key) : [],
        excludeTables: included ? [] : applied.tables.map((row) => row.key),
      });
    } else {
      onSelection?.({
        ...selection,
        includeBuckets: included ? applied.buckets.map((row) => row.key) : [],
        excludeBuckets: included ? [] : applied.buckets.map((row) => row.key),
      });
    }
  };

  if (!inv || inv.empty) {
    return (
      <div className="pb-empty">
        <Icon name="table" size={28} />
        <h3>No size inventory yet</h3>
        <p>
          Per-table and per-bucket sizes come from the free engine doctor / size inventory
          (<code className="pb-mono">portabase doctor</code> and capture). Cloud does not add a new CLI flag.
          Keys stay sealed to the runner.
        </p>
      </div>
    );
  }

  return (
    <div className={`pb-sizer${compact ? ' is-compact' : ''}`}>
      {(demo || inv.mocked) && (
        <div className="pb-sample-banner" role="status">
          <span className="pb-sample-chip">SAMPLE</span>
          <strong>Doctor / size inventory</strong>
          <p>{inv.labeled}</p>
        </div>
      )}

      <div className="pb-sizer-plans" role="radiogroup" aria-label="Plan cap to fit">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            role="radio"
            aria-checked={planId === card.id}
            className={`pb-sizer-plan${planId === card.id ? ' is-on' : ''}`}
            onClick={() => onPlanId?.(card.id)}
          >
            <small>{card.title}</small>
            <b>{card.capLabel}</b>
            <span>{card.cadence}</span>
          </button>
        ))}
      </div>

      <div className={`pb-sizer-fit${fit.overCap ? ' is-over' : ' is-ok'}`}>
        <div>
          <strong>{fit.overCap ? 'Over plan cap' : 'Fits plan cap'}</strong>
          <p>
            Selected estimate {formatHumanSize(fit.usedBytes)} of {fit.capLabel}
            {fit.overCap ? ` · over by ${formatHumanSize(fit.overByBytes)}` : ` · ${formatHumanSize(fit.remainingBytes)} remaining`}.
            Exclude tables or buckets so the capsule fits Cloud Free 100 MB, $7 10 GB, or $17 25 GB.
            Smallest public cap that fits this selection: <strong>{recommended.shortLabel}</strong>
            {recommended.stillOver ? ' (still over $17 25 GB)' : ''}.
          </p>
        </div>
        <div className="pb-sizer-fit-num pb-mono">{fit.percent}%</div>
      </div>
      <Bar ratio={fit.ratio} over={fit.overCap} />
      {fit.overCap && (
        <div className="pb-inline">
          <button
            type="button"
            className="pb-btn pb-btn-sm"
            onClick={() => {
              const suggestion = suggestExcludesToFit(inv, planId);
              onSelection?.({ ...selection, ...suggestion.selection });
            }}
          >
            Fit this plan (omit largest)
          </button>
        </div>
      )}

      {unmeasured.loud && (
        <div className="pb-callout warn" role="status">
          <Icon name="warn" size={16} />
          <div>
            <strong>{unmeasured.headline}</strong>
            <p>Unmeasured items stay in the include list but cannot prove they fit. Run <code className="pb-mono">portabase doctor</code> on the runner for sizes. Cloud does not invent bytes.</p>
          </div>
        </div>
      )}

      {summary.notCoverage.loud && (
        <div className="pb-callout danger pb-sizer-loud" role="alert">
          <Icon name="warn" size={18} />
          <div>
            <strong>{summary.notCoverage.headline}</strong>
            <p>{summary.notCoverage.detail}</p>
            <p className="pb-sizer-omit-list pb-mono">{summary.notCoverage.names.join(' · ')}</p>
          </div>
        </div>
      )}

      <div className="pb-sizer-split">
        <section className="pb-card">
          <div className="pb-card-head">
            <h3>Tables</h3>
            <span>
              {summary.omittedTables.length > 0 && <b className="pb-sizer-omit-tag">NOT COVERED · {summary.omittedTables.length}</b>}
              {summary.includedTables.length}/{applied.tables.length} · {formatHumanSize(summary.includedTableBytes)}
            </span>
          </div>
          <div className="pb-inline" style={{ marginBottom: 10 }}>
            <button type="button" className="pb-btn pb-btn-sm" onClick={() => setAll('tables', true)}>Include all</button>
            <button type="button" className="pb-btn pb-btn-sm" onClick={() => setAll('tables', false)}>Exclude all</button>
          </div>
          <div className="pb-sizer-list">
            {[...applied.tables].sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0)).map((row) => (
              <RowToggle
                key={row.key}
                checked={row.included}
                onChange={(on) => toggleTable(row.key, on)}
                label={row.key}
                meta={row.rows ? `${row.rows.toLocaleString()} rows` : 'row count not in inventory'}
                size={row.sizeBytes ? formatHumanSize(row.sizeBytes) : 'size n/a'}
                tone={row.included ? '' : 'danger'}
              />
            ))}
          </div>
        </section>

        <section className="pb-card">
          <div className="pb-card-head">
            <h3>Storage buckets</h3>
            <span>
              {summary.omittedBuckets.length > 0 && <b className="pb-sizer-omit-tag">NOT COVERED · {summary.omittedBuckets.length}</b>}
              {summary.includedBuckets.length}/{applied.buckets.length} · {formatHumanSize(summary.includedBucketBytes)}
            </span>
          </div>
          <div className="pb-inline" style={{ marginBottom: 10 }}>
            <button type="button" className="pb-btn pb-btn-sm" onClick={() => setAll('buckets', true)}>Include all</button>
            <button type="button" className="pb-btn pb-btn-sm" onClick={() => setAll('buckets', false)}>Exclude all</button>
          </div>
          <div className="pb-sizer-list">
            {[...applied.buckets].sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0)).map((row) => (
              <RowToggle
                key={row.key}
                checked={row.included}
                onChange={(on) => toggleBucket(row.key, on)}
                label={row.key}
                meta={row.objectCount ? `${row.objectCount.toLocaleString()} objects` : 'object count not in inventory'}
                size={row.sizeBytes ? formatHumanSize(row.sizeBytes) : 'size n/a'}
                tone={row.included ? '' : 'danger'}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="pb-card">
        <div className="pb-card-head">
          <h3>What Cloud may store</h3>
          <span>include list + estimates</span>
        </div>
        <p className="pb-muted" style={{ marginTop: 0 }}>
          Keys stay sealed to the runner. The control plane receives the include list, size estimates, and job metadata / hashes — never keys, passphrase, or row bodies.
          Table omit uses existing <code className="pb-mono">--exclude-table-list</code>. Bucket include is Cloud job metadata — no new CLI capture flag.
        </p>
        <label className="pb-check">
          <input
            type="checkbox"
            checked={Boolean(excludeBinaries)}
            onChange={(e) => onExcludeBinaries?.(e.target.checked)}
          />
          <span>Also pass existing <code className="pb-mono">--exclude-binaries</code></span>
        </label>
        {spec.engineFlags.excludeTableList && (
          <p className="pb-mono pb-sizer-flag">--exclude-table-list {spec.engineFlags.excludeTableList}</p>
        )}
      </div>
    </div>
  );
}

export function JobSetupWizard({
  inventory,
  demo = false,
  planId: initialPlan = 'cloud-free',
  onClose,
  onConfirm,
  toast,
}) {
  const [step, setStep] = useState(0);
  const [planId, setPlanId] = useState(initialPlan);
  const [selection, setSelection] = useState({});
  const [excludeBinaries, setExcludeBinaries] = useState(false);
  const inv = inventory?.tables ? inventory : (demo ? sampleSizeInventory() : inventory);
  const spec = controlPlaneJobSpec({ inventory: inv, selection, planId, excludeBinaries });
  const steps = ['Plan cap', 'Include list', 'Review'];

  const confirm = () => {
    onConfirm?.(spec);
    toast?.('Job include list saved — keys stay on the runner', 'ok');
    onClose?.();
  };

  return (
    <div className="pb-modal-backdrop" onClick={onClose} role="presentation">
      <div className="pb-modal pb-modal-lg pb-sizer-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="sizer-wizard-title">
        <div className="pb-modal-head">
          <h2 id="sizer-wizard-title">New Cloud job · table + bucket sizer</h2>
          <button type="button" className="pb-btn pb-btn-icon pb-btn-ghost" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="pb-modal-body">
          <ol className="pb-wizard" aria-label="Job setup steps">
            {steps.map((label, i) => (
              <li key={label} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}>
                <span>{i + 1}</span>{label}
              </li>
            ))}
          </ol>
          {step === 0 && (
            <>
              <p className="pb-muted">Pick the cap this capsule must fit. Cloud Free is 100 MB, manual only. $7 is one database up to 10 GB, 1 capsule / 24h. $17 is unlimited databases up to 25 GB, 3 capsules / day.</p>
              <TableSizer
                inventory={inv}
                planId={planId}
                onPlanId={setPlanId}
                selection={selection}
                onSelection={setSelection}
                excludeBinaries={excludeBinaries}
                onExcludeBinaries={setExcludeBinaries}
                demo={demo}
                compact
              />
            </>
          )}
          {step === 1 && (
            <TableSizer
              inventory={inv}
              planId={planId}
              onPlanId={setPlanId}
              selection={selection}
              onSelection={setSelection}
              excludeBinaries={excludeBinaries}
              onExcludeBinaries={setExcludeBinaries}
              demo={demo}
            />
          )}
          {step === 2 && (
            <div className="pb-stack">
              {spec.notCoverage.loud && (
                <div className="pb-callout danger pb-sizer-loud" role="alert">
                  <Icon name="warn" size={18} />
                  <div>
                    <strong>{spec.notCoverage.headline}</strong>
                    <p>{spec.notCoverage.detail}</p>
                  </div>
                </div>
              )}
              <div className={`pb-sizer-fit${spec.fits ? ' is-ok' : ' is-over'}`}>
                <div>
                  <strong>{spec.fits ? 'Ready to run' : 'Still over cap'}</strong>
                  <p>
                    Estimate {formatHumanSize(spec.estimatedBytes)} against {formatHumanSize(spec.planCapBytes)}.
                    Control plane payload is the include list and estimates only.
                  </p>
                </div>
              </div>
              <dl className="pb-drawer-dl">
                <div><dt>Include tables</dt><dd className="mono">{spec.includeTables.join(', ') || '—'}</dd></div>
                <div><dt>Omit tables</dt><dd className="mono">{spec.excludeTables.join(', ') || 'none'}</dd></div>
                <div><dt>Include buckets</dt><dd className="mono">{spec.includeBuckets.join(', ') || '—'}</dd></div>
                <div><dt>Omit buckets</dt><dd className="mono">{spec.excludeBuckets.join(', ') || 'none'}</dd></div>
                <div><dt>Engine flag</dt><dd className="mono">{spec.engineFlags.excludeTableList ? `--exclude-table-list ${spec.engineFlags.excludeTableList}` : 'none (full table set)'}</dd></div>
              </dl>
            </div>
          )}
        </div>
        <div className="pb-modal-foot">
          <button type="button" className="pb-btn" onClick={onClose}>Cancel</button>
          {step > 0 && <button type="button" className="pb-btn" onClick={() => setStep(step - 1)}>Back</button>}
          {step < 2 && <button type="button" className="pb-btn pb-btn-primary" onClick={() => setStep(step + 1)}>Continue</button>}
          {step === 2 && (
            <button type="button" className="pb-btn pb-btn-primary" onClick={confirm}>
              Save include list
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
