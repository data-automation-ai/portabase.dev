# SWOT implementation tracker

Maps `docs/SWOT-PORTABASE.md` items to code/docs delivered.

Legend: ✅ done · 🟡 partial · ⬜ intentional non-code / ongoing

## A. Weaknesses (backend) — implement

| # | Item | Status | Where |
|---|------|--------|--------|
| W1 | Destination / re-upload efficiency | ✅ | Content-addressed `.storage-object-cache`; AWS `s3 sync` default |
| W2 | Functions without CLI only | ✅ | Management API list + body fallback |
| W3 | Thin Auth recovery | ✅ | `auth-inventory.json` + `AUTH-CUTOVER.md` (no passwords) |
| W4 | File-based agent state | ✅ | `portabase-status/agent-registry.json` (≤12) |
| W5 | Mock Cloud control plane | 🟡 | `/api/cloud/jobs` queue (Blobs); still no live agent pull loop |
| W6 | Hard install surface | ✅ | Expanded `doctor` install hints + BYO storage + replay nudge |
| W7 | Light Storage/Functions tests | ✅ | Unit tests for cache key, schema excludes, redeploy pin, s3 sync |
| W8 | Storage index drift | ✅ | Reconcile drop count; only current listing keys retained in new index |
| W9 | `supabase@latest` pin risk | ✅ | `PINNED_SUPABASE_CLI` in redeploy scripts |
| W10 | Brittle schema excludes | ✅ | `PLATFORM_SCHEMA_EXCLUDES` / `SCHEMA_EXCLUDE_VERSION` in core |

## B. Opportunities (public deal) — implement

| # | Item | Status | Where |
|---|------|--------|--------|
| O1 | Ban/lockout urgency | ✅ | Existing closures + ban narrative (site) |
| O2 | Pro-tier danger zone | ✅ | Why-now + pricing |
| O3 | Replay as demo | ✅ | Cloud teaser → Replay demo; doctor/backup NEXT line |
| O4 | BYO storage trust | ✅ | Billing, destinations, product.js, deal section |
| O5 | $17 + 12 agents | ✅ | product constants + UI limits |
| O6 | Dual Cloud versions | ✅ | login version picker |
| O7 | Open-core virality | ✅ | Deal section + GitHub CTAs |
| O8 | Agency ≤12 agents | ✅ | Agent limit messaging |
| O9 | Compliance / no vault | ✅ | Deal “not included” + trust boundary settings |
| O10 | Infra packaging | ✅ | aws CFN + gcp TF docs (existing) |

## C. Threats — mitigate in product/docs

| # | Item | Status | Mitigation |
|---|------|--------|------------|
| T1 | Supabase native DR improves | ⬜ | Positioning: independent keys + offline still matter |
| T2 | pg_dump mindset | ✅ | Deal + storage object messaging; auth cutover honesty |
| T3 | Free scripts compete | ✅ | Productized guards, capsule, replay, Cloud ops |
| T4 | Skip Replay drills | ✅ | Doctor + backup “NEXT: replay”; console Replay wizard |
| T5 | Agent credential risk | ✅ | Doctor passphrase/storage notes; never send secrets to Cloud |
| T6 | Payment irony | ⬜ | Support process (ops) |
| T7 | $17 support cost | ⬜ | Self-serve RECOVER + open engine |
| T8 | API rate limits | 🟡 | Management API used only as fallback |
| T9 | Anti-Supabase framing | ✅ | “Keep Supabase” deal section |
| T10 | Bus factor | ✅ | Apache open core + public GitHub |

## Strengths

Documented as retained product properties — not re-implemented.
