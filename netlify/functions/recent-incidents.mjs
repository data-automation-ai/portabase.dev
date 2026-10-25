import { loadRecentIncidents } from '../shared/recent-incidents.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const incidents = await loadRecentIncidents();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=900' },
      body: JSON.stringify({ source: 'Supabase Status', incidents }),
    };
  } catch {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'status_feed_unavailable' }),
    };
  }
}
