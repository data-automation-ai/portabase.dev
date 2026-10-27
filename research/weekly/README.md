# Weekly critical-incident research

Schedule: Mondays at 13:17 UTC (9:17 a.m. Eastern daylight time; 8:17 a.m. standard time).
The default lookback is seven days. Run manually with `days=30` to seed a rolling
30-day editorial queue. Reports retain original report dates, not crawl/reply dates.
Date-only posts use inclusive UTC dates at both boundaries to avoid missing boundary
cases; canonical URL and prior-ledger deduplication handle overlap.

The cloud workflow searches Reddit, Supabase GitHub discussions/issues, and public
support threads separately. AnswerOverflow is explicitly a Discord archive, not a
fourth independent source. Private Discord content is not accessible to this job.
Search indexing and source access limit coverage; this does not harvest every case.

Collection uses OpenAI Responses web search, then a separate structured AI review
checks operational severity, original evidence, dates, replies, causes, resolutions,
and cross-posts. Deterministic gates reject invented/unretrieved URLs, old reports,
duplicates and weak evidence. A recommendation is a draft, not independent confirmation
of the poster's allegations. AI review can still make mistakes; an editor must check
the source before adding it to `src/data/nightmares.js` or another public data module.

The existing site archive is included for deduplication. The last workflow artifact
also carries forward previously recommended cases. Holds can be retried; rejected
candidates remain in each report. A 90-day artifact expiration or artifact deletion
can remove this extra history; published archive deduplication remains available.
Cross-platform event deduplication is AI-assisted and needs editorial verification.

Outputs: Actions run summary plus `incident-research` artifact containing `report.md`,
`report.json`, `discovery.json`, and `ledger.json`. Source failures produce a partial
report and failing job, never a successful empty report. No Slack/email posts, issue
creation, site publication, application secrets, or production database access.

## Configuration and operation

- Server-only secret: `PORTABASE_RESEARCH_OPENAI_API_KEY` in this repository's Actions
  secrets. Source: AWS `secrets-bundle`, exact selector `default.openai-api-key`.
  Sync only that active record to the encrypted GitHub secret store. No AWS key is
  installed in GitHub and the job cannot read the whole bundle.
- Optional repository variable: `PORTABASE_RESEARCH_MODEL`; default `gpt-5.5`.
- Manual run: `gh workflow run weekly-incident-research.yml -f days=30`.
- Local run: `node research/weekly/run.mjs` with `OPENAI_API_KEY` injected securely.
- Tests: `node --test tests/weekly-research.test.mjs`.
- Disable/rollback: disable this workflow in GitHub Actions. No website rollback needed.

Each run makes three search requests and one review request, with explicit tool-call,
output-token and 25-minute job limits. API charges apply; this is not a dollar-denominated
spending cap. A failed run can be retried manually. GitHub schedules can be delayed;
inactive public repositories can have schedules disabled by GitHub.

Implementation references:
- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

## Capability status

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Weekly collection and AI review | `research/weekly`, workflow | Pending validation | Monday 13:17 UTC, seven days | No | Pending | URL/date/severity/deduplication gate tests pass | INCOMPLETE | Activate schedule and verify first cloud run |
| Recent public site cases | Existing curated archive | Existing | Editorial review required | No new cases published | Pending | Human source verification required | INCOMPLETE | Review initial 30-day report |
