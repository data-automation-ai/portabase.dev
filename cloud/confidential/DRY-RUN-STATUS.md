# Confidential recovery checkpoint — 2026-10-25

## Source-object picker update — 2026-10-25

The local trial GUI now loads a source inventory from the attested workload and
lets the operator select table row data by schema, Storage buckets, Auth users,
and Edge Functions. Schema and table definitions remain included. The workload
rechecks selected names against fresh source inventory before capture. Focused GUI,
scope and progress checks passed 9/9 locally. The inventory-capable application
image is built, and controller revision `portabase-confidential-controller-00011-tgt`
serves it. The old validation VM is still stopping; no replacement VM has yet
served a live inventory. No OAuth grants, capture, vault upload or restore have
completed in the current local session.

**INCOMPLETE. This branch is a source checkpoint, not a customer release.**

The previous live validation recorded real Google-signed Intel TDX attestation,
encrypted session commands and rejection of a wrong image digest or substituted
workload key. The isolated admission service recorded persistent quota checks,
anonymous denial, duplicate denial and daily-limit denial. The synthetic source
baseline covered password login, authenticated/anonymous RLS, Storage bytes and
an Edge Function invocation. These observations are narrower than recovery.

On 2026-10-25 the attested Dropbox-capable image built and the controller was
deployed, but the owner has not completed any of the three OAuth grants. No
AWA data has been read, no capsule uploaded, and no restore executed. An earlier
VM passed attestation and rendered the three connection controls. It had a
110-minute application timeout, so it was stopped before any grant. The current
replacement image extends that timeout to 230 minutes and adds source inventory.
Its launch is pending completion of the prior VM shutdown. All connections
remain false.

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

1. Wait for the old validation VM to finish stopping, then confirm the new VM
   and helper are attested to the application digest above. The helper listens
   only on `127.0.0.1:58441`; the VM auto-deletes after four hours.
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
