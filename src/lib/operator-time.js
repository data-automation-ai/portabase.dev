/**
 * Operator-facing timestamps.
 * Louis / DataAutomation are America/New_York. Browser-local is shown when
 * the host timezone is already that zone; otherwise we label ET explicitly.
 * Never invents a "live" clock from demo data — callers pass ISO strings.
 */

export const OPERATOR_TIMEZONE = 'America/New_York';

function validDate(value) {
  if (!value) return null;
  const t = value instanceof Date ? value : new Date(value);
  return Number.isFinite(t.getTime()) ? t : null;
}

export function formatOperatorTime(value, {
  timeZone = OPERATOR_TIMEZONE,
  now = Date.now(),
} = {}) {
  const date = validDate(value);
  if (!date) return { iso: null, absolute: '—', relative: '—', label: '—', timeZone };
  const absolute = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
  const relative = formatRelativeTime(date, now);
  return {
    iso: date.toISOString(),
    absolute,
    relative,
    label: `${relative} · ${absolute}`,
    timeZone,
  };
}

export function formatOperatorTimeShort(value, { timeZone = OPERATOR_TIMEZONE } = {}) {
  const date = validDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export function formatRelativeTime(value, now = Date.now()) {
  const date = validDate(value);
  if (!date) return '—';
  const delta = date.getTime() - Number(now);
  const abs = Math.abs(delta);
  const future = delta > 0;
  const min = Math.round(abs / 60e3);
  const hr = Math.round(abs / 3600e3);
  const day = Math.round(abs / 86400e3);
  let unit;
  if (min < 1) return 'just now';
  if (min < 60) unit = `${min}m`;
  else if (hr < 48) unit = `${hr}h`;
  else unit = `${day}d`;
  return future ? `in ${unit}` : `${unit} ago`;
}

export function jobDurationMs(startedAt, finishedAt) {
  const start = validDate(startedAt);
  const end = validDate(finishedAt);
  if (!start || !end) return 0;
  return Math.max(0, end.getTime() - start.getTime());
}
