# Binary incremental agent custody

- Agent: Codex `/root/binary_incremental`; thread `01a183da-9360-7300-bcbf-b62ec985aed5`; parent session `01a183c6-b1bc-7692-ad78-b3ab5d9b13f6`.
- Check-out: 2026-10-28T18:55:00Z (registration time approximate; exact execution timestamps retained in session).
- Reused checkout: `C:\Users\ryanh\git\portabase.dev\.worktrees\enclave-home-20261025`, branch `codex/enclave-copy-only-20261025`, base `0504bced9949ba7cb7374a0248278f4316c67cb5`.
- No worktree created. All 21 registrations reconciled with parent inventory; root and external checkout dirty files preserved. Start state: main ledger modified, inventory document and AGENTS.mdx untracked; preserved.
- Scope: encrypted durable binary object catalog, incremental binary capture/restore, full database capture preserved. Integration: parent review, explicit-path serial commit on named branch, then origin/main release review. No deployment or customer data operation by this agent.
- State: active. Expected source/test disk under 20 MB; synthetic fixtures only, never F:.

## Binary phase check-in — 2026-10-28T19:21:23Z

Signed: Codex `/root/binary_incremental`, thread `01a183da-9360-7300-bcbf-b62ec985aed5`.
State: awaiting parent review/integration. HEAD remains `0504bced9949ba7cb7374a0248278f4316c67cb5`; no staging, commits, push, deployment, real customer capture or live provider writes by this agent. Parent owns serial explicit-path commit per delegation.

Changed/new task paths:
- `cloud/confidential/binary-catalog.mjs`, `binary-catalog.test.mjs`, `binary-vault-store.mjs`, `binary-vault-store.test.mjs`, `manifest-envelope.mjs`.
- `cloud/confidential/application.mjs`, `engine-jobs.mjs`, `s3-vault.mjs`, `prepare-application.ps1`, `Dockerfile.application`.
- `utility/portabase.mjs`, `portabase-core.mjs`, `cloud-storage-connectors.mjs`, `capsule-review-reader.mjs`.
- Root `package.json`, `package-lock.json`, and this custody document.

Implementation: HKDF purpose-separated customer recovery key encrypts outer managed manifests and immutable catalog/object chunks. Stable opaque catalog namespaces survive VM replacement, including wrong-key fail-closed behavior. Baseline and versions are retained; no pruning of encrypted catalog-backed capsules. Full selected DB capture remains separate; managed binary reuse requires matching strong source HEAD ETag and existing remote encrypted references. Weak validators fail before binary GET. Scope exclusions do not become deletion tombstones. Remote writes/readbacks are bounded, S3/R2 large capsule streaming avoids whole-capsule memory; Dropbox capsule download streams. Quota reservation commits local accounting only after server acceptance; failed attempted upload remains conservative usage. Parallel capture drains in-flight jobs before failure accounting and cleanup. Restore binds usage to decrypted source project and verifies individual chunk/object hashes.

Validation: 29 focused tests pass across binary catalog/store, application scope, engine jobs, S3/R2. Includes real captureStorage synthetic HTTP seam, same-size/same-date changed ETag, zero unchanged binary GET/PUT, restart/full restore of old and new versions, deletion, tampering, wrong key, absent baseline, excluded buckets, quota denial/failed upload, drained parallel failure, 9 MiB streamed capsule, and encrypted outer review reader. Broader private review/delta/connector run: 32 pass, two existing connector tests fail (upload fixture omits size although pre-existing uploader requires size; legacy simulated server upload now returns 404). Confirmed size check already exists at HEAD; these are not new implementation regressions.

Package verification: `npm pack --dry-run --json`, actual local `npm pack`/tar unpack under ignored `.portabase/binary-package-check`, and unpacked `node utility/portabase.mjs --help` pass using existing installed dependencies. 108 packed files, zero missing relative module imports. Image prepare allowlist graph: 108 files, zero missing relative imports. No publish. Existing deps reused; not a fresh dependency-install or container-build proof. `git diff --check` passes.

Remaining release gates: real Supabase strong HEAD ETag behavior and real S3/R2/Dropbox delivery/recovery in approved attested cloud runner are unproved; no live claims. Catalog currently hard-bounded to 2,000 manifests / 64 MiB decrypted aggregate and fails closed until a paged encrypted index is implemented for larger history. Restore usage reports conservative logical payload attempted, not network/TLS wire bytes. Initial binary exemption and terminal accounting/crash reconciliation belong server ledger; plans agent now adding authenticated abort + 4h05m lease reconciliation. Managed full encrypted manifests apply every tier; incremental binary/catalog enforcement applies $9. Unknown shared-worktree changes remain untouched. All 21 registered worktrees remain; no new checkout. Owned retained package artifacts about 2 MiB; synthetic large file removed by fixture cleanup; no F: writes.

Recovery: parent can inspect `git diff -- <explicit paths above>` plus new files and stage only reviewed paths. Next owner: `/root` for integration; this agent continues a separately scoped OAuth grant import and engine abort integration requested by parent/team, without modifying plans agent endpoint/security-page files.

## Follow-on check-out — 2026-10-28T19:21:23Z

Same agent/thread/branch/checkout/HEAD; no worktree creation. Scope: authenticated encrypted-channel OAuth/Dropbox grant import preserving refresh/expiry; invoke new trusted usage abort on engine failure when available. Coordinate schemas with `/root/plans_usage` and `/root/customer_dashboard`. Expected additional source/fixture disk under 1 MiB; no cloud operations.

## Final backend freeze/check-in — 2026-10-28T19:36:05Z

Signed: Codex `/root/binary_incremental`, thread `01a183da-9360-7300-bcbf-b62ec985aed5`; state **awaiting integration**. HEAD `0504bced9949ba7cb7374a0248278f4316c67cb5`; no staging/commit/push/deploy by this agent. Parent owns reviewed explicit-path checkpoint; backend files frozen for parent image build. All 21 registered worktrees remain; no new checkout or removals. Unknown `AGENTS.mdx` preserved. Owned ignored package artifacts remain about 2 MiB under `.portabase/binary-package-check`, with dry-run policy evidence `.portabase/beacon-policy-dry-run.json`; no customer spool or F: writes.

Additional completed follow-on changes:
- `oauth.import` / `vault.import` accept encrypted-channel renewable sessions, validate live provider identity, preserve refresh/expiry only in sealed profile, and reject same-account target or malformed session.
- All managed tiers now reserve/finalize trusted usage. Temporary-runner backup reports zero outward delivery bytes; restore uses conservative logical payload attempted. Engine wrapper calls trusted `abort` for pre-child/child failures; server ledger preserves accepted reservations and reconciles expired leases (plans agent implementation).
- Single encrypted delegated target-grant authority: foreground and beacon share CAS refresh lease; token persisted before return; stale profiles cannot independently rotate. Disabled beacons keep an inert encrypted recovery copy and service only authenticated foreground access. Explicit target replacement/disconnect revokes delegation. Ambiguous refresh/persistence failure leaves lease and requires reauthorization after five minutes; stale rotating tokens are never retried.
- Build now requires explicit `-SourceCommit <40hex>` and archives only reviewed Git objects/allowlist into durable ignored `.portabase/confidential-build-<id>`. Dirty/untracked files are neither copied nor deleted. PowerShell parser passed; no cloud build or IAM mutation executed.
- Beacon KMS WIF CEL rejects nonempty command/environment overrides in addition to exact image/argv. Guard allows absent or empty claims, matching independent verifier. Checked against Google's claims/assertion docs: https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/attestation-assertions and https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/token-claims . Local dry-run contains both clauses; focused policy inspection test passes. Actual Google CEL provisioning remains parent release gate.

Exact reviewed path inventory for parent (combined original + follow-on ownership):
- `cloud/confidential/Dockerfile.application`
- `cloud/confidential/application.mjs`
- `cloud/confidential/application-scope.test.mjs`
- `cloud/confidential/binary-catalog.mjs`
- `cloud/confidential/binary-catalog.test.mjs`
- `cloud/confidential/binary-vault-store.mjs`
- `cloud/confidential/binary-vault-store.test.mjs`
- `cloud/confidential/manifest-envelope.mjs`
- `cloud/confidential/s3-vault.mjs`
- `cloud/confidential/engine-jobs.mjs`
- `cloud/confidential/engine-jobs.test.mjs`
- `cloud/confidential/oauth-connections.mjs`
- `cloud/confidential/oauth-import.test.mjs`
- `cloud/confidential/dropbox-vault.mjs`
- `cloud/confidential/destination-beacon.mjs` (follow-on lease correction to beacon agent's module)
- `cloud/confidential/beacon.test.mjs` (follow-on concurrency/failure/policy cases)
- `cloud/confidential/provision-beacon.ps1` (follow-on override conditions)
- `cloud/confidential/prepare-application.ps1`
- `utility/portabase.mjs`
- `utility/portabase-core.mjs`
- `utility/cloud-storage-connectors.mjs`
- `utility/capsule-review-reader.mjs`
- `package.json`
- `package-lock.json`
- `tests/cloud-storage-connectors.test.mjs` (size-integrity fixtures by this agent; auth401 expectation coordinated with plans agent)
- `docs/AGENT-BINARY-INCREMENTAL-2026-10-28.md`

Final validation: focused set 54 cases initially 53 pass plus one auth401 assertion concurrently updated by plans agent; rerun beacon+connector 21/21 passes including new WIF policy case. All focused cases now green across those runs (55 unique tests). Latest local package pack/unpack CLI startup passes; latest image and packed relative-import closure each 108 files with zero missing imports (`.portabase/binary-package-check/import-closure.json`). `git diff --check` passes. Broad private capsule review/delta paths passed earlier; stale Dropbox fixture failures are now fixed without weakening size/hash checks. No live proof implied.

Critical release dependencies: provision beacon bucket/KMS/WIF before normal target access (central authority lookup intentionally fails closed); pin rebuilt application digest for usage receipt verifier and WIF; hosted grant bridge must clear hosted refresh ownership only after durable encrypted-profile save (plans/frontend agents own completion). Real strong-ETag Supabase behavior, cloud vault delivery and independent restored completeness remain unproved until approved cloud fixture run. Catalog history cap and logical-versus-wire accounting limitations from first check-in still apply. Next owner/action: `/root` review, commit exact backend subset/dependencies, build immutable source, then release verification.
