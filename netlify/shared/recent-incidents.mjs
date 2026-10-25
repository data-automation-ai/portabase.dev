const STATUS_URL = 'https://status.supabase.com/api/v2/incidents.json';
const STATUS_ORIGIN = 'https://status.supabase.com';
const RECENT_DAYS = 90;
const RELEVANT = /project|database|postgres|auth|login|storage|function|api|gateway|endpoint|restore|backup|billing|dashboard|pooler|network|dns|data|outage|unavailable/i;

export function selectRecentIncidents(payload, now = Date.now()) {
  if (!Array.isArray(payload?.incidents)) throw new Error('invalid_status_feed');
  const oldest = now - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return payload.incidents.filter(incident => {
    const date = Date.parse(incident.created_at);
    return typeof incident.id === 'string' && /^[a-zA-Z0-9]+$/.test(incident.id)
      && typeof incident.name === 'string' && incident.name.length <= 200
      && ['major', 'critical'].includes(incident.impact)
      && Number.isFinite(date) && date >= oldest && date <= now
      && RELEVANT.test(incident.name);
  }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 8)
    .map(incident => ({
      id: incident.id,
      title: incident.name,
      date: incident.created_at.slice(0, 10),
      impact: incident.impact,
      status: typeof incident.status === 'string' ? incident.status.replace(/_/g, ' ') : 'reported',
      href: `${STATUS_ORIGIN}/incidents/${incident.id}`,
    }));
}

export async function loadRecentIncidents(fetcher = fetch, now = Date.now()) {
  const response = await fetcher(STATUS_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('status_feed_unavailable');
  return selectRecentIncidents(await response.json(), now);
}
