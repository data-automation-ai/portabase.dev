# Portabase Cloud billing

**Launch platform: Supabase only** (see `docs/LAUNCH-SCOPE.md`).

**Language:** the unit of work is an **escape** — not a “backup.” Also: *capsule*, *capture*, *Escape engine*.

## Payment gateway

| | |
| --- | --- |
| **Platform** | **Supabase** projects (DB · Auth · Storage · Functions) |
| **Gateway** | **Square** (Checkout + Subscriptions) |
| **Starter Escape** | **$7.00 / month** · **up to 1 GB** |
| **Daily Escape** | **$17.00 / month** · **up to 10 GB** |
| **Scale Escape** | **$37.00 / month** · **up to 100 GB** |
| **Included transfers** | **1 capsule backup / transfer per 24 hours** on every base plan |
| **Extra transfers add-on** | **Up to 3 / 24h** · **+$3/mo** on $7 · **+$5/mo** on $17 and $37. Square catalog IDs: `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7` / `_17` / `_37`. |
| **Agents** | **Up to 12** telemetry runners per workspace |
| **SMS** | Optional on **$17 / $37** (Twilio). Status only — never keys, capsule bytes, or customer data. Not on $7. |
| **Trial** | 7 free days · **card required** · auto-converts |

Plan caps meter **capsule usage Cloud is allowed to see** (ciphertext size reported by the runner). The vault is still customer BYO. Portabase does not host recovery bytes.

### Plans

| Plan id | Monthly | Cap | Transfers / 24h |
| --- | --- | --- | --- |
| `cloud-7` | $7 | 1 GB | 1 |
| `cloud-17` | $17 | 10 GB | 1 |
| `cloud-37` | $37 | 100 GB | 1 |

Legacy `cloud-27` aliases to `cloud-37`. Scale no longer includes 3 transfers — that is the Extra transfers add-on.

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
