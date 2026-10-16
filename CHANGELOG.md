# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project versions the **engine and site** together (`package.json`).

## 0.4.1 — 2026-10-15

### Added

- Native direct HTTPS connectors for **Dropbox API v2** (with 4 MB block SHA-256 `content_hash` verification) and **Google Drive API v3** (with folder hierarchy resolution and server-computed `sha256Checksum` verification) in `utility/cloud-storage-connectors.mjs` and the Cloud Console `DestinationsPage`
- Unattended GUI restore (`POST /api/cloud/unattended-restore` and Console `RestoresPage`) with full CLI recovery evidence parity (`SELECTIVE_RESTORE_VERIFIED` / `RESTORE_VERIFIED`)
- Promo code engine (`netlify/shared/promo-codes.mjs`, `/api/cloud/promo-codes`, `/api/cloud/redeem-test-promo`) and customer signup simulation for unattended E2E verification
- Legacy `ESZIP` Edge Function bundle extraction (`sourcesContent` TypeScript recovery) during function replay in `utility/function-replay-workspace.mjs`
- Single-query XML database row inventory (`query_to_xml`) and exact `data.sql` `COPY` row counting for selective restore verification
- Community GitHub surface: contributing guide, code of conduct, issue/PR templates, CI workflow
- Cloud: self-serve 8-day money-back (`POST /api/cloud/self-refund`) and Square `$7/mo` (`cloud-7`) and `$17/mo` (`cloud-17`) catalog variations

### Fixed

- Fixed Unicode `\u2028` / `\u2029` line-splitting in `data.sql` `COPY` blocks with `readAsciiSqlLines` and streaming split-row rejoining
- Fixed quoted table names starting with digits (e.g. `"public"."2fa"`) in `COPY` filtering and selected-table readback
- Excluded platform-managed schemas (`cron`, `dbdev`, `net`, `pgmq`) from `data.sql` row filtering and `setval` sequences
- Added explicit `files` whitelist in `package.json` reducing the published npm tarball from 76.2 MB to 270 kB

## 0.4.0

- Open-core engine: capture, encrypt, verify, restore, replay, simulate
- `--storage-first-per-bucket` Escape sample
- Restore plans for selective restore
- Portabase Cloud console and Square trial SKUs

