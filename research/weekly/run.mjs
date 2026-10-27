import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nightmares } from '../../src/data/nightmares.js';
import { SOURCES, canonical, gateCases, windowFor } from './policy.mjs';
import { discover, review } from './openai.mjs';

const output = resolve(process.env.RESEARCH_OUTPUT || 'research-output');
if (/^f:/i.test(output)) throw new Error('forbidden_output_drive');
const window = windowFor(process.env.RESEARCH_END || new Date().toISOString(), Number(process.env.RESEARCH_DAYS || 7));
const report = { version: 1, window, generatedAt: new Date().toISOString(), status: 'running', coverage: [], cases: [], errors: [] };
await mkdir(output, { recursive: true });
const safe = value => String(value).replace(/[<>]/g, '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').slice(0, 1500);
const key = url => { try { return canonical(url); } catch { return null; } };
const knownCases = nightmares.map(c => ({ url: c.href, title: c.title, summary: c.body }));
let previous = [];
try {
  if (process.env.RESEARCH_PREVIOUS) {
    const data = JSON.parse(await readFile(resolve(process.env.RESEARCH_PREVIOUS), 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.cases)) throw new Error('invalid_previous_ledger');
    previous = data.cases;
    knownCases.push(...previous);
  }
  const discoveries = [];
  for (const source of SOURCES) {
    console.log(`Researching ${source.id}`);
    try {
      const result = await discover(source, window);
      if (!result.searchCalls) throw new Error('no_search_performed');
      const access = JSON.parse(result.text);
      if (!['searched', 'limited', 'blocked'].includes(access.coverage)) throw new Error('invalid_source_coverage');
      discoveries.push({ source: source.id, ...result });
      report.coverage.push({ source: source.id, status: access.coverage, limitations: access.limitations, urls: result.sources, searchCalls: result.searchCalls });
      if (access.coverage === 'blocked') report.errors.push({ stage: source.id, code: 'source_access_blocked' });
    } catch (error) {
      report.coverage.push({ source: source.id, status: 'failed' });
      report.errors.push({ stage: source.id, code: /^openai_|^no_search|^missing_openai/.test(error.message) ? error.message : 'source_failed' });
    }
  }
  if (discoveries.length) {
    console.log('Reviewing evidence');
    const result = await review(discoveries, window, knownCases);
    const parsed = JSON.parse(result.text);
    if (!Array.isArray(parsed.cases)) throw new Error('invalid_review');
    report.cases = gateCases(parsed.cases, [...discoveries.flatMap(d => d.sources), ...result.sources], window,
      new Set(knownCases.map(c => key(c.url)).filter(Boolean)));
    report.model = result.model;
    report.usage = [ ...discoveries.map(d => d.usage), result.usage ];
    // Evidence notes are drafts; the site does not import this directory.
    await writeFile(resolve(output, 'discovery.json'), JSON.stringify(discoveries, null, 2));
  }
  report.status = report.errors.length ? 'partial' : 'reviewed';
} catch {
  report.status = 'failed';
  report.errors.push({ stage: 'review', code: 'review_or_history_failed' });
} finally {
  const ledger = new Map(previous.map(c => [key(c.url), c]));
  for (const c of report.cases) {
    // Holds remain eligible for another attempt; retained recommendations are drafts, not published cases.
    if (c.decision === 'recommend') ledger.set(key(c.url), { url: c.url, title: c.title, summary: c.summary, reportedDate: c.reportedDate });
  }
  await writeFile(resolve(output, 'ledger.json'), JSON.stringify({ version: 1, cases: [...ledger.values()] }, null, 2));
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  const lines = ['# Weekly Supabase evidence review', '', `Window: ${window.start} through ${window.end}. Status: **${report.status}**.`, '',
    'Draft research only. Search coverage is not exhaustive. No case is automatically published.', '',
    '## Coverage', '', ...report.coverage.map(c => `- ${c.source}: ${c.status}. ${safe(c.limitations || '')}`), '',
    ...report.errors.map(e => `- Failure: ${e.stage}: ${e.code}`), '', '## Reviewed candidates', ''];
  for (const c of report.cases) lines.push(`### ${safe(c.title)}`, '',
    `**${safe(c.decision)} / ${safe(c.severity)}** · Original report: ${safe(c.reportedDate)}`, '',
    key(c.url) ? `[Original source](${key(c.url)})` : 'Invalid source URL withheld', '', safe(c.summary), '',
    `Impact: ${safe(c.impact)}`, '', `Cause: ${safe(c.cause)}`, '', `Resolution: ${safe(c.resolution)}`, '',
    `Review: ${safe(c.reason)} (${safe(c.evidenceAccess)})`, '');
  if (!report.cases.length) lines.push('No reviewed candidates. Check coverage and errors before interpreting this as no new cases.');
  const markdown = `${lines.join('\n')}\n`;
  await writeFile(resolve(output, 'report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(JSON.stringify({ status: report.status, reviewed: report.cases.length, recommended: report.cases.filter(c => c.decision === 'recommend').length }));
  if (report.status !== 'reviewed') process.exitCode = 1;
}
