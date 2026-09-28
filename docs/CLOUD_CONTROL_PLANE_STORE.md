# Cloud control-plane store (engineer spec)

Two persistence layers. No third store.

| Layer | Role | What it holds |
| --- | --- | --- |
| **Hosted Supabase** | **Primary** | Control-plane rows for Portabase Cloud |
| **One on-disk SQLite file** | **Replica + live fallback** | The same essentials, plus a local outbox |

Louis rejected a two-store *family* (persistent sqlite + ephemeral / `:memory:` / tmp sqlite). This module opens **one** persistent `.db` file. It does not open `:memory:`, `file::memory:`, or a throwaway second sqlite.

Netlify Functions have ephemeral disk. They must **not** host this file. Run it on a control-plane host with durable storage (the dedicated Cloud box when that stack exists). Do not apply infra from this document.

## What is stored

Essentials only:

- `subscribers`
- `promo_codes`
- `billing_metadata` (Square customer / subscription ids, trial / period timestamps, price cents)
- `jobs` (type, status, project ref label, capsule **hash**)
- `capsule_hashes` (hex digest + algorithm)

Local-only (sqlite, never pushed as a primary table):

- `sync_outbox` — writes accepted while Supabase is down
- `replica_meta` — schema version and last replicate / sync / backup timestamps

SQL for the primary: [`supabase/cloud/0003_essentials.sql`](../supabase/cloud/0003_essentials.sql).  
SQLite schema: [`cloud/control-plane/schema.sql`](../cloud/control-plane/schema.sql).

`0001_control_plane.sql` / `0002_subscriptions.sql` remain the broader tenancy / SPA-era tables. This store does not invent a second product; it is the fallback path for the Cloud control plane.

## What is never stored

Not in Supabase. Not in sqlite.

- Customer Supabase keys (`service_role`, `sb_secret_`, postgres URLs)
- Encryption passphrases or private keys
- Capsule bytes, `.pbase`, dumps, Storage object bodies
- Card PANs / CVV / payment tokens

Writes are allowlisted per collection. Unknown columns and secret-shaped keys or values are rejected before either layer is updated.

## Primary project

The write dest is the **Portabase Cloud** hosted project (the portabase.dev control-plane project when it exists).

`ekklokrukxmqlahtonnc` is a live business source for other work. This module refuses that project ref as `PORTABASE_CLOUD_SUPABASE_URL`. Do not live-pull production projects from here.

## Runtime behavior

```text
read:   try Supabase → on success, refresh sqlite → return
        on primary down or error → read sqlite

write:  validate → write sqlite
        if primary up: write Supabase
        if primary down or write fails: append sync_outbox

replicate:  if outbox pending, sync-back first
            then copy each essential table Supabase → sqlite

sync-back:  replay sync_outbox to Supabase; drop applied rows
```

If Supabase is unavailable, Cloud control-plane reads **and** writes continue on the sqlite file. Queued writes apply when the primary returns.

## File location

Required: `PORTABASE_CLOUD_SQLITE_PATH` (absolute path to the `.db`).

No default to `:memory:` or `/tmp`. The opener refuses empty paths, memory URIs, and `F:` / `/mnt/f`.

Intended host path (when the control-plane box exists): `/var/lib/portabase-cloud/control-plane.db`.

WAL is enabled on that one database (`control-plane.db` plus SQLite's own `-wal` / `-shm`). That is still one database, not a second store.

## Backup

Single-file copy of the `.db` (`VACUUM INTO`, so WAL is folded in).

On demand:

```bash
export PORTABASE_CLOUD_SQLITE_PATH=/var/lib/portabase-cloud/control-plane.db
node cloud/control-plane/cli.mjs backup --dest /var/lib/portabase-cloud/backups/control-plane.db
```

On a schedule (process stays up), or cron / systemd timer calling the same command:

```bash
node cloud/control-plane/cli.mjs schedule --dest /var/lib/portabase-cloud/backups/ --every 86400
# or
0 3 * * * PORTABASE_CLOUD_SQLITE_PATH=... node /opt/portabase-cloud/app/cloud/control-plane/cli.mjs backup --dest /var/lib/portabase-cloud/backups/
```

Other commands: `open` (create/open + counts), `replicate`, `sync`.

## Env

| Variable | Purpose |
| --- | --- |
| `PORTABASE_CLOUD_SQLITE_PATH` | Persistent replica file |
| `PORTABASE_CLOUD_SUPABASE_URL` | Portabase Cloud project URL |
| `PORTABASE_CLOUD_SUPABASE_SERVICE_KEY` | Server-side primary access; process env only, never written to sqlite |

## Code

| File | Role |
| --- | --- |
| `cloud/control-plane/sqlite-file.mjs` | Open/create the persistent file + schema |
| `cloud/control-plane/store.mjs` | Read/write, fallback, outbox, replicate, sync, backup |
| `cloud/control-plane/supabase-primary.mjs` | Hosted primary adapter |
| `cloud/control-plane/backup.mjs` | File copy + schedule helper |
| `cloud/control-plane/forbidden.mjs` | Allowlist + secret/capsule reject |
| `cloud/control-plane/cli.mjs` | Operator commands |

Tests: `tests/cloud-control-plane-replica.test.mjs`. They use a real on-disk file and an in-process primary double (not a second sqlite).

This path is not proven-green in production. Do not treat unit tests as a live outage drill.
