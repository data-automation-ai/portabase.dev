# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project versions the **engine and site** together (`package.json`).

## Unreleased

### Added

- Community GitHub surface: contributing guide, code of conduct, issue/PR templates, CI workflow
- Landing capsule board (backup vs Escape) and sealed-case visuals
- Cloud: least-privilege key-custody copy; SMS kill phrase `REVOKE KEY`
- Cloud: self-serve 7-day money-back (`POST /api/cloud/self-refund`) closes the account
- `replay` now sets `--execute` on the argv slice `hasFlag` actually reads

### Fixed

- Documented `portabase replay --confirm-target` could print success without writing

## 0.4.0

- Open-core engine: capture, encrypt, verify, restore, replay, simulate
- `--storage-first-per-bucket` Escape sample
- Restore plans for selective restore
- Portabase Cloud console and Square trial SKUs ($17 / $27)
