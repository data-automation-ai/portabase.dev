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
| `verify --decrypt` | Crypto OK; no new project |
| `restore` dry-run | Plan only |
| **`replay`** | Full path into a **new blank** project |
| Cutover | Your DNS/app switch — separate deliberate step after a green replay |
