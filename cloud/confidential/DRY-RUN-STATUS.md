# Confidential recovery checkpoint — 2026-10-25

## Source-object picker update — 2026-10-25

The local trial GUI now loads a source inventory from the attested workload and
lets the operator select table row data by schema, Storage buckets, Auth users,
and Edge Functions. Schema and table definitions remain included. The workload
rechecks selected names against fresh source inventory before capture. Focused GUI,
scope and progress checks passed 9/9 locally. The running VM still has the
previous application digest; the new inventory operation is not live until the
isolated image is rebuilt and rolled forward. No OAuth grants, capture, vault
upload or restore have completed in the current local session.

**INCOMPLETE. This branch is a source checkpoint, not a customer release.**

The previous live validation recorded real Google-signed Intel TDX attestation,
encrypted session commands and rejection of a wrong image digest or substituted
workload key. The isolated admission service recorded persistent quota checks,
anonymous denial, duplicate denial and daily-limit denial. The synthetic source
baseline covered password login, authenticated/anonymous RLS, Storage bytes and
an Edge Function invocation. These observations are narrower than recovery.

On 2026-10-25 the attested Dropbox-capable image built and the controller was
deployed, but the owner has not completed any of the three OAuth grants. No
AWA data has been read, no capsule uploaded, and no restore executed. The
first new VM passed attestation and rendered all three controls. It had a
110-minute application timeout, so it was stopped before any grant. The
replacement image extends that timeout to 230 minutes. At 18:37 UTC the fresh
VM passed attestation for the pinned digest, and the local page rendered all
three controls with the run button blocked. All connections remained false.

## Bound targets

- Google project: `portabase-dev`, number `495102144848`, `us-central1`.
- Product Auth: `eoiqvdmvgaurlecdzqkp`.
- Synthetic source: `uloqvqdkeiwvnnnfdvrc`, `portabase-confidential-source`.
- Synthetic target: `jmqjsyyyhhwvkbqexxog`, `portabase-confidential-target`.
- Candidate application: `sha256:c8637913f9adb74cce420d41521ada5769d77d639d4be467f8b4483c4eb14621`.
- Candidate controller: `sha256:2c4beb01f9e9d5a9f58a74a98ad6728481e4ab66879c57723e9ccad95970bf4e`.
- Controller revision: `portabase-confidential-controller-00010-8sr`.
- Admission draft: `6ade48b63705dca0f83861da`, 25 GiB cap only for the isolated validation identity and three bounded starts per 24 hours. The production admission path returned 404 during a read-only quota probe.
- Google OAuth secret version 3 adds the existing public Dropbox app ID while preserving the prior Supabase OAuth fields. Previous version 2 is the rollback.

## Next validation steps

1. Confirm the new VM and helper are attested to the application digest above.
   The helper listens only on `127.0.0.1:58441`; the VM auto-deletes after four hours.
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
