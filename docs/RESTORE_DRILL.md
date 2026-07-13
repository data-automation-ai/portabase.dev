# PortaBase fresh-project restore drill

This drill is the minimum proof required before PortaBase describes a capsule as recovery-tested. A successful upload, checksum, or authenticated decryption is necessary, but it is not a successful recovery.

## Safety boundary

- Use a newly created, disposable Supabase project as the destination.
- Never use the source project as the destination. PortaBase already refuses matching project refs.
- Before any write, confirm that the destination has no non-system tables, Storage objects, Auth users, or deployed Functions.
- Record the source ref, destination ref, capsule ID, start time, finish time, and operator.
- Do not point an application or DNS at the drill project.
- Deleting the disposable project after evidence is captured is a separate, explicit action.

The existing `musicsupplies-dr-test-20260710` project is **not** a valid target. A read-only inspection on July 13, 2026 found extensive application schemas and deployed Functions there. Do not restore PortaBase test data into it.

## Small fixture

Use a deliberately understandable workload:

| Layer | Fixture | Required proof after restore |
| --- | --- | --- |
| Database | `customers`, `orders`, and `order_items`; 3, 4, and 7 rows | Exact row counts, primary keys, foreign keys, one aggregate total, and a deterministic content hash match |
| Auth | One test user marked `portabase_restore_drill` | User exists by ID/email; no real customer identity is used |
| Storage | Two private buckets with six small objects, including text, JSON, and image bytes | Bucket settings, object paths, sizes, MIME types, and SHA-256 hashes match |
| Functions | `drill-health` and `drill-order-total` | Both are ACTIVE; health invocation succeeds; order-total returns the restored aggregate |
| Configuration | Generated recovery checklist | Unexportable Auth provider settings, secrets, API keys, custom domains, Realtime settings, and DNS remain explicitly NOT VERIFIED until handled |

## Execution gates

1. Create a fresh Supabase project and wait for `ACTIVE_HEALTHY`.
2. Run a read-only emptiness preflight against the destination. Abort if any user workload exists.
3. Seed the fixture into the isolated source sandbox.
4. Capture a new capsule with all requested layers marked `COMPLETE`.
5. Run `verify --decrypt`; require checksum, AES-GCM authentication, and plaintext hash success.
6. Run `restore` without `--execute`; archive the dry-run plan.
7. Set the five target variables only for the disposable project:
   - `PORTABASE_TARGET_PROJECT_REF`
   - `PORTABASE_TARGET_SUPABASE_URL`
   - `PORTABASE_TARGET_SERVICE_ROLE_KEY`
   - `PORTABASE_TARGET_DB_URL`
   - `SUPABASE_ACCESS_TOKEN`
8. Run `restore --preflight`. PortaBase must report zero application tables, zero Auth users, zero Storage buckets, and zero Edge Functions. This step does not write.
9. Confirm the destination ref twice: once in the environment and once with `--confirm-target <NEW_REF>`.
10. Execute the restore. PortaBase repeats the blank-target inventory immediately before the first write.
11. Run the read-only acceptance checks below and save the results with the capsule evidence.

## Acceptance checks

The drill passes only when all of these are true:

- The restore command exits successfully and the source project was never written to.
- All three fixture tables exist with exact row counts.
- Primary and foreign-key constraints exist and no orphaned order rows are found.
- The deterministic order total matches the source.
- The tagged Auth test user exists in the destination.
- Both Storage buckets exist and all six object hashes match the source manifest.
- Both Edge Functions are ACTIVE.
- `drill-health` returns a successful response from the destination project.
- `drill-order-total` returns the same aggregate computed from the restored rows.
- Every provider setting that PortaBase cannot export remains visibly listed as manual—not silently marked green.
- The report records recovery point age (RPO), elapsed restore time (RTO), and every warning.

Any mismatch is a failed drill. Do not soften it to “partial success” in marketing copy.

## Verified live drill — July 13, 2026

The full drill passed against a newly provisioned, blank Supabase project. PortaBase captured and independently decrypted a 61 MB encrypted capsule, paused only the synthetic source after verification, provisioned a distinct target, proved the target was empty, executed the guarded restore, ran acceptance checks, paused the disposable target, and returned the source to `ACTIVE_HEALTHY`.

The verified recovery included:

- database schema, constraints, policies, triggers, views, functions, and more than 1.77 million table rows from the complete source workload;
- the fixture's exact 3 customers, 4 orders, 7 line items, zero orphan rows, and `$516.90` aggregate;
- one tagged synthetic Auth user;
- two private Storage buckets and six objects with matching paths, sizes, MIME types, and hashes;
- four deployed Edge Functions, including successful HTTP 200 probes of `drill-health` and `drill-order-total`;
- an evidence result of `RECOVERY_DATA_PATH_VERIFIED`.

The test also proved the failure controls. An earlier partial target was never reused, a malformed schema export failed closed before being described as recovered, an interrupted SSL database export never paused the source, and a later clean run completed after the exporter gained bounded retries that discard partial dump files.

This result proves the automated data recovery path. It does not turn provider-owned configuration into a false promise: Auth provider credentials and templates, newly issued project/API keys, external secrets, custom domains, Realtime settings, and DNS/application cutover still require guided manual intervention.
