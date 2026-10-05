# Runner recovery handoff — 2026-10-05

This document records the exact state recovered after the Codex terminal stopped
on 2026-10-05. It is a continuity checkpoint, not a completion claim.

## Repository identity

- Repository: `C:\Users\ryanh\git\portabase.dev`
- Branch: `agent/muse-telemetry-read-api`
- Last committed source before this handoff: `9186187`
- Remote: `https://github.com/data-automation-ai/portabase.dev.git`
- The checkout contains substantial pre-existing, uncommitted customer-flow and
  runner work. Do not reset, clean, stash, or broadly stage it.

## Authentication release already live

- Production deploy: `6ac3a402beda80e0c96f4654`
- Production auth source: `deab157`
- Repository evidence was pushed through `9186187`.
- Email/password, email confirmation, existing-user magic-link login, password
  recovery, and Google entry are deployed.
- Disabled GitHub login was removed.
- Final acceptance still requires a customer-controlled Google consent and an
  email confirmation/password-recovery round trip.

## Runner implementation present in the dirty checkout

The current checkout contains a runner-local setup console and supporting private
runtime implementation:

- source Supabase inventory by schema, table, row estimate and bytes;
- Storage inventory by bucket, object count and bytes;
- schema and keyword filtering plus immutable selection references;
- separate recovery-target configuration;
- persistent runner-local SQLite inventory, selection and event state;
- private runtime credential storage with redacted status responses;
- orange/red runner UI with a beginner Supabase guide;
- three-second hover or keyboard-focus help for all nine configuration fields;
- an execution-boundary explanation covering browser, runner and PortaBase;
- capsule review, persistent supervisor, claim/completion journals, safe result
  projection and opaque private configuration references.

Primary files include:

- `utility/ui/static/private/`
- `utility/ui/private-server.mjs`
- `utility/ui/private-setup.mjs`
- `cloud/runner/runner-state.mjs`
- `cloud/runner/runtime-secrets.mjs`
- `cloud/runner/supervisor.mjs`
- `docs/PRIVATE-RUNNER-JOB-PROTOCOL.md`
- `PROJECT_STATUS.md`

These implementation files remain uncommitted because they are interleaved with
the larger dirty customer-flow checkpoint. Preserve them exactly until they are
reviewed and committed by explicit scope.

## Local preview recovered

The development preview runs on `127.0.0.1:52383`. Its one-launch session token
is deliberately omitted from this tracked document. The current link is printed
in `private/runner-dev/preview.stdout.log` and is valid only while that process is
running.

The ignored helper `private/runner-dev/start-preview.ps1` reloads the existing
ignored environment files and starts the preview as a hidden process. It writes
the PID and separate output/error logs under `private/runner-dev/`. Do not copy
those private files into Git.

Recovered verification on 2026-10-05:

- page returned HTTP 200;
- `/api/bootstrap` returned HTTP 401 without its session token;
- the expected runner and source project bindings were returned with the token;
- SQLite reported persistent state;
- the runtime identified itself as Windows;
- scratch capacity was marked nonauthoritative with `linux_runner_required`.

No backup, restore, provider mutation or production deployment was performed in
this recovery pass. No test suite was run. JavaScript syntax checks and Git diff
whitespace checks had passed immediately before the preview restart.

## Security truth and remaining release gates

The UI correctly says **Seal not verified**. The current runtime credential file
is private to the runner directory and created with restrictive permissions, but
it is not encrypted with a customer-held recovery key. An administrator with host
control could still read it. Do not claim that PortaBase cannot enter, run or open
the runner until key sealing and denial proof exist.

There is no authentic Linux runner deployed today:

- Docker is unavailable on the development workstation;
- WSL has no Linux distribution;
- ECS cluster `portabase-cloud-prod-runners` exists in account `899867382621`,
  region `us-east-1`, but the last read-only audit found zero services and tasks;
- no Portabase runner image was available in ECR at that audit.

The next implementation sequence is:

1. Review and commit the existing dirty customer-flow/runner checkpoint without
   mixing unrelated homepage or worktree artifacts.
2. Implement customer-key sealing for runtime credentials and SQLite private
   state, with explicit operator-denial and recovery-key tests.
3. Build and publish the Linux runner image, mount separate durable private state
   and bounded ephemeral scratch, then deploy one isolated runner.
4. Prove the full signed-in subscription flow through runner registration, source
   probe, backup execution, safe telemetry and capsule display.
5. Perform an isolated restore drill into a new blank Supabase project and record
   rollback evidence.

Until those steps pass, the runner is implemented locally and previewable but is
not provisioned, sealed, deployed or complete.
