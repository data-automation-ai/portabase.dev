# Private runner boundary review

## Local remediation update — 2026-10-04

An additional source audit found the CloudTrail proxy also accepted caller-chosen
roles/external IDs without a server-owned tenant binding. It retrieved raw events
and returned resource names, principals and source IP addresses. That proxy is now
retired in source with fixed HTTP 410 and no request-field reads or AWS calls.
Its account panel directs customers to their own AWS audit history and the safe
runner Telemetry view. No existing provider roles or stored data were changed.
Two endpoint negative tests and rendered checks at 320/1440px pass for both
retired paths, including navigation and zero browser network calls.

The raw CloudWatch proxy has been retired in source. Every non-OPTIONS request
returns HTTP 410 with a fixed explanation; the handler does not read request
credentials, scopes or bodies and contains no AWS log/role calls. The matching
account panel now links to existing safe Telemetry, with no polling or fabricated
log feed. A negative test verifies refusal without reading request fields or
calling fetch; the production build passes. This change is not deployed and does
not delete previously retained logs. Private hosted diagnostic access remains
unimplemented. The other legacy privacy findings below remain release blockers.

The following review records the earlier state; its raw-log finding is superseded
locally by this update, not by verified production behavior.

Reviewed 2026-10-04 on `agent/muse-telemetry-read-api` in the dirty
`data-automation-ai/portabase.dev` checkout. This is a source review and three
synthetic, network-free helper probes. No production accounts, traffic, stored
records, or provider permissions were inspected. No application behavior changed.

## Governing requirement

The current owner decisions in [PROJECT_STATUS.md](../PROJECT_STATUS.md) take
precedence over older security prose: the ordinary backend holds account/billing
records, scheduling intents, deliberately emitted operational telemetry, and
sanitized activity. Credentials, keys, detailed configuration, inventories,
manifests, and diagnostic logs belong inside the private runner and capsule.
Customer-approved manifest snapshots are the explicit sharing exception.

**This boundary is not implemented end to end.** A separate hostname, an encrypted
disk, a URL check, or a boolean seal flag does not establish operator blindness.

## Observed paths and gaps

| Finding | Source evidence | Consequence |
| --- | --- | --- |
| Source PAT crosses the ordinary backend | `src/console/customer-dashboard.jsx` renders `ConnectSupabaseFlow`; `connect-supabase.jsx` calls `fetchSupabaseProjects`/`fetchSupabaseInventory`. `src/lib/cloud-api.js:70` POSTs the token to `/api/cloud/supabase`. `netlify/functions/cloud-supabase.mjs:42` reads it; `netlify/shared/supabase-mgmt.mjs` sends it to the provider. | Backend receives plaintext source credentials even though this handler does not intentionally save or log them. The proxy also receives project names and table/bucket inventory. Request/platform retention is unverified. |
| Private selection is persisted without manifest-sharing consent | `connect-supabase.jsx` sends project name, project ref, excluded table/bucket names and sizes. `netlify/shared/selection-store.mjs:146` retains these fields; `:171` writes `portabase-cloud-selections`, key `sel:v1:{identity}`. `cloud-selection.mjs:33` reads current and legacy identity keys. | A subset of inventory and sensitive selection configuration is stored in plaintext outside the runner. The new manifest consent API does not gate this older path. |
| Job intents carry names and arbitrary text | `connect-supabase.jsx` queues exclusions. `cloud/runner/job-intent.mjs:106` retains exclusions, capsule label and free-form note; `:53` accepts a truncated `safeError` string. `netlify/functions/cloud-jobs.mjs` persists and returns payloads and completion errors in `portabase-cloud-jobs`. | A second copy survives migration of the selection store alone. Secret-pattern rejection is not a safe operational-message allowlist. A synthetic diagnostic containing a private table name is accepted. |
| Main-origin credential and passphrase forms remain | `src/console/supabase-viewer.jsx:26` collects project keys and source login credentials; `src/lib/live-supabase.js:183` optionally writes the project key to main-origin sessionStorage. `src/console/open-capsule.jsx:25` holds a passphrase and fingerprints it locally. Both pages are routed by `ConsoleApp.jsx`. | These are browser-side exposure on the ordinary website, not evidence of backend transmission. Direct source requests still do not satisfy the requirement that sensitive setup originate inside the private runner GUI. All scripts delivered on that origin share its trust boundary. |
| Raw log proxy is outside the required boundary | `netlify/functions/cloud-cloudwatch-live.mjs` fetches raw CloudWatch events, then applies `redact()` before returning message strings and stream names. Provider errors also return `err.message`. `src/console/pages.jsx` exposes the Account CloudWatch panel. | The backend has already received private logs before redaction. Regexes cannot guarantee removal of names, data or unknown credential formats. Actual log contents/retention and active AWS bindings were not checked. |
| CloudWatch ownership is not bound to authenticated identity | The same handler accepts caller-provided `workspaceId`, `secretId`, `logGroupName`, `roleArn`, region and filter; `verifyCloudUser` establishes login but no owner-to-log-group/role lookup constrains these inputs. | **Release stop:** do not enable or claim this live endpoint is tenant-isolated with provider credentials until the authorized scope is derived server-side and denial-tested. AWS permissions may constrain impact; no live exploit or cross-account access was tested. |
| Seal UI is a shape check, not a sealing protocol | `src/console/seal-keys.jsx` only calls `assertRunnerSealUrl`; its success text promises a runner destination/POST. `src/lib/runner-seal.js` builds an envelope from supplied ciphertext without encryption or peer authentication. `cloud/runner/agent.mjs:65` sets `sealedKeysPresent` after checking fields. `cloud/runner/boot.mjs` logs a record; it does not serve the private GUI or a seal endpoint. | Synthetic probes accept both `https://portabase.dev/seal` and plain HTTP at an unrelated runner hostname. These helpers do not prove separate origin, trusted runner identity, successful encryption, possession of keys, persistence, or access revocation. |

The inspected worker (`cloud/runner/worker.mjs`) uses credentials already in its
environment and reports completion rather than posting those credentials. However,
it inherits process stdout/stderr, while the CLI prints names and diagnostics.
Do not attach that stream to ordinary-backend log collection.

## Useful components already present

- `utility/ui/server.mjs` provides a real process-served, read-only inventory GUI:
  loopback binding, launch token, Host/Origin checks, self-only CSP, and no-store
  responses. `utility/portabase.mjs:3003` starts it with `collectUiSnapshot`.
  It currently assumes preconfigured credentials and has no setup, sealing,
  mutation, remote authentication, or persistent-runner lifecycle. Reuse its
  isolation pattern; do not expose its current loopback HTTP server publicly.
- `utility/cloud-telemetry-payload.mjs` projects typed operational fields before
  the CLI's Cloud transmission and again at server ingestion. This is the right
  channel for outer-dashboard health; it is not a raw-log transport.
- Capture lifecycle logs are written under `raw/logs` before archive sealing;
  `utility/portabase.mjs:1755` includes them in the encrypted archive. Later upload
  logs are not included. The CLI also retains resume inventory outside the capsule
  at its runner `statusDirectory`; that private state needs encrypted persistence,
  access controls and retention rules when hosted. No transmission of this resume
  file to Cloud was established by this review.
- `netlify/shared/manifest-sharing.mjs` gates a strict shareable projection by
  owner, current consent revision and exact preview digest. Revocation clears the
  active shared snapshot. `src/console/manifest-sharing.jsx` previews locally;
  `portabase export-manifest --for-sharing` exports a summary without upload.
  This does not authorize the legacy selection/log paths or prove deletion from
  provider backups/version history.

## Smallest compatible migration (proposal)

1. Keep the outer dashboard for account/billing, opaque runner identity,
   schedule/job intents, aggregate usage and emitted health. Add an **Open private
   runner** entry only after a real authenticated private interface exists. Give
   that interface a distinct theme and persistent textual identity.
2. Move source connection, size inspection, selection, restore planning,
   passphrase entry and diagnostics into the runner-served application. Reuse
   `TableSizer` presentation and CLI inventory/restore code without importing the
   main site's API adapters or analytics. Source/provider access originates in
   the runner; credentials never transit the ordinary backend or its proxy.
3. Replace named queue selections with an opaque runner-owned configuration
   revision. The runner resolves names internally. Keep server-authoritative
   entitlement and cost limits; use fixed operation/result codes and bounded
   numeric aggregates. Bind worker claims to the intended registered runner.
4. At the coordinated replacement release, reject source credential/inventory
   bodies at the old proxy and selection endpoints. Stop named job payloads and
   raw-log proxying. Preserve access via the real replacement; hiding old controls
   alone leaves callable APIs. The current review does not disable legacy flows.
5. Inventory existing selection/job/log stores and provider retention through an
   authorized, value-redacted audit. Migrate any needed private configuration
   directly into customer-controlled runner storage; verify it there before
   removing old copies under an explicit retention/deletion plan. Changing code
   does not remove existing records or backups.
6. Report seal state only from a verified protocol: authenticated runner identity,
   pinned key/version or independently verified attestation as appropriate,
   successful encryption/key possession, durable encrypted state, and explicit
   revocation/update behavior. A UI checkbox or ciphertext-shaped string is
   insufficient.

**Recommended fail-closed release boundary:** until the replacement is integrated,
do not release a claim that the ordinary backend receives no confidential source
material. Do not connect the legacy CloudWatch endpoint to privileged log-reader
credentials. A future guard should reject it until a server-owned tenant mapping
exists; private diagnostics should move to the runner, with only fixed safe
activity events left on the dashboard. This is a recommendation, not an applied
behavior change.

## Decisions still needed

| Decision | What it determines |
| --- | --- |
| Browser-only execution, customer-operated runner, or attested hosted runner | Where the private GUI/code executes, who can administer/update it, and whether jobs can run unattended while the browser is closed. Ordinary hosted containers do not supply operator blindness. |
| Key ownership and unattended release | Who can unwrap persistent state, how scheduled jobs obtain keys, and how recovery, subscription expiry and revocation work. |
| Private origin and connection model | Customer DNS/TLS or attested endpoint; runner authentication; browser pairing; update approval; separation from the main site's cookies, scripts and telemetry. A new hostname alone is insufficient. |
| Persistent state and diagnostic retention | Encryption and access controls for credentials, manifests, resume indexes, logs, caches and temporary spool while sleeping and after cancellation. |

Provider choice need not block pure schema/UI separation work, but these decisions
block a truthful final sealing implementation and a production privacy guarantee.
Older `docs/ZERO-KNOWLEDGE.md`, `docs/CLOUD_CONSOLE.md`, `docs/SECURITY-TRUST.md` and
`PROJECT.md` contain absolute claims or main-site credential/log flows that must
be reconciled with the current requirement, not treated as proof.

## Required validation before release

Trace synthetic credentials, inventory markers and diagnostic markers through
the actual private GUI, runner and dashboard. Ordinary backend requests, logs,
stores and compiled public scripts must contain none of those markers except the
exact approved shared projection. Test foreign runner/tenant access, stale pairing,
revoked consent/keys, malicious job fields, direct legacy endpoint calls, unknown
log fields, restart/sleep recovery and code-update/key-release failures. Prove an
isolated capture and restore through the chosen deployed runner. Local schema
tests and a successful frontend build cannot establish these properties.
