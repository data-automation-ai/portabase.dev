# E2E escape test — wired for transmission

**Last update:** 2026-08-07 (sample Escape COMPLETE on 2026-08-06)

## Topology

| Role | Value |
| --- | --- |
| **Source** | `ekklokrukxmqlahtonnc` (DataAutomation) · us-east-1 |
| **Vault** | `s3://dataautomation-ai-backups/portabase/ekklokrukxmqlahtonnc/` |
| **Destination (secrets “whitepaper”)** | `kiuwcdpjsdotkoojbkoi` · eu-west-1 · *not blank — do not replay without wipe* |
| **Config** | `portabase.config.json` (provider aws; gitignored — recreate from env) |
| **Source env** | `.env.portabase.local` (gitignored · from secrets-bundle) |
| **Target env** | `.env.replay-target.local` (gitignored · whitepaper or blank project keys) |
| **Runner script** | `scripts/e2e-escape-test.ps1` |

**Scope reminder:** one **project** per Escape, not the whole Supabase org.

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
| Git push (org write) | `github-dataautomation-ia-pat` (`lcapece` is pull-only on this repo) |
| **Management API (org-wide)** | **`supabase-token`** — verified working 2026-08-12. The `SUPABASE_ACCESS_TOKEN` inside `.env.portabase.local` returns **401**; do not use it. |

## Commands

```powershell
# Doctor + plan only
.\scripts\e2e-escape-test.ps1

# Limited trial escape → S3 (safe size; schema/storage sample trial limits)
.\scripts\e2e-escape-test.ps1 -Trial

# Preferred size-bounded full-path Escape (full DB/Auth/Functions; first object per bucket)
# Load .env.portabase.local first, then:
node utility/portabase.mjs backup --storage-first-per-bucket --progress

# Offline integrity (no Supabase target)
node utility/portabase.mjs simulate --capsule .\portabase-capsules\<id>

# Full Storage escape → S3 (multi‑GB — prefer EC2/container)
.\scripts\e2e-escape-test.ps1 -Full

# Replay (target must be blank)
# Set PORTABASE_TARGET_* from .env.replay-target.local for a blank project
node utility/portabase.mjs replay --capsule .\portabase-capsules\<id> --confirm-target <NEW_REF>
```

## Verified 2026-08-12 — simulate GREEN on gold capsule · replay staged

| Step | Result |
| --- | --- |
| `npm test` | **80 / 80 pass** |
| `simulate` on gold capsule | **OK — 14 / 14 checks passed** (4 warnings, all expected) |
| Bug found + fixed | `simulate` hard-FAILed the functions layer on the **ghost** `generate-image` (404 at source, `captureVia: skipped-missing`). Verifier now separates deliberately-skipped ghosts (WARN, named) from genuine gaps (still FAIL). Commit `179a0b7`. |
| Replay target | `svltssnxzqsrxtbjgaex` (`portabase-replay-proof`) · **ACTIVE_HEALTHY** · us-east-1 |
| Target blank check | **Confirmed blank** — 0 `public` tables · 0 auth users · 0 storage buckets/objects (only platform migration rows) |
| Target Storage API | **200** with secret key |
| Target Auth admin API | **200** with secret key |
| Target env | `.env.replay-target.local` regenerated → now points at the **blank** project (previously pointed at whitepaper `kiuwcdpjsdotkoojbkoi`, which is **not** blank) |
| `psql` | 18.4 present locally |
| **Connection route** | **Session pooler REQUIRED.** `db.svltssnxzqsrxtbjgaex.supabase.co` is **IPv6-only** (no A record) and this machine has **no IPv6 route** (`ping -6` = 100% loss). Use `postgres.svltssnxzqsrxtbjgaex@aws-0-us-east-1.pooler.supabase.com:5432` (session, port 5432 — **not** transaction 6543). |
| **Capsule DB size** | **891.3 MB** `data.sql` · 614 tables with data (largest: `public.order_history_lcmd` 142.5 MB, `musicsupplies.order_history_lcmd` 132.7 MB). **Does NOT fit a 500 MB free-tier target** → full replay needs a paid/larger target, or use `--restore-plan` and accept `SELECTIVE_RESTORE_VERIFIED` instead of full green. |
| **Blocker** | **Target DB password.** Management API exposes no reset endpoint (`config/database/*` → 404); dashboard-only action. Everything else for replay is staged. |

**Credential note:** `.env.portabase.local`'s `SUPABASE_ACCESS_TOKEN` is **unauthorized** against the Management API (401). The bundle's `supabase-token` **is** org-scoped and works — use that one.

**To finish:** dashboard → `portabase-replay-proof` → Settings → Database → Reset database password → set `PORTABASE_TARGET_DB_URL` in `.env.replay-target.local` (direct `db.<ref>.supabase.co:5432`, **not** the pooler) → then:

```powershell
node utility/portabase.mjs replay --capsule .\portabase-capsules\ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z --confirm-target svltssnxzqsrxtbjgaex
```

---

## Verified 2026-08-06 — sample Escape COMPLETE

| Step | Result |
| --- | --- |
| Mode | `--storage-first-per-bucket` (not `--trial`) |
| Database | **Full** data dump · inventory FP `4845d671…` · 588 tables |
| Storage | **12 / 15 973** objects (first per non-empty bucket) · source FP `4b943fa4…` · sample/capsule FP `4fd76ac4…` · **match** |
| Functions | **232** complete · FP `89503fbf…` (stale `generate-image` skipped) |
| Auth | **19** users · FP `be3797a7…` |
| Capsule status | **COMPLETE** · ~262 MB encrypted · ~7.3 min · S3 **verified** |
| Capsule id | `ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z` |

```
s3://dataautomation-ai-backups/portabase/ekklokrukxmqlahtonnc/ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z/
```

Local mirror (gitignored): `portabase-capsules/ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z/`

Same day earlier: PARTIAL `…15-35-27.337Z` (Functions Management API **502**). Prefer COMPLETE id above.

## Verified 2026-08-04 (historical)

| Step | Result |
| --- | --- |
| `doctor` | **PASS** (source + AWS S3) |
| S3 write probe | **OK** `dataautomation-ai-backups/portabase/…` |
| Trial escape | **PARTIAL** capsule on S3 (`…T22-02-44.037Z`) — Functions Management API **403** at the time |
| Whitepaper blank? | **No** — replay refuses until wiped or a new blank project is used |

## Before green replay

1. Use a **blank** Supabase project as target (**not** whitepaper unless intentionally emptied).  
2. Prefer **`simulate`** on the COMPLETE capsule first.  
3. For multi‑GB full Storage escape, run on **EC2/container** (no F:, no laptop thrash).  
4. Functions: intermittent **502** or stale **404** names — 404s skip; 502s need retry.

## Related

- `docs/HANDOFF.md` §9 — proof status  
- `docs/REPLAY.md` — sample mode + fingerprints + simulate tiers  
