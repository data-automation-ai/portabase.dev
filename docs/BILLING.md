# Portabase Cloud billing

**Launch platform: Supabase only** (see `docs/LAUNCH-SCOPE.md`).

**Language:** prefer *recovery cycle*, *capsule*, *Escape*, *capture* — not “backup” — in customer-facing copy.

## Payment gateway

| | |
| --- | --- |
| **Platform** | **Supabase** projects (DB · Auth · Storage · Functions) |
| **Gateway** | **Square** (Checkout + Subscriptions) |
| **Plan A · Daily Escape** | **$17.00 / month** · **1 recovery cycle per 24 hours** |
| **Plan B · Triple Escape** | **$27.00 / month** · **up to 3 recovery cycles per day** |
| **Agents** | **Up to 12** telemetry runners per workspace |
| **SMS** | Success **and** failure texts at run time |
| **Trial** | 7 free days · **card required** · auto-converts |

A “recovery cycle” is one full managed job (capture → package → destination verify) counted against the rolling 24h window.

### Plans

| Plan id | Monthly | Cycles / day |
| --- | --- | --- |
| `cloud-17` | $17 | 1 |
| `cloud-27` | $27 | up to 3 |

There is **no** à-la-carte “extra cycle” SKU. Choose Daily or Triple.

Flow: sign in → `POST /api/cloud/subscribe` with `{ "planId": "cloud-17" | "cloud-27" }` → Square payment link → card on file → trial phase $0 → monthly plan.

Secrets: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`. Optional pins: `SQUARE_CLOUD_PLAN_VARIATION_ID` ($17), `SQUARE_CLOUD_PLAN_VARIATION_ID_27` ($27).

## Binary / capsule storage — customer required

**Portabase Cloud does not host recovery binaries.**

| Item | Who provides |
| --- | --- |
| Encrypted capsules (`.pbase`) | **Customer destination** (S3, Dropbox, NAS, Local Starter) |
| Storage bill | Customer’s storage provider |
| Encryption passphrase | Customer / KMS policy |
| Supabase source keys | Customer / managed secret scope |
| Console / telemetry / SMS / cycles | Portabase Cloud |

## Code

- Browser: `src/lib/product.js` (`CLOUD_PLANS`)
- Server: `netlify/shared/product.mjs`, `netlify/shared/square-cloud.mjs`
- Checkout: `netlify/functions/cloud-subscribe.mjs`
- Console: Account → Plan
