# Square Checkout setup

**Commercial product today:** Portabase Cloud — **$17/mo base** after a 7-day trial (Square subscription checkout via `cloud-subscribe` / catalog plan variation). Card required. Customer provides capsule storage.

**Retired:** `$147` one-time “Essentials” software license.  
`POST /api/square/checkout` now returns **HTTP 410** with pointers to open source + Cloud. Do not create payment links for that SKU.

Legacy `GET /api/square/order` and `POST /api/license/claim` remain only for customers who already paid under the old model.

## Required configuration (Cloud + Square)

Credentials are **product-scoped**. Do not reuse `square-nysmassageexam-*` (or any other product's Square application) to open Portabase checkout.

| Runtime name | AWS `secrets-bundle` selector | Browser-visible |
| --- | --- | --- |
| `SQUARE_ACCESS_TOKEN` (fallback) | **`square-portabase-production-access-token`** first | No |
| `SQUARE_LOCATION_ID` | `square-location-id` | No |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` (fallback) | **`square-portabase-webhook-signature-key`** first | No |
| `SQUARE_ENV` | not secret; `production` or `sandbox` | No |
| `PORTABASE_SITE_URL` | not secret; `https://portabase.dev` | No |

Also store `square-portabase-application-id` and `square-portabase-production-application-secret` in the bundle when the Portabase Square application is created. Functions refuse a token that byte-matches another product's Square secret.

Optional legacy only: `PORTABASE_LICENSE_PRIVATE_KEY` for historical offline license re-issue.

The functions resolve private values from AWS Secrets Manager secret `secrets-bundle` first, then from same-named Netlify environment variables as a temporary fallback. Never create a `VITE_SQUARE_*` variable.

## Square configuration (Cloud subscription)

1. Create or select the authorized Portabase Square application and location.
2. Add the records above to the AWS `secrets-bundle`.
3. Cloud subscribe uses Square Catalog subscription plan + payment links (see `netlify/shared/square-cloud.mjs`).
4. Register `https://portabase.dev/api/square/webhook` for payment events if you still process webhooks.
5. Set `SQUARE_ENV=sandbox` for tests; production for live.

## Endpoints

| Path | Role |
| --- | --- |
| `POST /api/cloud/subscribe` | **Current** — Cloud trial → $17/mo Square checkout |
| `POST /api/cloud/confirm-checkout` | Confirm subscription after redirect |
| `POST /api/square/checkout` | **Retired** — returns 410 |
| `GET /api/square/order` | Legacy order paid check ($147 Essentials) |
| `POST /api/license/claim` | Legacy platform-bound license for paid Essentials orders only |
| `POST /api/square/webhook` | Square HMAC-validated payment events |

## Fail-closed behavior

Cloud subscribe fails closed when Square config is missing, and when the resolved access token matches another product's Square secret. `POST /api/cloud/confirm-checkout` does **not** grant trial access from `checkout_pending` alone — it retrieves the Square order/payments (and subscription if present) and requires a COMPLETED/CAPTURED payment (including the $0 trial card-on-file) or a PENDING/ACTIVE subscription. CAPTURED payments count even when the Square order is still OPEN. Invalid webhook signatures are rejected. Errors are logged without tokens, keys, request bodies, or card data.

Jobs (`/api/cloud/jobs`) return HTTP 402 until the account has `trialing` / `active` / `past_due` access.

## Site password note

Netlify site-wide password protection (`has_password` / `password_context=all` on site `portabase-dev`) intercepts anonymous webhook traffic **and** stranger checkout. Remove the blanket lock before taking a customer order. The live site returned Netlify's password form for `/api/auth/config` on 2026-08-23.
