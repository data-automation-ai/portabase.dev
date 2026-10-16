# Agent coordination ledger (append-only)

Never overwrite another agent's entry. Append claims and handoffs below.

---

## 2026-09-23 — Claude (session 1eba90f1) — CLAIM

- Task: build the $7 Cloud offering (pick Supabase projects → pick tables/buckets under a size cap → saved selection honored by backup).
- Plan / resume point: [`docs/PLAN_CLOUD_7.md`](docs/PLAN_CLOUD_7.md) — the checklist there is the source of truth for progress.
- Branch: `agent-checkpoints/claude/1eba90f1-cloud7`, based on `integrate/main-into-deploy-live` @ `999d9d2`
  (merge of `origin/main` into `origin/deploy-live` @ `a24a768`; that merge was never pushed).
- Deploy branch (assumed, not verified via Netlify API): `deploy-live`.
- Worktree: main checkout `C:\Users\ryanh\git\portabase.dev` (no new worktree).
- Pre-existing untracked, user-owned, not touched: `.impeccable/`, `.worktrees/`.
- Push status: **LOCAL ONLY.** `origin` (data-automation-ai) push → 403 for `lcapece`; push to `old-origin` blocked by permission policy. Work is not crash-safe until the user pushes.

## 2026-09-23 — Claude (session 1eba90f1) — HANDOFF

- Head: see `git log -1 agent-checkpoints/claude/1eba90f1-cloud7`. Done: S1, S2, S3, S5. S4 is a WIP checkpoint (`d0735b5`); a Sonnet worker may still have been editing S4 paths at handoff, so run `git status` before editing.
- Tests: selection-flags 13/13, cloud-supabase 10/10, cloud-selection 20/20. Full suite: one pre-existing env-dependent failure (`tests/aws-capsule.test.mjs:290`).
- Not pushed, not integrated, not deployed.

## 2026-10-15T15:56:40-04:00 — Antigravity (session 89c17ccb) — CLAIM

- Task: Phase 1 Pure CLI Hardening (`captureAuth` pagination + `truncated` fix, `packDirectoryTarGz` >8 GiB header guard, Edge Function Management API fallback validation, CLI `VERSION` sync to `0.4.1`, and CLI option/flag sync).
- Worktree: canonical checkout `C:\Users\ryanh\git\portabase.dev` (no new worktree).
- Active branch: `checkpoint/zipper-runner-ui-20261006` @ base SHA `111bd54c4dba37f4e208c7ab103747b9f122720b`.
- Canonical repo branch: `origin/main` @ `06b7d2e6ff957e639cfd015f7811f79fe591d7c0` (`deploy-live` @ `a24a768f7fb22f0e650171cd23c6c7a6362d4aac`; Netlify site `794217cc-42ab-4a9f-81da-06a661403573` uses CLI deploys, currently `6ac3a402beda80e0c96f4654`).
- Owned paths: `utility/portabase.mjs`, `utility/portabase-core.mjs`, `utility/portabase.test.mjs`, `src/lib/capsule-key.js`, `src/main.jsx`, `src/console/customer-dashboard.jsx`, `docs/CODE-REVIEW-2026-10-15.md`, `COMMUNICATION.md`.
- Intended outcome: All 4 CLI engine bugs + CLI flag mismatches resolved and covered by automated tests in `utility/portabase.test.mjs`.

## 2026-10-15T16:18:00-04:00 — Antigravity (session 89c17ccb) — HANDOFF

- Completed Phase 1 (Pure CLI Hardening + Live Restore Target Preflight) & Phase 2 (Stranded Commit Porting + Security / Billing / Runner Fixes):
  - `utility/portabase.mjs`: Fixed `captureAuth` pagination (up to 50 pages / 10,000 users) and `truncated` flag; fixed `captureFunctionViaManagementApi` to reject non-source JSON metadata; fixed `writeRecoveryEvidence` to allow ISO millisecond dots in capsule IDs; wired `--exclude-table-list` fallback; synced `VERSION = '0.4.1'`.
  - `utility/portabase-core.mjs`: Added `MAX_USTAR_FILE_BYTES` (`0o77777777777`, 8 GiB - 1) guard in `packDirectoryTarGz`.
  - `utility/recovery-options.mjs`: Added `--exclude-binaries` and `--exclude-table-list` CLI options; fixed `databaseIdentity()` so Supabase Session Pooler usernames (`postgres.<projectRef>`) do not collide across different projects on the same regional pooler host.
  - `src/lib/sha256-hex.js`, `src/lib/google-gis-auth.js`, `src/lib/supabase-auth.js`: Ported SHA-256 Google OAuth nonce pairing, `event.source === popup` check, CSPRNG requirement, and implicit hash callback handling.
  - `netlify/shared/square-cloud.mjs`: Ported `findNamedPlanVariation` and `catalogVariationIdFromUpsert` (`id_mappings` + nested variation lookup) to both `ensureCloudPlanVariationId` and `ensureExtraTransfersAddonVariationId`.
  - `public/_redirects`: Added all `/api/*` → `/.netlify/functions/*` rewrites before the SPA catch-all.
  - `src/lib/runner-seal.js`: Rejected `CONTROL_PLANE_HOSTS` (`portabase.dev`, `localhost`) on all paths.
  - `src/console/capsule-manage.jsx` & `src/console/pages.jsx`: Prevented "Queue verify" from faking `verified: true` outside `demoMode`, passed `mocked={Boolean(demoMode)}` to gauges, and isolated demo billing card labels from live accounts.
  - `netlify/shared/product.mjs`, `src/lib/product.js`, `netlify/shared/subscription-store.mjs`, `netlify/functions/cloud-self-refund.mjs`: Aligned `CLOUD_MONEY_BACK_DAYS = 8` and prorated self-refund calculation with `docs/BILLING.md`.
  - `supabase/cloud/0001_control_plane.sql`, `0002_subscriptions.sql`, `0003_essentials.sql`: Enabled RLS on all `portabase_cloud` tables and revoked `public, anon, authenticated` grants.
  - `cloud/runner/Dockerfile`: Added `awscli`, `rclone`, `curl`, and `supabase` CLI to the worker image.
- Verification:
  - Live read-only restore preflight against blank target `svltssnxzqsrxtbjgaex` using gold capsule `ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z`: **PASSED (`exit code 0`)**.
  - Full test suite (`npm test`): **783 / 783 passing (`0` failures)**.
  - Production bundle (`npm run build`): **PASSED (`1.77s`)**.

