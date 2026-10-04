// Rank the reported consequence, not the credibility of a claim or its cause.
export function incidentImpact(story) {
  const text = `${story.tag} ${story.title}`.toLowerCase();
  if (/banned|takeover|project deleted|table deleted|data loss|empty restore|missing files/.test(text)) return 0;
  if (/identity|lockout|billing freeze|production|database unreachable|multi-service|platform outage|unavailable|unreachable/.test(text)) return 1;
  if (/restore|export blocked|backup|restricted|stuck|critical|ten days/.test(text)) return 2;
  if (/login|dashboard|endpoint|major|hardware/.test(text)) return 3;
  return 4;
}

export function incidentDate(story) {
  if (story.date) return story.date;
  const label = story.source.split('·').at(-1).trim();
  const year = label.match(/\b(20\d{2})\b/)?.[1] || '0000';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months.findIndex(value => label.startsWith(value)) + 1;
  const day = label.match(/^[A-Za-z]+\s+(\d{1,2})(?:\D|$)/)?.[1] || '00';
  // Unknown days/months remain unknown; a later comment does not redate a case.
  return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function incidentKey(href) {
  const url = new URL(href);
  const redditId = url.pathname.match(/\/comments\/([^/]+)/)?.[1];
  return redditId ? `reddit:${redditId}` : `${url.hostname}${url.pathname.replace(/\/$/, '')}`;
}

export function sortIncidents(stories, order = 'recent') {
  return [...stories].sort((a, b) => {
    const ad = incidentDate(a);
    const bd = incidentDate(b);
    const period = order === 'impact' ? 4 : 7;
    return bd.slice(0, period).localeCompare(ad.slice(0, period))
      || incidentImpact(a) - incidentImpact(b)
      || bd.localeCompare(ad)
      || a.id.localeCompare(b.id);
  });
}
