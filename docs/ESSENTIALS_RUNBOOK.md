# Portabase Essentials runbook

## What the package does

Portabase Essentials runs entirely on a customer-controlled Windows, macOS, or Linux machine. It captures the hosted Postgres database (including Auth and Storage metadata), Storage object bytes, and downloadable Edge Function source. It packages those materials into a timestamped archive, encrypts the archive locally with AES-256-GCM, transfers it to the customer's destination, and verifies the destination copy.

Portabase never receives the Supabase credentials, destination credentials, encryption passphrase, or capsule contents.

## Prerequisites

- Node.js 20 or newer
- PostgreSQL client tools (`pg_dump`, `pg_dumpall`, and `psql`) for Docker-free database capture and restore
- `rclone` for Google Drive, Dropbox, or another remote
- A Supabase database connection string, project URL, service-role/secret key, and optional personal access token for Edge Functions
- An encryption passphrase of at least 16 characters stored separately from the backup destination

The included Supabase CLI is pinned by `package-lock.json`. It is used for Edge Functions and can fall back for database dumping where its Docker dependency is available.

## Local Starter (no S3 / Dropbox yet)

If you have **no third-party storage**, keep encrypted capsules on a folder you control (this PC, USB drive, or NAS path):

```json
"provider": {
  "type": "local",
  "mode": "local-starter",
  "path": "./portabase-capsules/vault",
  "maxBytes": 104857600,
  "allowLargeLocal": false
}
```

- Default size gate: **100 MB** per encrypted capsule folder.
- Larger only with `allowLargeLocal: true` or `backup --allow-large-local` (you accept same-disk risk).
- Passphrase still never goes to Portabase. Capsules are still encrypted at rest on disk.
- When you can, switch to Dropbox or S3 — Escape from Supabase is not Escape from laptop loss.

See also `utility/portabase.config.local-starter.example.json`.

## Configure Drive or Dropbox

Authorize the customer's provider directly with `rclone config`. Portabase stores only the non-secret remote name and destination path:

```json
{
  "provider": {
    "type": "google-drive",
    "remote": "gdrive",
    "path": "/Portabase"
  }
}
```

Use `"type": "dropbox"` and the customer's Dropbox remote name for Dropbox. Portabase uses `rclone copy --immutable --checksum`, never mirror/delete sync semantics, and follows the upload with `rclone check`.

## Set credentials without writing them into the config

```powershell
$env:SUPABASE_DB_URL = 'postgresql://...'
$env:SUPABASE_URL = 'https://PROJECT_REF.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '...'
$env:SUPABASE_ACCESS_TOKEN = '...'
$env:PORTABASE_ENCRYPTION_PASSPHRASE = 'use-a-long-customer-owned-passphrase'
```

`SUPABASE_URL` may also be copied as a `/rest/v1` or `/storage/v1` endpoint; Portabase normalizes it to the project base URL. New `sb_secret_` keys are sent only as the `apikey` header, while legacy JWT service-role keys also receive the required Bearer header.

If a direct database hostname exposes only IPv6 and the runner has no IPv6 route, use the project's IPv4-compatible Supabase session-pooler connection string from the Connect panel. Transaction-pooler URLs are not appropriate for every dump/restore operation.

## Prove readiness before scheduling

```powershell
npm run portabase -- doctor
npm run portabase -- plan
npm run portabase -- backup
npm run portabase -- status
npm run portabase -- verify --capsule .\portabase-capsules\CAPSULE_NAME --decrypt
npm run portabase -- restore --capsule .\portabase-capsules\CAPSULE_NAME
```

`doctor` performs an authenticated read, not merely an environment-variable presence check. `backup` reports `PARTIAL` if any requested layer is unavailable. `verify --decrypt` checks the outer file hashes, AES-GCM authentication tag, encrypted payload hash, and decrypted payload hash. `restore` is a no-write plan unless the execution guards are supplied.

## Schedule on Windows

First make the required values available to the scheduled user's environment. Then preview and install the task:

```powershell
npm run portabase -- install-schedule --every-hours 6
npm run portabase -- install-schedule --every-hours 6 --execute
```

The generated wrapper contains paths only, never credentials. A direct customer-owned webhook can be configured with `alerts.webhookEnv`; Portabase posts status directly to that URL without an intermediary service.

## Retention

Retention recognizes only timestamped capsule directories for the configured project. Preview is always the default:

```powershell
npm run portabase -- prune --keep 30
npm run portabase -- prune --keep 30 --execute
```

The current Essentials command prunes the local capsule cache. Provider-side lifecycle/trash/version behavior remains visible in the customer's own Drive or Dropbox account. Remote destructive pruning is deliberately not automatic.

## Recovery guardrails

Recovery execution requires all of the following:

1. `PORTABASE_TARGET_PROJECT_REF` names a project different from the source.
2. `PORTABASE_TARGET_SUPABASE_URL` contains that exact target project ref.
3. Target database and service credentials are present locally.
4. `--execute` is supplied.
5. `--confirm-target` exactly equals the target ref.

Portabase then restores roles/schema/data, recreates Storage buckets and objects, and deploys captured Functions. It does not claim to export provider secrets, Auth provider settings/templates, new project API keys, custom domains, DNS, or every platform setting. Those items remain on the explicit post-restore checklist.

## Proof completed in this repository

On July 12, 2026, the utility completed a read-only capture against the isolated `redshift-whitepapers` Supabase sandbox. Database, Storage, and two Edge Functions were marked ready; the capsule was encrypted, copied to a separate local destination, checksum-verified, authenticated-decrypted, and opened as a dry-run restore plan. No restore or target write was performed.
