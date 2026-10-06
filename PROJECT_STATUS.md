# Portabase — capability & evidence ledger

## Vertical customer flow checkpoint — 2026-10-05

The authenticated customer path is now connected locally from existing Square
subscription proof through runner registration, opaque backup submission,
agent-only claim/execution, durable completion, safe telemetry, and dashboard
capsule display. The runner reads the engine's private `latest.json` and sends
only a fixed result projection: capsule ID/status, ciphertext and manifest
hashes, total bytes, object count, duration, destination kind, destination
verification, and completion time. Supabase credentials, capsule passphrases,
vault URIs, object names, manifests, paths, logs, and capsule bytes remain in the
customer-controlled runner.

The runner credential screen now gives the customer the exact private runner
environment, setup, opaque-reference, and supervisor sequence. Queue execution
status remains separate from capsule capture status, and vault delivery remains
separate from restore proof. Missing result metadata from an older engine does
not cause a possibly completed backup to rerun.

Focused local evidence: **104/104 tests passed**, including one composed flow
from signed-in Square subscriber through the rendered dashboard model. The
production Vite build passed with the existing large-chunk warning. These are
synthetic/local results. No release was deployed, no real Square account was
charged, no production runner was provisioned, no real Supabase project was
captured, and no restore drill was performed.

## Current release gates — 2026-10-05

This matrix supersedes older capability tables below. Checkpoints record local
evidence; they do not establish provisioned services or deployed behavior.

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Signup and account management | Auth/account UI and APIs | Dedicated Auth project identified | Current deployment needs recheck | Older release only | Current signup/session/logout not reverified | Local identity tests | INCOMPLETE | Deployed account flow verification |
| $7 Square subscription | Checkout, confirmation, webhook, entitlement and period-end cancellation code/UI | Merchant access not currently proven | Last credential audit returned 401 | New integration not deployed | No paid lifecycle proof | Local ownership, provider-response, cancellation-reconciliation and browser tests | INCOMPLETE | Valid product Square configuration; deployed checkout, renewal, cancellation and refund proof |
| Persistent private runner | Agent-only worker, supervisor, completion journal and safe capsule result projection | No production runner proven | Private storage and credentials required | No | Composed synthetic backup flow only | Local auth/retry, exact-result acknowledgement, private status projection and exclusive process lease tests | INCOMPLETE | Hosting/key custody, deployed lifecycle and real execution |
| Private GUI, manifests and logs | Runner-local setup and authenticated capsule review | No remotely accessible private GUI | Loopback setup requires private environment | No | Local encrypted fixtures only | Origin/CSRF/binding and wrong-key tests | INCOMPLETE | Remote access/pairing and customer recovery drill |
| Optional manifest sharing | Explicit private preview/download; account import/consent/revoke | Backend service binding not reverified live | Local implementation | No new release | Local browser/API tests | Consent revision/hash/owner denial tests | IMPLEMENTED locally | Deployed private-to-account sharing flow |
| Safe telemetry | Typed ingestion, runner/job reporting, safe capsule metadata and dashboard display | Existing store service; current binding unverified | Agent enrollment integrated locally | No new release | Composed synthetic customer flow only | Exact result allowlist, durable retry/receipt, tenant isolation and private-field denial tests | INCOMPLETE | Deployed tenant flow and real customer runner proof |
| Email and SMS | Verified destinations, preferences, outbox, dispatch and receipt handling | Product provider configuration missing at last audit | Not proven ready | No new release | No real acceptance/delivery proof | Local consent, quota, callback and dedup tests | INCOMPLETE | Product-specific providers, deployed verification/opt-out/delivery |
| Scheduled backups and subscription lifecycle | Managed schedule contract/API/dispatcher/account UI; normal cancellation endpoint/account UI | Production dispatcher and persistent runner absent | Local implementation only | No | None | Local schedule authority/quota tests and cancellation reconciliation tests | INCOMPLETE | Deployed dispatcher/runner, real scheduled job, and live Square lifecycle proof |

No claim of operator blindness, provable sealing, live restoration or whole-product
completion is supported by these local results. Legacy private records remain
unmigrated; retiring endpoints does not erase stored copies or provider retention.

## Current integration checkpoint — 2026-10-04

Normal period-end Square cancellation is now wired through the authenticated
account UI. The control requires a second confirmation, sends only
`{ confirm: true }`, includes the separately billed transfer add-on, preserves
access through Square's confirmed effective date, and does not delete the
customer vault or private runner configuration. Success is shown only after
the cancellation endpoint or a fresh provider-backed account read confirms it.
An ambiguous/lost successful response reconciles without issuing an extra
provider mutation. Billing dates render in UTC to preserve Square's effective
calendar date across local timezone boundaries.

Targeted evidence: seven cancellation endpoint tests passed; the combined
billing entitlement, account projection, and cancellation run passed 30/30;
the production Vite build passed; and the signup/checkout browser fixture
passed for both `cloud-7` and `cloud-17`, including unchanged-provider failure,
lost-success-response reconciliation, exact request bodies, refreshed account
state, and removal of the cancel control after confirmation. The browser fixture
created no real accounts, messages, or charges. No live Square cancellation or
deployment occurred, and the latest credential audit remains HTTP 401.

Managed schedule source and account UI are also present locally. Its dispatcher
now has 13/13 direct security tests, including persisted bounded multi-account
traversal, next-invocation continuation, exclusive overlapping leases, lease
release, and malformed-cursor refusal. It is not enabled or deployed, no
persistent production runner is proven, and no real scheduled backup has run.

Latest integrated validation: the full test suite passed 754 tests with zero
failures after durable claim fixture migration. Production Vite build passed
again after claim and retained-record projection integration; the existing
large-chunk warning remains. These are local synthetic/build results only.
The earlier in-progress checkpoints below are historical and superseded by
this result. Managed schedule backend and account GUI implementation are now
in progress; no scheduled service or provider delivery is deployed or proven.

Root composed recovery coverage now includes five passing scenarios. The new
lost-idle case commits an empty claim, loses its response, queues work, then proves
the worker retries the exact old claim and remains idle; only the next claim may
execute the queued job. No provider operation occurs in these tests. Other
completion/supervisor mock migrations remain in progress before full-suite rerun.

Root added and passed the composed lost-claim-after-server-commit regression:
real private GUI/reference, registered credential, restricted endpoint and worker
resend the identical durable claim, recover the running assignment and execute
the synthetic target operation exactly once. All four composed scenarios pass.
Root migrated private replay-child/config-plan mock replies to strict claim echoes
and running status; all fourteen related tests pass. Full-suite migration still
has other old worker/supervisor fixtures being updated; current integrated green
status is not yet established for the new durable claim protocol.

Root independently verified fourteen durable-claim-server and retained-record
privacy tests. Assigned and idle claims deduplicate atomically; completion
outages block advancing to another assignment; current assignments survive
pruning. Typed projections block all five seeded legacy-data leaks while
preserving stored records and supported public behavior. Worker-side durable
claim integration remains underway, so this is not end-to-end retry proof yet.

Fresh read-only Netlify metadata audit verified site ID
794217cc-42ab-4a9f-81da-06a661403573, name portabase-dev and domain portabase.dev.
Complete listings found zero current blobs in portabase-cloud-selections,
portabase-cloud-jobs and portabase-cloud-runners. No blob contents were read,
no identifiers/values printed and nothing modified. This only describes those
three current stores at audit time; it does not establish historical deletion,
provider backup retention or the absence of data in other stores.

Fresh read-only provider audit: verified `pb-admin` with STS in AWS account
899867382621/us-east-1, then checked the repository-linked Netlify site and
effective service configuration without printing values. The production Square
location probe still returns HTTP 401 using the configured fallback token.
Product-specific Mailgun API/domain/from and Twilio account/auth/messaging-service
configuration remain absent from inspected AWS records and Netlify function env.
This is operator-profile evidence, not proof of deployed function role access.
No sends, charges, secret writes or provider mutations occurred.

Root independently verified six supervisor-lease tests, including real competing
processes and crash leftovers. Existing/stale locks are never stolen; cleanup
refuses changed ownership or linked/replaced files. Local claim journal/worker
integration is now underway against the server's durable claim protocol.

Runner image source now launches the tested supervisor rather than the inert
boot metadata prototype. `cloud/runner/README.md` states required private durable
storage, credentials, shutdown behavior and missing hosted capabilities. Docker
is unavailable here: the updated image is NOT built, run or deployed.

Seeded-store source audit found additional retained-record projection leaks in
dashboard flags/phase, runner rows, malformed v2 jobs, telemetry identity/time
fields and object-valued public agent fields. These are synthetic reproductions,
not inspected production records. Strict projections are assigned; no existing
records are deleted. Durable claim recovery using an atomic queue/claim decision
and runner-local request journal is also being implemented in coordinated stages.

Latest root full-suite checkpoint: **722 tests passed**, production build passed
with the existing bundle-size warning. After the acknowledgement review fix,
root separately verified all 38 journal/auth/supervisor tests: a successful HTTP
reply identifying the wrong job/result now halts for private review while keeping
the pending result. This supersedes previous failing full-suite checkpoints.
Single-supervisor root locking is under implementation. Ambiguous claim recovery
is being designed; current supervisor stops rather than guessing whether a lost
claim response assigned work. No provider actions or deployment occurred.

Root composed private replay now uses real agent issuance/store authentication,
account-authenticated enqueue, restricted runner endpoint and actual worker/private
child preparation. All three scenarios pass: success, wrong-key refusal, and lost
server acknowledgement followed by credential rotation and journal replay without
another execution. Customer session tokens are absent from worker requests and
child environment. Target execution is synthetic; this is not live restore proof.
Root independently passed credential-upgrade and private queue browser flows at
320/1440px. Completion-outage integration now uses the new restricted endpoint;
all eleven completion tests pass. Latest full run before that fixture update was
718/719; a fresh full run remains required after the acknowledgement-mismatch
review fix currently underway.

Root independently verified eight server runner-auth tests: new credentials get
server-owned account mapping, explicit CAS rotation preserves runner identity,
and agent-only claim/finish obey tenant, revocation, entitlement and retry rules.
Root also verified twelve persistent supervisor tests before the agent-only
worker migration (still in progress), including shutdown and ambiguous-claim halt.
New queue admission now requires explicit jobAccess; telemetry-only credentials
cannot consume quota or queue unexecutable work. Twenty-four admission,
completion and composed private replay tests pass with this guard. Worker and
credential UI integration are not yet jointly verified or deployed.

Root verified actual private setup/source/replay console routes at 320/1440px,
including explicit opaque job import, stale-runner clearing on failure and disabled
live schedule controls. Root also retired v1 job POST requests in the local Cloud
handler (410); retained legacy jobs expose status/migration markers without their
private payload or raw diagnostics. Existing records remain untouched. Ten
admission/privacy tests and eleven completion tests pass against this change;
quota and in-flight completion tests now exercise real v2 references. Legacy
workers require migration before any coordinated deployment of this retirement.

Root verified five private-sharing tests after the inventory-count correction:
missing/skipped/partial/limited inventories omit counts; complete empty inventories
export zero. The full-suite checkpoint during the coordinated UI migration was
705 tests: 697 passed, eight old credential-UI source assertions failed. Those
assertions are being replaced with coverage of the new private setup contract;
do not treat the current integrated suite as green until the rerun passes.

Root verified the private sharing export's four service/API tests and actual
encrypted-fixture browser flow at 320/1440px. Export requires explicit preview
and download, rechecks capsule binding, and passes the existing dashboard import
schema without automatic upload. Count availability semantics are receiving a
follow-up fix: absent/skipped inventories must not imply zero objects/functions.

The main console's source viewer and capsule inspection routes now use private
setup/replay guidance and opaque reference import, removing their main-origin
key/passphrase entry components from those routes. Navigation labels identify
private source setup and private capsule review. Root production build passed;
full rendered route and coordinated legacy endpoint verification remain pending.

Runner lifecycle audit confirms current Docker boot is a metadata placeholder
and the worker runs once. An opt-in persistent supervisor is under implementation;
managed scheduling, actual provisioning, token renewal and encrypted long-term
key custody are not implemented by that process loop and remain release gates.

Additional privacy remediation: the CloudTrail proxy also accepted arbitrary
caller role scopes and returned private AWS resource/principal/IP details. It is
now retired locally alongside the CloudWatch proxy. Both console panels use
clear availability copy and navigate to safe Telemetry; AWS audit history stays
in the customer's AWS account. Two endpoint refusal tests and both-panel browser
checks at 320/1440px pass. No deployment, provider permission changes, or deletion
of existing data occurred. Private hosted audit browsing remains unavailable.

Root browser verification of the retired-log replacement passed at 320/1440px:
actual component renders, navigates to Telemetry, has no horizontal overflow,
does not expose synthetic private secret labels, and makes no network requests.
Reproduce with `node scripts/check-private-log-boundary.mjs`.
Coordinated legacy PAT/selection replacement and private-review shareable-summary
export are currently assigned and remain unverified until integrated.

Privacy remediation: retired the ordinary-backend raw CloudWatch log proxy in
source (fixed HTTP 410, no scope/body/credential reads or AWS calls). Its account
panel now directs users to safe Telemetry instead of polling and displaying demo
logs. The negative endpoint test and production build pass. This is not deployed;
existing retained data and other legacy credential/selection paths remain
unresolved. Private hosted diagnostic access is still unavailable.

Latest root validation: **697 tests passed**, with a successful production build
(existing bundle-size warning). This supersedes the older suite counts below.
Root independently verified all 32 completion journal, publication, projection
and receipt tests. Pre-execution rejection now persists before reporting; lost
acknowledgements replay the exact failure without executing. Immutable terminal
receipts acknowledge finished jobs after queue pruning. Completions older than
90 days retain their original timestamp and suppress stale alerts. One older
private-plan test fixture was corrected to acknowledge the exact terminal job,
preserving the strict production acknowledgement requirement.

These are local integration results with synthetic stores/providers, not live
delivery or recovery proof. No provider sends, deployment or billing changes
were performed. Square configuration, email/SMS provisioning, runner hosting
and key custody, legacy backend privacy paths, and live end-to-end recovery
remain release blockers; the full subscription system is incomplete.

Root verified eight job-completion integration tests using actual handler,
publisher and outbox with synthetic stores/providers. Owned backup/verify/replay
outcomes reach safe telemetry and consented outbox records; default-off/unverified
contacts suppress; partial writes and concurrent retries deduplicate; distinct
same-time jobs retain separate identities; pending events survive queue trimming.
Actual worker journal retry does not rerun its synthetic operation. Additional
early-failure journal and pruned-job receipt fixes remain in progress; real
email/SMS acceptance/delivery has not been tested.

Root added two completion-event projection tests covering all operation outcomes,
privacy filtering and foreign/revoked/nonterminal denial; both pass. Sixteen
existing message/outbox/delivery tests also pass. Independent completion review
found outstanding retry gaps for pre-execution failures without a journal and
pruned terminal jobs after lost acknowledgements; these are assigned for repair
before durable job-to-alert delivery is considered implemented.

Function restore now supports both capture layouts via fresh private CLI staging
and requires ACTIVE/JWT listing verification. Root verified seven function tests
and 18 combined engine/function tests, then added an early workspace preflight
regression proving a nonempty Function directory without an entrypoint fails
before target operations. Prepared preflight now uses actual deployment layout
rules instead of assuming fallback directory layout. Source equality/invocation
and live deployment remain unverified.

Integration review confirmed the GUI's five-field reference matches the dashboard
parser and private resolver without exposing target/configuration details.
Function restoration is being corrected for both capture layouts; review also
requires workspace/source compatibility checks before database writes, not only
when deployment starts. Completion-alert durability now includes retaining
unpublished terminal jobs until effects succeed, so queue pruning cannot discard
pending notifications. Both changes remain under implementation/testing.

Job completion audit found a missing path: v2 terminal queue records did not
publish safe telemetry or enqueue notifications on either initial finish or
idempotent retry. Implementation is assigned: derive events only from owned
terminal jobs, stable job-based identities, persist telemetry before outbox,
retry failed effects without rerunning the operation, and suppress duplicate
managed CLI completion alerts. Verify-success and restore-failure event support
must be added consistently. This path is not yet implemented/verified here;
no real email/SMS sends are authorized by this audit.

Root verified five replay-reference service/API tests and the extended browser
flow at 320/1440px. Customers explicitly confirm the configured target after
saving a plan, then download an opaque dashboard-compatible reference; no plan,
target, names or credentials enter that download, and no automatic queue/provider
call occurs. Browser checks cover no persistent browser storage, external calls
or overflow. Job-completion-to-notification coverage is now being audited for
the new replay path; live email/SMS delivery remains unconfigured/unverified.

Latest root integrated suite: 665 tests passed. Prepared engine now includes
selected COPY-table count verification; root separately verified 16 combined
engine/readback tests, including denial when broad database inventory passes
but a selected table count differs. Counts remain a limited proof, not row
content equality. GUI replay-reference authoring and Function deployment fixes
are still being finalized; this suite does not establish production readiness.

Root verified ten prepared-engine tests after fixture correction. They execute
the real engine orchestration and SQL filtering with synthetic external adapters,
covering lower admission budget, private evidence, target guards, selected-layer
availability before calls, unselected missing layers, failed readback and cleanup
revocation. Five selected-table verifier tests also pass, including Auth/platform
tables and empty COPY blocks; engine integration is underway. These establish
local behavior and row-count comparison only, not live recovery or row-content
equality. Function deployment layout/status verification is the next identified
engine gap and is assigned separately.

Root exercised the new prepared-engine tests and found their target fixture had
21 characters, so production validation correctly rejected it before target
access. The fixture is being corrected to a valid 20-character reference;
validators were not loosened. Selected-only Storage preflight and explicit
empty-layer handling are also being integrated. This engine suite is not yet
recorded as passing; child-executor injection tests do not substitute for it.

Root verified 22 child/configuration/worker tests, including real subprocess
rejection of malformed invocation, missing/wrong keys and invalid review caps
with zero target calls. Positive child tests use real resolver/preparation and
an injected executor; actual engine proof remains separate. Next integration
includes explicit private GUI replay configuration and per-selected-table
readback covering Auth/platform COPY tables, not only application summaries.

Root hardened shared recovery status: inventory-only Storage or explicit
unrestored serving state cannot become verified recovery; each layer must supply
boolean true, not a truthy value. S3 retains its distinct objects-in-S3 status.
Sixty-four focused tests passed. Six fixed-child tests also pass, including
revision/config tampering and safe worker reporting; positive child tests use
an injected executor and are not target recovery proof. Review still requires
selected-layer preflight, stronger Function/platform-table readback and explicit
custom-host target support before broader recovery claims.

Prepared engine and fixed private child entry are now present in source. Root
review identified a valid-plan rejection when the job admission budget is below
the plan's declared budget; the engine must use the already validated lower cap.
Thirteen existing worker/configuration tests pass after initial wiring, but they
do not prove the new successful child execution path. New child/engine tests and
independent review are still underway; production execution remains unverified.

Root verified all six private replay preparation tests. Preparation now snapshots
and authenticates the approved capsule/plan, extracts privately with path and
size checks, freezes its result and supplies explicit cleanup. Tests prove
original-file replacement after snapshot cannot substitute replay contents;
they also cover failed authentication/budget cleanup, hardlinks, Windows special
paths, case/Unicode aliases and a source/staging-name collision found in review.
This is local synthetic preparation proof, not target restore or live service
proof. Engine and worker consumption remain active integration work.

Root verified 18 combined archive-review and selective-SQL tests after the reader
adopted the shared SQL grammar. Both inspection and filtering now reject the
same unsupported statements/truncated COPY forms; callback tests verify the
authenticated archive lifetime and cleanup. Preparation code is under review
for filesystem aliases and staging collisions before execution is enabled.

Root verified 29 combined private configuration/plan/worker-guard tests after the
retained authenticated-archive callback integration. Callback completion/failure
cleanup and refusal before callback on invalid plans are covered. Production
frontend build passes with the existing large-chunk warning. Private preparation,
engine consumption and child/worker wiring are now separate active integration
tasks; no live execution or deployment is claimed by these checks.

Recovery evidence writer accepts an explicit validated private directory rather
than ambient/default output location, and rejects unsafe capsule identifiers
before deriving filenames. Thirteen evidence/recovery tests pass, including
private-directory placement and F:/path traversal refusal. Prepared execution
will supply a durable private evidence directory separately from cleaned scratch;
this helper is not yet the full private execution path.

Private replay configuration now accepts a paired plan UUID and descriptor
digest, authenticates the exact capsule/selection with explicit review limits
and the job's numeric admission budget, and returns plan details only inside
the runner. Root verified seven integration/guard tests, including worker denial
before spawn and sanitized error reporting. Execution remains deliberately
closed until authenticated snapshot preparation and child consumption are wired.

Database restore accepts an explicit validated private scratch directory for
filtered SQL. Twelve recovery tests pass, including proof that the filtered file
stays below that directory, is removed afterward, and F: is refused. Standalone
defaults remain unchanged. The upcoming prepared private execution path must
pass this option; the option alone does not relocate existing deployed jobs.

Root browser verification now passes at 320px and 1440px using a real synthetic
encrypted capsule: inspection, private log display, selection/budget/empty gates,
plan save, failed-refresh invalidation, no external requests or page overflow.
Screenshots are under `portabase-evidence/private-capsule-review/`. Visual review
found the post-save summary incorrectly showing zero bytes; it now retains the
saved total and the browser test asserts it. This supersedes the failed browser
runs below. Private replay snapshot preparation remains in development.

Latest root integration run: 616 tests passed. Worker command construction now
explicitly refuses an attached private restore plan until child-side snapshot
execution is connected, preventing a partially integrated plan from silently
becoming a full replay. Private configuration/validator integration is underway;
the execution guard is temporary release protection, not the completed feature.

Root verified nine new private saved-plan validator tests: approved descriptor
hash, exact inventory and byte counts, runner/source/capsule binding, explicit
empty selection, lower admission budget, authentication and path denial. The
validator is not wired into execution yet and does not lock files after return.
Recovery tests also prove unsupported selective SQL invokes zero database
commands (12 tests pass). Latest browser run passed plan saving and then failed
its hidden-button locator after an intentionally failed refresh; that test
assertion is being corrected. Earlier browser failures remain recorded below.

Selective SQL filtering now rejects unsupported statements, malformed/duplicate
COPY blocks and truncated dumps. Root verified six SQL security tests plus 61
combined core/identifier/private-review tests. Restore database preparation now
sits inside its cleanup guard, so rejection during filtering also removes the
temporary plan directory. No database or provider execution was performed.

Private plan saving now returns the SHA-256 of the exact persisted binding file.
This lets the next private configuration pin the approved plan/capsule descriptor
instead of trusting a mutable path alone. The ten capsule-review tests pass with
an assertion against actual binding bytes. This hash is an integrity reference,
not proof of safe execution or a replacement for private runner access controls.

Root browser execution of `scripts/check-private-capsule-review.mjs` failed:
the save-plan response wait timed out after 30 seconds. The process exited 1;
this is not a verified GUI flow despite the ten passing API/archive tests.
Diagnosis is assigned to the viewer implementation agent. A separate private
saved-plan validator is being implemented before worker/CLI execution wiring.

Root independently verified ten private capsule review tests using real encrypted
synthetic archives: authentication failures, malformed/link/traversal archives,
bounded decompression, private-path checks, stale/changed capsule denial,
inventory-bound plan saving, and HTTP session/Origin/CSRF enforcement. Metadata
reads now handle short reads and reject observed file changes during reading.
No source provider requests or customer data were used. Browser review and
saved-plan-to-replay integration remain pending; saving a plan is not execution.

Integrated local suite passed 589 tests before the latest COPY identifier fix.
Restore table measurement/filtering now recognizes unquoted and mixed-quoted
PostgreSQL COPY identifiers, matching the private reader's accepted identifiers;
deselected blocks no longer pass through merely because names lack quotes.
Fifty-one focused tests passed after that fix. General non-COPY SQL filtering
and authenticated saved-plan execution remain release work; these tests do not
prove selective restore of arbitrary SQL or a deployed customer recovery flow.

Capsule ustar packaging now measures UTF-8 prefix and filename fields in bytes,
preventing multibyte names from overwriting adjacent header fields. Paths that
cannot fit are rejected before opening an output stream so the existing caller
can use its system-tar fallback. Six focused packaging/capture-log tests passed,
including an encrypted log round trip and oversized Unicode path rejection.
This is local synthetic evidence, not a cloud restore drill or deployment.

Restore-plan structural validation now rejects negative/coerced/unsafe byte
counts, nonboolean selections, duplicate identities, malformed collections and
unsafe budgets before replay. Fifty-three related tests passed. This prevents
malformed arithmetic from bypassing a declared budget; it does not authenticate
user-edited byte estimates against the actual capsule. The offline review path
must bind selections to authenticated inventory and capsule digests.

Shared privacy copy corrected: removed current-tense claims that paid Cloud is
blind to keys or already seals them in the browser. Homepage/auth/dashboard shared
copy now distinguishes runner-local selection from unfinished managed hosting,
key custody and legacy backend credential/inventory flows. Three existing copy
integration tests passed. Offline private capsule review/restore planning is the
next independent implementation task; hosting and provider credentials remain
required for the actual deployed service.

Effective credential audit: verified AWS STS for `pb-admin` in account
`899867382621`, region `us-east-1`, then read the configured secret bundle without
printing values. The actual product-specific selector found no Portabase Square
token/location records; Netlify fallback was selected and its production location
probe returned HTTP 401. Portabase Mailgun API/domain/from and Twilio account/auth/
messaging-service selectors were absent from both inspected sources. Script:
`scripts/audit-effective-service-secrets.mjs`. This is operator-profile evidence,
not proof of the deployed function's AWS permissions. No provider state changed.

Latest root verification: **582 tests passed**. Private v2 workers journal start
and exact completion records under their explicit private root, reconcile saved
results before new claims, and archive only matching server acknowledgements.
Uncertain execution blocks instead of rerunning. Root's 42 focused tests cover
restart, lost acknowledgement, concurrent start, corrupt/foreign records, links,
bounded scans, admission caps and all-provider transfer-size checks. Fsync/ACL
behavior remains platform-dependent; synthetic process tests are not power-loss
or real cloud-runner proof. No real capture/restore/provider action or deployment.

Managed final-capsule gate implemented: `PORTABASE_JOB_MAX_CAPSULE_BYTES` is checked
at transfer entry for all destination types. Ciphertext and sidecars count;
oversize, invalid limits, links and special files stop before copy/upload.
Root reran all seven gate tests with tiny fixtures and mocked transports. Worker
v2 forwards the validated server admission cap, overriding ambient values.
This bounds final capsule bytes only; source capture, spool capacity, actual
transfer retries and monthly metering remain separate unimplemented limits.

Completion reconciliation: v2 jobs accept an identical terminal result from the
same authenticated runner without rewriting stored state or timestamps. Conflicting
terminal results return 409 and other runners remain forbidden. Twenty-two targeted
integration tests passed. The private durable completion journal is being added;
server idempotency alone does not recover results after a worker crash.

Worker acknowledgement fix: a failed completion response no longer causes a
second contradictory failure report after the engine has finished. The worker
reports `job_result_unconfirmed` locally and does not rerun the engine. Seventeen
worker/private-configuration tests passed, including lost responses for both
successful and failed engine outcomes. Durable private result journaling and
idempotent completion reconciliation are still needed for crash recovery.

Latest integrated checkpoint: **565 tests passed**, build passed with existing
bundle-size warning. Root independently verified the signup, pending checkout,
and private-job queue browser scripts. Runner cards now import strict opaque
references, preview them, require explicit queue consent and active ownership,
and reconcile lost responses with the same request ID. Tested at 320/1440 px;
actual injected job handler persisted only one job on retry. No private inventory
or companion configuration file is uploaded. Queued status is not execution proof.

Checkout confirmation now persists beyond a toast and across navigation/login;
explicit retry checks the original attempt, does not create another purchase,
and requires verified access before success. Expired add-on repurchase and paid
plan upgrades still need provider-backed reconciliation, not a local boolean fix.
No accounts/messages/charges were created and nothing was deployed.

Signup follow-up verified by root: `/signup` defaults to account creation;
signup/resend callback URLs preserve the validated return path and selected plan.
Actual SDK browser tests pass for both $7/$17 after clearing session storage.
This covers a fresh tab/session with the browser-local PKCE verifier retained,
not a different device without that verifier. Provider HTTP responses were
intercepted; no real accounts, messages or charges were created.

Private queue retry integration: v2 queue accepts an optional request UUID stored
outside the private-reference payload. Exact owner/request/type/runner/config
retries return the original job before quota reservation; changed intent with the
same request ID returns 409. Existing queue retention provides at least 24 hours
of deduplication. Root's nine admission tests pass, including concurrent first
requests and repeat submissions. Account-side private reference import/queue UI,
new-session signup return, and persistent checkout confirmation are in progress.

Latest root integration: **558 tests passed**, production build passed (existing
bundle-size warning). Root independently ran `check-signup-checkout.mjs`:
both $7 and $17 public plan selection survive signup/confirmation into the exact
checkout POST; all provider/auth responses intercepted, no accounts or charges.
This fixes a regression where current free entitlement overrode checkout choice.
Checkout selection no longer changes effective entitlement or quotas.

Root also ran `check-private-setup-ui.mjs`: 320/1440 px, private inventory selection,
immutable save, resolver/argv integration, empty-selection confirmation and failed
refresh rejection; no external requests or overflow. Opt-in `ui --private-setup`
authors backup configuration inside the existing loopback runner UI boundary.
This is configuration authoring, not a provisioned remote GUI or an executed
backup/restore. Legacy central credential/selection paths remain until coordinated
replacement. No release, provider configuration change or customer messages.

External state rechecked during private GUI implementation: read-only audit bound
to Netlify site `794217cc-42ab-4a9f-81da-06a661403573`, `portabase-dev`,
`portabase.dev`. Published deploy remains `6ab288426450b9689079fdab`. Production
Square location lookup still returns HTTP 401 `UNAUTHORIZED`; no Portabase
Mailgun/Twilio variable names appear in the inspected production function
environment scope. This does not inventory AWS secret contents or prove absence
of provider accounts. No configuration was changed and no messages were sent.

Private output-path review: existing staging/status ancestors are checked for
directory type, links and resolved-path equality before execution. Ten private
configuration tests passed, including junction/file replacement attempts against
both output paths. Owner filesystem ACLs must still prevent concurrent path
replacement; these checks are not an OS sandbox. Private GUI configuration
authoring is the next implementation task, with the existing loopback-only UI
boundary preserved until remote hosting and key custody are decided.

Private job protocol integration: v2 queue requests carry only immutable runner
identity and exact configuration UUID/revision. The job API validates customer
ownership on queue and additionally requires the active runner credential on
claim/finish; legacy workers cannot claim or finish v2 jobs. Root verified 27
API/job/worker tests, including exact private file resolution, path/link escape
denials, configuration-change rejection and an actual synthetic CLI invocation
from the private working directory. Full suite now **548 passed**. This opt-in
path is not deployed; the private GUI has not replaced legacy named selections.
Jobs and runner lifecycle now use the same
ownership-checked subscription lookup as account endpoints.

Remaining execution gate: the queue's `admission.maxBytes` is metadata, not proof
of byte limits enforced during capture or upload. Worker resource/bandwidth
enforcement and metered accounting still require implementation and live proof;
do not infer cost protection from queue admission or displayed quotas.

Worker execution guard follow-up: unsupported operations (including heartbeat)
no longer fall through to backup. Backup requires both the queued project identity
and a valid, matching worker project identity before process launch. Nine targeted
job/worker tests passed, including intercepted failure reports and no-spawn checks.
Heartbeat execution is not implemented by this worker. Versioned runner-private
configuration references are the next integration task; legacy named queue fields
remain a confidentiality gap until the coordinated replacement is wired.

Runner result privacy follow-up: worker requests and persisted finish results now
use a shared fixed operational-code projection. Arbitrary exception codes and
diagnostic text become `worker_failed`; process exits are bounded to 1–255 or
unknown. Eight targeted job/worker tests passed, including the intercepted request
body and persisted result. Existing stored errors and other legacy configuration
paths have not been migrated or removed; this is not the whole privacy boundary.

This section supersedes older implementation-in-progress notes below. Overall
service remains **INCOMPLETE and undeployed**; local provider stubs are not live proof.

| Capability | Current source evidence | Deployment / live proof | Remaining gate |
| --- | --- | --- | --- |
| Notification dispatch | Authenticated telemetry feeds consent-bound outbox; verified contacts, scheduled dispatcher and per-account budgets implemented | Not deployed; no real sends | Product provider configuration, budget selection and live delivery checks |
| Delivery receipts and history | Signed provider receipts, callback routes, verification-message indexes and owner-scoped history API/UI implemented; root integration test covers event, acceptance, signed receipt, history, duplicate suppression and privacy | Synthetic provider transport only | Provider webhook setup, actual receipt retries and ambiguous-send reconciliation |
| Manifest sharing | Local export, preview, explicit hash-bound consent, upload and revoke implemented | Local browser/API checks only | Real private-runner integration and deployed ownership checks |
| Private runner | Metadata lifecycle and safe telemetry exist; confidential runner compute and GUI remain incomplete | No provisioned runner proof | Hosting/key-custody decision, real execution and restore drill |
| Billing | Provider-verified entitlement and effective quota API/UI implemented; expired/unverified add-ons cannot raise displayed quotas | Last audited Square credential returned 401 | Owner's Square setup, checkout/webhook/renewal/refund live proof |

Root full suite checkpoint: **535 passed**, including the notification delivery
integration test. Production build passed with the existing bundle-size warning.
Root also reran the delivery-history browser check and five account-quota browser
scenarios. Free manual allowance is one per 24 hours; scheduled quota is zero.
No commercial plan prices/capacities changed. No merge, release, provider
configuration change or real customer notification was performed.

The seal panel now explicitly reports private-runner setup unavailable, has no
credential/URL input, and cannot display successful sealing without a protocol.
Root verified live/demo rendering at 320/1440 px with no network requests or
success notifications. This corrects a false UI claim; it does not implement the
required private runner or encryption/key-release protocol.

Mobile sales review remains isolated on `review/mobile-sales-20261004` at
`2e158ad`; the subscription changes here do not modify that worktree.

Privacy release gate: [private runner boundary review](docs/PRIVATE-RUNNER-BOUNDARY-REVIEW.md)
identifies legacy PAT proxying, persisted inventory selections/job details,
main-origin credential forms, and raw CloudWatch log transit. The CloudWatch
endpoint also lacks a server-derived owner-to-log-group/role mapping. These are
source findings, not a verified live exploit. Do not provision privileged log
access or claim the confidentiality goal is met before the coordinated runner
replacement and real account-isolation checks. A separate origin alone cannot
establish operator blindness.

## 2026-10-04 subscription service goal and owner decisions

**Overall: INCOMPLETE.** The active goal is a deployed subscription service with
Square billing, account management, persistent capsule runners, customer-controlled
manifest sharing, telemetry, and email/SMS delivery. A local build or mock-provider
test does not establish live readiness. Continue against the entire goal.

Owner decisions in this session override older pricing and architecture prose:

- Latest size clarification: the owner recalls $7/100 MB and $17/10 GB. This
  supersedes the earlier discussion of $7/10 GB and $17/100 GB as the working
  proposal, but the owner is still reconciling the original specification.
  Git evidence: e875e17 docs/BILLING.md offered $7/1 GB, $17/10 GB, $37/100 GB.
  Current docs/source instead offer Free/100 MB, $7/10 GB, $17/25 GB. Do not silently
  choose one as the final commercial agreement or modify live Square plans.
  Unlimited databases and one scheduled run per rolling 24 hours on $7, three on
  $17 were requested in this session. Do not multiply executions by database count.
- Owner explicitly requires an included bandwidth allowance and metered charges
  thereafter. Allowance, rate, billable direction, and spend ceiling are not yet
  selected. For estimates use the owner's assumed $6.50 net receipt after Square
  on the $7 subscription; that is revenue before operating costs, not profit.
- A subscriber's runner persists for the life of the subscription, with sealed
  credentials and manifests. Stopping compute while retaining encrypted state is
  proposed; the owner has not yet answered whether a continuously running machine
  is required.
- The website may receive nonconfidential operational information: schedules,
  statuses, errors, and notifications. Sanitize errors before transmission; raw
  logs can contain source secrets. Full manifests/logs belong in the capsule;
  sharing manifests with the backend requires the customer's explicit choice.
- Question 2 clarification: the GUI spans two trust boundaries. The ordinary
  backend launches/schedules the runner and holds account/billing records,
  deliberately emitted nonconfidential telemetry, and sanitized activity logs.
  Sensitive setup and database access originate inside the runner's interface.
  Source credentials, encryption keys, sensitive configuration, full manifests,
  and detailed logs must not pass through the ordinary backend. Capsule creation
  and recovery execute inside the runner. These requirements supersede existing
  control-plane endpoints that proxy source credentials or persist inventories.
  A separate hostname or encrypted disk alone does not prove operator blindness;
  key release, code-update authority, and the browser-to-runner secure channel
  remain architecture work. Shared manifests are the explicit opt-in exception.
- The runner MUST contain its own GUI. It lets customers connect their databases,
  inspect table/object sizes, choose backup and restore contents, see estimated
  capacity/transfer usage, and fit a selection to the actual target's limits
  (including a free Supabase target). Show exclusions and dependency issues;
  successful sizing is not proof of successful application recovery. Sensitive
  names/inventories remain inside the runner's trust boundary by default.
- The outer dashboard represents each runner as a distinct openable entity. The
  customer can open its private GUI and seal it on the client side. Main and
  private workspaces must have visibly different themes plus persistent text/icon
  labels; color alone is insufficient. Exact colors are not selected. A sealed
  state must correspond to verified encryption/key state, not a cosmetic toggle.
  Client-side execution remains to be clarified: browser-only, customer-controlled
  process, or attested hosted execution have different unattended scheduling and
  operator-access properties. Do not silently equate these models.
- The outer dashboard shows only emitted overall health/state (e.g. running or
  waiting), last report, and a next scheduled run when actually known. Never
  present a missing/stale heartbeat as healthy waiting. A stated future schedule
  does not prove that a sleeping runner will wake successfully.
- Verifiability must cover the actual delivered runner version, dependency/code
  review, permitted network destinations, telemetry schema, and update authority.
  A hash identifies bytes but does not prove safety; a clean observed network
  trace does not prove all future executions safe. Neither is alone a basis for
  an absolute zero-knowledge or 'provably fair' claim.
- Included optional Supabase keep-alive checks originate from the runner using
  minimal read-only database activity. Main backend receives only safe outcome
  telemetry. The owner requests this feature at no additional customer charge;
  runner wake/compute costs must still be counted in unit economics. Supabase's
  2026-10-04 guidance says low user database activity over seven days can trigger
  pausing; a few daily database requests typically help. A generic HTTP ping is
  not established as sufficient, and this feature cannot guarantee no pausing.
  Source: https://supabase.com/docs/guides/platform/free-project-pausing
- Cloudflare is the owner's intended runner provider; alternatives are welcome.
  Cloudflare Containers/Sandboxes are under evaluation, not provisioned or proven.
- Future AWS support must fit the framework. It is not an expansion of the first
  release. Keep source-provider capture/recovery separate from runner hosting,
  scheduling, billing, vault destinations, and telemetry.
- Owner asks whether the runner can be provably secure and zero-knowledge to
  Portabase. This is an open architecture requirement, not an achieved property.
  Ordinary Cloudflare Sandboxes permit operator-controlled code to access the
  sandbox's secrets: encryption at rest alone cannot establish operator blindness.
  See https://developers.cloudflare.com/sandbox/concepts/security/ . Candidate
  boundaries are customer-controlled execution without Portabase administration
  or unattended updates, or attested confidential compute with key-release policy
  controlled independently of Portabase (e.g. customer-owned KMS and Nitro
  Enclaves). Enclave attestation does not prove the application's correctness.
  Do not use the existing absolute zero-knowledge marketing claims as evidence.
- Still to settle: what the GB allowance meters; who owns/pays for retained vault
  storage; retention and any per-100-GB add-on; key release for unattended jobs;
  notification allowance. Pending decisions do not block independent security work.

### Cost evidence (estimates, not measured margins)

Cloudflare's [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
was checked on 2026-10-04. A standard-2 container (1 vCPU, 6 GiB RAM, 12 GB disk)
running 15 minutes per job at 25–100% CPU utilization models $0.56–$0.97/month for
30 jobs, or $1.69–$2.90 for 90 jobs. At one hour per job those become $2.25–$3.87
and $6.75–$11.61. These exclude bandwidth, persistence, Workers/Durable Objects,
logs, payment processing, notifications, retries, and support. Shared plan/free
allowances are not a per-customer discount.

North America/Europe container egress is $0.025/GB beyond the shared allowance.
100 GB sent three times a day for 30 days is 9,000 GB, costing $225 at the marginal
rate ($200 if that customer alone uses a 1,000 GB included allowance). Full-copy
transfer economics do not fit $17. Incremental behavior exists in the local CLI,
but no representative hosted-runner benchmark proves its transfer/runtime savings.
Do not infer that R2's free egress makes Container egress free.

[Container limits](https://developers.cloudflare.com/containers/platform/limits/)
currently cap local disk and snapshots at 20 GB. A 100 GB staged capsule therefore
requires streaming/external storage or another compute platform. Native snapshots
expire 30 days after creation/last restore; they are not alone a permanent recovery
store. Preserve customer-controlled independent recovery copies.

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Signup and account identity | Supabase auth and console | Prior dedicated project evidence | Recheck deployment | Older release | New end-to-end signup pending | Tenant/session denial tests pending | INCOMPLETE | Public session and account lifecycle proof |
| Square $7/$17 subscriptions | subscribe, confirm-checkout, webhook functions | Existing integration; live merchant binding needs recheck | Current plan definitions need owner updates | Older release | Checkout, renew, cancel pending | Confirmation currently trusts browser return; fix before release | INCOMPLETE | Provider-verified fulfillment and lifecycle |
| Plan allowances | frontend/server product constants | N/A | Older 1-database/25-GB definitions remain | No revised plans | None | Aggregate run limits pending | INCOMPLETE | Meter definition and matching enforcement |
| Persistent sealed runner | cloud-runners scaffold | No real runner verified | Cloudflare proposed | No | None | Credential custody and isolation pending | INCOMPLETE | Implement compute/state lifecycle and key release |
| Runner enrollment and revocation | cloud-agents, agent-store, AgentCredentials | Netlify stores created on first write; not live tested | Local API/client wired | No | None | Local hashing, revocation, tenant isolation and concurrency tests passed | IMPLEMENTED locally | Public authenticated enrollment proof |
| Account-isolated telemetry | telemetry ingest/read and console | Existing blob service; revised namespace unverified live | New per-runner credential contract | No | None | 15 local telemetry/security tests passed | IMPLEMENTED locally | Coordinated API/UI/runner enrollment release |
| Capsule manifests and logs | CLI capture/recovery engine | Existing local implementation under review | Complete artifact contract pending | No new runner release | Cloud drill pending | Secret exclusion and encrypted artifact proof pending | INCOMPLETE | Inspect and prove every required artifact |
| Optional manifest sharing | Existing privacy model forbids inventories | No | No | No | None | Opt-in ownership/revocation tests pending | INCOMPLETE | Implement explicit consent and private account access |
| Private runner GUI and sealing | Existing console/CLI flows under boundary audit | No private runner verified | Hosting/key model unresolved | No | None | Client key custody, update path and traffic proof pending | INCOMPLETE | Real private interface; distinct theme and verified seal state |
| Selective backup/restore sizing | CLI and console selection tools under review | Runner integration pending | Real target capacity rules pending | No | None | Selection/dependency validation pending | INCOMPLETE | Inspect object sizes privately and prove selected recovery |
| Included keep-alive | Owner-approved requirement | No runner job verified | Cadence/compute budget pending | No | None | Read-only request and safe telemetry pending | INCOMPLETE | Actual runner-originated activity and no false availability guarantee |
| Scheduling and job execution | Runner metadata endpoints | Scaffold only | No real execution wiring | No | None | Idempotency, quotas and tenant boundaries pending | INCOMPLETE | Real scheduled cloud jobs |
| SMS alerts | Local console controls | Product-specific delivery unverified | No verified backend | No | None | Phone verification/opt-out tests pending | INCOMPLETE | Actual delivery and preferences |
| Email updates | Identity email exists; operational mail pending | Sender/service binding unverified | No verified operational delivery | No | None | Recipient ownership and suppression pending | INCOMPLETE | Actual event-triggered delivery |
| Recovery | CLI with unrelated ongoing edits preserved | Isolated target not bound for this goal | Cloud proof pending | No | None | Negative restore tests and rollback proof pending | INCOMPLETE | Representative independent restore drill |
| Homepage | Commit 80b2431 pushed | Existing Netlify site | Preview validated | Not deployed | Baseline only | No new backend scope in homepage commit | IMPLEMENTED | Safe release preserving production routes |

Release caution: current netlify.toml includes a site gate absent from the last
verified public deployment. Do not blindly deploy the dirty checkout. Preserve
unrelated CLI edits, create a clean intended release, retain rollback, and prove
the public product flows before declaring completion.

Latest local validation: Vite production build succeeded (existing large-bundle
warning); 19 runner credential, telemetry read, and telemetry view tests passed.
This does not prove provider provisioning, public delivery, or zero-knowledge.

### 2026-10-06 runner storage tier decision (owner, this session)

**This is a fifth distinct size/pricing combination recorded for this product.**
Prior recorded variants, none deleted, none chosen as final:
`e875e17` docs/BILLING.md ($7/1 GB, $17/10 GB, $37/100 GB); current live
docs/source (Free/100 MB, $7/10 GB, $17/25 GB); the 2026-10-04 owner recall
($7/100 MB, $17/10 GB — see above). Do not silently collapse these; flag the
conflict to the owner before any Square plan or marketing copy is changed.

Today's owner decision, recorded as the newest working proposal:

- Base tier: **$7/month, 10 GB runner-local storage**, which also caps the
  largest single binary object the base tier will copy. AWS estimate: EBS gp3
  10 GB ≈ $0.80/mo, or S3 Standard 10 GB ≈ $0.23/mo — both comfortably inside
  the previously recorded $6.50 net-after-Square figure.
- **"XL runner" upsell: $17/month, 100 GB runner-local storage / 100 GB max
  object size.** AWS estimate: ≈ $8–10/mo storage, leaving margin before
  compute/transfer. This is distinct from (and not yet reconciled with)
  whatever the existing $17/25 GB plan definition becomes.
- Storage cost is billed by GB-month regardless of invocation frequency; a
  runner invoked 1 hour/month still carries the full 10 GB or 100 GB storage
  cost for as long as the volume exists. Only compute scales down with usage.
- **Run frequency, revised again same session:** base $7 tier raised from the
  2026-10-04 figure of 1 scheduled run/rolling-24h to **up to 3 runs/day**.
  XL also gets **up to 3 runs/day** (not higher than base) — XL's
  differentiator is storage/object-size headroom, not run count. The owner
  also said XL will allow "a potentially larger total amount of storage and
  data movement" beyond the 100 GB per-object cap — i.e. a higher cumulative
  retained-storage and/or bandwidth allowance, not just a bigger single-object
  ceiling. Exact XL aggregate storage and transfer numbers are not yet
  specified; do not infer a figure. This still leaves the "what the GB
  allowance meters" and bandwidth-allowance questions from 2026-10-04 open.
- **Upsell flow**: before provisioning/billing, the runner scans the
  customer's binary objects (sizes only, via the source's listing API — no
  object bytes need to move for this). If any object exceeds the $7 tier's
  10 GB cap, the customer is informed of the specific objects affected and the
  cost increase required (the $17 XL tier) to include them, before capture
  proceeds. This is sizing-and-disclosure, not an automatic upgrade.
- Streaming the object through the runner (download → encrypt → upload,
  bounded buffer) was discussed as a way to handle objects larger than local
  disk without needing a bigger volume at all. Not adopted for this decision —
  the owner chose a hard per-tier object-size cap instead, which is simpler to
  support and explain, at the cost of refusing objects above the tier's limit
  rather than handling them via streaming. This remains available as a future
  option if a customer's single-object size exceeds even the XL cap.
- **Not yet implemented in code.** `utility/job-capsule-limit.mjs` only caps
  the total assembled capsule size (whole-job pass/fail, checked after
  download). `utility/portabase-core.mjs`'s `assertLocalStarterSize` is an
  unrelated Local-Starter destination cap. Neither does the per-object
  pre-check (via source listing, before download) or the customer-facing
  skip/disclosure flow described above. This is new work.
- Confirm whether the Supabase S3-compatible API is available for this
  customer's project before relying on any direct-copy shortcut for binary
  objects — the owner stated it is not officially exposed for this use case,
  so object transport goes through the Storage REST API like a normal client
  (download then upload), not a server-side S3 copy.

## 2026-10-03 CLI recovery options (current work; not released)

**INCOMPLETE for release/live recovery.** Source changes and local fixtures cover
the rows below. No production backup, overwrite, restore, npm publish, or website
deploy was performed in this work. The earlier deployment request remains pending
the npm-versus-website destination choice and the recovery release gates.
The older identity/site ledgers below are retained as historical evidence, not
reverified current provider state.

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
|---|---|---|---|---|---|---|---|---|
| All-table DDL only / per-table row exclusion | `utility/portabase.mjs`, `recovery-options.mjs` | n/a | CLI flags/config implemented | No | None | Fixture verifies no data dump in DDL mode | Implemented, locally tested | Cloud capture and schema-only restore drill |
| Storage inventory without object bodies | Same | n/a | `--storage-inventory-only` | No | None | Mock service rejects any body request; omitted count/size tested | Implemented, locally tested | Cloud inventory and restore verification |
| Independent destination database name | `recovery-options.mjs` | Target not inspected | `--target-db-name` | No | None | Source/wrong-project/name checks tested | Implemented, locally tested | Matching API/database runtime and application-role proof |
| Target overwrite | `overwrite-target.mjs`, `portabase.mjs` | Target not inspected | `--overwrite-target --overwrite-scope app-and-auth` | No | None | Confirmation, rollback binding, drift, platform schema/extension refusal, transaction invocation tested | Implemented; release blocked | Real rollback drill, dependent-object safety audit, active-writer fencing and database failure injection |
| File objects diverted to customer S3 | `storage-s3-restore.mjs` | Customer bucket not selected | URI + expected owner required | No | None | Mock upload/read-back hashes, mapping, corrupt read-back rejection tested | Implemented, locally tested | Real owner/IAM denial tests, multipart upload, free-account restore |
| Binary incremental cache | `recovery-options.mjs`, `portabase.mjs` | n/a | `--incremental-binary` | No | None | Path-specific SHA-256 cache validation; corrupt/stale cache tests | Implemented, locally tested | Cloud two-run proof; timestamp policy limitations documented |
| Baseline + delta reconstruction | Same | n/a | `--delta --baseline` | No | None | Wrong baseline/hash, changed/deleted files, reused payload and baseline preservation tested | Implemented, locally tested | Real add/change/delete restore; full baseline retention in customer vault |
| Strict backup/restore options | `recovery-options.mjs` | n/a | Unknown/missing options rejected | No | n/a | Typo, missing value, unimplemented flag rejection tested | Implemented, locally tested | Other CLI commands still need strict parsing |
| Scenarios, sizing, and vector exclusion | `docs/CLI-SCENARIOS.md` | n/a | Linked from README/REPLAY | No | n/a | Vector Buckets explicitly outside capture/sizing/restore; pgvector distinguished | Documented | Commands need cloud qualification before production use |

Local validation: full suite **374/374 passed**. A subsequently expanded
`tests/recovery-options.test.mjs` passed **12/12**, including four capture runs
(first download, verified cache reuse, newer whole-file download, and delta
deletion recording). These use synthetic data and mocked providers only.
The full suite initially found an operator-config-dependent
doctor test; the test now explicitly isolates its missing config and removes the
inherited runtime config. No operator config was changed.

Operational limits: overwrite replaces app schemas and Auth rows, preserves
platform schema definitions, refuses app-schema extensions and platform triggers
depending on app functions, and requires a complete target rollback capsule plus
isolated restore evidence. Count/catalog comparison does not prove no concurrent
content changes. Database SQL is transactional; later Storage/Function operations
are not. S3 diversion preserves objects but does not restore Storage URL serving.
Independent database/S3 plan budgets and KMS-specific destination configuration
remain unimplemented. No whole-product completion claim is made.

Current repo guidance overrides stale hosted/shared-project examples in the older
handoff: never use the dead shared project or treat a sibling project's backend as
the Portabase identity or recovery destination.

Historical scope of this file: **Google sign-in for Portabase Cloud identity.** Other
capabilities (capture, restore, replay, Square billing) are tracked in
`PROJECT.md` and `docs/HANDOFF.md`.

Status vocabulary is the portfolio one: *scaffolded → implemented → provisioned
→ configured → deployed → verified → complete*. Never substitute one for
another.

**Overall status: INCOMPLETE — provisioning and configuration are done and
verified; blocked on deploying the app bundle and running the live sign-in proof.**

---

## Definition of Done (Google sign-in)

Agreed finish line for this capability:

- A stranger visits `https://portabase.dev/login`, clicks **Continue with
  Google**, picks any Google account, and lands in the Cloud console at `/app`
  with a real Supabase session.
- The session is issued by **Portabase's own Supabase project**
  (`eoiqvdmvgaurlecdzqkp`), not the shared portfolio project.
- Sign-out clears the session and `/app` is denied afterward.
- The popup-blocked path still completes via full-page redirect.

Not done until every row below reads **verified**.

---

## Capability rows

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
|---|---|---|---|---|---|---|---|---|
| Dedicated Supabase project | Supabase org `capece` (Pro) | ✅ `eoiqvdmvgaurlecdzqkp`, us-east-1, ACTIVE_HEALTHY, created 2026-08-20 | ✅ Google provider + site_url + allow list | n/a | ✅ | n/a | **configured** | — |
| GCP project + consent screen | gcloud + console | ✅ `portabase-dev` / `495102144848` | ✅ App name `Portabase`, **External**, support+contact `rfiddomains@gmail.com`, home page set | n/a | ✅ consent screen renders as `portabase.dev` | n/a | **verified** | Publishing status is **Testing** |
| Consent screen logo | `scripts/make-app-icon.py` | ✅ `public/icons/portabase-consent-120.png` | ❌ **not uploaded** | ❌ | ✅ 120x120, 6.3 KB, verified by test | n/a | **BLOCKED** | File input is hidden from the a11y tree; JS reveal blocked. Manual: Branding → Browse |
| Google OAuth client | Google Cloud Console (browser-automated) | ✅ `portabase-web`, client id `495102144848-jvd6gi5nk948t0v3l527n2hpldcr56bd` | ✅ 4 JS origins + 5 redirect URIs | n/a | ✅ account chooser renders "to continue to portabase.dev"; unregistered-URI control correctly returns `Error 400: redirect_uri_mismatch` | ✅ secret never in bundle/repo | **verified** | — |
| Google client secrets in `secrets-bundle` | AWS `899867382621` | ✅ `portabase-google-oauth-client-id` / `-client-secret` / `-updated-at` | ✅ | n/a | ✅ round-trip read back byte-exact; 293→296 keys, no key lost | ✅ | **verified** | — |
| Supabase Auth → Google provider | Supabase Management API | n/a | ✅ enabled; `site_url=https://portabase.dev`; 4-entry redirect allow list | n/a | ✅ read back: `external_google_client_id` matches the client the app sends (the `aud` check) | ✅ secret set, never echoed | **verified** | — |
| id_token sign-in flow (browser) | `src/lib/google-gis-auth.js` | n/a | n/a | ❌ not merged to `main` | ❌ | ⚠️ partial | **implemented** | Live proof requires the OAuth client |
| Single GoTrue client / no URL-handler race | `src/lib/supabase-auth.js` | n/a | ✅ `detectSessionInUrl: false` | ❌ | ❌ | ✅ guarded by test | **implemented** | — |
| Product isolation guard | `tests/google-oauth-isolation.test.mjs` | n/a | ✅ | ❌ | ✅ 11/11 pass, **mutation-tested** (6/6 seeded regressions caught), runs in CI via `.github/workflows/ci.yml:23` | ✅ | **verified (CI-level)** | — |
| Netlify env vars | Netlify site `794217cc-…` (`portabase-dev`) | n/a | ✅ all 5 set across all 4 contexts | ❌ not yet deployed | ✅ read back; **0** occurrences of the shared ref remain | n/a | **configured** | Takes effect only on next deploy |

### Non-secret target identity (so a later agent picks the right target)

| Thing | Value |
|---|---|
| Supabase project (identity) | `eoiqvdmvgaurlecdzqkp` — "portabase.dev" |
| Supabase project (replay restore target — **not** identity) | `svltssnxzqsrxtbjgaex` — "portabase-replay-proof" |
| Shared portfolio project (**must not** be used for this product) | `ekklokrukxmqlahtonnc` — "DataAutomation" |
| GCP project (Portabase consent screen) | `portabase-dev` / `495102144848` |
| GCP project that must **not** be used | `massageexam` — NYS Massage Exam |
| Netlify site id | `794217cc-42ab-4a9f-81da-06a661403573` |
| Deploy mechanism | **No Git linkage** — `build_settings` is empty, so Netlify does **not** build from a branch. Deploys are manual (`netlify deploy --prod`). Merging to `main` alone ships nothing. |
| Publishable key (public) | `sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL` |

---

## Why the OAuth client could not be created from the CLI

Tested, not assumed (2026-08-20). **Correction to an earlier claim in this file:**
gcloud *does* ship OAuth client commands — `gcloud iam oauth-clients create` and
`gcloud iap oauth-clients create`. Neither creates a "Sign in with Google" web
client, which is the trap: a command can succeed and hand back a client id that
cannot do this job.

- `iam oauth-clients` is **workforce identity federation** — scope
  `cloud-platform`, for reaching Google Cloud resources on behalf of
  workforce-pool users. Supabase's Google provider would reject it.
  `gcloud iam oauth-clients list` returned **0 items** across every project in
  this account, so no such client was ever created here.
- `iap oauth-clients` is **IAP-locked**: redirect URIs are immutable by design,
  and the IAP OAuth Admin APIs were permanently shut down **2026-03-19**.
- `gcloud` 550.0.0 is installed and authenticated as `rfiddomains@gmail.com`.
- The only programmatic path to an OAuth brand/client is the IAP API
  (`iap.googleapis.com` → `projects.brands`). Calling it returns:
  `400 INVALID_ARGUMENT — "Project must belong to an organization."`
- `gcloud organizations list` returns **0 items** — this is a consumer Gmail
  account with no Workspace organization, so no brand can be created via API.
- Even with an organization, `brands.create` produces **internal** (org-only)
  brands and **IAP-typed** clients. Portabase needs an **external** brand so any
  Google account can sign in, and a general **Web application** client. Google
  exposes no API for either.
- `gcloud alpha` is not installed and cannot be added without administrator
  rights on `C:\Program Files (x86)\Google\Cloud SDK`. This is moot — the alpha
  commands wrap the same org-restricted IAP API.

**Conclusion:** the consent screen and Web application client are console-only —
confirmed by Google's own [Manage OAuth Clients](https://support.google.com/cloud/answer/15549257)
page, which documents creation solely as a console flow. A Google platform
limitation, not a tooling gap. Everything downstream *is* automatable, and was
automated. The console steps were completed by browser automation instead.

## Remaining holes, in order

1. **Deploy the app bundle.** The browser code (id_token flow, single GoTrue
   client, callback handling) is committed but **not deployed**. The live site
   still serves the old bundle, which uses the broken `signInWithOAuth` code
   exchange and still points at the shared project. Nothing about sign-in works
   for a real user until this ships. Note the site has no Git linkage — merging
   to `main` does **not** deploy; someone must run a manual deploy.
2. **Get the branch to the org remote.** Work is on
   `agent-checkpoints/claude/5075c12e-google-oauth`, pushed only to
   `old-origin` (`lcapece/portabase.dev`). Pushes to `origin`
   (`data-automation-ai/portabase.dev`) were denied twice by the local
   permission classifier; the org PAT itself holds `push: true, admin: true`.
3. **Upload the consent logo** (manual, ~30s): Branding → Browse →
   `public/icons/portabase-consent-120.png`. Free while in Testing.
4. **Decide on publishing status.** The app is in **Testing**, so only listed
   test users can sign in — everyone else gets "Access blocked". Publishing to
   Production is required for real users. See the tradeoff below.
5. **Write a privacy policy and terms page.** Both consent-screen fields are
   empty because `portabase.dev` has no `/privacy` or `/terms` route. Google
   requires a privacy policy to publish an External app.
6. **Run the live proof** (below).

### Publishing tradeoff (a real decision, not a detail)

Google's Branding page states: *"After you upload a logo, you will need to
submit your app for verification unless the app... has a publishing status of
'Testing'."* Portabase requests only non-sensitive scopes (`openid`, `email`,
`profile`), so it can normally publish to Production **without** review — but
**uploading a custom logo triggers brand verification**, which can take days to
weeks, during which the consent screen shows a default.

So: logo **or** fast launch. Removing the logo before publishing is trivial if
speed matters more.

### Migration note — accounts do not come along

Netlify previously pointed at the shared project `ekklokrukxmqlahtonnc`. Any
Portabase Cloud account that already exists there lives in *that* project's
`auth.users` and will **not** exist on `eoiqvdmvgaurlecdzqkp` after cutover.
Pre-launch this is expected to be empty, but it was not verified — confirm
before deploying if any real signups may have occurred.

## Live proof checklist

- [x] **Google account chooser appears, not "Access blocked"** — verified
      2026-08-20 by driving the authorize endpoint directly: it renders
      "Choose an account / to continue to **portabase.dev**". A control request
      with an unregistered redirect URI correctly failed with
      `Error 400: redirect_uri_mismatch`, so the check discriminates.
      (An earlier `curl` probe of the same thing was **discarded** — its
      control passed too, meaning it proved nothing.)
- [ ] Click Google on the deployed `https://portabase.dev/login` (needs the new bundle)
- [ ] Returns to the app with a **valid session** (inspect the user object, not just the UI)
- [ ] `/app` (protected route) loads
- [ ] Sign out clears the session
- [ ] After sign-out, `/app` is denied
- [ ] Popup-blocked path: block popups, confirm the redirect fallback completes
- [ ] Bundle scan: correct client id present, no client secret, no other product's id

**Regression rows for the `detectSessionInUrl: false` flip.** Email confirmation
and password-recovery links also land on `/auth/callback`. Under PKCE they
arrive as `?code=` and `completeOAuthCallback()` handles them — but if the new
project's email templates emit implicit-flow fragments (`#access_token=`), the
handler that used to catch those is now off and `completeOAuthCallback()` will
throw "No session found after auth redirect." These must be proven, not assumed:

- [ ] Email signup confirmation link completes and lands in `/app`
- [ ] Password recovery link completes and allows a password change

Identity is not entitlement — a signed-in user is not a paying one. Cloud
membership must still be checked server-side.

---

## Verified so far (2026-08-20)

- Build passes: `npm run build` → 746.50 kB bundle, no errors.
- Full suite passes: `npm test` → **109/109**, including the 11 new isolation tests.
- Isolation guard **mutation-tested**, 6 seeded regressions, all caught:
  shared project ref reintroduced; client id hardcoded as a literal;
  `detectSessionInUrl` flipped back to true; a foreign product domain leaked in;
  the purpose phrase dropped from the root document; a wrong-size consent logo
  substituted. Baseline restored to 11/11 after each.
- Built bundle contains **no** `GOCSPX-` client secret and **no** foreign
  product domain in auth code. (`ekklokrukxmqlahtonnc`, `svltssnxzqsrxtbjgaex`,
  and `musicsupplies.*` do appear in the bundle — they are console *demo data*
  naming backup **sources**, which is this product's subject matter, not an
  auth binding.)

## Not verified

- Nothing has been tested against a live Google account — the OAuth client does
  not exist yet.
- Email signup confirmation and password recovery have **not** been re-tested
  since `detectSessionInUrl` was set to false. Both land on the same callback
  route this change touches.
- Nothing is deployed. Work sits on branch
  `agent-checkpoints/claude/5075c12e-google-oauth`, pushed to **`old-origin`**
  (`github.com/lcapece/portabase.dev`) only. `origin`
  (`github.com/data-automation-ai/portabase.dev`) rejected the push with 403
  because the cached credential is `lcapece`. The org PAT in `secrets-bundle`
  (`github-dataautomation-ia-pat`, user `data-automation-ai`) **does** hold
  `push: true, admin: true` on that repo — verified via the GitHub API — but the
  push itself was denied twice by the local permission classifier and was not
  retried around. Work reaching the org remote and then `main` is still open.
- `.env.example` changes (`VITE_GOOGLE_OAUTH_CLIENT_ID`, new project URL) are
  **local-only and uncommitted** — that file already carried pre-existing edits,
  so it was deliberately excluded from the checkpoint commit rather than
  entangling two authors' work. It is not crash-safe.
# Portabase site — status

## Definition of Done

A signed-in customer on **https://portabase.dev** connects one Supabase project, saves what the capsule should cover, and queues a **manual** backup. A worker they start (`node cloud/runner/worker.mjs`) pulls that job and runs the free engine with secrets that were already on that machine. The capsule lands in **their** vault. The site shows queued / running / finished and never receives the passphrase, database URL, or capsule bytes.

Not this definition: a managed Portabase server that runs the job for them, a paid schedule, or a green replay. Those stay separate rows until they have live proof.

**This repo is not that yet.** The queue and the pull worker are implemented below. They are not deployed, and no live job has been pulled.

## Capability ledger

Status vocabulary: scaffolded / implemented / deployed / verified / complete. Nothing is complete without live proof.

| Capability | Status | Evidence | Next hole |
|---|---|---|---|
| Square $7 checkout (cloud-7) | implemented (pre-existing) | netlify/functions/cloud-subscribe.mjs | live charge not proven (docs/CLOUD.md) |
| Connect Supabase via PAT (in-request only) | implemented, not live-verified | netlify/functions/cloud-supabase.mjs | live probe with a real PAT |
| List projects | implemented, not live-verified | same | live probe |
| Table + bucket sizes | implemented, not live-verified | netlify/shared/supabase-mgmt.mjs | live probe |
| Pick tables/buckets under cap (UI) | implemented | src/console/connect-supabase.jsx, table-sizer.jsx | browser walkthrough on deploy preview |
| Save selection server-side | implemented, not live-verified | netlify/functions/cloud-selection.mjs | live probe |
| Engine honors selection (--exclude-table-data / --exclude-buckets) | implemented, unit-tested | utility/portabase.mjs, tests/selection-flags.test.mjs | real backup against a test project |
| Managed runner runs saved selection on schedule (1/24h) | scaffolded | cloud/runner/boot.mjs still idles. No scheduler. | Not this slice. Paid schedule is still unbuilt. |
| Manual backup intent + customer worker pull | implemented, not live-verified | netlify/functions/cloud-jobs.mjs claim/finish; cloud/runner/worker.mjs; Connect Supabase "Queue manual backup" | Deploy this branch, sign in, queue one job, run the worker against a real project |
| Incremental binary option | implemented, not live-verified | Whole file only. A greater date stamp is differential and the entire file is fetched. Etag is not the rule. | A second backup where one binary file's date stamp moved forward |
| Deployed to production (deploy-live) | NOT deployed | branch pushed to origin; merged to `main` — Netlify deploys are manual (`netlify deploy --prod`), merge alone ships nothing | manual deploy + live proof |
# Checkout integration verification — 2026-10-04

- Corrected proof semantics: a runner/CLI comparison MATCH now records `comparisonMatched` while retaining `proven: false`. It cannot establish recovery without an isolated restore, read-back checks and critical application flow evidence. Fifteen proof/dashboard tests passed. Authenticated restore-evidence ingestion remains incomplete; no green recovery claim is available from a comparison-only report.
- Dashboard alias/loading/cache fix implemented by UI agent and browser-verified across `/dashboard`, `/app/home`, `/app/overview`, reload and demo. Cached MATCH is cleared when the current server response is unproven; unrelated Account/Alerts/Replay remain reachable.

- Read-only production refresh: Netlify site `794217cc-42ab-4a9f-81da-06a661403573` still publishes deploy `6ab288426450b9689079fdab`. Exact site-scoped Square production location read returns 401 UNAUTHORIZED. No Mailgun/Twilio notification variable names appeared in the checked production function configuration. Provider settings were not changed. Notification integration/release runbook: `docs/NOTIFICATION-OPERATIONS.md`.
- Actual ConsoleApp browser review reproduced stale cached green recovery proof during loading, dashboard503 and subsequent unproven responses across dashboard aliases. Fix and regression verification are in progress; prior dashboard API tests did not establish UI truthfulness.

- Dashboard storage/subscription outages now return explicit 503 rather than empty successful activity; invalid job-store shape also fails closed. Console shows unavailable status and suppresses overview until reload instead of implying no jobs. Two targeted tests and Vite build passed; full ConsoleApp browser outage verification is assigned. Earlier combined suite checkpoint: 482 passed before this dashboard change.
- Verified-contact UI and product-scoped notification transport configuration are implemented locally. Sending requires explicit global/channel flags and Portabase-specific credentials. No production configuration, actual challenge messages, scheduled delivery or provider receipts have been verified.

- Removed legacy unscoped subscription fallback from account, dashboard, selection, checkout and self-refund endpoints. Shared lookup now requires verified provider-scoped identity and matching stored ownership. Twenty-two identity/billing tests passed. Existing legacy records need explicit reconciliation before rollout; no silent cross-provider lookup or live migration performed.

- Verified-contact API route is connected, and the outbox now resolves contacts through the explicit challenge-verification store. Root reran 22 contact/outbox tests. Challenge sending is still unconfigured and fails explicitly; no messages sent.
- Root verified the manifest-sharing browser flow at 1440/390/320px: local preview, explicit consent, shared readback, revocation and error recovery. CLI summary export is available via `export-manifest --capsule <dir> --for-sharing --out <new-file.json>`; three tests include actual CLI execution, file-hash binding and overwrite refusal. This is a summary export, not automatic runner publication.
- Mobile sales work is isolated on local branch `review/mobile-sales-20261004`, commit `2e158ad`, in `.worktrees/mobile-sales`. Seven viewport checks and build passed. No merge or deployment; original diagram and review screenshots are committed there. Requested lcapece remote diverges from this checkout; no unrelated history pushed.

- Authenticated telemetry now enqueues fixed operational notifications through the durable outbox after safe event persistence. Root verified 28 telemetry/outbox tests: duplicate reports deduplicate per channel, private fields and recipient addresses are absent from queue records, and queue outages return 503 with partial persistence disclosed. Default recipient resolver is unset, so production wiring suppresses delivery until verified contacts are connected. No scheduled dispatcher or real delivery proof yet.
- Added manifest-sharing API route; backend consent/upload/revoke implementation is under integration review. Customer UI and private-runner export remain incomplete.

- Integrated live alert preferences UI verified by root through Chromium with intercepted authenticated requests: load/save failure and retry, revision conflict, live versus demo behavior. No real provider messages sent. Full local suite at this checkpoint: 443 passed, zero failures.
- Corrected Supabase claim mapping so phone/account confirmation cannot mark an email verified. Requires `email_confirmed_at`; user metadata is not evidence. Before relying on this for delivery, verify product Confirm Email policy or use an independent email challenge: Supabase auto-confirm can implicitly confirm email. Official semantics: https://supabase.com/docs/guides/auth/users and https://supabase.com/docs/guides/auth/general-configuration.

- Added server-only Mailgun/Twilio delivery adapters with explicit product credentials and fixed TLS endpoints. Acceptance is not delivery; timeouts, malformed success and ambiguous server failures return unknown and must not auto-resend. Three mocked-network adapter tests and three capsule archive/encryption log tests passed. No live messages sent; verified recipients, worker wiring, provider configuration, signed delivery receipts and end-to-end delivery remain incomplete. References: https://www.twilio.com/docs/messaging/api/message-resource and https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-http.

- Runner telemetry now uses the same typed payload projection before cloud transmission and at server ingestion. Cloud requests omit hostname, customer-supplied agent labels, capsule labels and arbitrary payload fields; customer-configured webhooks retain their existing behavior. Network-boundary regression plus telemetry/admission tests: 26 passed. Earlier combined suite: 427 passed, before subsequent changes; not a live proof.
- Runner/job admission enforcement now checks verified paid access and add-on expiry, preserves documented free manual service, and uses conditional writes for concurrency. Runner lifecycle responses explicitly describe unprovisioned metadata and requested state; compute provisioning remains incomplete.

- Added authenticated `/api/cloud/notification-preferences` with opt-out defaults, strict boolean-only input, customer isolation and revision-checked writes to prevent lost consent updates. Seven combined notification tests pass, including concurrent updates and storage outages. API returns `deliveryConfigured: false`; live UI integration is in progress, provider delivery remains unconfigured and undeployed.

- Notification message formatter added with explicit success/failure preferences and fixed operational text. Three local tests verify consent defaults and exclusion of private payloads. Recipient verification, durable delivery queue, email/SMS provider configuration, UI integration and real delivery remain INCOMPLETE; no messages sent.
- Homepage now places the customer-supplied `portabase1.png` immediately below the hero and before case reports. Five responsive viewport checks and build passed; undeployed.
- Private-runner ownership decision requested: customer-owned AWS, attested hosted compute, or ordinary managed hosting with disclosed operator access. Browser-only scheduling cannot meet unattended execution after the browser closes.

- Checkout confirmation now treats HTTP 202 / pending verification as pending, retains the return URL for a reload retry, and announces active access only when the backend returns both successful verification and an active entitlement. Failed verification also preserves the retry URL.
- Local verification: 24 checkout, entitlement security, subscription, and auth configuration tests passed; Vite build passed with the existing bundle-size warning.
- Undeployed. Existing subscription records require provider reconciliation before the stricter entitlement checks are released. Real Square checkout/webhook/renewal/refund proof remains required.
- Live homepage inspection confirmed production still serves the older hero with `supabase-banned.jpg`; the local homepage successfully loads `banned.png` through its WebP source. The committed homepage release remains undeployed.
