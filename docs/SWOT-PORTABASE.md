# Portabase SWOT analysis (40 items)

**Scope:** deep review after absorbing `supabase-backup` patterns (Storage objects + Edge Functions) and the current open-core + Cloud product.

**Split:**  
- **A. Backend / product code** — 20 items (Strengths 1–10, Weaknesses 1–10)  
- **B. Business / public use cases** — 20 items (Opportunities 1–10, Threats 1–10)

---

## A. Backend & product code (50%)

### Strengths (10)

1. **Guarded restore is real code, not marketing** — `validateRestoreTarget` + blank-target inventory refuse source overwrite and occupied destinations before write.
2. **Encrypted capsule as unit of recovery** — AES-256-GCM, checksums, offline-first; Cloud never needs ciphertext.
3. **Layered capture** — Database (native pg_dump), Storage bytes with SHA-256, Edge Functions via CLI, Auth-aware inventory; partial layers stay partial (no fake-green).
4. **Replay path** — CLI `replay` + console wizard codify “prove capsule on a **new** project/account.”
5. **Storage resume metadata (post-port)** — Object identity (size / updatedAt / etag), prior-run index under `portabase-status/last-storage-manifest.json`, skip unchanged downloads inside a staging tree.
6. **Functions redeploy kit (post-port)** — Capsule includes `functions-manifest.json`, per-file hashes, `REDEPLOY-ALL.ps1` / `redeploy-all.sh` with `verify_jwt` flags (from supabase-backup lessons).
7. **Open-core default** — Full capture free; trial limits explicit; no license gate on encryption.
8. **Telemetry fail-closed** — Allowlisted events; secret-shaped payloads rejected (`telemetry.mjs`).
9. **Dual identity for Cloud** — Supabase Auth and Cognito both first-class; subscription namespaced by version.
10. **Battle-tested lineage** — Patterns from MusicSupplies `supabase-backup` (delta S3, Management API functions, DR runbooks) inform the engine without shipping that ops mess as product.

### Weaknesses (10)

1. **Storage resume is still local-staging, not destination-delta** — Unlike `dr-sync-storage-s3.js`, Portabase does not yet skip re-upload to customer S3 when only capsule rebuild changes; large fleets still re-encrypt full trees each night.
2. **Functions capture depends on Supabase CLI** — No Management API body fallback if CLI download fails or version skews.
3. **Auth user recovery is thinner than DB/Storage/Functions** — Identity providers, templates, and passwords remain manual cutover.
4. **Capsule format + status files are file-based** — No first-class multi-tenant agent registry on the runner beyond config/env.
5. **Cloud control plane is partially mock** — Console UI + Blobs billing are ahead of live telemetry fan-in and agent job queue for replay.
6. **Hard operational surface area** — Requires tar, psql/pg_dump, Supabase CLI, rclone/aws; doctor helps but install friction remains high for non-ops founders.
7. **Test coverage is strong on pure guards, light on live Storage/Functions E2E** — Unit tests do not replace a nightly live restore against a blank hosted project.
8. **Prior storage index can drift** — Resume index is last local capture metadata; concurrent agents or manual deletes of destination objects are not reconciled.
9. **REDEPLOY scripts use `npx supabase@latest`** — Version pin risk; CLI “latest” can break deploys silently over time.
10. **Schema exclude lists are long and brittle** — Postgres system schema filters must track Supabase platform schema changes or dumps leak / miss edges.

---

## B. Business & public use cases (50%)

### Opportunities (10)

1. **“User is banned” / dashboard lockout** — Public Supabase ban and support-path stories create urgency for independent recovery; Portabase is the productized answer.
2. **Vibe-coder → production gap** — Millions on Supabase Pro without enterprise SLA; $17 Cloud + free engine is priced for the danger zone between hobby and enterprise.
3. **Replay as the sales demo** — “Watch us restore your last capsule into a fresh project in under an hour” is a concrete deal closer vs abstract backup claims.
4. **BYO storage as trust differentiator** — Customers keep S3/Drive/NAS; competitors that vault customer data invite landlord risk; message: *we never hold your binaries*.
5. **Square $17 + 12 agents** — Simple commercial package for SMBs; easy to compare against $599 Team tiers of the platform itself.
6. **Dual Cloud versions (Supabase vs AWS identity)** — Meets both “all-in on Supabase” and “AWS-native compliance” buyers without two products.
7. **Open-core virality** — Apache-2.0 engine can be starred, audited, and self-hosted; Cloud is the wake-up call, not a dump unlock.
8. **Agency / multi-project shops** — Up to 12 agents fits freelancers managing several client Supabase apps under one subscription.
9. **Compliance narrative** — Customer-held encryption keys + immutable destinations align with SOC2-style “we don’t process your recovery data” claims (with careful legal framing).
10. **Partnership with infra** — Documented AWS CloudFormation recovery stack + GCP Terraform give enterprise “run in my account” packaging for procurement.

### Threats (10)

1. **Supabase improves native export/DR** — If hosted backups become fully extricable under lockout, urgency drops.
2. **“We already pg_dump” mindset** — Buyers undervalue Storage objects + Functions until an incident; education cost is high.
3. **Competing open tools** — Community scripts (including the user’s own supabase-backup) free-ride the problem space; must stay more reliable and productized.
4. **False sense of security** — Users may skip Replay drills; first real lockout still fails if capsules never verified.
5. **Credential mishandling on agent hosts** — Service role keys on a poorly secured runner create a worse breach than platform lockout.
6. **Payment / chargeback friction** — Ironic risk: Square/subscription disputes while promising escape from billing lockouts; support must be excellent.
7. **Support burden at $17** — Complex restore incidents can cost more than monthly revenue if every trial becomes a white-glove evacuation.
8. **Platform ToS / AUP gray areas** — Exporting data is fine; mass-automation of Management API must stay within rate limits and fair use.
9. **Market conflation with “Supabase alternative”** — Hostile framing burns goodwill; product must stay “keep Supabase, remove SPOF.”
10. **Single-founder / small team bus factor** — Public trust for DR software requires continuity, docs, and open engine so customers are not locked into Portabase the company.

---

## Deal framing for the public (use-case summary)

| Scenario | What they buy | What they must bring |
|----------|---------------|----------------------|
| Solo founder on Pro | Free engine + optional $17 Cloud | Runner + destination (S3/Drive/etc.) + passphrase |
| Agency (≤12 apps) | Cloud fleet view + 12 agents | Per-client secrets on agents; BYO storage |
| Post-incident / banned | Replay + restore docs + OSS engine | New Supabase account; blank project; PAT |
| AWS-heavy shop | Cognito Cloud version + CFN recovery stack | Own AWS account for vault |

**One-line deal:** *Portabase keeps an encrypted, restorable copy of your Supabase app outside Supabase — you hold the keys and the binary storage; we sell the proof it still works and the pager when it doesn’t.*

---

## Implementation notes (this iteration)

Pulled from `supabase-backup` into Portabase:

| Port | Location |
|------|----------|
| Storage object identity (size/etag/updatedAt) | `storageObjectIdentity`, manifest v2 |
| Skip re-download when prior identity matches | `shouldSkipStorageDownload` + `last-storage-manifest.json` |
| Functions per-file SHA-256 | `functions-manifest.json` |
| REDEPLOY PS1/Bash + verify_jwt | `generateFunctionRedeployScripts` |
| Restore honors `--no-verify-jwt` | `restoreFunctions` |
| RECOVER.md points to replay + redeploy | capsule `RECOVER.md` |

**Still not ported (future):** full S3 destination-side delta like `dr-sync-storage-s3.js` (compare remote archive before re-upload).

---

## Implementation status

See **`docs/SWOT-IMPLEMENTATION.md`** for the full tracker.

Summary of code delivered against SWOT weaknesses / opportunities:

| Area | Delivered |
|------|-----------|
| W1 Storage efficiency | Content-addressed `.storage-object-cache`; AWS `s3 sync` |
| W2 Functions CLI risk | Management API list/body fallback |
| W3 Auth thin | `auth-inventory.json` + `AUTH-CUTOVER.md` |
| W4 Agent registry | `agent-registry.json` (max 12) |
| W5 Cloud jobs | `POST/GET /api/cloud/jobs` |
| W6 Doctor | Install hints + BYO storage + replay nudge |
| W7 Tests | Cache key, schema excludes, CLI pin, s3 sync |
| W8 Index drift | Reconcile dropped keys on new index |
| W9 latest pin | `PINNED_SUPABASE_CLI` |
| W10 Schema lists | Versioned `PLATFORM_SCHEMA_EXCLUDES` |
| O3–O9 Public deal | Homepage **The Deal** section + pricing BYO/12 agents |
