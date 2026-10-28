# Isolated recovery proof harness

`isolated-recovery-proof.mjs` is operator-only and must not be bundled into a browser or runner image. Default `plan` reads Google Secret Manager metadata only; it does not start a VM, access secret payloads or run a data job. The old `customer-dry-run-session.mjs` is not used.

```powershell
node cloud/confidential/isolated-recovery-proof.mjs plan
```

After reviewing and deploying the image that includes the `session.open.expectedSelection` guard, pass its exact independently reviewed digest. The explicit `inspect` action can start a billed runner and writes encrypted profile versions to the existing approved Google secret. It performs no backup or restore. It reads credentials into process memory, releases them only after verified Google Intel TDX attestation, and persists each returned sealed profile with readback before any subsequent provider command. It emits only fixed errors, counts, connection booleans and approved fixture identifiers.

```powershell
node cloud/confidential/isolated-recovery-proof.mjs inspect --digest=sha256:<reviewed-64-hex-digest> --identity=6f454f7b-b490-4fe9-9c49-48ce5b6f4408 --source=uloqvqdkeiwvnnnfdvrc --target=jmqjsyyyhhwvkbqexxog --start-runner=yes
```

Only one operator may use this fixture profile at a time. The helper detects changed secret versions before and after persistence; it is not a distributed lock. Do not run the legacy loopback helper concurrently. Do not retry a profile persistence failure by blindly launching another session. Preserve the original process for recovery and review the saved encrypted version first. Runner lifecycle/termination remains under the controller and operator; the harness does not delete VMs.

By default the profile must already bind exactly the two approved project references. Missing or different selections fail before automatic catalog/provider access. Do not bypass that failure by changing the expected references. Both provider grants must authorize the approved project, and provider identity or the previously supplied distinct-account confirmation must pass. This harness does not mint tokens, initiate new OAuth consent, fabricate account emails or acknowledge an unsaved recovery key.

### Explicit fixture selection repair

After reviewing and deploying the image with the rebind option, append `--rebind-fixture=yes` to the **inspect** command above to repair this synthetic fixture's saved selection. The option is forbidden for `plan` or `proof`. It is still constrained to the exact validation identity and approved source/target; it cannot select arbitrary customer projects. The keyholder sends the explicit new selection through the attested encrypted channel. The enclave validates distinct project references, rejects the protected product-auth target, updates only the selection, discards stale batch mappings and preserves connections and all other profile fields.

Rebinding defers all automatic vault/catalog reads. Neither the old selected project nor its catalog namespace is accessed during opening. The helper first prints the original immutable encrypted Secret Manager version number, creation time and state as its recovery checkpoint; it never prints its payload, tokens or recovery key. It adds a new encrypted version and verifies durable readback before querying provider grants or the approved source inventory. Original secret versions are never overwritten, disabled or deleted. The subsequent read-only project and preflight checks can still reject revoked grants, missing project access or unconfirmed account separation. Repairing selection does not confer provider access and does not run capture or restore.

An `attestation_verified` metadata event is emitted only when the verifier supplied fresh checked evidence. That event can precede a workload-level selection rejection; an unverified transport or attestation failure cannot produce it. The signed attestation token and workload keys are not printed.

The explicit `proof` action performs one durable capture and one restore into the still-blank approved target:

```powershell
node cloud/confidential/isolated-recovery-proof.mjs proof --digest=sha256:<reviewed-64-hex-digest> --identity=6f454f7b-b490-4fe9-9c49-48ce5b6f4408 --source=uloqvqdkeiwvnnnfdvrc --target=jmqjsyyyhhwvkbqexxog --start-runner=yes --vault=s3 --confirm-scope=synthetic-drill-v1
```

`--vault=dropbox` is also supported when its saved grant is valid. S3 follows the actual hosted protocol: `backup.start` uses `vault: 'dropbox'` with `vaultProvider: 's3'`; the first field selects the durable workflow and the second selects the provider. No access keys are passed on the command line. The fixture scope is exactly `public.portabase_drill_items`, bucket `portabase-drill-private`, one Auth fixture user and one fixture Edge Function. Changed table/bucket inventory or counts stop proof. Source table/schema definitions are included by the existing engine. The harness checks target blankness twice and never permits overwrite.

Capture must report complete and durable vault verification before restore starts. The restore uses the actual newly returned job ID, never a guessed or fallback capsule ID. A successful result explicitly reports `independentRecoveryDrill: false`: a subsequent fresh-VM vault fetch/restore and independent row/login/RLS/object/function comparisons remain separate proof. Local tests do not demonstrate cloud delivery.

## Read-only investigation, 2026-10-28

- Validation secret version 1, encrypted profile version 502 (created 10:23:19Z), and OAuth configuration version 3 were ENABLED. Payloads were not accessed during investigation.
- Approved source was ACTIVE_HEALTHY with one application table, one Auth user, one Storage object and one Edge Function. Approved target was ACTIVE_HEALTHY and blank in all four categories.
- No loopback helper was running on port 58441. The new harness has not been executed against cloud services.
- Existing refresh grants can be reused inside the enclave; fresh human OAuth consent is not inherently required. Whether this saved profile contains usable grants and approved selections remains unknown until attested opening. Missing/revoked source, destination or vault grants require consent only for the affected connection; an absent distinct-account confirmation requires the actual account emails from the owner, not invented values.
