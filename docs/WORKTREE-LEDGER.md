# Portabase worktree ledger

This is the durable index for worktrees, branches, and release custody. It does not replace `git worktree list --porcelain`; reconcile both at the start and end of every task. Existing unlisted worktrees must be inventoried, never assumed disposable.

## Hotel check-out and check-in

**Check out before creation.** Write a reservation row before `git worktree add`. Sign with the agent's name, session ID, and UTC time. Include the planned path, branch, base commit, integration target, purpose, and expected disk use. If the entry cannot be saved, do not create the worktree. After creation, append actual path and HEAD.

**Check in before the session ends.** The same named agent signs its UTC check-in time and records commits, push result, remaining changed/untracked paths, disk use, validation, deployment ID, and named next owner/action. An unfinished branch may be checked in as `awaiting integration`; check-in never means permission to delete.

**Overdue check-in.** If a session ends without check-in, or an `active` entry has no update after 24 hours, mark it `overdue check-in` and record the named agent/session, last timestamp, and observed worktree state. This assigns custody from evidence; it does not assert why the agent stopped. Preserve the worktree for recovery.

**Agent replacement.** The incoming agent signs a new takeover row with its own name, session ID, and UTC time. It inventories the previous checkout and links its commits and dirty files before continuing. Only the original agent can sign its check-in. The incoming agent may mark the old entry `overdue check-in` with observed evidence and become the named next owner; it must not rewrite history or silently absorb uncommitted changes.

**Owner termination.** When the owner explicitly fires an agent, record the agent name and session ID (or `unknown`), UTC time recorded, owner's stated reason (or `not provided`), affected worktrees, and the exact handoff document name. Mark it `owner terminated / forced handoff pending`. The successor signs a separate inventory and takeover; it cannot check in for the fired agent. Update to `owner terminated / forced handoff complete` only when the successor has recorded commit, dirty-file, remote, and deploy evidence.

## Required entry for each active worktree

| Field | Record |
| --- | --- |
| Path | Absolute path from `git worktree list --porcelain` |
| Purpose and owner | Task and responsible agent/session |
| Branch and base | Named branch, base commit, current HEAD; note detached HEAD explicitly |
| Integration destination | Remote URL and branch or reviewed release checkout |
| Changes | Scoped commits and all remaining changed/untracked paths |
| Validation | Tests, build, and limits of proof |
| Deployment | Deploy ID, source commit, and served-asset or browser proof, if applicable |
| State | `active`, `awaiting integration`, or `eligible for owner-reviewed removal` |
| Last review | Date and next action |
| Handoff document | Exact path and filename, or `none` |

## Signed session log

Checked in: Codex `/root`, 2026-10-28 12:27:07 UTC, existing `enclave-home-20261025` checkout. Base `e2e73bf`; implementation commits `fa01467`, `368850e`; integration target `origin/main` at `https://github.com/data-automation-ai/portabase.dev.git`. No new worktree. Published deploy `6ae1e92f86a13c701e2fe143`, all five served asset hashes verified; 37 backend functions preserved. Isolated browser interaction passed; final authenticated public interaction unverified after browser connection failure. Earlier bad draft was immediately rolled back. Handoff: `docs/PICKER-RESCUE-2026-10-28.md`. Remaining untracked `AGENTS.mdx` preserved. Release staging is 2,145,980 bytes; no worktree deletion or cleanup. Next owner: Codex `/root` on next authorized continuation to verify the signed-in public picker and continue backend reconciliation. Push result is recorded by the final Git push for this check-in commit.

| Agent / session | Worktree | UTC check-out | UTC check-in | Status and next owner |
| --- | --- | --- | --- | --- |
| Codex `/root` / current rescue session (retrospective registration) | `C:\Users\ryanh\git\portabase.dev` | 2026-10-28 11:39:54 | 2026-10-28 11:46:56 | `bc28b40` committed and pushed to `origin/codex/worktree-custody-20261028`; root still has 65 unrelated changed and 30 untracked porcelain entries, all preserved. Next owner: integration/release agent to review custody branch and root dirty state. |
| Codex `/root` / current rescue session (retrospective registration) | `.worktrees\enclave-home-20261025` | 2026-10-28 11:39:54 | 2026-10-28 11:46:56 | `c42c8c2` pushed to `origin/main`; 0 tracked changes, 1 untracked `AGENTS.mdx` preserved. Build passed; browser preview unavailable; not verified live. Next owner: release agent to reconcile current Netlify source before deployment. |
| Codex `/root` / custody integration continuation | `.worktrees\enclave-home-20261025` | 2026-10-28 11:49:03 (retrospective) | 2026-10-28 11:49:03 | `51ed65c` added root agent rules and this ledger to `origin/main`; 1 untracked `AGENTS.mdx` preserved. No Netlify deployment claimed. Next owner: release agent to reconcile the manually published site before GUI release. |

### Owner termination and forced handoff — 2026-10-28

| Field | Record |
| --- | --- |
| Agent | Google Antigravity; exact session ID unknown |
| Owner action | Fired / replaced by Codex `/root`, as stated in this conversation |
| Reason stated by owner | Poor performance; work resulted in a missing working GUI and object selection/filtering control |
| UTC time recorded | 2026-10-28 11:39:54 (exact firing time not known) |
| Handoff document | `HANDOFF-2026-10-28.md` |
| Named worktrees in handoff | Root checkout; `.worktrees\enclave-home-20261025`; `.worktrees\confidential-12gb-20261025` |
| State | Owner terminated / forced handoff pending full inventory |
| Successor | Codex `/root`; preserve all named worktrees and reconcile commits, dirty files, remotes, and Netlify deploy before further integration |

This entry records the owner's stated reason and the observed handoff. It does not assign individual file edits to an unknown session without provenance evidence.

These two entries were registered after the work began because this policy did not yet exist. Future worktrees must be registered before creation.

## Current rescue checkpoint — 2026-10-28

- Root `C:\Users\ryanh\git\portabase.dev` is heavily dirty and behind `origin/main`; preserve every changed and untracked file. Its tracked `AGENTS.md` had been removed locally; this task restored it and added custody rules. `AGENTS.mdx` remains untracked and preserved.
- `.worktrees\enclave-home-20261025` is the dashboard branch. Commit `c42c8c2` restores the filterable object selector as the primary `/dashboard` view and was pushed to `origin/main` at `https://github.com/data-automation-ai/portabase.dev.git`. This is **not proof of production deployment**. Its `AGENTS.mdx` remains untracked.
- `.worktrees\confidential-12gb-20261025` has the eight-shard Storage capture/restore implementation (`72bcf0b`, strengthened by `21d22d5`) and its passing dedicated test. This branch has not been integrated into `origin/main`. Preserve it and its untracked `AGENTS.mdx`.
- Netlify site `794217cc-42ab-4a9f-81da-06a661403573` reports published deploy `6ae10a3f5208a45fbdb6ed1e`, titled `CloudShell compact assessment; no credential entry`, created 2026-10-27. Its configured Git repository is `https://github.com/lcapece/portabase.dev`, while this checkout's `origin` is `https://github.com/data-automation-ai/portabase.dev.git`. The site uses manual deployments; reconcile the actual release source before publishing a replacement.
- `C:\Users\ryanh\git\portabase-prod-google-deploy` is detached at `b4fb4de` and dirty. It may contain newer production work. Preserve it. Do not deploy the dashboard branch over it without reviewing its changed and untracked files.
- The worktree inventory currently lists 21 entries, including a prunable temporary Claude entry. Prunable is a Git metadata observation, **not deletion authorization**. Inventory each entry and its disk usage before asking the owner to remove any.

### Read-only worktree inventory at takeover

`git worktree list --porcelain` returned 21 entries on 2026-10-28: 20 paths exist, one temporary Claude path is missing, 19 existing checkouts have changed or untracked paths, and one is clean. The counts below are Git porcelain entries, not file counts. `wt/` means `C:\Users\ryanh\git\portabase.dev\.worktrees\`; `git/` means `C:\Users\ryanh\git\`. These entries require individual custody review before any removal.

| Path | Branch / HEAD | Changed | Untracked |
| --- | --- | ---: | ---: |
| `git/portabase.dev` | `main` / `7adabd0` | 66 | 33 |
| Claude temporary `deploy-wt` (path missing) | detached / `cb2cdaa` per Git metadata | unknown | unknown |
| `git/portabase-fill-missing` | `pr-17-fill-missing` / `7e2a7e3` | 1 | 3 |
| `git/portabase-prod-google-deploy` | detached / `b4fb4de` | 8 | 3 |
| `git/portabase-review-implement` | `agent/review-implement` / `fc601e1` | 1 | 1 |
| `git/portabase-win-arm64` | detached / `084aada` | 3 | 1 |
| `git/portabase-wt-proofwall` | detached / `a4251da` | 2 | 1 |
| `wt/aws-assessment-release-20261027` | detached / `2030fef` | 1 | 1 |
| `wt/confidential-12gb-20261025` | `codex/12gb-timing-20261025` / `f44f838` | 0 | 1 |
| `wt/confidential-app-20261024` | detached / `58f32b4` | 1 | 1 |
| `wt/deploy-order` | detached / `2096f6f` | 1 | 1 |
| `wt/discord-evidence-20261026` | detached / `b64f8f1` | 1 | 1 |
| `wt/enclave-home-20261025` | `codex/enclave-copy-only-20261025` / `c42c8c2` | 0 | 1 |
| `wt/homepage-evidence-20261025` | `codex/homepage-evidence-20261025` / `61781e7` | 1 | 1 |
| `wt/mobile-sales` | `review/mobile-sales-20261004` / `2e158ad` | 8 | 3 |
| `wt/oauth-diagnostic-20261026` | detached / `97d0596` | 1 | 1 |
| `wt/panel-development-release` | detached / `cbd8304` | 0 | 0 |
| `wt/weekly-research-20261027` | `codex/weekly-research-20261027` / `95141cb` | 1 | 1 |
| `git/portabase.dev-signup-release` | detached / `deab157` | 1 | 1 |
| `git/PortabaseCli` | detached / `084aada` | 3 | 1 |
| `C:\Users\ryanh\Portabase\src` | detached / `084aada` | 1 | 1 |

These historical worktrees predate this ledger; their original agents, session times, and integration destinations are unknown until verified. Do not assign blame from a path name alone.

## Session closeout

Update every touched entry, then report the exact checkout, branch, HEAD, commits, push/deploy status, dirty paths, and next integration step. Record large `node_modules`, `dist`, or runner artifacts separately from source changes so disk review can be safe and targeted. Never silently abandon a worktree.

## Graphical dashboard recovery takeover — 2026-10-28

- Agent: Codex /root; session 01a1827c-b046-7e40-8e8d-bf2ffa550a66; UTC check-out 2026-10-28T12:48:45Z; state active.
- Reusing C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025, branch codex/enclave-copy-only-20261025, base/HEAD 989d03128e745f1a66ace7f030d4f232f969bbc6. No worktree created. Integration: https://github.com/data-automation-ai/portabase.dev.git main.
- Prior checkout has only untracked AGENTS.mdx, preserved. Root remains dirty and untouched. All 21 registered paths match the ledger inventory; root HEAD now 563c8a7 and enclave HEAD now 989d031. Missing Claude temporary path remains preserved in Git metadata. Prior rescue check-in is recorded at 989d031; no check-in signed for another agent.
- Purpose: restore source-left / destination-right graphical dashboard with integrated original picker; undo the accidental replacement with OneTwoThreeDone. Review existing wrapper before reuse because its status and inventory were hardcoded.
- Deployment evidence: prior picker-rescue release metadata remains in .portabase/picker-rescue/release.json. Live revision to be reverified before any deployment.
- Expected additional disk use under 100 MB. C: free space approximately 5.5 GB. No backup/restore runs authorized by this UI repair. Next owner: this session.

- Check-in: Codex /root, session 01a1827c-b046-7e40-8e8d-bf2ffa550a66, UTC 2026-10-28T13:00:51.6204316Z. State: awaiting integration. Evidence and preview only; application source unchanged. Task files: docs/WORKTREE-LEDGER.md, docs/GRAPHICAL-RECOVERY-2026-10-28.md, scripts/preview-graphical-recovery.mjs. Remaining unrelated untracked path: AGENTS.mdx, preserved. Worktree disk use 67,093,956 bytes before final documentation; worktree count remains 21. Preview syntax and original graphical markup checks pass; browser identified the original graph/button but disconnected before picker interaction/screenshot. Push: not performed. Deployment: none. Handoff: docs/GRAPHICAL-RECOVERY-2026-10-28.md. Next owner: this Codex session to finish graphical restoration and full-screen regression protection; do not deploy the hardcoded wrapper. Local preview process session 68363 listens on 127.0.0.1:58453, synthetic only.

## Graphical dashboard implementation continuation

- Agent Codex /root; session 01a1827c-b046-7e40-8e8d-bf2ffa550a66; UTC check-out 2026-10-28T13:35:07.8458558Z; state active. Reuse existing worktree C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025, branch codex/enclave-copy-only-20261025, base e384220ee2cc9b691ee8889b6cce46caf74dfd4d. No new worktree. Only untracked AGENTS.mdx at start, preserved. Integration origin https://github.com/data-automation-ai/portabase.dev.git main, then narrow Netlify release preserving published site artifacts/functions. Root dirty state preserved. All 21 worktree registrations reconciled against prior ledger; no removals. C: free 5.3 GB; expected new build/evidence under 150 MB. Owner explicitly requires restoration, commit, push, live deployment. Check-in and evidence to follow.

- Implementation check-in: Codex /root; session 01a1827c-b046-7e40-8e8d-bf2ffa550a66; UTC 2026-10-28T14:22:55.8985033Z. Worktree C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025; branch codex/enclave-copy-only-20261025; application HEAD 9b9768ca360913448798e8c3c9cd5b8932bb905c. Commits 80bd2b9, 5286b1d, 9b9768c pushed to origin/main and named branch. 28 focused tests pass; exact-commit build and server function smoke pass. Deploy 6ae203f5551071afc34932d1 is published; source revision and unchanged homepage verified by HTTP, signed-in live graphical screen/picker verified by browser. Real project/capacity data awaits explicit source consent for capece, then intended target consent; no jobs run. Only remaining unrelated untracked path AGENTS.mdx is preserved. Documentation closeout changes committed separately. Ignored release artifacts 256096101 bytes retained; fixture/preview processes 29869 and 68363 retained for evidence. Worktree count remains 21. State awaiting integration of real OAuth grants; named next owner/action: this Codex session after owner consent. Handoff docs/GRAPHICAL-RECOVERY-2026-10-28.md.

## Graphical vault button continuation — 2026-10-28

- Agent Codex /root, session 01a1827c-b046-7e40-8e8d-bf2ffa550a66. Reused C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025; branch codex/enclave-copy-only-20261025; no worktree created or removed. Root dirty checkout and untracked AGENTS.mdx preserved. All 21 worktree entries remain accounted for; C: free 3,384,868,864 bytes at check-in.
- Owner requested 100% larger Supabase source/destination badges, removal of redundant recovery mapping, and five logo buttons in the graphical vault panel. Commits 32b6c09, 8749c08, 73dd272, d7c059d pushed to origin/main and the named branch. 16 focused GUI/state tests and frontend build pass. Synthetic browser preview verified five-column layout and Off toggle; signed-in live browser verified all five buttons.
- Published Netlify deploy 6ae21a5a41f87a1de347b704 from reviewed commit d7c059d1c47a307603e082419cfb4180316b3e59. Prior deploy 6ae218d95af67ab03a09b902 is rollback. Served /dashboard revision matches source; homepage unchanged in release manifest. Dropbox and Google Drive use existing OAuth start routes; live 302 destinations checked. OneDrive, Amazon S3, and Cloudflare R2 are visibly disabled as setup pending. No multi-vault delivery or hosted recovery execution was claimed or run.
- Check-in Codex /root at 2026-10-28T15:53:36Z. State awaiting integration of provider connection and delivery implementations. Remaining changed/untracked path only AGENTS.mdx (untracked, preserved); ignored exact-release artifacts retained. Handoff: docs/GRAPHICAL-RECOVERY-2026-10-28.md. Named next owner/action: implement OneDrive and guided S3/R2 connections, multiple-vault capsule delivery, then separately prove a full hosted recovery cycle with owner-selected test projects.

## S3 and R2 capsule setup continuation — 2026-10-28

- Agent Codex /root, session 01a1827c-b046-7e40-8e8d-bf2ffa550a66. Reused existing `C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025`, branch `codex/enclave-copy-only-20261025`; no worktree created or removed. Integration destination `origin/main`. Root dirty checkout and untracked `AGENTS.mdx` preserved. Worktree inventory remains 21 entries, including the missing Claude temporary path; no prune or cleanup. C: free approximately 275 MB at check-in.
- AWS account 899867382621: created private bucket `portabase-capsules-899867382621`, intended prefix `Portabase/capsules/`, TLS-only bucket policy, and Confidential Space OIDC role `portabase-confidential-capsule-vault` scoped to that prefix. Static customer keys are not needed for this AWS path. The trust pins the current application image digest, so a new runner image requires updating and reviewing the digest before use. No real attested exchange, upload, or restore has been run.
- Cloudflare account 22e69ab8d7535209e7b725242118e4cf: R2 subscription remains inactive. Activation presents automatic billing beyond the free allowance; owner approval requested and pending. OAuth client creation wizard has not been submitted. No R2 bucket or live R2 credentials exist.
- Commits `b16f2ef`, `5d0219b`, `61446f2`, `1e68018`, `b7e8af5` pushed to named feature branch only. GUI saves S3/R2 bucket, prefix, and naming policy; provider code supports S3 attested role and R2 S3-compatible endpoint; uploader now verifies remote readback hashes. 15 focused tests pass, `git diff --check` passes. Capsule naming choice is not wired into upload behavior, and the hosted GUI does not launch these jobs. No main push or production deployment. Last reviewed production Netlify deploy remains `6ae22074ad2af0ca66a4e9dc` from earlier dashboard release.
- Check-in Codex /root at 2026-10-28T16:47:50Z, HEAD `b7e8af52453ed631a85ab1f2f3c9347b549f8dd1`, state awaiting integration. Remaining changed/untracked path: `AGENTS.mdx` only, unrelated and preserved. Ignored generated release artifacts retained. Named next owner/action: this Codex session or successor to implement safe overwrite/date-stamped storage semantics, connect hosted GUI to attested jobs, activate R2 only after owner billing approval, then run isolated cloud proof and release review.

## Power outage continuation — 2026-10-28

- Takeover: Codex /root, session 01a183c6-b1bc-7692-ad78-b3ab5d9b13f6, UTC 2026-10-28T18:33:26.489890+00:00. State active. Existing checkout C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025; branch codex/enclave-copy-only-20261025; base 0504bced9949ba7cb7374a0248278f4316c67cb5. No new worktree. Integration destination origin/main at https://github.com/data-automation-ai/portabase.dev.git after release review.
- Previous owner session 01a1827c-b046-7e40-8e8d-bf2ffa550a66 checked in at 2026-10-28T16:47:50Z; no overdue check-in inferred. Prior production evidence: deploy 6ae22074ad2af0ca66a4e9dc, not yet reverified. All 21 registered worktrees reconciled; exact current HEADs and dirty/untracked paths in docs/POWER-OUTAGE-INVENTORY-2026-10-28.json. Only AGENTS.mdx is untracked in this reused checkout; preserve it. Root and other checkout changes preserved.
- Scope: resume customer trial preparation; owner added customer console runner hours for 30 days and organized durable manifests, all encrypted under the recovery key used inside the attested enclave. R2 billing approval remains pending. No production restore or new billing subscription authorized here. C: free approximately 15 GiB; expected additional source/test artifacts under 20 MB.

- Dashboard subagent phase 1 check-in: Codex `/root/customer_dashboard`, parent session `01a183c6-b1bc-7692-ad78-b3ab5d9b13f6`, UTC 2026-10-28T19:16:27Z. Awaiting parent integration; same checkout/branch/HEAD, no new worktree or commit. Exact changed paths, recovery command, 4 semantic tests, 16 isolated responsive cases, build/screenshot evidence and retained artifacts in `docs/AGENT-DASHBOARD-2026-10-28.md`. Parent retains Git index. No deploy/push; 21 registrations and C: free 16,564,752,384 bytes. Next action: parent reviews phase 1; this agent investigates hosted Run integration under separate phase 2.

- Dashboard subagent phase 2 check-in: Codex `/root/customer_dashboard`, parent session `01a183c6-b1bc-7692-ad78-b3ab5d9b13f6`, UTC 2026-10-28T19:31:20Z. Awaiting integration by `/root`; same checkout/branch/HEAD, no staging/commit/push/deploy. Hosted runner UI/client integration and explicit source/target consent implemented; 18 focused tests and 6 isolated browser flows pass, in addition to 16 usage UI cases. Exact paths, command to recover/stage, scope limitations, deployment gates, retained artifacts in `docs/AGENT-DASHBOARD-2026-10-28.md`. 21 worktree registrations; C: free 16,353,136,640 bytes. Parent owns release and isolated live proof. Agent ends turn to free concurrency slot; no worktree removed.

- Cases subagent check-out: Codex /root/cases_database, parent session 01a183c6-b1bc-7692-ad78-b3ab5d9b13f6, UTC 2026-10-28T19:33:55Z. Reuse same enclave-home checkout and HEAD0504bced; all21 registrations reconciled. No new worktree, staging or deployment. Scope and custody in docs/AGENT-CASES-2026-10-28.md. Parent owns serial integration; state active.

- 2026-10-28T20:25:28Z — Codex `/root/cases_database` check-in, session `01a183c6-b1bc-7692-ad78-b3ab5d9b13f6`, reused enclave-home-20261025 at HEAD `9d335afb313f91636930cbec073074a2bf8b34d5`; awaiting integration by parent `/root`. Exact paths, parent-owned live seed evidence, 13 tests / 12 UI flows / build, disk inventory, recovery commands and no-deploy status: [AGENT-CASES-2026-10-28.md](./AGENT-CASES-2026-10-28.md). Parent owns shared index; no child commit or push. All 21 worktrees preserved.

- 2026-10-28T20:37:08Z — Codex `/root/cases_database` follow-up check-in, parent session `01a183c6-b1bc-7692-ad78-b3ab5d9b13f6`, HEAD `bc7fb2c4d5ac0233b21321eb97ce06462fc06cdd`, reused enclave-home-20261025; awaiting parent integration. Bounded isolated recovery proof harness and session selection guard, no live executions, 9 focused tests pass. Exact paths, metadata investigation, disk/worktree inventory and recovery commands: [AGENT-CASES-2026-10-28.md](./AGENT-CASES-2026-10-28.md). Parent owns serial commit/build/deploy; no child staging or push.

- 2026-10-28T21:17:07Z — Codex `/root/cases_database` explicit fixture rebind check-in, same parent session and enclave-home checkout, HEAD `c875019c05d0e954d6742820496a147eb63ae733`; awaiting parent integration. Five exact source/doc paths, default-strict guard, inspect-only fixture repair, no-provider-opening proof and 12 passing tests are recorded in [AGENT-CASES-2026-10-28.md](./AGENT-CASES-2026-10-28.md). No child cloud execution, commit or deployment. Parent reviews and rebuilds before running.
