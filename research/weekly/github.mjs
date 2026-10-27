// Direct API collection complements web indexing. No GitHub write scope is needed.
const relevant = /banned|suspend|lock.?out|lost|data loss|delet|restore|backup|unavailable|unreachable|stuck|production|outage|recovery|no space/i;
export async function collectGithub(window, fetcher = fetch) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Portabase-evidence-research',
    ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
  const get = async path => {
    const res = await fetcher(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`github_http_${res.status}`);
    return res.json();
  };
  const query = `org:supabase is:issue created:${window.start.slice(0, 10)}..${window.end.slice(0, 10)}`;
  const items = [];
  let total = 0;
  let limited = false;
  for (let page = 1; page <= 10; page++) {
    const data = await get(`/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=100&page=${page}`);
    if (!Array.isArray(data.items)) throw new Error('github_invalid_response');
    total = data.total_count;
    limited ||= Boolean(data.incomplete_results) || total > 1000;
    items.push(...data.items);
    if (items.length >= total || data.items.length < 100) break;
  }
  const candidates = items.filter(i => relevant.test(`${i.title} ${i.body || ''}`));
  limited ||= candidates.length > 40;
  const evidence = [];
  for (const item of candidates.slice(0, 40)) {
    const repoPath = new URL(item.html_url).pathname;
    let replies = [];
    let repliesAccessible = true;
    try {
      const comments = await get(`/repos${repoPath}/comments?per_page=100`);
      replies = comments.map(c => ({ url: c.html_url, date: c.created_at, body: (c.body || '').slice(0, 3000) }));
      if (item.comments > 100) { repliesAccessible = false; limited = true; }
    } catch { repliesAccessible = false; limited = true; }
    evidence.push({ url: item.html_url, title: item.title, date: item.created_at, body: (item.body || '').slice(0, 8000),
      state: item.state, repliesAccessible, replies });
  }
  return { source: 'github_api', sources: evidence.map(e => e.url), searchCalls: 0,
    text: JSON.stringify({ coverage: limited ? 'limited' : 'searched',
      limitations: `GitHub issues only; discussions use web search. Scanned ${items.length}/${total} issues; ${candidates.length} keyword candidates; inspected ${evidence.length}. Bodies/replies may be truncated; verify original before recommendation.`,
      notes: evidence }),
  };
}
