# Confidential recovery checkpoint — 2026-10-25

**INCOMPLETE. This branch is a source checkpoint, not a customer release.**

The previous live validation recorded real Google-signed Intel TDX attestation,
encrypted session commands and rejection of a wrong image digest or substituted
workload key. The isolated admission service recorded persistent quota checks,
anonymous denial, duplicate denial and daily-limit denial. The synthetic source
baseline covered password login, authenticated/anonymous RLS, Storage bytes and
an Edge Function invocation. These observations are narrower than recovery.

On this push turn, the local helper's `/status` endpoint reported
`awaiting_oauth`, both connections false, and no backup or restore executed.
The owner has approved both displayed Supabase OAuth grants. The remaining
step is to complete the grants, not to request approval again.

## Bound targets

- Google project: `portabase-dev`, number `495102144848`, `us-central1`.
- Product Auth: `eoiqvdmvgaurlecdzqkp`.
- Synthetic source: `uloqvqdkeiwvnnnfdvrc`, `portabase-confidential-source`.
- Synthetic target: `jmqjsyyyhhwvkbqexxog`, `portabase-confidential-target`.
- Candidate application: `sha256:70ab9d63d32db4beb3206f21bd67de0128a508a966a9915050a8d0382545076b`.
- Candidate controller: `sha256:08223327cda7cfea430945a1359d509b12258026a17b6a094838fefdda930815`.
- Admission is pinned to an isolated Netlify draft, not the production website.

## Next validation steps

1. Recheck the expiring helper and VM before reuse. The helper listens only on
   `127.0.0.1:58441`; the test VM auto-deletes after two hours.
2. Complete both approved grants for Portabase Confidential Recovery in capece.
   Supabase rejects HTTP loopback redirects, so the test uses the registered
   HTTPS callback with a controlled handoff to the local verifier. Never print
   the callback code. The public GUI callback remains unimplemented.
3. Require exact source/target selection, blank target and size preflight.
   The helper's guarded `/execute` action requires the exact target ref and
   `syntheticOnly: true`; it does not run automatically after OAuth.
4. Run capture and restore, then verify target login, RLS, exact object bytes,
   functions, row invariants and source preservation independently.
5. Implement and verify customer-owned vault delivery. The current engine job
   defaults to cloud-local capsule storage; it is not off-site recovery proof.

The independently distributed verifier, customer-controlled image approvals,
long-running OAuth refresh, hosted GUI flow, durable customer capsule delivery
and a full recovery drill remain release gates. A successful push changes none
of those live-proof requirements.
