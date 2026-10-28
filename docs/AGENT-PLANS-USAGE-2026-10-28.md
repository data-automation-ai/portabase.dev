# Plans and usage custody

- Agent: Codex `/root/plans_usage`; thread `01a183da-486f-77c1-8cd7-36d134c9cf44`, parent session `01a183c6-b1bc-7692-ad78-b3ab5d9b13f6`.
- Check-out: 2026-10-28; exact UTC timestamp recorded below. Existing checkout `C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025`, branch `codex/enclave-copy-only-20261025`, base `0504bced9949ba7cb7374a0248278f4316c67cb5`.
- No new worktree. All 21 registered worktrees reconciled against parent inventory; preserve missing Claude registration and every unrelated dirty path. Existing local changes are parent ledger/inventory plus untracked `AGENTS.mdx`.
- Scope: new $9 plan, durable trusted usage/quota accounting, dashboard usage response, narrow homepage price/logo correction. Integration: parent reviews and commits explicit files serially to the existing named branch, then release review for `origin/main` at `https://github.com/data-automation-ai/portabase.dev.git`.
- No cloud changes, real captures/restores, new subscriptions, or deployment. Expected source/test size under 1 MB. Parent retains Git index custody.
- State: active.
- UTC check-out: 2026-10-28T18:53:35.7178480Z


## Signed check-in / integration handoff

- Agent `/root/plans_usage`, thread `01a183da-486f-77c1-8cd7-36d134c9cf44`; UTC check-in **2026-10-28T20:22:43.453091+00:00**; state **awaiting integration**.
- Existing branch `codex/enclave-copy-only-20261025`; HEAD at check-in `0504bced9949ba7cb7374a0248278f4316c67cb5`. No agent commit or staging: parent explicitly retains the shared index and commits reviewed files serially. Runtime usage-meter and usage-attestation files are frozen for the parent's separate image checkpoint.
- Worktree audit: 21 registrations remain; none created, removed, moved or pruned. C: free space measured 16,259,047,424 bytes before check-in. Own listed source files total 2,384,030 bytes; retained task build/QA artifacts total 40,639,270 bytes. Parent owns full checkout/global ledger reconciliation. No F: writes; no local backup/restore proof runs.
- Expanded authorized scope: new plan/accounting, secure OAuth grant bridge and encrypted profile persistence, old-route quota bypass closure, homepage removals/replacement/copy, full Security page/source doc, Legal title and accurate custody copy, checkout release gate, provisioning/release tools. Cases agent owns Stories extraction and cases routes within shared main.jsx; dashboard agent owns UsageOverview, with one added interrupted-accounting footnote from this agent. Binary agent shares connector test fixes.

### Backend contracts and policy

`cloud-9` is $9/month, one source project, one backup per rolling 24 hours, 10,000,000,000 outbound bytes per fixed 30-day allowance. The first trusted binary baseline is Portabase-paid; new/changed binaries thereafter, full selected DB on each run. One baseline claim is durable across periods. Trusted failed baseline attempts can resume atomically; running/successful claims cannot reset. Each whole job is attributed to the window where it starts. New Starter backups are interactive (`scheduled:false`); unattended attested recovery-key delegation does not exist. Free 72-hour beacons are independent.

Usage writes require a dedicated Google attestation audience `urn:portabase:usage:v1`, pinned image/project/TDX/debug/entrypoint policy, and account/payload-bound nonce. General `/attest` proof tokens cannot authorize usage. CAS reservations only grow; finish receipts are idempotent and cannot exceed reservations. Trusted abort and 4h+5m orphan expiry conservatively charge reserved bytes, while public actual bytes/duration remain unknown rather than fabricated. Legacy queue/claim/scheduler/runner and local-server upload/restore paths reject new Starter unmetered work. Reads, stop and existing completion remain available where applicable; legacy $7 identity is retained.

`GET /api/cloud/dashboard` adds `usage`, independent authoritative Google Monitoring `runnerUsage`, and separate controller `beaconUsage`. Missing history is `recorded:false`; missing uptime is not zero. Aborted/expired summaries have `accountingEstimated:true` and unknown actual outbound/runtime with conservative allowance usage. Last-backup verification never goes green merely for upload success.

`GET /api/cloud/confidential-session` returns pinned policy/controller and owner-bound opaque encrypted profile/revision. `PUT {sealedProfile,profileRevision}` uses CAS and never receives a recovery key. `POST action:bridge` validates attestation, encrypts a fixed oauth.import/vault.import grant to the enclave, and returns only envelope plus HMAC bridgeId. After successful enclave import and durable profile PUT, `complete-bridge` clears only the currently matching exported provider cookie. Expired Supabase or legacy Dropbox grants refresh before import; current grant expiry must be real and within 24 hours. Hosted authorization backends necessarily handle provider grants; Supabase and legacy Dropbox cookie formats differ. Browser/runtime import and grant-rotation handling are coordinated with the other agents.

### Billing and release

Parent—not this agent—provisioned and verified the distinct Square $9 variation `25NV7LAGMJLSCS7S6OSWTZ5O` using AWS-first product credentials. Evidence `.portabase/starter-nine-provision.json`. Existing prices/subscriptions and Netlify function environment were not changed. Missing image pin remains fail-closed.

Private `portabase-runtime-policy/starter-nine` includes `starterVariationId`, `usageImageDigest`, and `managedStarterEnabled` (default false). New checkout fails before payment calls unless all are valid/enabled; public pricing displays Coming soon and disables Starter checkout. Existing legacy billing remains separate. Operator activation requires reviewed proof and `scripts/provision-starter-nine.mjs apply --merchant=<reviewed> --image=sha256:<approved> --enable-managed-starter --validated-release=<40-character-source-commit>`; do not activate while controller stays validation-only. Changing the image without explicit activation disables an old enabled flag.

`scripts/release-enclave-policy.mjs plan` computes impacted function import closure from the parent-verified served baseline `b3c03c7ea1de8b9ea6516f2ecd0673cc3f5be181`. Latest plan includes 36 functions (including cases). `prepare` requires a clean committed source and the exact reviewed `--functions=` list; it archives the commit, verifies the served baseline, bundles native v2 metadata/routes with Netlify's own zipper, preserves unrelated live assets/functions, explicitly carries API/OAuth/security/legal/cases routes and unforced SPA fallback, and preserves AWS static files. New cron activation and unrelated artifact reuse failures stop the script. Draft/upload/publish are separate explicit actions. No release action beyond local plan has run. HTTP checks of every requested draft route and signed-in flows remain mandatory before publish.

### Validation and evidence

- Durable usage + UI model: 16/16 latest tests; includes concurrent quota reservation, fixed periods, failed baseline retry, dedicated attestation, idempotent receipts, abort/orphan unknown actual stats.
- Bridge tests: 4/4, including encrypted-only grant response, invalid attestation/origin, recovery-key field rejection, account/CAS profile isolation, stale bridge finalization and actual Dropbox refresh expiry.
- Legacy quota bypass + admission/payment guard suites: 29 focused tests pass; new Starter cannot use legacy queue, runner lifecycle, scheduled enqueue, direct upload or unattended restore.
- Baseline product/docs/auth/display regressions: 58/58 pass; repaired stale expectations against authoritative existing server caps rather than increasing Free production quota.
- Launch gate / Square / dashboard: 25/25 pass; two isolated browser scenarios prove blocked false / enabled true without checkout writes.
- Latest Vite build passed, 791 modules, including cases routes and hosted runner UI. Output retained in `.portabase/plans-usage-build-20261028`.
- Four key native functions bundled locally as runtime API v2: admission, usage, session, dashboard. Bundles in `.portabase/native-functions-qa-20261028`; these are QA artifacts, not final release artifacts.
- Homepage, Security, Legal: 12 viewport checks at 1440/768/390/320 px, zero horizontal overflow or page errors; screenshots and results in `.portabase/marketing-qa-20261028`. Visual review covered security mobile, three enclave cards desktop and Legal mobile; corrected light text contrast. Preview remains http://127.0.0.1:58456 (exec session 82485).
- Generated image copied to durable sibling `public/images/portabase-secure-enclave-flow.png`, 2014×780. Parent used built-in imagegen with prompt: replace Cloudflare runner logo with Google Cloud plus Intel, label Secure Enclave, outward arrow to Google attestation certificate, preserve the rest. Original asset retained.
- No production customer backup, restore, provider upload, checkout charge, subscription mutation or deployment performed by this agent. Parent owns isolated live proof, public controller enablement, final build, release review and integration.

### Files and recovery

Every changed/untracked path attributable in whole or in part to this agent follows. Other agents' files and unknown `AGENTS.mdx` remain untouched except the explicitly coordinated shared files above. Review shared files as an integrated change before staging.

- `cloud/confidential/usage-attestation.mjs`
- `cloud/confidential/usage-attestation.test.mjs`
- `cloud/confidential/usage-meter.mjs`
- `docs/AGENT-PLANS-USAGE-2026-10-28.md`
- `docs/SECURITY-TRUST.md`
- `netlify.toml`
- `netlify/functions/auth-config.mjs`
- `netlify/functions/cloud-confidential-admission.mjs`
- `netlify/functions/cloud-confidential-session.mjs`
- `netlify/functions/cloud-confidential-usage.mjs`
- `netlify/functions/cloud-dashboard.mjs`
- `netlify/functions/cloud-jobs.mjs`
- `netlify/functions/cloud-runners.mjs`
- `netlify/functions/cloud-schedules.mjs`
- `netlify/functions/cloud-storage-connectors.mjs`
- `netlify/functions/cloud-subscribe.mjs`
- `netlify/functions/cloud-unattended-restore.mjs`
- `netlify/shared/confidential-runtime-view.mjs`
- `netlify/shared/confidential-usage.mjs`
- `netlify/shared/job-enqueue.mjs`
- `netlify/shared/managed-schedules.mjs`
- `netlify/shared/product.mjs`
- `netlify/shared/runtime-policy.mjs`
- `netlify/shared/square-cloud.mjs`
- `netlify/shared/square-ready.mjs`
- `public/images/portabase-secure-enclave-flow.png`
- `scripts/check-enclave-marketing.mjs`
- `scripts/provision-starter-nine.mjs`
- `scripts/release-enclave-policy.mjs`
- `src/auth-pages.jsx`
- `src/console/usage-overview.jsx`
- `src/lib/dashboard-view.js`
- `src/lib/product.js`
- `src/lib/square-public.js`
- `src/main.jsx`
- `src/site-pages.jsx`
- `src/styles.css`
- `tests/cloud-storage-connectors.test.mjs`
- `tests/cloud-subscribe.test.mjs`
- `tests/confidential-admission.test.mjs`
- `tests/confidential-session.test.mjs`
- `tests/confidential-usage.test.mjs`
- `tests/dashboard-view.test.mjs`
- `tests/docs-site.test.mjs`
- `tests/never-hold-keys.test.mjs`
- `tests/product-plans.test.mjs`
- `tests/runner-admission-security.test.mjs`
- `tests/subscription-blockers.test.mjs`
- `tests/table-sizer.test.mjs`

Exact recovery/staging command, for parent after review (not executed by this agent):

```powershell
git -C "C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025" add -- "cloud/confidential/usage-attestation.mjs" "cloud/confidential/usage-attestation.test.mjs" "cloud/confidential/usage-meter.mjs" "docs/AGENT-PLANS-USAGE-2026-10-28.md" "docs/SECURITY-TRUST.md" "netlify.toml" "netlify/functions/auth-config.mjs" "netlify/functions/cloud-confidential-admission.mjs" "netlify/functions/cloud-confidential-session.mjs" "netlify/functions/cloud-confidential-usage.mjs" "netlify/functions/cloud-dashboard.mjs" "netlify/functions/cloud-jobs.mjs" "netlify/functions/cloud-runners.mjs" "netlify/functions/cloud-schedules.mjs" "netlify/functions/cloud-storage-connectors.mjs" "netlify/functions/cloud-subscribe.mjs" "netlify/functions/cloud-unattended-restore.mjs" "netlify/shared/confidential-runtime-view.mjs" "netlify/shared/confidential-usage.mjs" "netlify/shared/job-enqueue.mjs" "netlify/shared/managed-schedules.mjs" "netlify/shared/product.mjs" "netlify/shared/runtime-policy.mjs" "netlify/shared/square-cloud.mjs" "netlify/shared/square-ready.mjs" "public/images/portabase-secure-enclave-flow.png" "scripts/check-enclave-marketing.mjs" "scripts/provision-starter-nine.mjs" "scripts/release-enclave-policy.mjs" "src/auth-pages.jsx" "src/console/usage-overview.jsx" "src/lib/dashboard-view.js" "src/lib/product.js" "src/lib/square-public.js" "src/main.jsx" "src/site-pages.jsx" "src/styles.css" "tests/cloud-storage-connectors.test.mjs" "tests/cloud-subscribe.test.mjs" "tests/confidential-admission.test.mjs" "tests/confidential-session.test.mjs" "tests/confidential-usage.test.mjs" "tests/dashboard-view.test.mjs" "tests/docs-site.test.mjs" "tests/never-hold-keys.test.mjs" "tests/product-plans.test.mjs" "tests/runner-admission-security.test.mjs" "tests/subscription-blockers.test.mjs" "tests/table-sizer.test.mjs"
```

Next owner: parent `/root`; commit reviewed paths, preserve unknown files and all build evidence, run integration checks, and complete release/proof gates before claiming live.


### Parent-requested post-check-in addendum

- 2026-10-28T20:23:25.264553+00:00: removed only the trailing blank line from `cloud/confidential/oauth-import.test.mjs`, retaining its existing line endings. Parent stages it; no index mutation by this agent.
- Release helper now explicitly includes `public/data/cases-snapshot.json` in addition to the reviewed three image assets. It preserves all unrelated published assets.
- Re-signed `/root/plans_usage`, same thread; state remains awaiting integration.

### Final integration review check-in — 2026-10-28T20:36:26Z

Signed: `/root/plans_usage`, thread `01a183da-486f-77c1-8cd7-36d134c9cf44`; same shared branch/worktree; HEAD `bc7fb2c4d5ac0233b21321eb97ce06462fc06cdd`. Status: awaiting integration, source frozen. Inventory: 21 existing worktrees preserved; C: free 16,207,425,536 bytes. No worktree created, no Git index mutation, no deploy or environment mutation by this agent.

- Reviewed release against actual served source `b3c03c7ea1de8b9ea6516f2ecd0673cc3f5be181`, published deploy `6ae22074ad2af0ca66a4e9dc`. Read-only plan: `.portabase/enclave-policy-release/final-review-plan.json`; 36 affected functions, seven untouched functions, expected 43 total after release.
- Preserved unrelated assets/function hashes; explicit cases submit/manage, security/legal/trust routes; OAuth/API redirects precede SPA fallback; `/aws` static directory and assets retain precedence. Existing notification and schedule dispatch crons remain exactly once per minute. Helper now preserves memory/region/build metadata and fails publish on unrelated invocation/runtime/config or schedule drift. Public cases snapshot included.
- Fixed genuine terminal-replay regression in `netlify/functions/cloud-jobs.mjs`: terminal claim recovery is read-only and does not reread entitlement, while running/new Starter legacy execution remains forbidden. Added `tests/durable-claim-server.test.mjs` regression. Unattended restore GET remains read-only; Starter POST forbidden. All 40 focused durable claim, promo/restore, and admission tests pass.
- Qualified homepage claims in `src/main.jsx`: verification is reported evidence, no offline or zero-risk guarantee, customer-owned vaults scoped by managed/standalone, retained referenced binary objects and recovery key required, independent destination access still needed. Closing copy distinguishes customer CLI from managed enclave.
- Additional changed path beyond previous explicit recovery list: `tests/durable-claim-server.test.mjs`. Parent may add that exact path alongside the previously enumerated reviewed files. `scripts/release-enclave-policy.mjs`, `src/main.jsx`, `netlify/functions/cloud-jobs.mjs`, `netlify/functions/cloud-unattended-restore.mjs` were already listed.
- Validation: 40 focused tests pass; release helper syntax and diff whitespace checks pass. Full suite rerun belongs to parent session 12074. All 36 prepared bundles and draft route/browser checks remain required; no draft prepared by this agent. Managed activation still waits for isolated proof and reviewed image pin/controller release.
- Parent owns final serial commit/release and all live evidence. No files removed or cleaned. The existing exact recovery command above plus `git add -- tests/durable-claim-server.test.mjs` captures this addendum's reviewed source; run only after parent review.

### Draft verification and packaging correction — 2026-10-28T20:48:49Z

Signed `/root/plans_usage`, same thread; HEAD `bb1b6b80add727f3927d5789bebbfd3876b99c5f`; awaiting integration. Parent-created draft `6ae25db495de9e1456c081b9` is fully ready but MUST NOT publish: native v2 endpoints returned 502 from missing `@netlify/blobs`. Static revision, assets, all 43 function hashes and both existing schedules were verified. Legacy OAuth routes work; managed Starter flag remains false. No customer writes or publication by this agent. Unauthorized empty POST checks were rejected at runtime; no authenticated mutation attempted. HTTP evidence: `.portabase/enclave-policy-release/draft-http-review.json`.

Root cause: native v2 forces Netlify NFT tracing even with esbuild configured. Tracing repositoryRoot restricted to archived source silently excluded dependencies installed above it in the shared main checkout. Corrected `scripts/release-enclave-policy.mjs` to trace from the Git common directory parent while source remains immutable archived commit. Added `scripts/lib/verify-netlify-package.mjs` to inspect ZIP paths, extract, and actually import each native workload with ambient dependency resolution blocked (only Lambda-provided AWS SDK imports exempt). The original broken ZIP is rejected by this guard; all seven rebuilt native ZIPs pass. Only archived function workload, required node_modules and Netlify wrappers are present; no env, operator config, private release files or AGENTS.mdx included. Windows namespace path handles nested archive paths safely.

Remaining task-owned changes for parent's reviewed commit: `scripts/release-enclave-policy.mjs`, new `scripts/lib/verify-netlify-package.mjs`, and this custody document. Recovery: `git add -- scripts/release-enclave-policy.mjs scripts/lib/verify-netlify-package.mjs docs/AGENT-PLANS-USAGE-2026-10-28.md` after parent review. No index changes by this agent. Parent must prepare a NEW draft from the corrected clean commit, repeat API checks and browser review, then decide publication. The failed draft is retained as evidence, not deleted.

### Final displayed-offer consistency check-in — 2026-10-28T20:52:56.572016+00:00

Signed `/root/plans_usage`, same thread; awaiting integration, source frozen. Parent explicitly expanded review to remaining rendered docs/customer console offers. Updated only display copy and public sizer cards derived from existing public product constants, preserving legacy cloud-7 entitlements/identifiers and its legitimate +$10 upgrade quote.

New reviewed paths in this pass: `src/docs/DocsApp.jsx`, `src/backend-page.jsx`, `src/console/pages.jsx`, `src/console/table-sizer.jsx`, `src/console/customer-dashboard.jsx`, `src/console/one-two-three-done.jsx`, `src/console/walkthrough.jsx`, `src/console/transfer-window.jsx`, `src/lib/table-sizer.js`. Existing-owned `netlify.toml` now explicitly maps `/api/cloud/confidential-admission` to its native function; release tooling includes it ahead of SPA fallback. Draft QA harness will assert canonical path returns unauthorized JSON, not HTML.

Validation: 37 focused docs/sizer/product/dashboard tests passed; Vite build 791 modules passed. Evidence `.portabase/display-copy-final-tests.log`, `.portabase/display-copy-final-build.log`. No live writes, no deployment, no Git index changes. Parent owns serial reviewed commit and new draft. Additional recovery command after review: `git add -- src/docs/DocsApp.jsx src/backend-page.jsx src/console/pages.jsx src/console/table-sizer.jsx src/console/customer-dashboard.jsx src/console/one-two-three-done.jsx src/console/walkthrough.jsx src/console/transfer-window.jsx src/lib/table-sizer.js netlify.toml docs/AGENT-PLANS-USAGE-2026-10-28.md`.
