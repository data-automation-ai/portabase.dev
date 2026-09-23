# Handoff — $7 Cloud selection build (2026-09-23)

The plan and checklist are in [`PLAN_CLOUD_7.md`](PLAN_CLOUD_7.md). The capability ledger is [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md).
This file covers **where things stand and exactly what to do next.**

## Delivery state

| Stage | State |
|---|---|
| Implemented | S1, S2, S3, S5 done. S4 (UI) is a **WIP checkpoint**, not verified. |
| Committed | Yes, on local branch `agent-checkpoints/claude/1eba90f1-cloud7` |
| Pushed | **NO.** `origin` (data-automation-ai) returned 403 for `lcapece`, and pushing to `old-origin` was blocked by the agent permission policy. |
| Integrated into `deploy-live` | NO (needs user approval) |
| Deployed / live-verified | NO |

**First action for whoever resumes:** push the branch.
```
git push old-origin agent-checkpoints/claude/1eba90f1-cloud7 integrate/main-into-deploy-live
```
`integrate/main-into-deploy-live` (`999d9d2`, the merge of `origin/main` into `origin/deploy-live`) was never pushed either. This branch is built on top of it.

## Commits on the branch (oldest → newest)

| SHA | What |
|---|---|
| `b57be6b` | Plan + `COMMUNICATION.md` claim |
| `28f148f` | `netlify.toml` redirects: `/api/cloud/supabase`, `/api/cloud/selection` |
| `8b18f50` | S5: `docs/CLOUD.md` flag corrections, `PROJECT_STATUS.md` |
| `330a1eb` | S2 + S3: the two Netlify functions + tests (10/10, 20/20 pass) |
| `219291c` | S1: engine flags + tests (13/13 pass) |
| `d0735b5` | **WIP** S4 UI snapshot, taken while the worker was still editing |

## What each piece does

- **`netlify/functions/cloud-supabase.mjs`** + `netlify/shared/supabase-mgmt.mjs`
  - Signed-in user POSTs `{action:'projects'|'inventory', token, ref}`.
  - Calls the Supabase Management API (`/v1/projects`, `/v1/projects/{ref}/database/query`) with read-only SQL for table sizes, bucket sizes (via `storage.objects`) and DB size.
  - The token is used only in-request: never stored, never logged. Tests assert a sentinel token never leaks.
- **`netlify/functions/cloud-selection.mjs`** + `netlify/shared/selection-store.mjs`
  - GET/PUT the selection in Netlify Blobs (`portabase-cloud-selections`, `sel:v1:{uid}`).
  - Server-side validation: the cap comes from `product.mjs` (the client `capBytes` is ignored), 1 DB on cloud-7, and table/bucket name regexes.
  - Rejects secret-shaped bodies.
- **Engine** (`utility/portabase.mjs`, `utility/portabase-core.mjs`)
  - `portabase backup --exclude-table-data schema.t,... --exclude-buckets b,...`, or config `capture.excludeTableData` / `capture.excludeBuckets`.
  - pg_dump gets `--exclude-table-data=` (DDL is still dumped). Excluded buckets are skipped.
  - `manifest.selection` records both lists.
- **UI** (WIP): `src/console/connect-supabase.jsx`, `customer-dashboard.jsx` sizer tab, `src/lib/cloud-api.js`, `src/lib/table-sizer.js`.
  - Flow: paste token → pick project → measure → TableSizer under the cap → Save → copyable CLI command.

## Remaining steps (in order)

1. **S4 finish and verify.**
   - Run `npm run build` and `npm test`.
   - Open `/dashboard?demo=1` and walk through the flow.
   - Check the token is held in React state only (grep `connect-supabase.jsx` for `localStorage` / `sessionStorage`).
2. **S6 break-it review** (Sonnet). Look for:
   - token leakage (logs, error bodies, URL)
   - cap bypass
   - `ref` / bucket / table injection into SQL or argv
   - a backup that silently includes excluded data
   - known soft spot: `cloud-selection` falls back to the **client** `planId` when there's no active subscription, so a non-payer can save against a larger plan's cap. Decide: reject, or clamp to `cloud-free`.
3. **S7 verify.**
   - `npm test`, `npm run build`.
   - Live probe via `netlify dev` or a deploy preview, with a real Supabase PAT.
   - A real `portabase backup --exclude-table-data …` against a test project. Confirm the excluded rows are absent and `manifest.selection` is populated.
4. **Integrate.** Merge into `deploy-live` **only with user approval**.

## Known issues / decisions for the user

- **Policy conflict:** `docs/CLOUD.md` previously said "no new CLI capture flags" for Cloud. S1 added two free-CLI flags; that was the only way for a backup to honor the selection. The user hasn't ruled on it yet.
- **Not in scope and still INCOMPLETE:**
  - The managed runner doesn't execute jobs (`cloud/runner/boot.mjs` idles).
  - There's no 1-per-24h scheduler run.
  - There's no Supabase OAuth.
  - Today the customer runs the generated command themselves.
- **Pre-existing test failure** (not from this work): `tests/aws-capsule.test.mjs:290`. It depends on the environment; it expects "Config not found", but this machine has ambient config.
- **Deploy branch assumed `deploy-live`.** Not confirmed via the Netlify API (site `794217cc-42ab-4a9f-81da-06a661403573`).
- **Pre-existing untracked, user-owned, untouched:** `.impeccable/`, `.worktrees/`.
