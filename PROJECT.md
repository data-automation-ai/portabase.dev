# Portabase — what this project is and what you must do

**Audience:** Any new AI (Claude, etc.) or engineer taking over.  
**Also read:** `docs/HANDOFF.md` (detail) · `AGENTS.md` (hard rules).

---

## One sentence / USP

**USP: Escape.** Portabase is **your Supabase Escape** — open-core recovery that encrypts a restorable copy of a customer’s project **outside** Supabase (including Storage bytes and Edge Functions platform DB backups leave behind), and sells **Portabase Cloud** (this website) as **GUI, easy configuration, and telemetry** so the Escape keeps running — while the **capsule vault stays customer-owned**.

---

## The problem it solves

If a Supabase account is banned, billing-locked, or otherwise unreachable, the business can lose **app + Auth + Storage + Functions + provider backups** behind one door. Portabase keeps a **customer-owned escape path**.

Owner motivation is personal (long Supabase lockout / billing dispute experience). Marketing site tells that story. Product must stay **honest** and **operationally reliable**.

---

## Two products in one repo

| Product | What it is | Who runs capture |
| --- | --- | --- |
| **Community (OSS)** | CLI engine + optional desktop | Customer (or their VM) |
| **Portabase Cloud (paid)** | Netlify SPA + functions + Supabase Auth + Square | **Portabase managed runners** (target state) |

| | Staging (temp disk) | Final vault |
| --- | --- | --- |
| **Cloud (sold)** | Portabase EC2/container | Customer BYO S3 / Dropbox |
| **Standalone** | Customer local **or** their cloud | Customer choice |

**Never sell:** “You must stage multi‑GB on your laptop C: drive.”  
**Never claim:** managed Cloud means Portabase can *never* see a key (residual risk during job — see Security).

---

## What a backup is (technical)

| Layer | Form |
| --- | --- |
| Database | **Logical** SQL via `pg_dump` / `pg_dumpall` (roles, schema, data) — not physical basebackup |
| Storage | **Real object bytes** from Supabase Storage |
| Functions | Source code (+ Management API fallback) |
| At rest | Encrypted capsule (`.pbase` + manifest + checksums) on **customer** storage |

Proof of integrity = **backup → vault → `replay` into a NEW blank Supabase project** (never the source).  
Doc: `docs/REPLAY.md`.

---

## Stack (site + Cloud API)

```text
React 19 + Vite 8  →  Netlify static (dist/)
                   →  Netlify Functions (/api/*)
                   →  Hosted Supabase Auth + control-plane DB
                   →  Square billing
                   →  optional AWS (S3 vault, Trail, CloudWatch, runners)
```

| Area | Location |
| --- | --- |
| Marketing + routes | `src/main.jsx` |
| Auth pages | `src/auth-pages.jsx` |
| Cloud console | `src/console/` → `/app` · demo `/app?demo=1` |
| CLI engine | `utility/portabase.mjs` |
| Pricing constants | `src/lib/product.js` + `netlify/shared/product.mjs` |
| Launch auth flag | `src/lib/cloud-versions.js` (`AWS_CLOUD_VERSION_ENABLED = false`) |

Live: **https://portabase.dev**

---

## Commercial rules (current)

| Rule | Value |
| --- | --- |
| Payment | Square |
| Daily Escape | **$17/mo** · 1 escape / 24h |
| Triple Escape | **$27/mo** · up to 3 escapes / day |
| Included | **1 backup cycle per 24 hours** |
| (no à-la-carte extras) | Choose $17 or $27 plan only |
| Agents | Up to **12** |
| SMS | On **success** and **failure** at run time |
| Trial | 7 days, card required |
| Launch platform | **Supabase only** (DB/Auth/Storage/Functions) |
| Identity | **Supabase Auth** only (Cognito off) |
| Vault | Customer BYO — Portabase does not host capsule bytes long-term |

---

## Security posture (public)

Page: `/security` · Doc: `docs/SECURITY-TRUST.md`

- Options: Trust Portabase · customer KMS · CloudTrail · CloudWatch live (secret-scoped) · mix  
- **Up front:** on managed Cloud there is still a **possibility Portabase can see/use key material** during a job  
- Zero vendor key path → **standalone OSS only**  
- Console: Account → CloudWatch live / CloudTrail live  

---

## HARD RULES for any AI working here

1. **NEVER write any file to the F: drive.**  
2. **Do not** use the operator workstation as multi‑GB spool unless user **explicitly** names a path.  
3. **Default spool:** EC2 or container (cloud ephemeral disk).  
4. **Vault:** S3 or Dropbox — not “the laptop is the backup.”  
5. **Hosted Supabase** default; self-hosted deprecated.  
6. Prefer **short answers**; no multi-minute silent tool loops.  
7. **Stop immediately** when user says stop.  
8. Be **honest** about keys, limits, and incomplete proof work.  
9. Do not force-push or destroy shared state without confirmation.

Details: `AGENTS.md` · global `C:\Users\ryanh\.grok\AGENTS.md`.

---

## Owner’s priority right now

**Prove the product:**

1. ~~Backup Supabase project **`ekklokrukxmqlahtonnc`** → S3~~ — **DONE** (sample Escape COMPLETE 2026-08-06)  
2. **`portabase replay`** into a **new blank** Supabase project — **still open**  
3. Optional later: full multi‑GB Storage Escape on **EC2/container**  

| Item | Value |
| --- | --- |
| Source | `ekklokrukxmqlahtonnc` (**project**-scoped, not whole org) |
| S3 prefix | `s3://dataautomation-ai-backups/portabase/ekklokrukxmqlahtonnc/` |
| Gold capsule | `…2026-08-06T16-33-17.909Z` — first-per-bucket Storage sample · **COMPLETE** · S3 verified |
| Replay target | Need **blank** project (`svltssnxzqsrxtbjgaex` may exist — re-verify; whitepaper is **not** blank) |
| E2E status | **Backup path green (sampled Storage).** **Replay not green yet.** |
| **Queue rule** | Full Storage spool → **EC2/container** — never F:; no workstation thrash |

Detail: `docs/HANDOFF.md` §9 · `docs/E2E-ESCAPE-TEST.md`.

---

## What works / what doesn’t yet

### In good shape (code present)

- Marketing site + open-core narrative  
- Supabase-only Cloud launch flag  
- Console shell (demo mode)  
- Billing constants + SMS management UI (demo)  
- Cycle pricing model in product constants  
- CLI capture / restore / **replay** / **simulate**  
- **`--storage-first-per-bucket`** Escape + inventory fingerprints (DB/Auth/Functions/Storage)  
- Parallel Storage downloads + Node tar.gz packer  
- Security page + trust docs  
- Netlify cloud function scaffolding (auth, subscribe, audit, CloudWatch live)  
- Live **COMPLETE** sample capsule on S3 (2026-08-06)

### Incomplete / fragile

- **Green live `replay`** of the COMPLETE capsule into a blank project  
- Full multi‑GB Storage download proof on cloud runner  
- Managed runner **actually** spooling in ECS/EC2 for product  
- Dropbox **OAuth + token** productized in console  
- Square **extra-cycle** SKUs live  
- Real SMS provider send path  

---

## How you should work (new AI checklist)

### First hour

1. Read **this file** + `docs/HANDOFF.md` + `AGENTS.md`.  
2. `git status` / `git log` — prefer clean tree on `main`; use org PAT if push 403 as `lcapece`.  
3. Confirm you will **not** write to F: or start multi‑GB local backup without explicit ask.  
4. Ask owner: next priority = **blank replay**, **full Storage cloud proof**, **Dropbox**, or **billing**?

### If owner wants “make it work” (proof)

1. Prefer **`simulate`** on gold capsule, then **replay** to a **blank** target.  
2. For full Storage: provision **EC2 or container** with Node, `pg_dump`, AWS CLI, disk for ~15–30 GB.  
3. Inject secrets from operator process (secrets-bundle / env) — never commit.  
4. Or re-run sample: `backup --storage-first-per-bucket` → S3.  
4. Ensure blank target project → `replay --confirm-target <NEW_REF>`.  
5. Report COMPLETE/PARTIAL/FAILED with capsule path and S3 URI — no silent multi-hour loops without status lines.

### If owner wants product features

- Prefer docs + small vertical slices.  
- Keep `product.js` / `product.mjs` in sync.  
- Marketing claims must match engine behavior.

### If owner says stop

**Stop all processes and tools immediately.** Do not “just finish the backup.”

---

## Key paths (copy-paste)

```text
Repo:     C:\Users\ryanh\git\portabase.dev
Handoff:  docs/HANDOFF.md
Rules:    AGENTS.md
Engine:   utility/portabase.mjs
Site:     src/main.jsx
Console:  src/console/
API:      netlify/functions/
Product:  src/lib/product.js
Launch:   src/lib/cloud-versions.js
```

```powershell
cd C:\Users\ryanh\git\portabase.dev
npm install
npm run dev          # site
npm run build
npm test
npm run portabase -- doctor
```

---

## Related docs (full list)

| Doc | Topic |
| --- | --- |
| `docs/HANDOFF.md` | Deep handoff, pitfalls, git, next build list |
| `docs/PRODUCT_SPEC.md` | Product definition |
| `docs/LAUNCH-SCOPE.md` | Supabase-only, Cloud vs standalone staging |
| `docs/OPEN_CORE.md` | Open core vs paid |
| `docs/SECURITY-TRUST.md` | Keys, KMS, Trail, CW, honesty |
| `docs/BILLING.md` | $17, cycles, SMS |
| `docs/REPLAY.md` | Proof restore to new project |
| `docs/CLOUD_CONSOLE.md` | Console IA |
| `docs/CLOUD_INFRASTRUCTURE.md` | AWS control plane sketch |
| `docs/AUTH_AND_TRIAL.md` | Auth + trial |
| `docs/ESSENTIALS_RUNBOOK.md` | CLI operator runbook |

---

## Entity / accounts (operator)

- **Legal:** DataAutomation.ai, LLC  
- **GitHub org:** DataAutomation-ai  
- **AWS:** `899867382621`  
- **Preferred Supabase ops project:** `ekklokrukxmqlahtonnc`  

Secrets live in AWS Secrets Manager `secrets-bundle` and Netlify env — **never commit**.

---

*This is the “what is the project / what do I do” brief. Keep it updated when proof status or pricing/rules change. Last refresh: 2026-08-07.*
