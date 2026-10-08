# Portabase CLI: capture and recovery scenarios

These examples describe the CLI source in this checkout. The new options are
locally tested, **not yet published or verified against a live recovery target**.
Do not assume an older npm installation supports them. `PROJECT_STATUS.md`
records the remaining release gates.

## What is covered—and what is not

Portabase captures application PostgreSQL schema/data, Auth inventory and
database rows where selected, ordinary Storage **file buckets**, and Edge Function
source. Restoring these layers still requires application-specific verification
of roles/RLS, Auth configuration, secrets, callbacks, jobs, and user flows.

**Supabase Vector Buckets are not supported. Portabase does not inventory,
size, export, transfer, restore, redirect to S3, or verify that separate vector
store.** Its vectors, indexes, and metadata need a separate recovery process.
An ordinary capsule marked `COMPLETE` makes no claim about Vector Buckets.
New manifests explicitly include a `supabase-vector-buckets: NOT_CAPTURED`
exclusion; that marker does not mean the source was scanned for vector buckets.

Supabase describes Vector Buckets as S3-compatible vector storage. Do not describe
them as an Edge Function database: SQL/FDW access does not make their external
payload part of a PostgreSQL dump. This differs from `pgvector` columns actually
stored in ordinary PostgreSQL tables: those rows follow database selection rules,
and restoring them requires the compatible extension on the destination.
Sources: [Vector Buckets](https://supabase.com/docs/guides/storage/vector/introduction)
and [pgvector](https://supabase.com/docs/guides/database/extensions/pgvector).

## Choose a scenario

| Goal | Option | What remains recoverable |
|---|---|---|
| Full capture | `backup` | Supported, enabled service layers |
| All database structures, no database rows | `backup --ddl-only` | DDL; Storage/Functions still follow their own capture settings |
| Omit rows from specific tables | `backup --exclude-table-data public.events,public.logs` | Their DDL plus all other selected table data |
| Only selected tables have rows | `backup --include-table-data public.orders,public.customers` | DDL for all app tables, selected app rows; Auth data is separate |
| Object names/sizes without bytes | `backup --storage-inventory-only` | Object inventory only; **no object-body recovery** |
| Full database into a free account, objects into S3 | `restore --storage-to-s3 ...` | Database in target; captured file objects preserved in S3 |
| A different destination DB name | `restore --target-db-name recovered_app` | Same source tables in the separately named existing database |
| Replace an occupied target DB | `restore --overwrite-target ...` | App schemas and Auth data replaced with explicit rollback gates |
| Reuse unchanged binary downloads | `backup --incremental-binary` | A standalone full capsule; verified local cache saves transfers |
| Store changes relative to a full baseline | `backup --delta --baseline ...` | Requires that exact full baseline plus this delta |

## One-time setup on a cloud runner

All shell examples below are **Bash on a customer-controlled EC2/container
runner**, from the repository checkout. They are not instructions to spool a
production capsule on your Windows workstation. Never use F:. A standalone
customer may deliberately choose their own local path, but that is not the
agent/default proof workflow.

Install Node/dependencies (`npm ci`), matching PostgreSQL client tools (`psql`,
`pg_dump`, `pg_dumpall`), `tar`, Supabase CLI, and AWS CLI v2 on the runner.
Use an instance role or an authorized AWS profile. Keep bucket access private.
Allow enough ephemeral space for SQL dumps, object bytes, encrypted archive,
cache, and—for delta restore—both capsules plus the assembled result.

Copy this block into the runner shell. Prompts collect the actual customer
identifiers; passwords/tokens are hidden rather than placed in shell history.
Use the direct/session database endpoint, not a transaction-pooler connection.

```bash
set -euo pipefail
umask 077
export PORTABASE_REPO="$PWD"
pb() { node "$PORTABASE_REPO/utility/portabase.mjs" "$@"; }
read -r -p 'Source project ref: ' SOURCE_REF
export SOURCE_REF
read -r -p 'Source API URL: ' SUPABASE_URL
export SUPABASE_URL
read -r -s -p 'Source PostgreSQL URL: ' SUPABASE_DB_URL; echo
export SUPABASE_DB_URL
read -r -s -p 'Source service-role/server key: ' SUPABASE_SERVICE_ROLE_KEY; echo
export SUPABASE_SERVICE_ROLE_KEY
read -r -s -p 'Supabase management access token: ' SUPABASE_ACCESS_TOKEN; echo
export SUPABASE_ACCESS_TOKEN
read -r -s -p 'Capsule passphrase (at least 16 characters): ' PORTABASE_ENCRYPTION_PASSPHRASE; echo
export PORTABASE_ENCRYPTION_PASSPHRASE
read -r -p 'AWS region for this customer vault: ' AWS_DEFAULT_REGION
export AWS_DEFAULT_REGION
read -r -p 'Customer capsule vault bucket name (no s3://): ' VAULT_BUCKET
export VAULT_BUCKET
export PORTABASE_RUNNER_ROOT=/var/tmp/portabase
mkdir -p "$PORTABASE_RUNNER_ROOT/tmp" "$PORTABASE_RUNNER_ROOT/evidence"
export TMPDIR="$PORTABASE_RUNNER_ROOT/tmp"
export PORTABASE_EVIDENCE_DIRECTORY="$PORTABASE_RUNNER_ROOT/evidence"
export PORTABASE_CONFIG="$PORTABASE_RUNNER_ROOT/source.json"
node --input-type=module -e '
import { writeFileSync } from "node:fs";
const e = process.env;
writeFileSync(e.PORTABASE_CONFIG, JSON.stringify({
  version: 3, projectRef: e.SOURCE_REF,
  backupDirectory: e.PORTABASE_RUNNER_ROOT + "/capsules",
  statusDirectory: e.PORTABASE_RUNNER_ROOT + "/status",
  provider: { type: "aws", bucket: e.VAULT_BUCKET, prefix: "portabase/" + e.SOURCE_REF },
  capture: { database: true, storage: true, functions: true, auth: true },
  encryption: { passphraseEnv: "PORTABASE_ENCRYPTION_PASSPHRASE" },
  retention: { keepLast: 30, pruneAfterBackup: false }
}, null, 2), { mode: 0o600 });'
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
pb doctor --config "$PORTABASE_CONFIG"
```

Verify the returned AWS account/role against the customer runner and vault
authorization. A cross-account vault needs its own bucket policy. These examples
do not grant permissions or create accounts. Keep the passphrase outside the vault
and normal provider account; retain a separately controlled recovery copy.

## Assess database and object sizes first

The CLI performs read-only inventory; it does not download object bodies:

```bash
pb sizes --config "$PORTABASE_CONFIG"
pb sizes --config "$PORTABASE_CONFIG" --json > "$PORTABASE_RUNNER_ROOT/sizes.json"
```

It reports tables and ordinary file buckets sorted by size, including object
counts. Table sizes include heap/index/TOAST storage; row counts may be estimates.
Object totals come from listing metadata. Check each section for errors; an
unavailable section is **unknown**, not zero. Vector Buckets are excluded.
These are planning inputs, not the compressed capsule size or the final restored
database size. Leave headroom for indexes, extension requirements, temporary work,
and database growth. S3 diversion reduces target **file storage** requirements,
not the size of database rows (including any `bytea` values).

For SQL-level inspection, paste these read-only statements into the source's
authorized SQL client. They change no objects:

```sql
-- Total database footprint, including more than app tables.
SELECT current_database() AS database_name,
       pg_database_size(current_database()) AS bytes,
       pg_size_pretty(pg_database_size(current_database())) AS size;

-- Largest tables, including indexes and TOAST. Platform schemas are visible too.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       pg_size_pretty(pg_indexes_size(c.oid)) AS index_size
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY total_bytes DESC;

-- Ordinary Storage file-object inventory. No payload downloads.
SELECT bucket_id, count(*) AS object_count,
       count(*) FILTER (WHERE metadata->>'size' IS NULL) AS unknown_size_count,
       COALESCE(sum((metadata->>'size')::bigint), 0) AS reported_bytes,
       pg_size_pretty(COALESCE(sum((metadata->>'size')::bigint), 0)) AS reported_size
FROM storage.objects
GROUP BY bucket_id ORDER BY reported_bytes DESC;

-- Largest ordinary objects; names may contain customer information.
SELECT bucket_id, name, (metadata->>'size')::bigint AS reported_bytes
FROM storage.objects
ORDER BY reported_bytes DESC NULLS LAST LIMIT 50;
```

Do not edit `storage.objects` to move or delete files: its rows are metadata;
the bytes reside elsewhere. [Supabase Storage schema](https://supabase.com/docs/guides/storage/schema/design)
explains this distinction. Compare the database and Storage totals separately
against the intended target's **current** plan allowances; no free-plan limit is
hardcoded here. Size the separate Vector Buckets service with its provider tools;
Portabase's output cannot assess it.

## Scenario 1: full baseline capture

```bash
pb backup --config "$PORTABASE_CONFIG" --progress
pb status --config "$PORTABASE_CONFIG"
read -r -p 'Full capsule directory printed by backup: ' FULL_CAPSULE
export FULL_CAPSULE
pb verify --capsule "$FULL_CAPSULE" --decrypt
pb simulate --capsule "$FULL_CAPSULE" --json
```

Expect `COMPLETE` for the supported enabled layers. `PARTIAL` requires investigation.
Checksum/decryption and offline simulation are not live restoration proof. The
vault receives the encrypted capsule; backup staging/cache remain on the runner.

## Scenario 2: all DDL, without database row data

```bash
pb backup --config "$PORTABASE_CONFIG" --ddl-only
```

Expected: `SELECTIVE`; `database/schema.sql` and roles exist, `database/data.sql`
does not. Auth database rows are absent too. Separate Auth inventory may still
contain identity metadata; this is not an anonymization option. Storage bytes
and Function source are still captured unless their own options disable them.

For database structure plus a file inventory, without object bodies:

```bash
pb backup --config "$PORTABASE_CONFIG" --ddl-only --storage-inventory-only
```

## Scenario 3: DDL-only for selected tables

Keep the rest of the data but omit logs and events (replace these example table
names with exact `schema.table` names from `sizes`):

```bash
pb backup --config "$PORTABASE_CONFIG" --exclude-table-data public.logs,public.events
```

Or capture app rows only for orders/customers while retaining every app table's DDL:

```bash
pb backup --config "$PORTABASE_CONFIG" --include-table-data public.orders,public.customers
```

Auth data is not excluded by an application-table allowlist. Foreign keys between
selected and omitted tables may require a broader selection; the tool must not
be treated as proof of application-level referential consistency. Both modes
produce `SELECTIVE` capsules. `--ddl-only` conflicts with `--include-table-data`.

## Scenario 4: inventory objects without shuttling their bytes

```bash
pb backup --config "$PORTABASE_CONFIG" --storage-inventory-only
```

All ordinary objects in selected buckets are listed, including text files as well
as binary files. Each manifest entry includes its name, reported size, source
presence, `includedInCapsule: false`, `payloadLocation: "not-captured"`, and
`omissionReason: "storage-inventory-only"`. Hashes of uncaptured bodies are not
invented. The summary records omitted object count and bytes separately.

This does **not** send the omitted files to S3. They cannot later be recovered
from that capsule. Use a full capture if you want the free-account/S3 recovery
scenario below. PostgreSQL `bytea` values are database row data; this option does
not exclude those values.

To inventory only specific buckets, retaining full database capture:

```bash
pb backup --config "$PORTABASE_CONFIG" --storage-inventory-only --include-buckets avatars,documents
```

Buckets excluded by selection have no per-object inventory. Do not combine
inventory-only mode with trial/first-per-bucket sampling.

## Target setup for scenarios 5–9

Use a dedicated target project/database, never the source. The target database
must already exist and have a compatible Supabase service schema and extensions.
The CLI does not create a Supabase account or initialize a plain PostgreSQL server.
Keep source and target credential sets distinct.

```bash
read -r -p 'Destination project ref: ' PORTABASE_TARGET_PROJECT_REF
export PORTABASE_TARGET_PROJECT_REF
read -r -p 'Destination API URL: ' PORTABASE_TARGET_SUPABASE_URL
export PORTABASE_TARGET_SUPABASE_URL
read -r -s -p 'Destination PostgreSQL URL: ' PORTABASE_TARGET_DB_URL; echo
export PORTABASE_TARGET_DB_URL
read -r -s -p 'Destination service-role/server key: ' PORTABASE_TARGET_SERVICE_ROLE_KEY; echo
export PORTABASE_TARGET_SERVICE_ROLE_KEY
read -r -p 'Recovery capsule directory or s3:// URI: ' CAPSULE
export CAPSULE
```

For a custom database hostname, also supply `--confirm-target-db host:port/name`
on preflight and execution. For hosted direct/pooler URLs, the connection must
match the selected project ref. Confirmation never makes the source a valid
overwrite target.

## Scenario 5: ordinary blank-target recovery

```bash
pb restore --capsule "$CAPSULE"
pb restore --capsule "$CAPSULE" --preflight
pb restore --capsule "$CAPSULE" --execute --confirm-target "$PORTABASE_TARGET_PROJECT_REF"
```

The first command decrypts and reports a plan; it changes no target. Preflight
reads the target. Only the last command writes. Database SQL runs in one
transaction with stop-on-error. Storage and Edge Function operations are separate
services and cannot share that transaction. A later failure can leave the database
restored but the overall recovery failed; use the evidence and rollback plan.

## Scenario 6: free Supabase account + customer S3 objects

Use a full capsule whose database fits the target. The customer chooses an
**existing private S3 bucket**, which may differ from the encrypted capsule vault.
The runner needs bucket inspection and prefix-scoped object upload/read permissions
(including multipart permissions for large objects), plus any applicable policy
requirements. The bucket owner ID is mandatory; cross-account access is allowed
only when configured by that owner.

```bash
read -r -p 'Object recovery S3 URI (s3://bucket/prefix): ' OBJECT_DESTINATION
read -r -p 'Object bucket owner AWS account ID: ' OBJECT_BUCKET_OWNER
pb restore --capsule "$CAPSULE" --preflight \
  --storage-to-s3 "$OBJECT_DESTINATION" --s3-expected-owner "$OBJECT_BUCKET_OWNER"
pb restore --capsule "$CAPSULE" --execute \
  --confirm-target "$PORTABASE_TARGET_PROJECT_REF" \
  --storage-to-s3 "$OBJECT_DESTINATION" --s3-expected-owner "$OBJECT_BUCKET_OWNER"
```

Expected evidence: `DATABASE_RESTORED_OBJECTS_IN_S3` after all selected layers
verify. Captured object bytes are uploaded **before database writes**, streamed
back, and checked against SHA-256 and size. Upload/read failure stops before the
database restore. Preflight checks identity/ownership but cannot prove write
permission without writing. A failed run can leave partial uploads in its unique
run prefix; retain them until reviewed.

The destination layout is:

```text
s3://chosen-bucket/prefix/<capsule-id>/<unique-run-id>/objects/<original-bucket>/<encoded-object-path>
s3://chosen-bucket/prefix/<capsule-id>/<unique-run-id>/storage-s3-mapping.json
```

The verified mapping records original bucket/name, size, checksum, and exact S3
URI. Repeated restores use new prefixes. No public ACL is requested. Uploads use
S3 AES-256 server-side encryption; buckets requiring a customer KMS key are not
supported by this option yet. These restored objects are **not capsule-encrypted**:
authorized S3 readers can access their contents. Keep the mapping private too.

No object is uploaded to the target Supabase Storage API. The database may contain
old object URLs, but they will not automatically work. Either update the app to
serve authorized S3 objects, or later copy them into Supabase using its Storage
API. Portabase currently does not automate that copy-back or URL rewrite. S3
preservation is separate from restored application file access. S3 diversion does
not capture or move Vector Buckets.

To download the verified mapping onto the cloud runner for inspection:

```bash
read -r -p 'Mapping S3 URI printed by restore: ' MAPPING_URI
aws s3 cp "$MAPPING_URI" "$PORTABASE_RUNNER_ROOT/storage-s3-mapping.json" --only-show-errors
```

Do not publish that mapping; object names may identify customers.

## Scenario 7: destination database has a different name

Source and destination database names do not have to match. `--target-db-name`
changes the database component of the **target connection only**; it neither
renames the source nor creates/renames a database on the server. On hosted
Supabase, the normal database is generally `postgres`; a different project
display name/ref is separate from the PostgreSQL database name.

For a customer-controlled compatible target with an existing `recovered_app` DB:

```bash
read -r -p 'Target database hostname: ' TARGET_DB_HOST
read -r -p 'Target database port: ' TARGET_DB_PORT
pb restore --capsule "$CAPSULE" --target-db-name recovered_app --preflight \
  --confirm-target-db "$TARGET_DB_HOST:$TARGET_DB_PORT/recovered_app"
pb restore --capsule "$CAPSULE" --target-db-name recovered_app --execute \
  --confirm-target "$PORTABASE_TARGET_PROJECT_REF" \
  --confirm-target-db "$TARGET_DB_HOST:$TARGET_DB_PORT/recovered_app"
```

The target API must actually serve that same database; a successful direct SQL
connection alone does not prove API routing. Custom AWS service-plane restore
also needs an appropriate Edge Function deployment adapter; the current CLI uses
the hosted Supabase management path for Functions. Do not interpret the name
override as full AWS/self-hosted recovery support.

## Scenario 8: deliberately overwrite an existing target database

**Destructive, opt-in, and not yet live-qualified.** The implemented scope is
`app-and-auth`: replace application schemas and Auth rows while preserving
Supabase's platform schema definitions/migration history. It does not drop/recreate
the whole PostgreSQL database, replace cluster-wide existing role attributes,
clear target Storage, or remove deployed Functions.

Preconditions: stop target writers/jobs, capture the target into a **new complete
full rollback capsule**, restore that rollback capsule into a separate blank
project, and retain successful machine-readable evidence. Use the same sealing
passphrase for recovery and rollback capsules in this implementation. The evidence
must bind the rollback capsule ID and encrypted SHA-256 to the exact target's
source database identity. Older evidence lacking these fields must be regenerated.
The CLI rechecks table counts/row counts and catalog metrics against rollback;
that detects some drift but is **not a content-level proof of zero concurrent
writes**, so writers must remain stopped throughout.

Prepare rollback by using scenario 1 with the occupied target as the **capture
source**, then scenario 5 with a separate blank project as the **drill target**.
Return all source/target environment variables to their intended recovery values
before proceeding. Do not run an ordinary restore over a failed partial restore.

```bash
read -r -p 'Verified full rollback capsule directory: ' ROLLBACK_CAPSULE
read -r -p 'Successful isolated rollback-drill evidence JSON path: ' ROLLBACK_EVIDENCE
read -r -p 'Exact target database identity (host:port/name): ' TARGET_DB_IDENTITY
pb restore --capsule "$CAPSULE" --preflight \
  --overwrite-target --overwrite-scope app-and-auth \
  --confirm-overwrite "$PORTABASE_TARGET_PROJECT_REF" \
  --confirm-target-db "$TARGET_DB_IDENTITY" \
  --rollback-capsule "$ROLLBACK_CAPSULE" --rollback-evidence "$ROLLBACK_EVIDENCE"
```

After reviewing the plan and completing the cloud qualification gates:

```bash
pb restore --capsule "$CAPSULE" --execute \
  --confirm-target "$PORTABASE_TARGET_PROJECT_REF" \
  --overwrite-target --overwrite-scope app-and-auth \
  --confirm-overwrite "$PORTABASE_TARGET_PROJECT_REF" \
  --confirm-target-db "$TARGET_DB_IDENTITY" \
  --rollback-capsule "$ROLLBACK_CAPSULE" --rollback-evidence "$ROLLBACK_EVIDENCE"
```

The database reset and SQL restoration share one transaction; SQL failure rolls
back that transaction. Verification and other service failures after commit need
the rollback capsule. The executable rollback path is scenario 5 into a blank
replacement project, followed by a separately approved application/DNS cutover;
automatic in-place rollback is not implemented.

Overwrite refuses partial/selective capsules, restore plans, the source target,
missing/mismatched rollback evidence, extensions in app schemas, and platform
triggers depending on app functions. Target Functions must be empty. Target
Storage must be empty unless objects are being diverted to S3, in which case
existing target Storage is left alone. These refusals require a reviewed migration
plan, not `--allow-occupied-target`.

For overwrite plus S3 diversion, use:

```bash
pb restore --capsule "$CAPSULE" --preflight \
  --overwrite-target --overwrite-scope app-and-auth \
  --confirm-overwrite "$PORTABASE_TARGET_PROJECT_REF" \
  --confirm-target-db "$TARGET_DB_IDENTITY" \
  --rollback-capsule "$ROLLBACK_CAPSULE" --rollback-evidence "$ROLLBACK_EVIDENCE" \
  --storage-to-s3 "$OBJECT_DESTINATION" --s3-expected-owner "$OBJECT_BUCKET_OWNER"
pb restore --capsule "$CAPSULE" --execute \
  --confirm-target "$PORTABASE_TARGET_PROJECT_REF" \
  --overwrite-target --overwrite-scope app-and-auth \
  --confirm-overwrite "$PORTABASE_TARGET_PROJECT_REF" \
  --confirm-target-db "$TARGET_DB_IDENTITY" \
  --rollback-capsule "$ROLLBACK_CAPSULE" --rollback-evidence "$ROLLBACK_EVIDENCE" \
  --storage-to-s3 "$OBJECT_DESTINATION" --s3-expected-owner "$OBJECT_BUCKET_OWNER"
```

`--allow-occupied-target` is a legacy drill bypass; it is not overwrite. SQL
errors now stop the database transaction even in that mode. Auth-only/app-only
overwrite, live writer fencing, and automatic in-place rollback are not implemented.

## Scenario 9: restore only a subset to fit the target

```bash
pb restore-plan --capsule "$CAPSULE" --output "$PORTABASE_RUNNER_ROOT/restore-plan.json"
```

Edit that JSON on the runner: set unwanted table/bucket/function entries to
`"selected": false`. All application DDL remains; table selection controls data
rows. The plan validates its capsule ID and configured byte budget before writes.
Do not treat its byte count as the target provider's quota calculation.

```bash
pb restore --capsule "$CAPSULE" --restore-plan "$PORTABASE_RUNNER_ROOT/restore-plan.json" --preflight
pb restore --capsule "$CAPSULE" --restore-plan "$PORTABASE_RUNNER_ROOT/restore-plan.json" \
  --execute --confirm-target "$PORTABASE_TARGET_PROJECT_REF"
```

Result: `SELECTIVE_RESTORE_VERIFIED`, never full recovery. When choosing S3
diversion, a plan's existing total budget still includes selected file bytes;
the current planner does not automatically separate database and S3 budgets.
For a full-database/S3 restore, no selective plan is required.

## Scenario 10: incremental binary transfers, standalone full capsules

```bash
pb backup --config "$PORTABASE_CONFIG" --incremental-binary
# Run again after controlled file changes on the source:
pb backup --config "$PORTABASE_CONFIG" --incremental-binary
```

A binary with a newer timestamp is fetched as a **whole file**. With equal/older
timestamps, the previous whole file may be reused only when its cached bytes
verify against the previous SHA-256. Missing/corrupt cache means a full download.
Unknown timestamps also force download. No byte-range patching occurs.
This timestamp policy can miss changes made without advancing a timestamp;
use a normal full capture or delta's metadata comparison for those workloads.
Unchanged non-binary objects use conservative identity/hash-verified cache reuse.
Each non-delta capsule contains its own selected object payloads.

## Scenario 11: full baseline plus delta capsules

```bash
pb backup --config "$PORTABASE_CONFIG"
read -r -p 'New COMPLETE full baseline directory: ' FULL_CAPSULE
pb backup --config "$PORTABASE_CONFIG" --delta --baseline "$FULL_CAPSULE"
read -r -p 'New delta capsule directory: ' DELTA_CAPSULE
pb verify --capsule "$DELTA_CAPSULE" --decrypt
pb restore --capsule "$DELTA_CAPSULE" --baseline "$FULL_CAPSULE"
pb restore --capsule "$DELTA_CAPSULE" --baseline "$FULL_CAPSULE" --preflight
pb restore --capsule "$DELTA_CAPSULE" --baseline "$FULL_CAPSULE" \
  --execute --confirm-target "$PORTABASE_TARGET_PROJECT_REF"
```

This is a **full baseline + differential capsule** design. Each delta references
one full baseline; delta-of-delta chains are refused. Database SQL is still dumped
in full at capture time, then unchanged files are omitted by hash. It is not WAL,
CDC, or row-by-row incremental database backup. Changes to dump output can cause
the whole SQL file to be stored again. Storage reuses matching baseline metadata,
and records deletions. Function/SQL file deletions are recorded too.

Replay requires the exact baseline ID **and manifest checksum**, verifies reused
payloads, overlays changed files, removes tombstones, and uses the current inventory
instead of resurrecting deleted files. A full baseline is required; partial,
sampled, DDL-only, or inventory-only delta capture is refused. Keep the full
baseline for as long as any delta references it; local prune protects it, but
customer S3 lifecycle rules must also preserve it. Baselines already encrypted in
S3 are supported during restore via an `s3://` argument; baseline capture currently
expects a runner directory.

To divert a delta's reconstructed objects to S3, add:

```bash
pb restore --capsule "$DELTA_CAPSULE" --baseline "$FULL_CAPSULE" --execute \
  --confirm-target "$PORTABASE_TARGET_PROJECT_REF" \
  --storage-to-s3 "$OBJECT_DESTINATION" --s3-expected-owner "$OBJECT_BUCKET_OWNER"
```

Standalone `simulate` currently does not assemble a delta chain; use the no-write
`restore --baseline` command above to validate chain assembly. Neither is a live
recovery drill.

## Failure handling and robust operation

| Symptom | Action |
|---|---|
| `SELECTIVE` capture | Intentional omission; inspect selection before assuming recoverability |
| Missing omitted object bytes | Recover from another full capsule/source; inventory cannot recreate bytes |
| Wrong baseline ID/checksum | Supply the exact baseline; never substitute a similarly named capsule |
| S3 owner/access/read-back failure | Correct IAM/region/owner; DB restore has not begun |
| SQL failure | Database transaction rolls back; inspect schema/permissions in a controlled runner |
| Later Function/verification failure | Read evidence; database may already be committed; execute rollback plan |
| Target name mismatch | Correct target connection/name; no source rename is required |
| Unsupported `--fill-missing` / `--writers` | This engine refuses them; old help text advertised unimplemented behavior |
| Vector data absent | Outside product scope; use a separate vector-store recovery procedure |

Release qualification must include cloud tests of DDL-only restore, inventory-only
restore, actual free-account sizing, large/multipart S3 transfers, denied owner/
write/read permissions, corrupt payloads, delta add/change/delete, wrong baseline,
database rename routing, overwrite SQL rollback, RLS denial tests, and post-commit
rollback. Local fixtures validate code decisions; they do not satisfy those gates.

Further CLI hardening priorities: immutable/versioned vault retention; signed
recovery evidence; writer fencing and consistent cross-service snapshots; structured
sanitized SQL diagnostics; bounded retries/timeouts; per-layer resumable restores;
extending strict backup/restore option validation to every command; independent database/S3 quota plans;
and authenticated application-role validation before any cutover.
