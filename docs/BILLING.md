# Portabase Cloud billing

**Launch platform: Supabase only** (see `docs/LAUNCH-SCOPE.md`).

## Payment gateway

| | |
| --- | --- |
| **Platform** | **Supabase** projects (DB · Auth · Storage · Functions) |
| **Gateway** | **Square** (Checkout + Subscriptions) |
| **Base price** | **$17.00 / month** USD (`1700` cents) |
| **Included cycles** | **1 backup cycle per 24 hours** (workspace) |
| **Extra cycles** | **$10.00 / month each** (`1000` cents) — each add-on allows **one additional cycle per 24 hours** |
| **Agents** | **Up to 12** telemetry runners per workspace |
| **SMS** | Success **and** failure texts at run time (manage numbers in console) |
| **Trial** | 7 free days · **card required** · auto-converts |
| **List reference** | $34/mo list on base plan messaging (intro may still show half-off base) |

### Examples

| Extra cycles purchased | Runs allowed / 24h | Monthly (base + extras) |
| --- | --- | --- |
| 0 | 1 | $17 |
| 1 | 2 | $27 |
| 2 | 3 | $37 |
| 5 | 6 | $67 |

A “cycle” is one full managed backup job (capture → package → destination verify) counted against the rolling 24h window.

Flow: sign in → `POST /api/cloud/subscribe` → Square payment link → card on file → trial phase $0 → monthly base (+ optional cycle add-ons).

Secrets: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY` (secrets-bundle / Netlify). Optional pin: `SQUARE_CLOUD_PLAN_VARIATION_ID`. Cycle add-ons: map to Square catalog variations when wired.

## SMS text management (included)

| Feature | Notes |
| --- | --- |
| **On failure** | Default on — text when a run fails |
| **On success** | Default on — text when a run completes successfully |
| **Number management** | E.164 numbers, labels, enable/disable, remove |
| **Verify** | Verify before live traffic (demo: one-click verify) |
| **Test SMS** | Send a test message to a number |
| **Delivery history** | Sent / failed / suppressed |
| **Quiet hours** | Optional; suppress **success** only (failures still send) |
| **Escalation chains** | Separate multi-step policies (email → SMS → Slack) for missed schedule / verify fail |

Console: **Alerts → SMS texts**.

Related ops (also needed in production SMS):

- Carrier **STOP/HELP** compliance
- Opt-in consent timestamp
- Rate limits / burst protection
- Per-project vs workspace-wide routing
- Deduping (one text per run outcome, not per agent heartbeat)

## Binary storage — customer required

**Portabase Cloud does not host recovery binaries.**

| Item | Who provides |
| --- | --- |
| Encrypted capsules (`.pbase`) | **Customer destination** (S3, Dropbox, Google Drive, NAS, local) |
| Storage bill | Customer’s storage provider |
| Encryption passphrase | Customer / KMS policy |
| Supabase source keys | Customer / managed secret scope |
| Console / telemetry / SMS / cycles | Portabase Cloud |
| Agents | Up to **12** on plan |

## Code

- Browser: `src/lib/product.js`
- Server: `netlify/shared/product.mjs`, `netlify/shared/square-cloud.mjs`
- Checkout: `netlify/functions/cloud-subscribe.mjs`
- Console: Account → Plan (cycles); Alerts → SMS texts
