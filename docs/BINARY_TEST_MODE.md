# Binary backup test mode

## Why

In this project, **~99.9% of DR byte volume is binary** (DB dumps, `.bak` files, AMI `.bin` images). A JSON inventory export does not exercise that path. Full production binary copies (tens to hundreds of GiB) are too slow for day-to-day validation.

**Test mode** runs the **same transfer + verify pipeline** with **small synthetic binary fixtures**.

## Recommendation

| Profile | What it creates | When to use |
| --- | --- | --- |
| **Tiny** (default) | 64 KiB + 1 MiB + 8 MiB | Every script change; CI-like smoke |
| **Medium** | Tiny + 64 MiB | Before trusting multi-MB Dropbox transfers |
| **DiskSim** | Medium + **1 GiB** single file | Simulates a “small disk image” **without** creating EBS |
| **EbsSmoke** | DiskSim + optional real 1 GiB volume → snapshot | Rare AWS snapshot-path proof only |

**Prefer DiskSim over a real 1 GiB EBS volume** for routine tests:

- Same large single-object upload/download/hash behavior
- No EBS cost, no wait-for-snapshot, no leftover volumes
- Use `-CreateEbsVolume` only when you must prove `create-volume` / `create-snapshot` / tags

## Commands

```powershell
# Fast smoke (recommended default)
.\scripts\test-binary-backup-mode.ps1

# Or via production exporter entrypoint
.\scripts\export-aws-binary-backups-to-dropbox.ps1 -TestMode

# 1 GiB disk-like blob through Dropbox
.\scripts\test-binary-backup-mode.ps1 -Profile DiskSim

# Also write fixtures to the S3 export bucket
.\scripts\test-binary-backup-mode.ps1 -Profile Tiny -AlsoS3

# Rare: real 1 GiB EBS + snapshot (tagged PortabaseTestMode=true)
.\scripts\test-binary-backup-mode.ps1 -Profile EbsSmoke -CreateEbsVolume
```

## What it proves

1. Dropbox OAuth from `secrets-bundle` works  
2. rclone copy **upload** of binary objects works  
3. rclone copy **download** works  
4. **SHA-256** of each fixture matches after round-trip  
5. Optional: S3 put path for export bucket  
6. Optional: EBS 1 GiB volume + snapshot lifecycle  

## Interactive production pick (real binaries)

For real dumps/images, do **not** export every historical backup by default. Use the visual picker:

```powershell
.\scripts\export-binary-backups-interactive.ps1
```

What the user gets:

1. Scan of known S3 backup buckets  
2. Grouping into **series** (same path pattern; dates stripped)  
3. **Only the most recent object per series is offered by default**  
4. **Out-GridView** multi-select — see label, size, modified time, “most recent” flag  
5. Printed confirmation list → type **YES** to upload  
6. Copies only chosen objects to Dropbox under `…/picked/<timestamp>/`

Optional:

```powershell
# Also offer latest CAPECE + Combo AMI disk images (large)
.\scripts\export-binary-backups-interactive.ps1 -AlsoAmiImages

# Show full history in the grid (you still pick; most recent still labeled)
.\scripts\export-binary-backups-interactive.ps1 -IncludeAllInSeries

# Dry run through confirmation only
.\scripts\export-binary-backups-interactive.ps1 -WhatIf
```

## What test mode does **not** replace

- Production dump buckets (`dbasebackups`, etc.) — use the interactive picker  
- Most-recent AMI `create-store-image-task` (~100–200+ GiB each) — opt-in via `-AlsoAmiImages`  
- Live restore drills into a disposable Supabase project  

## Output location

```text
Dropbox: /AWS-Binary-Backups/<accountId>/binary-test-mode/<Profile>/<timestamp>/
  fixture-*.bin
  BINARY_TEST_MANIFEST.json
  README.md
```

Manifest `result` is `PASS` or `FAIL`. Exit code `2` on failure.
