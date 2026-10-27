# Confidential recovery checkpoint — 2026-10-25

## Live validation update — 2026-10-26

- Controller revision `portabase-confidential-controller-00013-4t8` now pins application image `sha256:67cce210194ed821da572ae11ddf1e0b0bb8acd8efeda7582e9066ba6c4b9426` for the isolated validation identity. The earlier `sha256:f01cfb2cf2010983b07f705e4b88f8f3bc7c43bf618aaad39c90ca1cffc76a31` digest is the rollback value.
- Local helper `http://127.0.0.1:58441/` returned HTTP 200 and displayed the saved Source grant, separate Destination OAuth link, Source object picker placeholder, Dropbox panel, and Google Cloud attestation image digest. Destination and Dropbox remain disconnected. No backup or restore ran.
- Supabase Management OAuth did not disclose the signed-in account through `GET /v1/profile` for this grant. Source and Destination grants use separate PKCE exchanges; Destination instructions require a private browser session. A manual two-email confirmation is required before preflight when provider identity is unavailable. This confirmation is user supplied, not independently verified by Supabase.
- The validation runner start counter was cleared by compare-and-set only after checking that the isolated identity had zero run reservations and no VM. A new VM was then started; no customer data job was triggered.
- The displayed Google Cloud label and pinned workload digest are factual provider identification and attestation evidence. No Google Cloud logo or endorsement claim is present.

**INCOMPLETE:** Destination OAuth, separate-account confirmation, Dropbox OAuth, selected source inventory, blank-target preflight, capture, restore, and data comparison still require live proof.

## Source-object picker update — 2026-10-25

The local trial GUI now loads a source inventory from the attested workload and
lets the operator select table row data by schema, Storage buckets, Auth users,
and Edge Functions. Schema and table definitions remain included. The workload
rechecks selected names against fresh source inventory before capture. Focused GUI,
scope and progress checks passed 9/9 locally. The inventory-capable application
image is built, and controller revision `portabase-confidential-controller-00011-tgt`
serves it. A replacement TDX VM is running, and the local client verified its
Google-signed attestation against the pinned application digest. The local
screen shows the object-picker panel before login; live tables and buckets
appear after source OAuth and project selection. No OAuth grants, capture, vault
upload or restore have completed in the current local session.

**INCOMPLETE. This branch is a source checkpoint, not a customer release.**

The previous live validation recorded real Google-signed Intel TDX attestation,
encrypted session commands and rejection of a wrong image digest or substituted
workload key. The isolated admission service recorded persistent quota checks,
anonymous denial, duplicate denial and daily-limit denial. The synthetic source
baseline covered password login, authenticated/anonymous RLS, Storage bytes and
an Edge Function invocation. These observations are narrower than recovery.

On 2026-10-25 the attested Dropbox-capable image built and the controller was
deployed. Three earlier starts on the synthetic validation account had no
backup or restore runs; their timestamps are preserved in the ignored local
evidence record. The validation-only start counter was cleared with a
compare-and-set update after confirming no run and no VM existed. The current
replacement VM is running and the client verified the pinned digest. All three
OAuth connections remain false. No AWA data has been read, no capsule uploaded,
and no restore executed.

## Bound targets

- Google project: `portabase-dev`, number `495102144848`, `us-central1`.
- Product Auth: `eoiqvdmvgaurlecdzqkp`.
- Synthetic source: `uloqvqdkeiwvnnnfdvrc`, `portabase-confidential-source`.
- Synthetic target: `jmqjsyyyhhwvkbqexxog`, `portabase-confidential-target`.
- Candidate application: `sha256:f01cfb2cf2010983b07f705e4b88f8f3bc7c43bf618aaad39c90ca1cffc76a31`.
- Controller image: `sha256:73339126383e9da470c8380d1ef5978d02b62bbd6dcb1c2592e1459f45341ad3`.
- Controller revision: `portabase-confidential-controller-00011-tgt` (100% traffic).
- Admission draft: `6ade48b63705dca0f83861da`, 25 GiB cap only for the isolated validation identity and three bounded starts per 24 hours. The production admission path returned 404 during a read-only quota probe.
- Google OAuth secret version 3 adds the existing public Dropbox app ID while preserving the prior Supabase OAuth fields. Previous version 2 is the rollback.

## Next validation steps

1. Open the active local helper at `http://127.0.0.1:58441/`. It listens only
   on loopback; the attested VM auto-deletes after four hours.
2. Complete both approved Supabase grants for Portabase Confidential Recovery.
   Supabase rejects HTTP loopback redirects, so the test uses the registered
   HTTPS callback with a controlled handoff to the local verifier. Never print
   the callback code. The public GUI callback remains unimplemented.
3. Complete Dropbox OAuth in the same local page using Dropbox's displayed
   authorization code. The code is exchanged inside the attested VM. The
   encrypted capsule must upload to Dropbox and verify its returned content
   hashes before restore starts.
4. Require exact source/target selection, blank target and size preflight.
   The helper's guarded `/execute` action requires the exact target ref and
   `syntheticOnly: true`; it does not run automatically after OAuth.
5. Run capture and restore, then verify target login, RLS, exact object bytes,
   functions, row invariants and source preservation independently.
6. Verify the Dropbox capsule can be fetched and restored independently after
   the temporary VM is deleted. Upload hash verification alone is not a full
   disaster-recovery drill.

The independently distributed verifier, customer-controlled image approvals,
long-running OAuth refresh, hosted GUI flow, durable customer capsule delivery
and a full recovery drill remain release gates. A successful push changes none
of those live-proof requirements.

## 2026-10-26 local trial update

The earlier connection and image details above are historical. The loopback
helper currently reports both Supabase OAuth grants connected, but Supabase did
not disclose both account identities. Separate account confirmation is still
required; Destination may have reused the Source browser login. Dropbox is not
connected. The isolated `portabase-confidential-source` project is selected;
its inventory returned one application table and one Storage bucket. The
picker's existing table and bucket selection form submitted successfully
through the live loopback helper. No capsule capture or restore has started.

Commit `6411a5e` moves Source project selection into the object picker and
groups objects as project → default `postgres` database → schemas → tables,
with Storage, Auth, and Edge Functions alongside. The source and destination
OAuth grants remain separate. This code was pushed to the feature branch and
copied to the helper snapshot, but the helper process was not restarted after
this final layout edit, so the new hierarchy is not yet live-proven. The older
grouped picker remains visible at `http://127.0.0.1:58441/`. The original
multi-project picker in `cloud/runner/cloud-run-server.mjs` remains intact;
its three-way object modes and sorting are not implemented in this confidential
trial. The current capture and restore engine supports one Source project and
one Destination project per job and only the Source project's default database.
