import React from 'react';

function maxOf(rows, keys) {
  return Math.max(1, ...rows.flatMap((row) => keys.map((k) => Number(row[k]) || 0)));
}

/** Accessible grouped bar chart for success vs fail counts. */
export function DualBarChart({ rows = [], mocked = false }) {
  const max = maxOf(rows, ['success', 'fail']);
  const w = 520;
  const h = 180;
  const pad = { l: 28, r: 8, t: 12, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const group = innerW / Math.max(rows.length, 1);
  return (
    <div className="pb-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Job success versus fail counts by day">
        {rows.map((row, i) => {
          const x = pad.l + i * group;
          const sw = Math.max(4, group * 0.32);
          const sh = (row.success / max) * innerH;
          const fh = (row.fail / max) * innerH;
          return (
            <g key={row.label}>
              <rect x={x + group * 0.18} y={pad.t + innerH - sh} width={sw} height={sh} fill="var(--c-ok)" rx="2" />
              <rect x={x + group * 0.52} y={pad.t + innerH - fh} width={sw} height={fh} fill="var(--c-danger)" rx="2" />
              <text x={x + group / 2} y={h - 8} textAnchor="middle" fill="var(--c-faint)" fontSize="10">{row.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="pb-chart-legend">
        <span><i className="ok" /> Success</span>
        <span><i className="fail" /> Fail</span>
        {mocked && <em>Demo health series</em>}
      </div>
    </div>
  );
}

/** Line chart for duration or encrypted-byte aggregates. */
export function LineChart({
  rows = [],
  valueKey = 'durationMs',
  label = 'Trend',
  format = (n) => String(n),
  mocked = false,
}) {
  const max = maxOf(rows, [valueKey]);
  const w = 520;
  const h = 180;
  const pad = { l: 8, r: 8, t: 16, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const pts = rows.map((row, i) => {
    const x = pad.l + (rows.length <= 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
    const y = pad.t + innerH - ((Number(row[valueKey]) || 0) / max) * innerH;
    return { x, y, row };
  });
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = pts.length
    ? `${d} L${pts[pts.length - 1].x},${pad.t + innerH} L${pts[0].x},${pad.t + innerH} Z`
    : '';
  return (
    <div className="pb-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
        <path d={area} fill="rgba(184,245,74,0.12)" />
        <path d={d} fill="none" stroke="var(--c-acid)" strokeWidth="2.2" />
        {pts.map((p) => (
          <circle key={p.row.label} cx={p.x} cy={p.y} r="3.2" fill="var(--c-acid)" />
        ))}
        {pts.map((p) => (
          <text key={`${p.row.label}-x`} x={p.x} y={h - 8} textAnchor="middle" fill="var(--c-faint)" fontSize="10">{p.row.label}</text>
        ))}
      </svg>
      <div className="pb-chart-legend">
        <span>{label} · max {format(max)}</span>
        {mocked && <em>Demo health series</em>}
      </div>
    </div>
  );
}
