# Plan — $7 Cloud: pick databases → pick tables/buckets under a size cap

**Resume here.** If a session dies, a new agent reads this file plus `COMMUNICATION.md`, then runs
`git log --oneline agent-checkpoints/claude/1eba90f1-cloud7` and continues from the first unchecked box.
Tick a box only once its "Done when" condition is met, and commit the tick with the work.

- Branch: `agent-checkpoints/claude/1eba90f1-cloud7` (base `999d9d2`). Deploy branch: `deploy-live` (assumed).
- Push: **blocked.** `origin` returns 403 for `lcapece`. The user must push or grant access.
- Worker policy: cheapest model that can do the step. Haiku for docs/tests/mechanical work, Sonnet for code.
  Workers edit only the paths listed for their step. The orchestrator commits.

## Scope for "today"

A $7 customer, working in the Cloud dashboard:
1. Pastes a Supabase Personal Access Token. It is used **in-request only**: never stored, never logged.
2. Sees their Supabase projects and picks **one** (`cloud-7` = 1 DB, 10 GB).
3. Sees every table and Storage bucket with real sizes.
4. Ticks items on and off, with a running total against 10 GB and a "Fit this plan" option.
5. Saves the selection server-side.
6. Gets a backup that honors the selection. The engine gains the flags; the selection exports as an exact command/config.

**Out of scope today (stays INCOMPLETE):** the managed runner that runs the job on a schedule (`cloud/runner/boot.mjs` idles);
Supabase OAuth app; server-side token custody. Customers run the generated command, or the runner later consumes the same job spec.

## Contracts (all workers code to these)

**Selection object** (Netlify Blobs store `portabase-cloud-selections`, key `sel:v1:{uid}`):
```json
{ "version": 1, "planId": "cloud-7", "projectRef": "abcdefghijklmnopqrst", "projectName": "My app",
  "excludeTables": ["public.big_logs"], "excludeBuckets": ["videos"],
  "estimateBytes": 123, "capBytes": 10737418240, "measuredAt": "ISO", "savedAt": "ISO" }
```

**`POST /api/cloud/supabase`** (`netlify/functions/cloud-supabase.mjs`), signed-in user (`verifyCloudUser`):
- `{ "action": "projects", "token": "sbp_…" }` → `{ projects: [{ ref, name, region, status }] }`
- `{ "action": "inventory", "token": "sbp_…", "ref": "…" }` → `{ tables:[{schema,name,rows,sizeBytes}], buckets:[{id,objectCount,totalBytes}], databaseBytes }`
  (the `normalizeSizeInventory` shape in `src/lib/table-sizer.js`)
- Uses `GET https://api.supabase.com/v1/projects` and `POST /v1/projects/{ref}/database/query` with `{query}`.
- Read-only SQL only. The token is never logged, stored or echoed. Errors are mapped to safe codes.

**`GET|PUT /api/cloud/selection`** (`netlify/functions/cloud-selection.mjs`), signed-in user:
- The server validates: plan exists, `estimateBytes <= capBytes`, a single `projectRef` for `cloud-7`, and arrays of `schema.table` / bucket ids.
- It rejects secret-shaped bodies (reuse the existing forbidden-body check).

**Engine flags** (`utility/portabase.mjs backup`):
- `--exclude-table-data schema.t1,schema.t2` → pg_dump `--exclude-table-data=schema.t1` for each table. The schema is kept; the rows are skipped.
- `--exclude-buckets b1,b2` → `captureStorage` skips those buckets.
- The manifest records `selection: { excludeTables, excludeBuckets }` so a restore can report NOT COVERED.

## Steps

- [ ] **S1 Engine flags** (Sonnet). Paths: `utility/portabase.mjs`, `utility/portabase-core.mjs`, new `tests/selection-flags.test.mjs`.
  Done when `npm test` passes and new tests prove the pg_dump argv and bucket filter.
- [ ] **S2 `cloud-supabase` function** (Sonnet). Paths: `netlify/functions/cloud-supabase.mjs`, `netlify/shared/supabase-mgmt.mjs`, `netlify.toml` redirect, tests.
  Done when unit tests with a mocked `fetch` prove the projects/inventory mapping and that the token never appears in logs or responses.
- [ ] **S3 `cloud-selection` function** (Sonnet). Paths: `netlify/functions/cloud-selection.mjs`, `netlify/shared/selection-store.mjs`, `netlify.toml`, tests.
  Done when tests prove the validation (over cap, 2 projects on cloud-7, secret body → 400).
- [ ] **S4 Dashboard UI** (Sonnet). Paths: `src/lib/cloud-api.js`, `src/console/connect-supabase.jsx` (new), `src/console/customer-dashboard.jsx`, `src/console/table-sizer.jsx`.
  Flow: token field (link to `https://supabase.com/dashboard/account/tokens`) → project list → inventory → TableSizer (real data) → Save → show the command:
  `portabase backup --exclude-table-data … --exclude-buckets …`. Token held in React state only.
  Done when `npm run build` passes and `?demo=1` renders the flow.
- [ ] **S5 Docs/status** (Haiku). Fix `docs/CLOUD.md:35` (the claimed `--exclude-table-list` flag). Add `PROJECT_STATUS.md` rows for each capability with its honest state.
- [ ] **S6 Break it** (Sonnet). Adversarial review of S1–S4: token leakage, cap bypass, SQL injection via ref/bucket names, a backup that silently includes excluded data.
  Fix confirmed findings.
- [ ] **S7 Verify + integrate.** `npm test`, `npm run build`, then a live probe of the functions (`netlify dev` or a deploy preview) with a real PAT if available.
  Merge to `deploy-live` **only with user approval**, since it's the production branch.

## Progress log (append)

- 2026-09-23: plan written; code map complete (sizer UI + pure functions exist; no live inventory, no saved selection, no engine flags, runner idle).
- 2026-09-23: netlify.toml redirects for /api/cloud/supabase and /api/cloud/selection added; S1–S5 workers launched in parallel on disjoint paths.
