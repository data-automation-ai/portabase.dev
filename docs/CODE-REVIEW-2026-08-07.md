# Portabase — Code Review (2026-08-07)

Scope: full repo, 4 parallel review passes (CLI engine, Netlify/payments backend, frontend+desktop, repo-wide secrets sweep). Read-only, no edits made. `npm test` run clean: 67/67 passing — none of the failing paths below are covered by that suite.

**Independent verification note:** findings #1 and #2 below (the two CRITICAL items) were re-read and confirmed directly against the source by me, not taken on subagent claim alone. The RLS finding (#19) was checked live against the production Supabase project (`ekklokrukxmqlahtonnc`) via direct SQL — RLS is indeed off on all 10 `portabase_cloud` tables, but I also confirmed neither `anon` nor `authenticated` has schema `USAGE`, so it is not currently reachable via PostgREST. It's ranked MEDIUM/LOW-severity accordingly rather than reported as an open/unresolved question.

---

## CRITICAL

### 1. `replay` silently no-ops but reports success — the product's core proof claim is currently false
**File:** `utility/portabase.mjs:80, 2449-2451`

`argv` is captured once at module load (`process.argv.slice(2)`, a copy). `flag()`/`hasFlag()` read this frozen copy. `replay()` tries to force execute mode via `process.argv.push('--execute')` (line 2450) — but that mutates the *original* live `process.argv`, not the frozen copy `hasFlag` actually reads. So `hasFlag('execute')` still evaluates false, `restore()` takes its dry-run branch, prints "DRY RUN ONLY — No target was changed," and returns with exit code 0. `replay()` then unconditionally prints "REPLAY VALIDATION FINISHED — this capsule is proven restorable into a new account."

**Failure scenario:** an operator runs `portabase replay --confirm-target <new-ref>` — the exact invocation documented in `help()`, `doctor()`, `RECOVER.md`, and `scripts/e2e-escape-test.ps1` — sees exit 0 and "proven restorable," and believes their backup strategy is validated. Nothing was actually written to the target. This is the single command whose entire job is to prove the product's central claim, and it currently can't fail loudly even when it does nothing.

**Zero test coverage** of `replay()` exists — an integration test invoking it end-to-end would have caught this immediately.

**Fix direction:** don't rely on argv mutation across a module-level frozen copy; pass an explicit `{ execute: true }` option into `restore()` instead of faking a CLI flag.

---

### 2. Cloud paywall is not enforced server-side — free users get permanent paid access
**File:** `netlify/functions/cloud-confirm-checkout.mjs:34-66`

This handler never contacts Square. It writes `status: 'trialing'` whenever a client-supplied `attempt` matches the stored `checkoutAttempt` — **or whenever `attempt` is omitted entirely** (the guard at line 42 is skipped when `attempt` is falsy). `checkoutAttempt` is created by the same authenticated user calling `cloud-subscribe` — it proves nothing about payment.

**Failure scenario:** any signed-in user calls `cloud-subscribe` (creates a pending checkout + attempt id), abandons the Square payment page without entering a card, then calls `cloud-confirm-checkout` with that attempt id (or without one) → full `trialing` access granted, no charge. A previously **canceled** user can call the same endpoint again and flip themselves straight back to `trialing`, because the access short-circuit only fires for currently-active statuses.

Compounding: `deriveAccess()` in `netlify/shared/subscription-store.mjs` never checks `trialEndsAt` against wall-clock time anywhere in the codebase, and **no scheduled function exists** to sweep expired trials. A `trialing` record grants access indefinitely unless Square happens to send an independent cancellation webhook.

**Net effect: the $17/$27 paywall is currently decorative.** This is the single highest-priority fix in the repo — it's a revenue bug, not just a security bug.

---

### 3. Possible cross-tenant log disclosure via CloudWatch console endpoint
**File:** `netlify/functions/cloud-cloudwatch-live.mjs:108-146`

`workspaceId`, `secretId`, and `logGroupName` all come from the client-controlled request; `roleArn` is optional, and when omitted the handler falls back to Portabase's own ambient AWS control-plane credentials rather than a customer-scoped role. Any authenticated user (see #4 — not even a paying one) can supply another tenant's `workspaceId`/`secretId` and read that tenant's CloudWatch log groups, or any log group reachable by Portabase's own account credentials. Message redaction strips known secret-shaped strings but does not stop reading another tenant's operational logs/hostnames outright.

**Recommend:** require and validate `roleArn` is scoped to the caller's own workspace (looked up server-side from the authenticated user's workspace membership, never trusted from the request body) before any AssumeRole call.

---

## HIGH

### 4. No entitlement check on any Cloud data endpoint — "logged in" ≠ "paid"
**Files:** `cloud-jobs.mjs`, `cloud-audit-trail.mjs`, `cloud-cloudwatch-live.mjs`

All three verify the JWT (`verifyCloudUser`) but never call `deriveAccess()`/check subscription status. A user who signs up but never starts a trial or pays gets full use of the job queue, audit trail, and CloudWatch viewer. Combined with #2, an attacker doesn't even need the confirm-checkout trick — plain signup may be enough depending on default record state.

### 5. SQL cleanup regex has no dollar-quote awareness — can corrupt restored functions
**File:** `utility/portabase.mjs:572-599` (`cleanSchemaLine`/`cleanRoleLine`), `transformSql` at line 529

Per-line regex rewrites (used to strip/rewrite `GRANT`, `CREATE TABLE "..."`, etc. lines during schema.sql cleanup) have no tracking of `$$...$$` / `$tag$...$tag$` boundaries. A PL/pgSQL function body containing a line that happens to match one of those patterns (e.g. dynamic `EXECUTE 'GRANT ...'`, or a string literal that looks like a DDL line) gets silently rewritten/commented mid-function, corrupting the restored function on `restore --execute`.

### 6. One failed Storage object download aborts the whole layer with no partial manifest
**File:** `utility/portabase.mjs:849-858` (`captureStorage`), pool behavior in `portabase-core.mjs:294-310`

`mapPool` uses `Promise.all`, so a single object download failure late in a large run (e.g. object 49,999 of 50,000 hits a transient 503) rejects the whole pool. The outer manifest correctly demotes to `PARTIAL` (no false-COMPLETE), but `storage-manifest.json` — which the *next* run's resume logic depends on — is never written, so the 49,998 successfully-downloaded objects can't be resumed from listing identity (only the best-effort content-hash cache partially mitigates re-download cost).

### 7. Argument injection into the spawned CLI from Electron's IPC layer
**File:** `desktop/main.cjs:88, 92-93`

`runCli` validates `args` only as "array of strings ≤2048 chars" with no flag allowlist. The renderer-supplied array is spliced directly into the child process argv, and the trusted `--config <path>` is only appended `if (!args.includes('--config'))` — so a compromised renderer can pass its own `--config <attacker-path>` and redirect the CLI to a malicious config (arbitrary `backupDirectory`, `provider.path`, `encryption.passphraseEnv`). `shell:false` + array spawn correctly prevents shell injection, but not this argument-level override.

### 8. `inspectInstalledLicense` shadows `path` module — guaranteed TypeError on every call
**File:** `desktop/main.cjs:80-81`

`async function inspectInstalledLicense(path = licenseFile())` shadows the top-level `require('node:path')`. The body then calls `path.join(...)` on the string parameter, throwing every time. This is invoked by the `portabase:state` IPC handler on every app boot and by `portabase:import-license` — license status/import is broken app-wide right now. Trivial one-line fix (rename the parameter), but the fact it shipped suggests this path isn't covered by any test or manual QA pass.

### 9. CSP (`connect-src 'none'`) may be blocking every network call the SPA makes
**File:** `public/_headers:6`, applies to `/*`; no `[[headers]]` override exists in `netlify.toml`

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none';
  base-uri 'self'; frame-ancestors 'none'
```

`connect-src 'none'` forbids `fetch`/`XHR`/`WebSocket` from **any** origin, including same-origin. This is applied site-wide (`/*`), and nothing narrows it for the app routes. Every `fetch()` in the SPA — auth config, Supabase SDK calls, `/api/cloud/*` — would be blocked by a CSP-compliant browser. This looks like it was copied from `desktop/index.html`'s CSP, where `connect-src 'none'` is *correct* because the Electron renderer talks over IPC, not HTTP — but fatal on the web SPA where it was seemingly reused verbatim.

**I checked `https://portabase.dev` directly and got a 401 (Netlify access-control gate) before any headers were observable**, so I could not confirm live behavior — this needs to be checked against an actual unauthenticated deploy preview or after removing that gate. Flagging as high rather than critical pending that confirmation, but if it is live, it's critical (whole site broken).

### 10. Square webhook has no idempotency/dedup — can resurrect a canceled subscription
**File:** `netlify/functions/square-webhook.mjs:59-144`

Signature verification is correct, but there's no event-id dedup store and no check that an incoming event is newer than the stored state. Square's own retry behavior (resending the same event, sometimes out of order) means a stale `subscription.updated: ACTIVE` replay can silently un-cancel a subscription that was already canceled.

### 11. `issue-license.mjs` — possession of a non-secret order id is sufficient to claim a license
**File:** `netlify/functions/issue-license.mjs:53-77`

No auth binds the requester's identity to the order's buyer — only `orderId` (format-validated) + a platform choice. The Square-side verification (order COMPLETED + correct $147 line item) is real and correctly implemented, so this isn't "mint without payment" — but order ids appear in redirect URLs/emails/dashboards and aren't secret, so anyone who learns a paid order id can claim that license first, ahead of the legitimate buyer (`claimPlatform` is first-come via `onlyIfNew`).

---

## MEDIUM

13. **CloudWatch/CloudTrail live pollers read the session from the wrong localStorage key.** `src/console/pages.jsx:1649, 1885` reads `'portabase.session'`; the real key is `'portabase.auth.v1'` (`src/lib/session.js:3`). Both pollers silently fall back to demo mode for every real customer — invisible breakage.
14. **Open redirect in OAuth callback via `state` param.** `src/auth-pages.jsx:358-385` extracts `next:` from the client-suppliable `state` query param and redirects to it with no same-origin allowlist. A user with an existing live session can be sent to `/auth/callback?state=next:https://evil.example/` with no `code` and still get redirected off-site.
15. **No scheduled trial-expiry sweep exists** (restated from #2's root cause — listed separately because it's an infra gap, not just a logic bug): no cron/scheduled Netlify function anywhere sweeps `trialing` records past `trialEndsAt`.
16. **Read-modify-write races between webhook and confirm-checkout.** `netlify/shared/subscription-store.mjs` — every writer does get-then-set with no compare-and-swap. A webhook cancellation and a concurrent confirm-checkout can clobber each other, dropping a cancellation.
17. **Shared static telemetry ingest token, non-constant-time comparison.** `cloud-telemetry.mjs:11-17` — one token for every tenant/agent; the `agents` table already has a per-agent `token_hash` design that isn't wired into this ingest path.
18. **`cloud-audit-trail.mjs` allows AssumeRole probing against an arbitrary attacker-supplied `roleArn`** with no allowlist/workspace binding, and returns raw AWS error text (recon value).
19. **No RLS on any of the 10 `portabase_cloud` tables** (`agents`, `alert_channels`, `alert_policies`, `escalation_steps`, `monitored_projects`, `profiles`, `runners`, `telemetry_events`, `workspace_members`, `workspaces` — confirmed live via direct query against the production project, not just the migration files). **Verified not currently exploitable**: neither `anon` nor `authenticated` role holds `USAGE` on the `portabase_cloud` schema, so PostgREST cannot reach these tables today regardless of RLS state. Still worth fixing — it's a silent landmine: the day anyone runs a `GRANT USAGE ON SCHEMA portabase_cloud TO authenticated` (e.g. while wiring up a client-side Supabase read for convenience), every tenant's workspaces, telemetry, and subscription data becomes readable/writable by any authenticated user with zero additional signal that it happened.
20. **Offset-based Storage pagination isn't safe against concurrent bucket mutation.** `utility/portabase.mjs:654-672`, duplicated in `scripts/promote-storage-cache.mjs:38-61` and `portabase.mjs:1997-2026`. Objects added/removed during a long capture window can be silently skipped from the source inventory while the capsule is still marked complete.
21. **Local-vault capsule copy isn't atomic.** `utility/portabase.mjs:1338-1350` — a killed process mid-copy leaves a corrupted partial capsule in the vault with no marker distinguishing it from a valid one.
22. **Restore verification checks row counts, not row content.** `verifyRestoredDatabase`/`compareDatabaseInventories` (`portabase-core.mjs:523-548`) — a restore with the right row count but wrong data would report `verified: true`; evidence-report language ("PASS — N rows matched") reads stronger than what's actually checked.
23. **Dead Cognito auth path remains fully wired**, gated by one boolean (`AWS_CLOUD_VERSION_ENABLED = false` in `src/lib/cloud-versions.js`) rather than centralized behind a single provider factory — flipping it re-activates a weaker, unreviewed auth flow (`USER_PASSWORD_AUTH`, no PKCE, tokens in localStorage) and ships dead weight to every visitor's bundle regardless.
24. **`open-report` IPC handler's TRIAL-REPORT check only matches basename**, not a scoped directory (unlike the correctly-scoped evidence-file check next to it) — `desktop/main.cjs:302-308`. Path comes from regex-parsed CLI stdout, which could in principle be influenced by source-project naming.
25. **Sign-out doesn't always clear the underlying Supabase session.** `src/lib/supabase-auth.js:108` — the catch-all fallback in `ensureFreshSession()` clears only the local mirror, not `supabase.auth.signOut()`; the real GoTrue session can silently rehydrate the app's session state on next visit. (Explicit sign-out button path is correct.)

---

## LOW

26. Fingerprints use MD5 as the headline integrity value in console/report copy (SHA-256 is also computed and stored, and the actual encryption auth tag is AES-GCM/SHA-256 — this is a labeling smell, not an exploitable gap).
27. `restoreStorage` uploads fully sequentially with a synchronous read-back verification per object — no concurrency, unlike capture. Meaningfully slows real-incident RTO.
28. `runDumpToFile` retries any pg_dump failure up to 3x with linear backoff, including non-retryable errors (permissions/syntax) — wastes ~9s before surfacing a deterministic failure.
29. `utility/portabase.mjs` is a single 2,483-line file mixing CLI parsing, capture, crypto orchestration, restore, and report generation — raises the cost of exactly the kind of bug found in #1 and #5.
30. Test coverage is concentrated on pure helpers; `backup()`, `captureStorage()`, `restoreStorage()`, `restoreDatabase()`, `openCapsule()`, `simulate()`, and `replay()` have zero direct test coverage despite being the highest-consequence code paths.
31. `listSecretNames` plaintext-table fallback parser is fragile to CLI output format changes — silently under-reports the "recreate these secrets" post-restore checklist with no error.
32. Square webhook's `payment.status === 'COMPLETED'` gate doesn't implement the documented house rule ("treat CAPTURED as paid even if order state is OPEN") — moot today only because `cloud-confirm-checkout` doesn't call Square at all (#2).
33. `square-order.mjs` GET endpoint is an unauthenticated paid/unpaid status oracle for any order id (low impact — legacy $147 flow only).
34. `resolveServerSecret` silently falls back to `process.env` on any Secrets Manager error — a rotated/misconfigured secret degrades quietly instead of failing loudly.
35. Replay-simulation timer loop (`src/console/pages.jsx:857-901`) has no unmount cleanup or run de-duplication — a recursive `setTimeout` chain can stack a second timer against the same state after navigate-away-and-back.
36. `CloudWatchLivePage`/`CloudTrailLivePage` are ~210-line near-duplicates that copy-pasted the same wrong-localStorage-key bug (#13) into two places instead of sharing a `useLivePoll()` hook.
37. Pricing copy ($17/$27) is hardcoded as literal strings in ~15 places in `src/main.jsx` marketing copy rather than sourced from `src/lib/product.js`'s `CLOUD_PLANS` — a price change updates the config but not the page text.
38. `docs/HANDOFF.md` and `docs/E2E-ESCAPE-TEST.md` are public and git-tracked and disclose real production Supabase project refs, a real S3 bucket/prefix with an actual capsule object key, and exact Secrets Manager key *names* to request — reconnaissance value for anyone who separately gets AWS access. No credential values are exposed, but this is more specific than it needs to be in a public repo.

---

## Confirmed clean (worth stating, not just omitting)

- **Crypto core is sound.** AES-256-GCM, per-file random IV/salt, scrypt KDF, AAD-bound capsule id, double SHA-256 verification (ciphertext then plaintext) on decrypt. No IV reuse, no unauthenticated-encryption gap.
- **Restore-target guards are real.** `validateRestoreTarget`/`validateBlankRestoreInventory` correctly refuse writing into the source project or an occupied destination — verified by dedicated passing tests.
- **No live secrets found anywhere** — working tree, full 53-commit git history, and built artifacts were swept for AWS keys, Square tokens, Supabase service-role JWTs, PEM headers; all hits were test-fixture strings, unchanged at HEAD. `.gitignore` correctly excludes `private/`, `portabase-capsules/`, `portabase-evidence/`, `.env*`, `dist/`, `release/`.
- **Electron hardening is genuinely good** apart from findings #7/#8/#24: contextIsolation on, sandbox on, no nodeIntegration, no remote module, array-based spawns (no shell injection), safeStorage-encrypted local credentials at `0o600`.
- **Netlify function auth is correctly wired** on the functions that need it (`verifyCloudUser` actually invoked, not just imported) — the gap is entitlement-after-auth (#4), not authentication itself.
- **67/67 existing tests pass**, and the ones that exist test real behavior (crypto round-trip, restore-target refusal, trial-ledger honesty, telemetry secret-rejection) rather than being smoke-only.

---

## Priority order to fix

1. `cloud-confirm-checkout.mjs` — stop granting trial status without a Square API call (#2) — **revenue-critical**
2. Add server-side trial expiry (scheduled function or check-on-read against `trialEndsAt`) (#2/#15)
3. Fix `replay`'s argv bug so it can't report false success (#1) — **product-integrity-critical**
4. Confirm and fix the `connect-src 'none'` CSP if it's live (#9)
5. Add entitlement checks to `cloud-jobs`/`cloud-audit-trail`/`cloud-cloudwatch-live` (#4)
6. Scope `cloud-cloudwatch-live.mjs`'s roleArn to the caller's own workspace server-side (#3)
7. Everything else, roughly in the ranked order above
