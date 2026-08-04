# E2E escape test — wired for transmission

**Last setup:** 2026-08-04

## Topology

| Role | Value |
| --- | --- |
| **Source** | `ekklokrukxmqlahtonnc` (DataAutomation) · us-east-1 |
| **Vault** | `s3://dataautomation-ai-backups/portabase/ekklokrukxmqlahtonnc/` |
| **Destination (secrets “whitepaper”)** | `kiuwcdpjsdotkoojbkoi` · eu-west-1 · *redshift-whitepapers@proton.me's Project* |
| **Config** | `portabase.config.json` (provider aws) |
| **Source env** | `.env.portabase.local` (gitignored · from secrets-bundle) |
| **Target env** | `.env.replay-target.local` (gitignored · whitepaper keys · **eu-west-1 pooler**) |
| **Runner script** | `scripts/e2e-escape-test.ps1` |

## Secrets map (AWS `secrets-bundle`)

| Use | Bundle key |
| --- | --- |
| Source project id | `supabase-project-id` |
| Source service role | `supabase-service-role-key` |
| Source DB password | `supabase-db-password` |
| Source access token | `supabase-token` |
| Whitepaper project id | `supabase-redshiftwhitepapers-project-id` |
| Whitepaper secret | `supabase-redshiftwhitepapers-secret-key` |
| Whitepaper DB password | `supabase-redshiftwhitepapers-database-password` |
| Whitepaper access token | `supbase-redshiftwhitepapers-acccess-token` (typo preserved in bundle) |

## Commands

```powershell
# Doctor + plan only
.\scripts\e2e-escape-test.ps1

# Limited trial escape → S3 (safe size)
.\scripts\e2e-escape-test.ps1 -Trial

# Full escape → S3 (can be multi‑GB Storage — prefer EC2)
.\scripts\e2e-escape-test.ps1 -Full

# Replay (target must be blank)
.\scripts\e2e-escape-test.ps1 -Trial -Replay
```

## Verified 2026-08-04

| Step | Result |
| --- | --- |
| `doctor` | **PASS** (source + AWS S3) |
| S3 write probe | **OK** `dataautomation-ai-backups/portabase/…` |
| Trial escape | **PARTIAL** capsule on S3 (`…T22-02-44.037Z`) — Functions Management API **403** (token privileges); DB/storage trial path completed; destination **verified** |
| Whitepaper DB | **Connected** via `aws-0-eu-west-1.pooler.supabase.com` |
| Whitepaper blank? | **No** — ~6 public tables, 7 auth users, **4** Storage buckets → **replay will refuse** until wiped or a new blank project is used |

## Before green replay

1. Use a **blank** Supabase project as target, **or** empty whitepaper (dangerous if production data).
2. Fix Functions capture privileges on the **source** PAT (Management API 403).
3. For multi‑GB full escape, run on **EC2/container** (no F:, no laptop thrash).

## Capsule on S3 (trial)

```
s3://dataautomation-ai-backups/portabase/ekklokrukxmqlahtonnc/ekklokrukxmqlahtonnc-2026-08-04T22-02-44.037Z/
```

Local mirror: `portabase-capsules/ekklokrukxmqlahtonnc-2026-08-04T22-02-44.037Z/`
