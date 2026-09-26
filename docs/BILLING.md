# Portabase Cloud billing

**Launch platform: Supabase only** (see `docs/LAUNCH-SCOPE.md`).

**Language:** the unit of work is an **escape** — not a “backup.” Also: *capsule*, *capture*, *Escape engine*.

## Payment gateway

| | |
| --- | --- |
| **Platform** | **Supabase** projects (DB · Auth · Storage · Functions) |
| **Gateway** | **Square** (Checkout + Subscriptions) |
| **Cloud Free** | **$0** · **100 MB** · dashboard + manual runs · **The free plan has no scheduled service**. Not a Square catalog plan. |
| **Starter Escape** | **$7.00 / month** · **one database** · **up to 10 GB** · **1 capsule / 24h** |
| **Daily Escape** | **$17.00 / month** · **unlimited databases** · **up to 25 GB** · **3 capsules / day** |
| **Scale Escape** | Hidden legacy **$37** · not offered on new checkouts |
| **Agents** | **Up to 12** telemetry runners per workspace |
| **SMS** | Optional on **$17** (Twilio). Status only — never keys, capsule bytes, or customer data. Not on Cloud Free or $7. |
| **Trial** | 7 free days · **card required** · auto-converts |

Plan caps meter **capsule usage Cloud is allowed to see** (ciphertext size reported by the runner). The vault is still customer BYO. Portabase does not host recovery bytes.

### Refunds (self-serve)

Full refund within **8 days** of purchase, prorated after that — no email, no call.
The customer provisions their own refund from the dashboard; the server enforces the
window and identity from the JWT email (never a client-supplied purchase id alone),
with all price math server-authoritative per Square. Processor is Square, never Stripe.

### Plans

| Plan id | Monthly | Cap | Transfers / 24h |
| --- | --- | --- | --- |
| `cloud-free` | $0 | 100 MB | manual only |
| `cloud-7` | $7 | 10 GB | 1 |
| `cloud-17` | $17 | 25 GB | 3 |
| `cloud-37` | $37 (hidden) | 100 GB | 3 |

Legacy `cloud-27` aliases to `cloud-17`. $17 already includes 3 capsules / day. Extra transfers add-on is legacy.

### Extra transfers add-on

| | |
| --- | --- |
| Id | `extra-transfers` |
| Allowance | **3** transfers in a rolling 24h window |
| Price | **+$3/mo** on `cloud-7` · **+$5/mo** on `cloud-17` and `cloud-37`. Optional override: `EXTRA_TRANSFERS_ADDON_MONTHLY_USD`. |
| Square catalog | `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7` / `_17` / `_37` (fallback `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID`). |

Dashboard (Home + Plan + Capsules) shows used / allowance and an upgrade CTA. `POST /api/cloud/jobs` with `type=backup` returns **429** `transfer_rate_limited` when the window is exhausted.

Flow: sign in → `POST /api/cloud/subscribe` with `{ "planId": "cloud-7" | "cloud-17" | "cloud-37" }` → Square payment link → card on file → trial phase $0 → monthly plan.

Secrets: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_ENVIRONMENT` (or `SQUARE_ENV`). Optional pins: `SQUARE_CLOUD_PLAN_VARIATION_ID_7`, `SQUARE_CLOUD_PLAN_VARIATION_ID` ($17), `SQUARE_CLOUD_PLAN_VARIATION_ID_37`, `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID`.

## Capsule storage — customer required

**Portabase Cloud does not host recovery binaries.** Zero knowledge of encryption passphrases.

| Item | Who provides |
| --- | --- |
| Encrypted capsules (`.pbase`) | **Customer destination** (S3, Dropbox, NAS, Local Starter) |
| Storage bill | Customer’s storage provider |
| Encryption passphrase | Customer / KMS policy — never Cloud |
| Supabase source keys | Customer / managed secret scope |
| Console / telemetry / SMS / escapes | Portabase Cloud |

## Code

- Browser: `src/lib/product.js` (`CLOUD_PLANS`, `transferWindow`, `EXTRA_TRANSFERS_ADDON_*`)
- Server: `netlify/shared/product.mjs`, `netlify/shared/square-cloud.mjs`
- Checkout: `netlify/functions/cloud-subscribe.mjs`
- Console: Account → Plan
