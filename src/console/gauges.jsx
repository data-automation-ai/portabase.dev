import React from 'react';

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function toneColor(tone) {
  if (tone === 'ok') return 'var(--c-ok)';
  if (tone === 'warn') return 'var(--c-warn)';
  if (tone === 'danger') return 'var(--c-danger)';
  if (tone === 'info') return 'var(--c-info)';
  return 'var(--c-acid)';
}

/** Accessible circular gauge. value 0–100. */
export function RingGauge({
  value = 0,
  label,
  detail,
  tone = 'ok',
  size = 132,
  mocked = false,
}) {
  const pct = clamp(Number(value) || 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = toneColor(tone);
  const title = `${label}: ${Math.round(pct)} percent${mocked ? ' (demo data)' : ''}`;
  return (
    <div className="pb-gauge" role="img" aria-label={title}>
      <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--c-border)" strokeWidth="10" />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 66 66)"
        />
        <text x="66" y="62" textAnchor="middle" fill="var(--c-text)" fontSize="22" fontWeight="700">{Math.round(pct)}</text>
        <text x="66" y="80" textAnchor="middle" fill="var(--c-faint)" fontSize="10">%</text>
      </svg>
      <div className="pb-gauge-copy">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
        {mocked && <em>Demo data</em>}
      </div>
    </div>
  );
}

export function BarGauge({
  used = 0,
  cap = 1,
  label,
  usedLabel,
  capLabel,
  tone = 'ok',
  mocked = false,
}) {
  const pct = cap > 0 ? clamp((used / cap) * 100) : 0;
  const color = toneColor(tone);
  return (
    <div className="pb-bar-gauge">
      <div className="pb-inline">
        <strong style={{ fontSize: 13 }}>{label}</strong>
        <span className="pb-mono pb-right pb-faint">{usedLabel} / {capLabel}</span>
      </div>
      <div className="pb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
      {mocked && <div className="pb-faint" style={{ marginTop: 6, fontSize: 11 }}>Demo data — live usage API not connected</div>}
    </div>
  );
}

export function StatusPip({ tone = 'ok', label }) {
  return (
    <span className={`pb-badge pb-badge-${tone === 'online' || tone === 'healthy' ? 'ok' : tone}`}>
      <span className="pb-dot" /> {label}
    </span>
  );
}
