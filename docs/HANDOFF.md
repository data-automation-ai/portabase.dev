# Portabase — project handoff (for Claude / any successor agent)

**Start here for “what is the project + what do I do”:** **[PROJECT.md](../PROJECT.md)** (repo root).  
**Then this file** for depth. Then `AGENTS.md` (hard rules).

**Owner:** Ryan (operator). **Entity:** DataAutomation.ai, LLC · GitHub repo [data-automation-ai/portabase.dev](https://github.com/data-automation-ai/portabase.dev).  
**Live site:** https://portabase.dev  
**Repo:** `C:\Users\ryanh\git\portabase.dev` (branch `main`).  
**Last handoff refresh:** 2026-08-07 (post Escape sample COMPLETE + fingerprints).

---

## 1. What Portabase is

| Layer | Description |
| --- | --- |
| **Open-core engine** | CLI (`utility/portabase.mjs`) — full Supabase capture, encrypt, verify, restore/replay. Apache-2.0. |
| **Marketing SPA** | React + Vite site (`src/main.jsx`) — risk story, open core vs Cloud, security page. |
| **Portabase Cloud** | Hosted console + Netlify Functions + Supabase Auth + Square billing. Ops product, not capsule vault. |

**Product promise:** Encrypted recovery capsules **outside** the customer’s Supabase account so lockout/billing bans don’t destroy the only copy.

**Scope unit:** **One Supabase project** (`projectRef`) per config/agent — **not** the entire org/account in one shot. Multiple projects → multiple agents. Capture stack for that project: Postgres + Auth inventory + Storage + Edge Functions.

**Not affiliated with Supabase, Inc.**

---

## 2. Hard rules (do not violate)

### 2.1 NEVER write to F:

- **No** files under `F:\` or `F:/` — not staging, cache, status, or “temporary.”
- Global rule also in `C:\Users\ryanh\.grok\AGENTS.md`.
- Prior incidents: F: vanished mid-backup → `mkdir '\\?'` failures and user trust damage.

### 2.2 No workstation spooling for E2E proof / production-style runs

| | |
| --- | --- |
| **Staging / spool** | **EC2 or container** (cloud ephemeral disk) |
| **Vault** | Customer **S3** or **Dropbox** (BYO) |
| **Local PC** | Only if user **explicitly** names an allowed path |

Do **not** thrash C: for multi‑GB Storage capture. Disk is tight; user rejects hardware thrash.

### 2.3 Supabase

- **Hosted Supabase only** for new/default work (`*.supabase.co`). Self-hosted is **deprecated**, not banned (migration use-cases OK).
- Primary ops/control-plane affinity: project **`ekklokrukxmqlahtonnc`** (DataAutomation / MusicSupplies shared ops) unless docs say otherwise.
- **Launch product identity:** Supabase Auth only (`AWS_CLOUD_VERSION_ENABLED = false` in `src/lib/cloud-versions.js`). Cognito code retained, not offered.

### 2.4 User relationship / process

- User has been **extremely clear** about not touching local hardware without permission.
- Prefer **short answers** over multi-minute silent tool loops.
- Confirm before destructive/shared actions (force-push, prod deletes, live backup of production).
- Be **honest** about residual key visibility on managed Cloud (see Security).

---

## 3. Commercial model (current)

| Item | Value |
| --- | --- |
| Gateway | **Square** |
| Base | **$17/mo** |
| Included | **1 backup cycle per 24 hours** (workspace) |
| Plans | **$17/mo** · 1 escape / 24h · or · **$27/mo** · up to 3 escapes / day |
| Agents | Up to **12** |
| SMS | Success **and** failure at run time (console: Alerts → SMS texts) |
| Trial | 7 days, **card required**, auto-convert |
| Vault | **Customer BYO** — not Portabase object storage |
| Staging (Cloud) | **Portabase managed runners** — not customer laptop |

Constants: `src/lib/product.js` ↔ `netlify/shared/product.mjs` (keep in sync).  
Docs: `docs/BILLING.md`, `docs/LAUNCH-SCOPE.md`, `docs/OPEN_CORE.md`, `docs/PRODUCT_SPEC.md`.

---

## 4. Architecture

### 4.1 Public site + Cloud API

```text
Browser
  → Netlify CDN (Vite build → dist/)
  → /api/* → Netlify Functions (netlify/functions/)
       → Supabase Auth (JWT verify)
       → Square (subscriptions)
       → Netlify Blobs (some subscription/job state)
       → optional AWS (CloudTrail LookupEvents, CloudWatch Logs, STS)
  → Hosted Supabase (control-plane SQL under supabase/cloud/)
```

| Component | Path / tech |
| --- | --- |
| SPA entry | `index.html` → `src/main.jsx` |
| Auth UI | `src/auth-pages.jsx`, `src/lib/supabase-auth.js` |
| Console | `src/console/*` (`/app`, demo `/app?demo=1`) |
| Build | `npm run build` (Vite 8, React 19) |
| Host | Netlify (`netlify.toml`) |

### 4.2 Recovery engine (what a “backup” actually is)

**Not** a physical Postgres basebackup of the whole cluster.

| Layer | Form |
| --- | --- |
| Postgres | **Logical** — `pg_dump` / `pg_dumpall` → roles + schema SQL + data SQL |
| Storage | **Real object bytes** downloaded from Supabase Storage |
| Edge Functions | Source (+ Management API fallback) |
| Capsule at rest | **Encrypted archive** (AES-256-GCM `.pbase` + manifest + checksums) |

CLI: `utility/portabase.mjs` + `utility/portabase-core.mjs`.  
Commands: `init`, `doctor`, `backup`, `verify`, `restore`, **`replay`**, **`simulate`** (offline decrypt/unpack/layer check), `status`, schedule/prune.

**Replay** = prove capsule by restoring into a **new blank** Supabase project (never source). See `docs/REPLAY.md`.

### 4.2.1 Escape sample mode (under multi‑GB Storage)

```bash
node utility/portabase.mjs backup --storage-first-per-bucket
# or config: "capture": { "storageSample": "first-per-bucket" }
```

| Layer | Behavior |
| --- | --- |
| Database | **Full** (schema + data) — not trial/schema-only |
| Auth | **Full** inventory |
| Functions | **All** (ghost 404 names skipped) |
| Storage | **First object per bucket only**; full listing still recorded in inventory |

### 4.2.2 Inventory fingerprints (integrity without hashing every Storage byte)

| Fingerprint | What it covers |
| --- | --- |
| `contents.database.inventoryFingerprintMd5` | Tables `schema.name` + reported row counts |
| `contents.auth.inventoryFingerprintMd5` | User id + email |
| `contents.functions.inventoryFingerprintMd5` | Function file paths + content SHA-256 |
| Storage **source** `sourceNamesFingerprintMd5` | Full listing: `bucket/path\tsize` for **all** objects |
| Storage **sample-expected** | First-per-bucket plan at list time (scaled) |
| Storage **capsule** `namesFingerprintMd5` | Objects actually in the capsule |

Under first-per-bucket: **source ≠ capsule by design**; **sample-expected must match capsule** (`sampleMatchesCapsule: true`).  
Details: `docs/REPLAY.md`.

### 4.3 AWS (ops)

| Item | Notes |
| --- | --- |
| Account | `899867382621` (“LOUIS DR”) |
| Secrets | AWS Secrets Manager secret `secrets-bundle` (see operator Claude.md) |
| S3 proof vault used in sessions | `s3://dataautomation-ai-backups/portabase/ekklokrukxmqlahtonnc/` |
| Cloud TF scaffold | `aws/cloud/terraform/` |
| Customer recovery CFN | `aws/cloudformation/portabase-recovery.yaml` |

### 4.4 Destinations (product direction)

| Destination | Non-expert | Power user |
| --- | --- | --- |
| **Dropbox OAuth** | “Connect Dropbox” | — |
| **Dropbox token** | — | Long-lived token / rclone (ops-stable) |
| **S3** | Guided / advanced | IAM / keys |
| **Local folder** | Desktop/agent on that PC | Self-host only; not Cloud default |

Engine already supports `aws`, dropbox/gdrive via rclone, `local`. **OAuth Dropbox in console is not fully productized yet** — design intent is clear; implement carefully.

---

## 5. Security & trust (must stay honest)

Public page: **`/security`** (alias `/trust`). Spec: `docs/SECURITY-TRUST.md`.

**Up front:** On managed Cloud, a runner must use crypto for the job window → **possibility Portabase can see or use key material**. Customer KMS / CloudTrail / CloudWatch **reduce** that; they do **not** claim zero. Zero vendor key path → **standalone OSS only**.

Trust dial: Trust Portabase · mix controls · max (KMS+Trail+CW) · standalone.

Console:

- **Account → CloudWatch live** — secret-scoped job logs (`/api/cloud/cloudwatch-live`)
- **Account → CloudTrail live** — customer Trail via AssumeRole (`/api/cloud/audit-trail`)

---

## 6. Repo map (high signal)

```text
portabase.dev/
  AGENTS.md                 # Project agent rules (F:, cloud spool)
  docs/HANDOFF.md           # THIS FILE
  docs/PRODUCT_SPEC.md
  docs/LAUNCH-SCOPE.md
  docs/OPEN_CORE.md
  docs/BILLING.md
  docs/SECURITY-TRUST.md
  docs/REPLAY.md
  docs/CLOUD_CONSOLE.md
  docs/CLOUD_INFRASTRUCTURE.md
  docs/AUTH_AND_TRIAL.md
  src/main.jsx              # Marketing + routes
  src/console/              # Cloud ops console
  src/lib/product.js        # Pricing, cycles, SMS feature list
  src/lib/cloud-versions.js # Supabase-only launch flag
  utility/portabase.mjs     # CLI engine
  utility/portabase-core.mjs
  netlify/functions/        # Cloud APIs
  netlify/shared/
  supabase/cloud/           # Control-plane SQL
  aws/                      # TF + CFN
  tests/
```

---

## 7. Secrets & local env (never commit)

| File / source | Purpose |
| --- | --- |
| `.env.portabase.local` | CLI backup secrets (gitignored pattern `.env.*.local`) |
| `.env.replay-target.local` | May exist for replay target project |
| AWS `secrets-bundle` | Operator secrets (Supabase, Square, AWS limited keys, etc.) |
| Netlify env | Production function secrets |

Typical CLI env:

- `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`
- `PORTABASE_ENCRYPTION_PASSPHRASE` (≥16 chars)
- Target replay: `PORTABASE_TARGET_PROJECT_REF`, `PORTABASE_TARGET_SUPABASE_URL`, `PORTABASE_TARGET_SERVICE_ROLE_KEY`, `PORTABASE_TARGET_DB_URL`

JWT **service_role** from Management API may be required if `sb_secret_` keys 401 on REST (seen on `ekklokrukxmqlahtonnc`).

---

## 8. How to run (day-to-day)

### Marketing site

```powershell
cd C:\Users\ryanh\git\portabase.dev
npm install
npm run dev
# production build
npm run build
```

### CLI (engine)

```powershell
# tools: pg_dump on PATH; optional desktop/vendor supabase
npm run portabase -- doctor
npm run portabase -- backup
npm run portabase -- status
npm run portabase -- replay --capsule <dir> --confirm-target <NEW_REF>
```

### Tests

```powershell
npm test
# or
node --test tests/*.test.mjs utility/*.test.mjs
```

### Console demo (no live auth)

Open `/app?demo=1`.

---

## 9. Proof goal (owner priority)

**Prove it works:** backup **DataAutomation** Supabase → vault → **replay** into a **new blank** project.

| | |
| --- | --- |
| **Source** | `ekklokrukxmqlahtonnc` (DataAutomation) — ~15 973 Storage objects / ~9.6 GB inventory |
| **Vault used in sessions** | `s3://dataautomation-ai-backups/portabase/ekklokrukxmqlahtonnc/` |
| **Replay target created** | `svltssnxzqsrxtbjgaex` (`portabase-replay-proof`) — verify still ACTIVE; may need service_role + DB URL |
| **Whitepaper / smoke** | `kiuwcdpjsdotkoojbkoi` — local smoke COMPLETE earlier; **not blank** → bad as replay target without wipe |
| **Must not** | Restore into source; spool on F:; silent multi-hour local thrash |

### Status as of 2026-08-06/07

| Proof | Status |
| --- | --- |
| **Escape sample (first-per-bucket) → S3** | **COMPLETE** — capsule `ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z`, destination **verified**, ~262 MB encrypted, ~7.3 min |
| Full Storage (~9.6 GB object download) | **Not** run as complete Escape on this pass (intentionally sampled) |
| **`replay` into blank project** | **Still open** — no green live replay of the COMPLETE capsule yet |
| **`simulate` offline** | Available; recommended before live replay |

**Gold capsule (sample Escape):**

```text
s3://dataautomation-ai-backups/portabase/ekklokrukxmqlahtonnc/ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z
local: portabase-capsules/ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z/
```

Fingerprint highlights from that run:

| Layer | MD5 (prefix) | Notes |
| --- | --- | --- |
| Database inventory | `4845d671…` | 588 tables, full data dump |
| Auth | `be3797a7…` | 19 users |
| Functions | `89503fbf…` | 232 functions listed; 463 file rows |
| Storage source | `4b943fa4…` | count **15973** |
| Storage sample/capsule | `4fd76ac4…` | count **12**, `sampleMatchesCapsule: true` |

Earlier same day: PARTIAL capsule `…15-35-27.337Z` (Functions Management API **502**). Prefer the COMPLETE capsule above.

**Correct next proof:** `simulate` on gold capsule → **blank** target `replay` (prefer EC2/container if doing full Storage later). Whitepaper is **not** blank.

Local env: `.env.portabase.local` (source) · `.env.replay-target.local` (target). Load secrets-bundle keys via operator env docs.  
**Git push to `data-automation-ai/portabase.dev`:** local `gh` user `lcapece` has **pull only**; use Secrets Manager `github-dataautomation-ia-pat` (org admin) for push.

---

## 10. Known technical pitfalls

1. **F: drive** — unstable/missing; never use.  
2. **`mkdir '\\?'` on Windows** — seen when drive path invalid / long-path edge cases.  
3. **Storage size** — ~10 GB full; use `--storage-first-per-bucket` for under-budget path proof; full object download still prefers cloud runner.  
4. **Parallel Storage** — implemented (`mapPool`, concurrency 8–12); cache dual-key + EBUSY hardening partially done.  
5. **Node packTarGz** — pure-Node tar.gz fallback when system tar fails (`portabase-core.mjs`). May emit `MaxListenersExceededWarning` on large packs (non-fatal).  
6. **Functions 404** — ghost function names (e.g. `generate-image`) should skip, not kill layer.  
7. **Functions 502** — Management API intermittent HTML 502 → layer PARTIAL; retry often succeeds (seen 2026-08-06).  
8. **Rolldown/lightningcss native bindings** on Windows can break after `npm install` — may need re-extract `binding-win32-x64-msvc` / `lightningcss-win32-x64-msvc`.  
9. **Launch flag** — keep AWS Cognito UI off until product says otherwise.  
10. **Square cycle add-ons** — product constants exist; live catalog SKUs may still need wiring.  
11. **First-per-bucket ≠ trial** — `FIRST_PER_BUCKET_STORAGE.databaseSchemaOnly` is **false**; do not confuse with `--trial`.

---

## 11. Git / deploy state

- Branch: **`main`** tracking **`origin/main`** (`data-automation-ai/portabase.dev`).
- Escape sample + fingerprint work **pushed** through `6549ecb` (2026-08-06); handoff refresh may be a later commit.
- Deploy: Netlify build from repo (confirm site link in Netlify UI for `portabase.dev`).
- Do not force-push or rewrite published history without owner approval.
- Do **not** commit: `portabase-capsules/`, `portabase-status/`, `portabase-evidence/`, terraform `tfplan` / `outputs.json` / state.

---

## 12. What to build next (suggested priority)

### Queued (owner — do next)

1. **Green `replay`** of COMPLETE sample capsule into a **blank** project (not whitepaper unless wiped).  
   Optional: `simulate` first. Pass: target has DB rows / sample Storage / Functions.  
2. Full Storage Escape on **EC2/container** when proving multi‑GB path (not laptop thrash).  
3. **EC2-only runbook script** — single script for full proof above.

### Product backlog

4. **Dropbox** — OAuth (simple) + access token (ops-stable); destination UX without S3 jargon.  
5. **Square** — base $17 + $10 extra-cycle add-ons end-to-end.  
6. **SMS sender** — wire real provider (ClickSend/Twilio); STOP/HELP; success+failure at job end.  
7. **Managed runners** — real log groups matching CloudWatch live secret scope.

---

## 13. Doc index (read order for a new agent)

1. **`PROJECT.md`** (USP + what to do)  
2. **`docs/HANDOFF.md`** (this file)  
3. **`AGENTS.md`**  
4. **`docs/E2E-ESCAPE-TEST.md`** · **`docs/REPLAY.md`**  
5. **`docs/PRODUCT_SPEC.md`** · **`docs/LAUNCH-SCOPE.md`** · **`docs/OPEN_CORE.md`**  
6. **`docs/SECURITY-TRUST.md`** · **`docs/BILLING.md`**  
7. **`docs/CLOUD_CONSOLE.md`** · **`docs/CLOUD_INFRASTRUCTURE.md`** · **`docs/AUTH_AND_TRIAL.md`**  
8. **`docs/ESSENTIALS_RUNBOOK.md`** (CLI operator path)

---

## 14. Tone / working agreement with owner

- Direct, short updates; **no multi-minute silent spinners**.  
- **No local hardware thrash.**  
- Security messaging: options for assurance + **explicit residual key risk** on managed Cloud.  
- Owner may be blunt under stress after failed long runs — stay professional, stop when told **stop**, do not continue background jobs after stop.

---

## 15. Session continuity (2026-08-06 Grok arc)

Work done that day (committed/pushed):

- Offline **`simulate`**
- Whitepaper local smoke config + capsule-smoke Edge Function
- **`--storage-first-per-bucket`** Escape mode
- Storage name+size fingerprints (source / sample-expected / capsule) + sizes in hash lines
- Non-storage fingerprints (DB / Auth / Functions)
- Fix: first-per-bucket no longer mis-labels database as schema-only
- Live COMPLETE Escape sample to S3 (see §9)

Left for successor: **live replay**, full multi‑GB Storage proof on cloud runner, product backlog §12.

---

*Handoff for Claude Code, Grok, or any successor. Update this file when proof status or product constants change.*
