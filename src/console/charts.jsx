import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const C = {
  ok: '#0f9f6e',
  danger: '#dc3d3d',
  acid: '#0e7c74',
  info: '#0e7c74',
  faint: '#6b7c76',
  muted: '#4b5c57',
  text: '#12241f',
  grid: '#d7e3df',
  panel: '#eef4f2',
  border: '#b7c9c3',
};

function hexFromCss(color, fallback) {
  if (!color) return fallback;
  if (color.startsWith('#')) return color;
  if (color === 'var(--c-ok)') return C.ok;
  if (color === 'var(--c-danger)') return C.danger;
  if (color === 'var(--c-acid)') return C.acid;
  if (color === 'var(--c-info)') return C.info;
  return fallback;
}

function ChartFrame({ children, mocked, empty, emptyLabel }) {
  if (empty) return <EmptyChart label={emptyLabel} />;
  return (
    <div className={`pb-chart${mocked ? ' is-sample' : ''}`}>
      {mocked && <span className="pb-sample-chip">SAMPLE</span>}
      <div className="pb-chart-canvas">{children}</div>
    </div>
  );
}

function DarkTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="pb-chart-tip">
      <strong>{label}</strong>
      {payload.map((row) => (
        <div key={row.dataKey}>
          <i style={{ background: row.color }} />
          {row.name}: {formatter ? formatter(row.value, row.dataKey) : row.value}
        </div>
      ))}
    </div>
  );
}

function axisTick(value) {
  return String(value);
}

/** Grouped bar chart for success vs fail counts. */
export function DualBarChart({ rows = [], mocked = false }) {
  const empty = !rows.length || rows.every((row) => !(row.success || row.fail));
  return (
    <ChartFrame mocked={mocked} empty={empty} emptyLabel="No success / fail counts yet.">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} barGap={4} barCategoryGap="28%">
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: C.faint, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: C.faint, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
          <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Legend wrapperStyle={{ color: C.muted, fontSize: 12 }} />
          <Bar dataKey="success" name="Success" fill={C.ok} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="fail" name="Fail" fill={C.danger} radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Area chart for duration or sealed-byte aggregates. */
export function LineChart({
  rows = [],
  valueKey = 'durationMs',
  label = 'Trend',
  format = (n) => String(n),
  mocked = false,
}) {
  const empty = !rows.length || rows.every((row) => !(Number(row[valueKey]) || 0));
  return (
    <ChartFrame mocked={mocked} empty={empty} emptyLabel={`No ${label.toLowerCase()} yet.`}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={rows}>
          <defs>
            <linearGradient id={`pb-area-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.acid} stopOpacity={0.28} />
              <stop offset="100%" stopColor={C.acid} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: C.faint, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: C.faint, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
            tickFormatter={(v) => axisTick(format(v))}
          />
          <Tooltip content={<DarkTooltip formatter={(v) => format(v)} />} />
          <Area
            type="monotone"
            dataKey={valueKey}
            name={label}
            stroke={C.acid}
            strokeWidth={2}
            fill={`url(#pb-area-${valueKey})`}
            dot={{ r: 3, fill: C.acid, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function StackedBarChart({
  rows = [],
  keys = [
    { id: 'database', color: 'var(--c-info)' },
    { id: 'storage', color: 'var(--c-acid)' },
    { id: 'functions', color: 'var(--c-ok)' },
  ],
  format = (n) => String(n),
  mocked = false,
  emptyLabel = 'No capsule sizes yet',
}) {
  const empty = !rows.length || rows.every((row) => keys.every((k) => !(Number(row[k.id]) || 0)));
  return (
    <ChartFrame mocked={mocked} empty={empty} emptyLabel={emptyLabel}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} barCategoryGap="32%">
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: C.faint, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: C.faint, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
            tickFormatter={(v) => format(v)}
          />
          <Tooltip content={<DarkTooltip formatter={(v) => format(v)} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {keys.map((k) => (
            <Bar
              key={k.id}
              dataKey={k.id}
              name={k.id}
              stackId="layers"
              fill={hexFromCss(k.color, C.acid)}
              maxBarSize={28}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function EmptyChart({ label = 'No jobs yet' }) {
  return (
    <div className="pb-chart pb-chart-empty">
      <div>
        <strong>Nothing to plot</strong>
        <p>{label}</p>
      </div>
    </div>
  );
}
