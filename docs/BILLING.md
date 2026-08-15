# Portabase Cloud billing

**Launch platform: Supabase only** (see `docs/LAUNCH-SCOPE.md`).

**Language:** the unit of work is an **escape** — not a “backup.” Also: *capsule*, *capture*, *Escape engine*.

## Payment gateway

| | |
| --- | --- |
| **Platform** | **Supabase** projects (DB · Auth · Storage · Functions) |
| **Gateway** | **Square** (Checkout + Subscriptions) |
| **Plan A · Daily Escape** | **$17.00 / month** · **1 escape per 24 hours** |
| **Plan B · Triple Escape** | **$27.00 / month** · **up to 3 escapes per day** |
| **Agents** | **Up to 12** telemetry runners per workspace |
| **SMS** | Success **and** failure texts at run time |
| **Trial** | 7 free days · **card required** · auto-converts |
| **Money-back** | **7 days · self-serve** · customer taps refund → Square refund + Cloud closed |

An **escape** is one full managed job (capture → encrypt capsule → destination verify) counted against the rolling 24h window.

### Plans

| Plan id | Monthly | Escapes / day |
| --- | --- | --- |
| `cloud-17` | $17 | 1 |
| `cloud-27` | $27 | up to 3 |

There is **no** à-la-carte extra-cycle SKU. Choose Daily or Triple.

### Intended size fence + egress (2026-08-15 — not yet a hard engine gate)

Cadence SKUs stay $17 / $27. They are **not** unlimited GB if **Portabase** pays the pipe.

| Rule | Intent |
| --- | --- |
| Included transfer | **10 GB per Escape** (bytes we ship that day, after incrementals) |
| Triple | same 10 GB **per** Escape (max 30 GB/day) |
| Same-region customer S3 | no transfer surcharge |
| Internet vault (Dropbox / Drive / cross-region) over include | quote **before** run · ~**$0.15/GB** |
| OSS / customer agent | they pay their pipe — no Portabase egress SKU |
| Hosted locker | paid nicety · separate disk rent · not the default vault |

Do not silently run a 50–500 GB first full to Dropbox on the $17 plan.

Flow: sign in → `POST /api/cloud/subscribe` with `{ "planId": "cloud-17" | "cloud-27" }` → Square payment link → card on file → trial phase $0 → monthly plan.

### 7-day money-back (automated, customer-triggered)

The customer does **not** email support. They tap **Refund & close account** in Cloud → Plan.

| When | What happens |
| --- | --- |
| During the $0 trial | Square subscription canceled. No charge to refund. Cloud access closed. |
| Within **7 days of first paid charge** | That payment is refunded via Square. Subscription canceled. Cloud access closed. |
| After the window | Button is gone. Not a forever refund. |

Account close means **our** Cloud record and Square subscription. **Capsules in their vault stay.** Source keys we held for the runner should be treated as revoked (customer can also `REVOKE KEY`).

API: `POST /api/cloud/self-refund` (signed-in). Function: `netlify/functions/cloud-self-refund.mjs`.

Secrets: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`. Optional pins: `SQUARE_CLOUD_PLAN_VARIATION_ID` ($17), `SQUARE_CLOUD_PLAN_VARIATION_ID_27` ($27).

## Capsule storage — customer required

**Portabase Cloud does not host recovery binaries.**

| Item | Who provides |
| --- | --- |
| Encrypted capsules (`.pbase`) | **Customer destination** (S3, Dropbox, NAS, Local Starter) |
| Storage bill | Customer’s storage provider |
| Encryption passphrase | Customer / KMS policy |
| Supabase source keys | Customer / managed secret scope |
| Console / telemetry / SMS / escapes | Portabase Cloud |

## Code

- Browser: `src/lib/product.js` (`CLOUD_PLANS`, `escapesPerDay`)
- Server: `netlify/shared/product.mjs`, `netlify/shared/square-cloud.mjs`
- Checkout: `netlify/functions/cloud-subscribe.mjs`
- Console: Account → Plan
