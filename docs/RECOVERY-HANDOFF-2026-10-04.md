# Portabase session recovery handoff — 2026-10-04

This note is for the next engineer or model entering after an unexpected
session loss. It is a recovery aid, not a release claim. The owner reports that
development was interrupted by power loss and a reboot into a new session.

## Latest implementation checkpoint — 2026-10-05

The requested vertical customer flow is connected locally:

1. authenticated account identity;
2. current Square-backed subscription admission;
3. customer-controlled runner credential registration;
4. opaque private backup reference submission;
5. runner-only resolution and execution;
6. durable completion with fixed safe capsule metadata;
7. safe telemetry persistence/readback; and
8. capsule ID, hashes, size, destination kind, and delivery status in the
   customer dashboard.

The engine now writes project-bound result metadata into its private status
directory. The runner validates that file and sends only capsule ID/status,
ciphertext and manifest hashes, total bytes, object count, duration,
destination kind, destination verification, and completion time. Queue status
(`succeeded`/`failed`) and capsule status (`COMPLETE`/`SELECTIVE`/`TRIAL`) are
stored separately. Completion journals and immutable server receipts compare
the exact result across retries. Older engines may finish without the new
metadata; the worker preserves the successful outcome and does not rerun it.

The runner credential UI now shows the environment variables and commands for
private setup, opaque reference download, and supervisor execution. It states
that Supabase credentials and capsule passphrases stay in the runner.

Evidence: 104 focused tests passed, including a single composed signed-in
Square subscriber -> runner -> backup -> telemetry -> dashboard flow, and the
production Vite build passed with the existing large-chunk warning. The test
asserted that its private passphrase, bucket/prefix, and engine filename never
entered serialized control-plane output.

Release state remains **INCOMPLETE**. Nothing was deployed. No production runner,
live Square lifecycle, real Supabase capture, customer vault delivery, or restore
drill was performed. The latest live infrastructure audit found the existing
runner deployment source incompatible with the current persistent supervisor
contract and no ready Portabase ECR/EC2 service plane; use a clean release
worktree and provision durable customer-controlled runner storage before any
deployment attempt.

## First rule: preserve the checkout

The current checkout contains extensive unfinished work. Do not reset, clean,
stash, checkout another branch, broadly stage, or overwrite files. Do not deploy,
publish, mutate provider state, or run a real backup/restore as part of initial
recovery. Read first. Never write to F:. End-to-end backup/recovery proof must
use the cloud/container spool required by `AGENTS.md`; do not create surprise
work files on local disks.

## Repository identity and observed state

Observed during recovery:

- Repository root: `C:/Users/ryanh/git/portabase.dev`
- Branch: `agent/muse-telemetry-read-api`
- HEAD: `80b2431 Focus homepage on recovery risk and prioritize recent incident evidence`
- Remotes: `origin` is `data-automation-ai/portabase.dev`; `old-origin` is
  `lcapece/portabase.dev`.
- Worktree: very dirty, with tracked modifications and many untracked files.
  The initial status listing was long; the assistant's `git status --short`
  count was 228 paths (count includes the `PROJECT_STATUS.md` modification).
- `PROJECT_STATUS.md`, `docs/HANDOFF.md`, source files, tests, and deployment
  config are themselves modified/untracked evidence. Treat this checkout as the
  source of current work, not the stale branch/state described by older docs.
- No files have been intentionally changed by the recovery assistant before
  writing this handoff.

There is an older Codex memory entry for this repository, but it describes the
2026-10-03 public npm/recovery-options work on branch
`checkpoint/2026-10-03-cli-review-fixes-hero`. That is background only and does
not describe the present 2026-10-04 checkout.

## Product objective and active thread

The preserved goal from the interrupted session is the deployed subscription
service, not one isolated runner bug:

> A customer can sign up, subscribe through Square, manage the account and
> capsule telemetry, operate persistent sealed capsule runners, keep full
> manifests and logs inside the capsule/private runner, explicitly choose
> whether a safe manifest projection is shared with Portabase, and receive
> email and SMS updates. Portabase's ordinary backend must not store source
> credentials, encryption keys, capsule contents, full manifests, detailed
> logs, or other confidential recovery data.

`PROJECT_STATUS.md` section **2026-10-04 subscription service goal and owner
decisions** is the current detailed decision record. It also preserves these
owner corrections: working pricing/capacity remains unresolved between older
source/docs and the recalled $7/100 MB and $17/10 GB plan; included transfer
allowances and metered overage are required; the runner persists for the paid
subscription; the private runner must contain its own GUI; only typed safe
operational telemetry crosses to the ordinary backend; and future AWS capture
must fit the architecture without expanding the first release.

The user explicitly requested a multi-agent workflow and then said: **“Need to
solidify the goal.”** This goal must persist across sessions. Do not shrink it
to whichever local subtask was last edited.

## Reconstructed work timeline and exact stopping points

Three coherent workstreams occurred on 2026-10-04:

1. **About 4:00–4:08 PM — durable private runner recovery.** Claim and
   completion journals, supervisor recovery, single-process leases, retained
   record privacy, and composed retry scenarios were integrated. The recorded
   754-test/build checkpoint predates the later schedule, cancellation, and
   homepage edits.
2. **About 4:13–4:19 PM — managed schedules and normal cancellation.** The
   schedule contract, API, dispatcher, account UI, and security coverage were
   added. A normal period-end Square cancellation endpoint and tests were also
   added. One recovered Codex subagent log ended at 4:19 PM because the weekly
   usage limit was reached, not because its task was complete.
3. **About 5:10–6:06 PM — isolated mobile-sales/homepage review.** Work in
   `.worktrees/mobile-sales` produced a subscription-focused mobile page,
   supplied recovery artwork, 22 sourced cases, desktop trimming, and review
   artifacts. A subset was then copied into the main dirty checkout. This is
   the literal latest on-disk work before the reported outage.

### Exact managed-schedule session stop

The recovered schedule subagent's final implementation added
`src/console/managed-backup-schedules.jsx`, schedule calls in
`src/lib/cloud-api.js`, integration in `src/console/pages.jsx`, and
`scripts/check-managed-backup-schedules.mjs`. Its fixture browser check passed
at 320 and 1440 pixels, covering private-field rejection, explicit save,
subscription denial, disabled dispatcher, quota/queue states, revision
conflict, disable, ambiguous response refresh, privacy, and overflow.

The final read command mistakenly requested nonexistent
`tests/managed-schedules.test.mjs`; the actual backend test file is
`tests/managed-schedule-security.test.mjs`. The session terminated with
`usage_limit_exceeded` one second later. It did not complete real API/UI
integration review or provide a final handoff.

Sibling schedule agents did run the correct file. The preserved logs record
11/11 managed-schedule security tests passing, followed by a combined 44/44
focused run after binding a runner record's declared slot to its storage slot.
That evidence covers schedule schema privacy, billing/owner/runner authority,
quota races, pause/claim behavior, disabled dispatch, malformed records, and
related claim/admission regressions. The resumed root session then added direct
dispatcher coverage: 13/13 schedule tests pass with bounded persisted
multi-account traversal, next-invocation continuation, exclusive overlapping
leases, lease release, and malformed-cursor refusal.

### Exact latest checkout split

The isolated branch/worktree is `review/mobile-sales-20261004` at commit
`2e158ad`, with additional uncommitted review changes. Its
`docs/MOBILE-SALES-REVIEW.md` records a Vite build and Chromium checks at 320,
390, 430, 767, 768, 1280, and 1440 pixels. It was not merged or deployed.

The main checkout contains only part of that review: the recovery diagram,
cases C15–C22, date/impact sorting, case numbering, and the mobile two-column
case layout. `MobileSalesPage`, desktop trimming, and the full reviewed variant
remain only in the isolated worktree. Do not blindly merge or copy either
direction; first compare the two worktrees and decide the intended product
surface.

### Exact interrupted homepage task — completed in the isolated worktree

The recovered final owner instructions were to present every customer case in
the supplied card format, retain two columns on mobile, and review the whole
homepage—especially the lower half—to remove material that was not needed.
The prior session had completed the card layout and responsive checks but had
left official uptime incidents mixed with customer account-loss evidence.

That remaining pass is now complete in `.worktrees/mobile-sales`:

- the first evidence block is limited to five official Supabase incidents
  directly relevant to login, project state, backup, pause, or restore;
- all 22 sourced customer account and data-loss reports remain in a separate
  two-column case section;
- repeated diagrams, the extra self-audit/use-case sections, duplicate
  subscription pitches, and the now unnecessary evidence sorter are absent;
- `npm run build` passed with the existing bundle-size warning;
- Chromium checks passed at 320, 390, 430, 767, 768, 1280, and 1440 pixels;
- a fresh 1440px full-page probe reported `stories: 5`, `cases: 22`, and
  `overflow: false` and produced
  `.worktrees/mobile-sales/review-evidence/home-1440-full.png`.

This resolves the exact interrupted UI review. It remains an isolated,
uncommitted worktree result: it has not been reconciled into the main dirty
checkout, merged, or deployed.

## Current evidence and known unfinished work

`PROJECT_STATUS.md` says an earlier integrated checkpoint passed 754 tests and
the production Vite build, with a bundle-size warning. That result predates the
managed schedule, cancellation, and partial homepage integration. It is not
evidence that the current main checkout passes.

Preserved local evidence after that checkpoint:

- The managed-schedule fixture UI check passed at 320/1440 pixels.
- Eleven managed-schedule security tests passed, and a later combined focused
  run passed 44/44 after the runner-slot binding fix.
- The expanded managed-schedule file now passes 13/13 with direct dispatcher
  cursor, lease, and multi-account traversal coverage.
- Seven normal subscription-cancellation tests passed. A combined billing,
  account-projection, and cancellation run passed 30/30.
- The authenticated billing page now invokes normal period-end cancellation
  through a second confirmation. The updated signup/checkout browser fixture
  passed for both public paid plans, including an unchanged-provider error and
  lost-success-response reconciliation without an extra provider mutation.
- The mobile review worktree records a production build and seven responsive
  viewport checks. Those results apply to that isolated worktree, not the
  partially copied main checkout.
- Four managed-schedule screenshots and the mobile review artifacts remain on
  disk.

Other visible release gaps called out by the current release-gates table:

- no production persistent private runner or live recovery drill;
- no live $7 Square checkout/subscription lifecycle proof (a recent audit
  recorded a Square 401);
- normal period-end cancellation is implemented through the account UI, but it
  is not deployed and no live Square cancellation is proven;
- managed schedule source now exists, but its dispatcher is not enabled or
  deployed and no real scheduled job is proven;
- email/SMS product configuration and real delivery/receipt proof are missing;
- safe telemetry and private manifest sharing are locally implemented but not
  deployed/live verified;
- current signup/account flows need deployed verification.

The ledger also reports a recent dashboard cached-green/unproven-status issue
and says a browser-level fix was in progress. Reconcile that note against the
actual latest source and scripts before resuming it.

Never claim the project is complete from tests/builds. `AGENTS.md` requires
separate provisioned/configured/deployed/live/security evidence and an
end-to-end recovery proof.

## Suggested read and recovery sequence

1. Read repository `AGENTS.md`, `PROJECT.md`, and the first ~100 lines of
   `PROJECT_STATUS.md`. Obey the no-F: and cloud-spooling rules.
2. Reconfirm root, branch, HEAD, remotes, and `git status`; preserve every dirty
   file. Do not use the older `docs/HANDOFF.md` branch/deploy details as current
   without verification.
3. Inspect `.worktrees/mobile-sales/docs/MOBILE-SALES-REVIEW.md`, the fresh
   `review-evidence/home-1440-full.png`, that worktree's status/diff, and the
   corresponding main-checkout homepage diff. The interrupted review itself is
   complete. Preserve both worktrees and decide explicitly whether the reviewed
   mobile variant should be integrated or left isolated.
4. Resume the product thread at managed schedule integration. Reconcile
   `src/console/managed-backup-schedules.jsx` with
   `netlify/functions/cloud-schedules.mjs`,
   `netlify/shared/managed-schedules.mjs`, and
   `tests/managed-schedule-security.test.mjs`. The fixture UI check is already
   known to have passed; backend and direct dispatcher security tests also
   passed. Complete deployment configuration, a persistent runner, and real
   scheduled-job proof before presenting scheduled backups as available.
5. Reverify normal cancellation against the deployed product Square account
   once valid product credentials are available. Preserve period-end semantics,
   provider readback, add-on cancellation, and the distinction from self-refund.
6. Continue updating the top release-gates/current-checkpoint section of
   `PROJECT_STATUS.md`; it is stale relative to schedule and cancellation source.
7. Give the owner a concise checkpoint with exact changed files, evidence,
   blockers, and the next action. Do not ask the owner to reconstruct this
   history again.

Primary pointers: `PROJECT_STATUS.md` (especially the 2026-10-04 owner-decision
section), `.worktrees/mobile-sales/docs/MOBILE-SALES-REVIEW.md`,
`src/console/managed-backup-schedules.jsx`,
`tests/managed-schedule-security.test.mjs`,
`netlify/shared/managed-schedules.mjs`,
`netlify/functions/cloud-cancel-subscription.mjs`, and
`tests/subscription-cancellation.test.mjs`.

## Failure analysis: how the prior recovery assistant failed

This analysis is based on the visible session, not speculation about model
internals.

1. **It answered the wrong question first.** When asked whether it had repo
   knowledge, it gave a high-level product and dirty-worktree summary. When
   asked whether there was a goal, it again described the general Portabase
   mission. The owner's actual need was to recover the exact interrupted
   development thread and avoid repeating work.
2. **It implied reconstruction but did not do it.** After the owner agreed to a
   recovery, the assistant said it would inspect recent checkpoints, but it
   only skimmed selected lines from `PROJECT_STATUS.md` and then returned an
   apology rather than the promised specific reconstruction. It did not inspect
   the newest changed files, test failures, local agent/task notes, timestamps,
   or session evidence to find the concrete stopping point.
3. **It did not maintain a durable checkpoint before failure.** The repo has a
   large mixed status ledger with historical and current work interleaved, and
   the assistant did not first establish a concise top-level resume pointer
   before development. This made the new session reconstruct from noisy notes.
4. **It overused apology and undershot action.** The owner said each new session
   was 1–5 steps backwards and could no longer afford it. The assistant
   responded with another apology and stopped. That acknowledged frustration
   but provided no artifact or concrete recovery.
5. **It made unsupported certainty statements.** It said 228 paths were changed
   and later claimed “I haven’t changed any files” without a before/after
   baseline. The 228 count came from a later status command; it was not safely
   attributable to pre-assistant state. Future reports should distinguish
   observed state from causation and avoid claims beyond evidence.
6. **It missed the user's immediate UI request context.** The browser-permission
   question was answered with a generic instruction. When asked “check,” the
   assistant failed to discover an active browser-control tool and instead
   claimed it could not inspect the settings, despite a relevant skill being
   available. This reduced trust further.
7. **It named the wrong active thread.** It promoted the older durable-claim
   checkpoint to “the main engineering thread” without checking source times,
   the preserved session logs, or the isolated mobile worktree. Later recovery
   proved that managed schedules/cancellation followed the claim work and that
   mobile-sales review was later still.
8. **It failed to check whether the goal survived the reboot.** A direct goal
   check later returned no active goal even though the old session contained a
   detailed persistent objective and the owner's instruction to solidify it.
   The corrected session restored that objective as an active goal.

### Required behavior for the next session

- Start by acknowledging the exact active task from durable evidence, not by
  restating the product mission.
- Inspect the live checkout and newest local notes before making claims. Treat
  the repo/status files as evidence with dates, not as unquestioned truth.
- Do not ask the owner to repeat context that can be recovered locally.
- Give short progress updates while doing actual reconstruction; then deliver a
  precise resume point with an actionable next step.
- Preserve the worktree and separate local tests/build evidence from deployment
  and live recovery evidence.

## Settings-screen question from this session

The owner showed ChatGPT Work's Cloud computer website-permissions screen and
was told to add `https://portabase.dev` as **Always allow**. The screenshot
displayed only `https://dicefootball.club` and `https://musicsupplies.com` at
that time. The owner then asked to check whether it had been added. This agent
could not verify the settings state in its available UI and said so; therefore
there is no evidence that the Portabase permission was saved. A future agent
with settings-screen access should verify it directly rather than infer it.

## Session status

This document preserves a recovery trail for the owner and a successor model.
The corrected session restored the full subscription-service objective as the
active Codex goal, recovered and completed the exact interrupted homepage
review in the isolated mobile-sales worktree, and updated this handoff from
checkout/session evidence. It did not commit, stage, deploy, publish, or perform
provider mutations. The next agent must inspect Git diff and current source
before continuing.
