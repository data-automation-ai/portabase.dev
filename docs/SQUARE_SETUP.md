# Square Checkout setup

**Commercial product today:** Portabase Cloud — **$17/mo base** after a 7-day trial (Square subscription checkout via `cloud-subscribe` / catalog plan variation). Card required. Customer provides capsule storage.

**Retired:** `$147` one-time “Essentials” software license.  
`POST /api/square/checkout` now returns **HTTP 410** with pointers to open source + Cloud. Do not create payment links for that SKU.

Legacy `GET /api/square/order` and `POST /api/license/claim` remain only for customers who already paid under the old model.

## Required configuration (Cloud + Square)

| Runtime name | AWS `secrets-bundle` selector | Browser-visible |
| --- | --- | --- |
| `SQUARE_ACCESS_TOKEN` | `square.access_token` | No |
| `SQUARE_LOCATION_ID` | `square.location_id` | No |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | `square.webhook_signature_key` | No |
| `SQUARE_ENV` | not secret; `production` or `sandbox` | No |
| `PORTABASE_SITE_URL` | not secret; `https://portabase.dev` | No |

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

Cloud subscribe fails closed when Square config is missing. Invalid webhook signatures return HTTP 401. Errors are logged without tokens, keys, request bodies, or card data.

## Site password note

Netlify site-wide password protection intercepts anonymous webhook traffic. Remove blanket lock before enabling public Square webhooks.
