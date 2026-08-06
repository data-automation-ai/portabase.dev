# Portabase Replay — validate capsule on a new account

**Replay** proves a recovery capsule works by restoring it into a **new, blank Supabase project** (a new org/account is fine). The source project is never written.

This is the same safety model as guarded `restore --execute`, with clearer validation framing.

## What it validates

1. Capsule decrypts (AES-256-GCM) and checksums pass  
2. Target ref ≠ source ref  
3. Target is blank (no app tables / Auth users / Storage / Functions)  
4. Layers restore into the new project  
5. Read-back proof + recovery evidence status  

## CLI

```bash
# Target = NEW project only
export PORTABASE_ENCRYPTION_PASSPHRASE='…'
export PORTABASE_TARGET_PROJECT_REF='newprojectref0000001'
export PORTABASE_TARGET_SUPABASE_URL='https://newprojectref0000001.supabase.co'
export PORTABASE_TARGET_SERVICE_ROLE_KEY='…'
export PORTABASE_TARGET_DB_URL='postgresql://…'
export SUPABASE_ACCESS_TOKEN='…'   # for Edge Functions deploy

# Optional no-write check
portabase replay --capsule ./portabase-capsules/<id> --confirm-target newprojectref0000001 --preflight

# Full validation write into the new project
portabase replay --capsule ./portabase-capsules/<id> --confirm-target newprojectref0000001
```

`--confirm-target` must **exactly** match `PORTABASE_TARGET_PROJECT_REF`.

## Cloud console

**Replay** nav → **New replay**:

- Pick a COMPLETE capsule  
- Enter the **new** 20-char project ref twice  
- Ack: not source + blank target  
- Track step timeline; copy agent CLI  

Cloud stores only refs, capsule id, and step status — never target service keys.

## Not the same as

| Action | Meaning |
| --- | --- |
| `verify` | Outer file checksums only |
| `verify --decrypt` | Crypto OK (auth tag); no unpack / layer inventory |
| **`simulate`** | **Offline:** decrypt + unpack + match layers to manifest · **no Supabase target** |
| `restore` dry-run | Plan only (still needs passphrase; no writes) |
| `replay --preflight` | Live blank-target check; no writes |
| **`replay`** | Full path into a **new blank** project |
| Cutover | Your DNS/app switch — separate deliberate step after a green replay |

## Size-bounded full-path capture (`--storage-first-per-bucket`)

When you want **full** database, Auth, and Edge Functions but Storage would blow a multi‑GB budget:

```bash
portabase backup --storage-first-per-bucket
# or in config: "capture": { "storageSample": "first-per-bucket" }
```

| Layer | Captured |
| --- | --- |
| Database | **Full** (schema + data) |
| Auth | **Full** (as always captured) |
| Edge Functions | **All** function source |
| Storage | **Every bucket**, but only the **first object** in each (empty buckets still listed) |

Source inventory (all object counts/bytes) is still recorded in the capsule for honesty. Capsule status is COMPLETE for layers, with `storage.limited` + limitation text.

Use this for under‑5 GB path proof; full object inventory still requires a normal `backup` without the flag.

## Offline simulate (no destination)

When you have a capsule but **no blank Supabase project yet**, prove integrity locally:

```bash
export PORTABASE_ENCRYPTION_PASSPHRASE='…'
portabase simulate --capsule ./portabase-capsules/<id>
# or
node utility/portabase.mjs simulate --capsule ./portabase-capsules/<id>
```

What it checks:

1. Outer `checksums.sha256`  
2. AES-256-GCM decrypt of `capsule.pbase`  
3. Unpack of compressed archive  
4. Outer `capsule.json` vs inner `manifest.json` (id, project ref, status)  
5. Each layer (database / storage / functions / auth): complete flag + expected files / object hashes  
6. Warns on TRIAL / PARTIAL and source-inventory vs in-capsule Storage size  

What it does **not** do: create a project, run `psql`, upload Storage, or deploy Functions. Those need **`replay`** against a blank target.
