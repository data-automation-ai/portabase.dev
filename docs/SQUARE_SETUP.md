# Square Checkout setup

**Commercial product today:** Portabase Cloud — **$7 / $17 / $37 per month** (1 / 10 / 100 GB) after a 7-day trial (Square subscription checkout via `cloud-subscribe` / catalog plan variation). Each base plan includes **1 capsule transfer / 24h**. Optional Extra transfers add-on (up to **3 / 24h**) is **+$3/mo** on $7 and **+$5/mo** on $17 / $37. Pin `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7` / `_17` / `_37`. Card required. Customer provides capsule storage. Cloud has zero knowledge of encryption keys.

**Retired:** `$147` one-time “Essentials” software license.  
`POST /api/square/checkout` now returns **HTTP 410** with pointers to open source + Cloud. Do not create payment links for that SKU.

Legacy `GET /api/square/order` and `POST /api/license/claim` remain only for customers who already paid under the old model.

## Required configuration (Cloud + Square)

| Runtime name | AWS `secrets-bundle` selector | Browser-visible |
| --- | --- | --- |
| `SQUARE_ACCESS_TOKEN` | `square.access_token` | No |
| `SQUARE_LOCATION_ID` | `square.location_id` | No |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | `square.webhook_signature_key` | No |
| `SQUARE_ENVIRONMENT` or `SQUARE_ENV` | not secret; `production` or `sandbox` | No |
| `PORTABASE_SITE_URL` | not secret; `https://portabase.dev` | No |
| `SQUARE_CLOUD_PLAN_VARIATION_ID_7` | optional pin · $7 / 1 GB | No |
| `SQUARE_CLOUD_PLAN_VARIATION_ID` | optional pin · $17 / 10 GB | No |
| `SQUARE_CLOUD_PLAN_VARIATION_ID_37` | optional pin · $37 / 100 GB | No |
| `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7` | optional pin · Extra transfers on $7 (+$3/mo) | No |
| `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_17` | optional pin · Extra transfers on $17 (+$5/mo) | No |
| `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_37` | optional pin · Extra transfers on $37 (+$5/mo) | No |
| `EXTRA_TRANSFERS_ADDON_MONTHLY_USD` | optional workspace-wide price override | No |

Never create a `VITE_SQUARE_*` variable. Never commit live tokens.

The functions resolve private values from AWS Secrets Manager secret `secrets-bundle` first, then from same-named Netlify environment variables as a temporary fallback.

## Square configuration (Cloud subscription)

1. Create or select the authorized Portabase Square application and location.
2. Add the records above to the AWS `secrets-bundle` and/or Netlify env.
3. Cloud subscribe uses Square Catalog subscription plan + payment links (see `netlify/shared/square-cloud.mjs`).
4. Register `https://portabase.dev/api/square/webhook` for payment events if you still process webhooks.
5. **LIVE vs TEST:** functions default to **LIVE** (`production` / `connect.squareup.com`). Set `SQUARE_ENVIRONMENT=sandbox` (or `SQUARE_ENV=sandbox`) only for TEST. Prefer live if Louis already configured production tokens in `secrets-bundle` / Netlify.

If checkout is blocked, `/api/cloud/subscribe` returns `checkout_blocked` with the **exact missing var names** (`SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, catalog pins). Values are never printed.

## Endpoints

| Path | Role |
| --- | --- |
| `POST /api/cloud/subscribe` | **Current** — Cloud trial → chosen plan checkout |
| `POST /api/cloud/confirm-checkout` | Confirm subscription after redirect |
| `POST /api/square/checkout` | **Retired** — returns 410 |
| `GET /api/square/order` | Legacy order paid check ($147 Essentials) |
| `POST /api/license/claim` | Legacy platform-bound license for paid Essentials orders only |
| `POST /api/square/webhook` | Square HMAC-validated payment events |

## Fail-closed behavior

Cloud subscribe fails closed when Square config is missing. Invalid webhook signatures return HTTP 401. Errors are logged without tokens, keys, request bodies, or card data.

## Site password note

Netlify site-wide password protection intercepts anonymous webhook traffic. Remove blanket lock before enabling public Square webhooks.
