# Private runner job references (v2)

Implemented as an opt-in source path; not deployed or verified on a hosted runner.
Legacy v1 credential proxy, selection and named job flows remain. This addition
does not make the ordinary backend confidential-data-free. Loopback private GUI
source exists; hosted access, key release and update authority remain unresolved.

## Public queue contract

An authenticated customer queues only:

```json
{
  "version": 2,
  "type": "backup",
  "runnerId": "11111111-1111-4111-8111-111111111111",
  "configRef": "33333333-3333-4333-8333-333333333333",
  "configRevision": 3
}
```

These are synthetic identifiers. Create random UUIDs for actual references;
references must not encode customer names. Operations are `backup`, `verify`, or
`replay`. Revision is a positive safe integer. Unknown fields, project/target
details, names, private configuration, raw errors and mixed legacy selections are
rejected. `config-reference.mjs` defines the public projection.

`cloud-jobs` validates an active registered runner belonging to the customer.
Private claim/finish requests use `/api/cloud/runner-jobs` with only
`Authorization: Bearer <runner credential>`. They include
`version: 2` and the same immutable `runnerId`. Revocation or another owner's
credential fails. Legacy claims cannot take v2 jobs, and private claims cannot
take legacy jobs. Finish reports carry fixed safe results, not private diagnostics.
The runner credential must have server-mapped job authority. Existing reporting
credentials require explicit owner-authorized rotation; an unmapped credential
halts with `runner_job_access_required`. Account login and refresh tokens are not
required by private workers. The account endpoint remains responsible for queuing.

The worker validates an HTTPS origin without userinfo, query, fragment or path
prefix and uses `redirect: 'error'` before sending its credential. It never
retrieves configuration from a central configuration endpoint.

## Runner-owned file contract

Private mode requires explicitly configured environment values:

- `PORTABASE_RUNNER_CONFIG_DIR`: absolute private directory, never F:, UNC or a
  device alias. This directory already exists; the resolver does not create it.
- `PORTABASE_RUNNER_ID`: registered immutable UUID.
- `PORTABASE_PROJECT_REF`: source project identity for this worker.
- `PORTABASE_AGENT_TOKEN`: current reporting/runner credential.
- `PORTABASE_CLOUD_URL`: HTTPS origin of the job service. `PORTABASE_CLOUD_TOKEN`
  is used only by the legacy worker path; private workers never transmit it and
  remove it from the child environment if present.
- For replay, `PORTABASE_TARGET_PROJECT_REF` must match the private target and
  differ from the source. Existing source/target credentials remain runner-local.
- Saved-plan replay also requires `PORTABASE_ENCRYPTION_PASSPHRASE`,
  `PORTABASE_REVIEW_MAX_CIPHER_BYTES` and `PORTABASE_REVIEW_MAX_EXPANDED_BYTES`
  in the worker environment. The limits are canonical positive decimal integers;
  expanded bytes must be at least 1024. UI command-line review limits do not
  configure a separately launched worker.
- Actual replay requires runner-local `PORTABASE_TARGET_SUPABASE_URL` (HTTPS),
  `PORTABASE_TARGET_DB_URL`, and `PORTABASE_TARGET_SERVICE_ROLE_KEY` or
  `PORTABASE_TARGET_SECRET_KEY`, plus the installed database/function tools and
  any function deployment credentials for the selected scope. Exact target,
  database identity and blank-target checks still apply before writes.

Presence of the directory setting selects private mode. Missing setup fails
closed. A preexisting `PORTABASE_RUNTIME_CONFIG` override is refused, because the
CLI otherwise gives it priority over the explicit configuration file.

Exact lookup: `<private-directory>/<configRef>/<configRevision>.json`.
The runner/private GUI must write revisions without overwriting an existing
revision. The reader verifies the tuple and operation; it never selects `latest`
or a different revision. Example private backup record:

```json
{
  "version": 2,
  "runnerId": "11111111-1111-4111-8111-111111111111",
  "configRef": "33333333-3333-4333-8333-333333333333",
  "configRevision": 3,
  "operation": "backup",
  "projectRef": "abcdefghijklmnopqrst",
  "engineConfigPath": "engine/revision-3.json",
  "engineConfigSha256": "<SHA-256 of the exact private engine config bytes>",
  "excludeTables": [],
  "excludeBuckets": [],
  "incrementalBinary": false
}
```

The hash is private and is not sent with the public queue request. Backup records
require both exclusion arrays and the boolean explicitly; omitted selection does
not silently become an unrestricted backup. Empty arrays deliberately mean no
exclusions. Verify/replay records instead require an exact `capsulePath` below
the private root and forbid capture selection fields. Replay also requires
`targetRef`. Capsule outer metadata `projectRef` must match the bound source.

The engine config must match that source and specify `backupDirectory` and
`statusDirectory` below the private root. Files are bounded to 256 KiB; path
escapes, links/junctions, hardlinked config files, missing revisions, changed
engine config hashes and unsupported operations fail. Existing staging/status
ancestors cannot be links. Private read failures become fixed Cloud error codes.

The worker invokes the installed engine by an absolute module path, runs with the
private root as its working directory, passes explicit `--config` and (where
needed) `--capsule`, and uses the supplied runner environment. No shell command
is constructed from names. Credentials stay in the existing process environment.
The adapter does not encrypt that environment or create a sealed runner.

## Opt-in persistent worker process

The separately invoked supervisor uses the same private v2 worker and server
admission checks:

```text
node cloud/runner/supervisor.mjs
```

Configure the private directory, runner/source identity, Cloud origin and runner
credential listed above before starting it. No positional
arguments or arbitrary command flags are accepted. The supervisor exclusively
acquires `<private-root>/.supervisor.lock` before polling. A second process using
that root stops with `supervisor_lease_review_required`, including when it has a
different account or runner ID. The Docker default remains unchanged.

The held lease records an ownership nonce, account hash, runner ID, Cloud origin,
PID and timestamp. No credential or source configuration is stored in it. The PID
and timestamp never authorize stealing a lease. The process checks the original
root/file identity, absence of links and exact ownership bytes before polling,
network requests, engine launches and cleanup. Clean shutdown removes only its
own verified lease; a crash, partial write or replacement leaves evidence intact.
A leftover lock requires the operator to verify that no supervisor or child is
still running, review pending/unknown job outcomes, and resolve the lock privately.
There is no automatic stale-lock removal or force-unlock command.

This is exclusion on one filesystem with atomic exclusive file creation, not a
distributed lock across hosts or a guarantee on unsupported network filesystems.
Restricted filesystem ownership remains required: portable Node cannot make
path-based unlink immune to a hostile administrator racing the final identity
check. Runtime crash tests are not power-loss durability proof. The local tests
in `tests/supervisor-lease.test.mjs` exercise real process contention/crash,
clean release, linked/tampered locks and foreign replacement refusal. On Windows,
the held file may itself prevent ancestor replacement; that denial is verified.

Each worker invocation finishes before another begins. Pending journal reports
are reconciled before new claims. Successful and idle invocations wait 30 seconds
by default; temporary service failures use exponential backoff with jitter capped
at 60 seconds. These waits keep the process alive and are interruptible.

Optional timing settings are canonical positive decimal integers in milliseconds:

| Environment variable | Default | Allowed range |
| --- | --- | --- |
| `PORTABASE_RUNNER_POLL_MS` | 30000 | 1000–300000 |
| `PORTABASE_RUNNER_RETRY_BASE_MS` | 1000 | 1000–300000 |
| `PORTABASE_RUNNER_RETRY_MAX_MS` | 60000 | base–300000 |
| `PORTABASE_RUNNER_REQUEST_TIMEOUT_MS` | 30000 | 1000–120000 |

The request deadline covers the response body as well as the HTTP request. Lost
completion responses retain the existing durable report for retry. Private claims
now use the durable request protocol below: a transport loss, timeout or HTTP 5xx
retries the exact saved request after backoff. Malformed successful replies,
changed assignments and sequence conflicts halt for private review. A legacy
claim without the durable protocol still stops with `claim_outcome_unknown` after
an ambiguous response; it cannot safely recover by claiming another job.

`SIGINT` and `SIGTERM` stop new polls and interrupt idle/backoff waits. An active
invocation drains its child and completion report; the supervisor does not kill a
restore midway. There is no engine execution timeout or forced shutdown deadline.
A host that kills the process before draining may leave an unknown journal outcome,
which must be reviewed privately before execution resumes.

Unknown execution, corrupt/full/conflicting journals, invalid configuration or
identity, expired/revoked authentication, and denied admission halt the supervisor.
It does not rotate runner credentials, release keys, change entitlements,
reenable a revoked runner, or bypass admission. Restart only after resolving the
reported condition. Lifecycle output uses fixed state/reason fields; private child
stdout stays in the runner and is never included in Cloud job reports.

This is a persistent polling process, not managed subscription provisioning,
scheduled job creation, remote access, encrypted state retention or proof of key
sealing. Credentials remain in the process environment. Durable private storage,
restricted ownership, single-process supervision and shutdown grace periods must
be configured and verified by the eventual host.

## Durable private claims

Before sending a claim, the worker saves one bounded state record beneath
`<private-root>/.claim-journal/<owner-hash>/<runnerId>/<origin-hash>/`.
The request is `{type:"claim",version:2,runnerId,claimProtocol:1,
claimSequence,claimRequestId}`. The sequence starts at 1; the request ID is a UUID.
Neither configuration contents nor credentials enter this journal or request.

The server atomically saves a runner's claim decision alongside its job queue.
Repeating the same sequence and UUID returns the assigned job's current status,
or the original empty decision. An empty response therefore cannot turn into a
new job merely because the first reply was lost. The worker requires the exact
`claim:{protocol:1,sequence,requestId,runnerId}` echo and saves the returned opaque
job identity/reference before configuration resolution or engine execution.

Local states are `pending`, `received`, then `settled`. Only settlement advances
the sequence by one. A null decision settles immediately. A job settles only
after an exact completion acknowledgement has been archived, including safe
pre-execution rejection. Pending completion reports are reconciled first; the
following poll can recover the terminal claim and settle it without executing.
A terminal server job without a matching completed private journal halts.
An execution start without a durable result still blocks all claims; durable
claims never authorize repeating an uncertain backup or restore.

The server refuses skipped/old sequences, changed UUIDs or references, and a new
claim while the prior job or completion-event publication is unfinished. It pins
the active claim's job until the sequence advances. Current admission is checked
again for a recovered running assignment. Credential rotation preserves the
runner ID and owner binding, so it preserves claim/completion recovery as well.

Local state is at most 4 KiB. Updates use an exclusive short filesystem lease,
an exclusively created staging file, file fsync, atomic rename and directory sync
where supported. A crashed lease, partial staging file, malformed/foreign state,
link, or exhausted sequence fails closed. No stale-lock stealing, automatic
journal reset, cleanup of unknown outcomes or sequence guessing is implemented.
Deleting local state cannot reset the server's sequence; recovery then requires
private review. Restricted filesystem ownership and durable host storage remain
prerequisites. Windows directory fsync limitations and the lease filesystem/race
limits above apply; process restart tests are not power-loss proof.

Synthetic tests cover separate-process restart, lost claim/idle decisions,
assignment and echo mismatch, corrupted/linked state, concurrent reservations,
completion replay, rotated credentials and refusal to rerun unknown execution.
They do not establish deployed worker availability or live provider recovery.

## Private completion journal

Before starting a v2 engine process, the worker exclusively creates and fsyncs a
start record under `<private-root>/.job-journal/<owner-hash>/<runnerId>/pending/`.
The per-job directory uses a SHA-256 job ID. Its binding includes the account
hash from the shaped runner credential, Cloud origin, runner ID, job ID, operation
and exact opaque config reference/revision. Neither bearer credential nor private
engine configuration is written into these records.

If admission or private configuration validation fails before execution starts,
the worker instead saves a failed-only `execution_rejected` record. It contains
the same exact binding and projected safe error, with no start marker. Rejected
reports use the same retry and acknowledgement checks as executed results. A
foreign/malformed job is never journaled or reported as a valid local job.
Rejection and execution compete for the same exclusive per-job reservation;
collisions, mixed states or partial writes stop processing for private review.
No unjournaled rejection is sent when durable storage fails.

After the engine exits, the worker saves and fsyncs its exact safe completion
report before contacting Cloud. On a subsequent invocation it sends pending
completion reports first, at most ten per invocation, without starting the engine
again. The server accepts an identical v2 terminal report idempotently; a changed
result conflicts. The worker checks the reply's job ID, operation, runner, version,
config reference/revision, status and safe error before moving the journal entry
to `done`. HTTP 200 by itself does not acknowledge a result. Archived entries
prevent a duplicate execution if the server returns the same job again.

A start without a valid durable finish is `job_execution_unknown`. It blocks new
claims and requires private runner review; the worker never assumes failure or
automatically repeats a backup after a crash. Malformed, oversized, foreign-bound
or linked records also fail closed. Pending scans are capped at 100 entries.
No automatic deletion of unknown or archived records is implemented. Journal
recovery does not refresh expired customer/runner credentials or resolve an
already-running Cloud job whose private execution outcome is unknown.

This requires persistent runner storage with trusted ownership and restrictive
ACLs. Directory ancestors are checked for links/junctions, records use exclusive
creation and bounded reads, and POSIX creation modes request private access.
Windows ACL provisioning remains the operator's responsibility. These checks
cannot defend against a hostile administrator replacing files between validation
and use. File contents are fsynced; directory fsync is attempted but unavailable
Windows cases are tolerated. Cross-platform power-loss durability is therefore
not guaranteed. Synthetic restart/process-exit tests are not power-loss proof.

## Private selection GUI (local implementation)

On the customer-controlled runner, set `PORTABASE_RUNNER_CONFIG_DIR`,
`PORTABASE_RUNNER_ID` and `PORTABASE_PROJECT_REF` as above, with credentials already
configured in that process environment. The exact engine file must be inside the
private root and have explicit staging/status directories. Start:

```text
portabase ui --private-setup --config <private-root>/engine.json --no-open
```

Open the launch link through the runner's loopback interface. This does not expose
a remote website; remote pairing and access remain unimplemented. Default
`portabase ui` remains read-only. Private setup refuses runtime config overrides
and trial inventories.

The separately labeled private workspace inspects table/bucket sizes and saves
backup selections. Reads use the launch token. Writes additionally require an
exact same-origin request, JSON body and a separate session CSRF token; both
request bodies and projected inventories are bounded. The browser can contact
only this process under its CSP. Names render as text, not HTML.

A failed refresh invalidates the old inventory. The exact engine config used for
inspection is pinned by digest before saving; changed settings require another
inspection. Concurrent saves consume the inventory token once. Empty selections
require explicit confirmation. Each save exclusively creates a fresh random
reference at revision 1 plus a private copy of the exact engine config. It returns
only the opaque queue intent and offers a local download. No request goes to the
ordinary backend, and no job is queued, executed or billed by this UI. Partial
filesystem failures may leave an unreferenced private directory; automatic cleanup
and lifecycle retention are not implemented.

## Remaining integration and release gates

### Offline capsule review and restore-plan authoring

The private runner now has a separate offline UI. It does not require source
provider access or call the inventory collector. Launch it on the runner with
the existing private-root, runner ID and source project environment bindings,
plus `PORTABASE_ENCRYPTION_PASSPHRASE` already configured in the runner process:

```text
portabase ui --private-capsule-review --capsule <exact-directory-below-private-root> --review-max-cipher-bytes <positive-integer> --review-max-expanded-bytes <positive-integer> --no-open
```

Both scan limits are explicit operator choices in bytes. Expanded limits must
be at least 1024. They limit this inspection, not the account's transfer quota.
The view has no filesystem browser, key form, provider fetch, restore execution
button or ordinary-backend upload. Opening it obtains only a private session;
the customer explicitly chooses **Inspect configured capsule**.

`utility/capsule-review-reader.mjs` checks the exact capsule path under the
private root, refuses links/hardlinked files and aliases, bounds metadata and
ciphertext, and copies ciphertext into a private bounded snapshot. Existing
capsule crypto verifies the ciphertext hash, AES-GCM authentication and plaintext
hash before any archive content is parsed or exposed. The metadata capsule ID
must match the authenticated AAD; inner source, capture status and timestamp must
match the envelope. This authenticates with the supplied capsule key; it does not
prove an independent signing identity or a successful restore.

The installed `tar` 7.5.20 parser is now a direct production dependency. The
reader streams decompressed bytes through an absolute limit and never extracts
archive entries. Only manifest/storage/log JSON (at most 1 MiB each) is buffered;
SQL COPY rows are discarded while table byte counts are measured using the shared
selective-restore SQL policy. At most 100,000 archive entries are accepted. The
default CLI ustar format and ordinary directory entries work. PAX/GNU extensions,
links, traversal, duplicate/case-alias entries, nested compression and unsupported
SQL are explicitly refused. Delta capsules require baseline integration and are
currently refused. Legacy capsules without capture logs show that absence.

The private UI renders a projected capture manifest, safe capture lifecycle log
and table/bucket/function selections. It omits raw diagnostics, SQL rows, object
names and credentials. Selected sizes are COPY dump bytes plus storage object
sizes, not restored database disk usage. Roles/schema restore in full; schema,
index and function runtime overhead are not included in the estimate.

Inspect and save endpoints require the per-launch session, exact loopback
Host/Origin, separate CSRF token and bounded JSON. Save accepts only IDs from the
inspected inventory, positive integer budget and explicit empty-selection intent.
It rechecks capsule metadata/ciphertext digests, consumes the review once and
writes fresh exclusive files at `.restore-plans/<planRef>/plan.json` and
`binding.json`. The binding records the runner, source, exact relative capsule
path, capsule ID and metadata/ciphertext/plan digests. The response also includes
the digest of the exact binding bytes for later private execution integration.
Partial write failures can leave an unreferenced plan directory; no automatic
cleanup or retention policy is claimed.

Scratch uses `.capsule-review/inspect-*` under the explicitly configured private
root, never the OS temporary directory. It holds bounded ciphertext and compressed
plaintext, then removes only its two fixed files and empty directory. Peak scratch
can approach twice the ciphertext limit. A process crash can leave private scratch
behind; cleanup is not secure erasure and trusted filesystem ACLs are required.
`withAuthenticatedPrivateCapsule(options, callback)` is a runner-internal seam
that keeps this same authenticated archive alive during a callback and cleans it
afterward; no HTTP endpoint receives that path or crypto envelope.

### Preparing and queueing a replay reference

To enable the separate **Create replay job reference** action, also launch the
review UI with `--config <engine-json-below-private-root>` and configure a
different `PORTABASE_TARGET_PROJECT_REF` in its process. Saving a plan alone
does not create a job reference. The customer must retype the configured target
and confirm the separate action. The service validates the saved binding, copies
the exact private engine configuration and writes a new immutable revision.
The download contains only `version`, `type`, `runnerId`, `configRef` and
`configRevision`; it contains no target, selection, path or credential.

Import that JSON into **Queue a private runner job** on the registered runner's
dashboard card and explicitly confirm queueing. The dashboard adds a request ID
for safe retries; importing or creating a reference does not queue or execute it.
Refresh invalidates unused in-memory approval. A created, downloaded reference
remains usable; refresh does not revoke it. Failed or lost creation responses
require a new inspect/save cycle and may leave an unreferenced private revision.

The worker resolves the exact revision and uses a fixed private replay child.
The child rechecks the record digest and plan binding, authenticates copied
ciphertext, and executes from a private extracted snapshot. It does not reopen
the original capsule or plan during execution. Scratch is under `.replay-runs`;
durable recovery evidence is under `.replay-evidence`, both inside the private
root. Cleanup revokes the preparation capability. Trusted filesystem ownership
is still required; this is not protection against a hostile runner administrator.

The selected data budget is the smaller of the saved plan budget and server
admission limit. It bounds measured selected COPY/object bytes, not restored disk
usage, temporary expansion or total transfer costs. Roles/schema apply in full.
Database read-back compares inventories and selected row counts; it does not
prove row contents or application behavior. Function source hashes and complete
application recovery remain separate checks. Remote access, hosting, key release
and production recovery remain release gates.

Local evidence: `node --test tests/private-capsule-review.test.mjs` and
`node scripts/check-private-capsule-review.mjs`. These use tiny synthetic encrypted
archives, test security failures and exercise the actual loopback UI at 320/1440px.
Screenshots are under ignored `portabase-evidence/private-capsule-review/`.
No production capsule, capture, restore or provider request was used.

`node --test tests/private-replay-flow.test.mjs` additionally carries an actual
loopback API-created reference through the dashboard parser, real queue/claim/
finish handler, worker resolution, private child and authenticated preparation.
It checks idempotent queueing, exact selection/binding, cleanup, private-data
absence from the cloud record, and wrong-key refusal before execution. Customer
authentication, Blob storage and completion publication use synthetic adapters;
the final target execution is simulated. This is protocol integration evidence,
not a live runner, real database restore, provider delivery or production proof.

### Other release gates

- Private setup authors backup selections; offline capsule review authors private
  restore plans and opaque replay references for explicit dashboard import.
  Credentials and the initial engine configuration still require runner-owner
  setup. Verify authoring, credential sealing and automatic dashboard handoff
  are not provided by these views. Revision immutability and protection against
  replacement after validation require trusted filesystem ownership/ACLs; this
  reader is not protection against a hostile runner administrator. Backup and
  legacy execution still reopen engine configuration in the CLI; prepared private
  replay uses its validated snapshot. No atomic immutable storage service is claimed.
- A single worker environment binds one source and optional target. Multi-project
  credential selection requires a separate private design; do not reuse unrelated
  source credentials by changing only a queue reference.
- Runner provisioning, remote pairing/TLS, retained encrypted state, wake
  scheduling, credential refresh, subscription cancellation and key release are
  not implemented by this protocol.
- V2 workers require a positive safe-integer `admission.maxBytes` and pass its
  canonical value as `PORTABASE_JOB_MAX_CAPSULE_BYTES`, overriding an ambient
  value. The CLI checks final capsule file sizes before every transfer provider.
  This is a final upload gate; it does not bound source capture, staging growth,
  inbound traffic, retries or total hosted costs.
- CLI stdout, errors, manifests, engine config and resume state remain private.
  Do not attach them to ordinary-backend logging. Use the typed telemetry channel.
- Replace legacy dashboard/proxy/selection flows together with the real private
  runner interface, then migrate retained records under the plan in
  [the boundary review](PRIVATE-RUNNER-BOUNDARY-REVIEW.md). No old records were
  deleted and no existing users were migrated here.

## Local evidence

`tests/private-runner-config.test.mjs` exercises queue projection through the
actual local-file resolver and worker argv; wrong identity/revision/project/
operation/target; path escapes and junctions; missing and oversized files; changed
engine bytes; unsafe Cloud URLs; fixed failure reports; and absence of private
names from Cloud requests. A real CLI `verify` process reads only a tiny synthetic
capsule checksum fixture from the private test directory. It performs no capture,
restore, provider request or production spool. Endpoint ownership tests are in
`tests/runner-admission-security.test.mjs`. These are local proofs only.

`tests/completion-journal.test.mjs` covers separate-process persistence, lost
acknowledgement retry without reexecution, unknown execution, pre-start write
failure, finish persistence failure, mismatched replies, malformed/foreign/link
records, concurrent start exclusion, pending/replay caps and invalid byte limits.
All fixtures are synthetic, and no real capture or provider call occurs.

Private GUI validation: `node --test tests/private-setup-ui.test.mjs
tests/ui-server.test.mjs tests/private-runner-config.test.mjs` and
`node scripts/check-private-setup-ui.mjs`. The browser check uses synthetic inventory
and a real loopback server at 320/1440 px; it verifies save-to-resolver-to-argv,
explicit empty selection, failed refresh, no external requests and no page
overflow. Screenshot evidence is under ignored
`portabase-evidence/private-setup/`. No real provider inventory was queried.
