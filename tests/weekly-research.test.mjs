import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, gateCases, windowFor } from '../research/weekly/policy.mjs';
import { response } from '../research/weekly/openai.mjs';
import { collectGithub } from '../research/weekly/github.mjs';
const window = windowFor('2026-10-27T13:17:00Z');
const url = 'https://www.reddit.com/r/Supabase/comments/abc123/case/?utm_source=test';
const good = { url, title: 'Production restore stuck', reportedDate: '2026-10-23', decision: 'recommend', severity: 'critical',
  summary: 'The author reports a failed production restore.', impact: 'Production inaccessible for two days', cause: 'Unknown',
  resolution: 'Author reports restored access', reason: 'Original thread and replies reviewed', duplicateOf: '', evidenceAccess: 'original_and_replies' };
const gate = (changes = {}, sources = [url], known) => gateCases([{ ...good, ...changes }], sources, window, known)[0];
test('window is seven days; backfill is bounded to thirty', () => {
  assert.equal(window.start, '2026-10-20T13:17:00.000Z');
  assert.equal(windowFor(window.end, 30).start, '2026-09-27T13:17:00.000Z');
  assert.throws(() => windowFor(window.end, 31));
});
test('canonicalization deduplicates reddit slugs, tracking, and comments', () => {
  assert.equal(canonical(url), canonical('https://old.reddit.com/r/supabase/comments/abc123/other/comment123'));
  assert.throws(() => canonical('https://github.com/other/repo/issues/12'));
  assert.throws(() => canonical('https://github.com.evil.test/orgs/supabase/discussions/12'));
  assert.throws(() => canonical('http://127.0.0.1/secret'));
});
test('requires observed original URL and substantive replies', () => {
  assert.equal(gate().decision, 'recommend');
  assert.equal(gate({}, []).decision, 'hold');
  assert.equal(gate({ evidenceAccess: 'snippet_only' }).decision, 'hold');
  assert.equal(gate({ evidenceAccess: 'original_only' }).decision, 'hold');
  assert.equal(gate({ severity: 'other' }).decision, 'hold');
});
test('old and future reports cannot masquerade as timely cases', () => {
  for (const reportedDate of ['2026-09-01', '2026-10-28', '', '2026-02-30']) assert.equal(gate({ reportedDate }).decision, 'hold');
  assert.equal(gate({ decision: 'exclude', reportedDate: '' }).decision, 'exclude');
});
test('deduplicates published, prior-reviewed, and cross-posted events', () => {
  assert.equal(gate({}, [url], new Set([canonical(url)])).decision, 'exclude');
  assert.equal(gate({ duplicateOf: 'https://github.com/orgs/supabase/discussions/123' }).decision, 'exclude');
  assert.equal(gateCases([good, good], [url], window)[1].decision, 'exclude');
});
test('resolution and operational impact are mandatory', () => {
  assert.equal(gate({ resolution: '' }).decision, 'hold');
  assert.equal(gate({ impact: '' }).decision, 'hold');
});

test('API rejects incomplete responses and does not expose provider error bodies', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-placeholder';
  try {
    await assert.rejects(response({}, async () => ({ ok: false, status: 401, text: async () => 'private provider detail' })), /^Error: openai_http_401$/);
    await assert.rejects(response({}, async () => ({ ok: true, json: async () => ({ status: 'incomplete' }) })), /response_incomplete/);
    const result = await response({}, async (_url, init) => {
      assert.equal(JSON.parse(init.body).store, false);
      return { ok: true, json: async () => ({ status: 'completed', output: [
        { type: 'web_search_call', action: { sources: [{ url }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'Reviewed' }] },
      ] }) };
    });
    assert.deepEqual(result.sources, [url]);
    assert.equal(result.searchCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('direct collector retains original dates and flags inaccessible replies', async () => {
  const result = await collectGithub(window, async url => url.includes('/search/issues')
    ? { ok: true, json: async () => ({ total_count: 1, items: [{ html_url: 'https://github.com/supabase/supabase/issues/123',
      title: 'Production recovery stuck', body: 'Restore failed', created_at: '2026-10-23T12:00:00Z', state: 'open', comments: 1 }] }) }
    : { ok: false, status: 403 });
  const data = JSON.parse(result.text);
  assert.equal(data.coverage, 'limited');
  assert.equal(data.notes[0].date, '2026-10-23T12:00:00Z');
  assert.equal(data.notes[0].repliesAccessible, false);
  await assert.rejects(collectGithub(window, async () => ({ ok: false, status: 429 })), /github_http_429/);
});
