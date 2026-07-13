# Square Checkout setup

PortaBase uses Square-hosted Checkout for the one-time $147 Essentials license. The browser receives only a Square payment-link URL. Card details never touch PortaBase. The success page verifies the completed order server-side, and the webhook validates Square's HMAC-SHA256 signature against the exact public notification URL and raw request body.

## Required configuration

| Runtime name | AWS `secrets-bundle` selector | Browser-visible |
| --- | --- | --- |
| `SQUARE_ACCESS_TOKEN` | `square.access_token` | No |
| `SQUARE_LOCATION_ID` | `square.location_id` | No |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | `square.webhook_signature_key` | No |
| `SQUARE_ENV` | not secret; `production` or `sandbox` | No |
| `PORTABASE_SITE_URL` | not secret; `https://portabase.dev` | No |
| `PORTABASE_LICENSE_PRIVATE_KEY` | `portabase-license-private-key` flat bundle record | No |

The functions resolve the three private values from AWS Secrets Manager secret `secrets-bundle` first, then from same-named Netlify environment variables as a temporary fallback. Never create a `VITE_SQUARE_*` variable.

## Square configuration

1. Create or select the authorized PortaBase Square application and location.
2. Add the three records above to the AWS `secrets-bundle` using the exact service/key selectors.
3. In Square Developer Dashboard, register `https://portabase.dev/api/square/webhook` as the webhook notification URL.
4. Subscribe it to `payment.created` and `payment.updated`.
5. Copy that endpoint's signature key to `square.webhook_signature_key`. It is not the access token.
6. Set `SQUARE_ENV=sandbox` for the end-to-end sandbox test. Complete a checkout, confirm `/thanks` verifies the order, and confirm Square receives HTTP 200 from the webhook.
7. Replace the sandbox values with production values, set `SQUARE_ENV=production`, redeploy, and perform one controlled live purchase/refund test.

## Fulfillment

After the success page re-verifies the completed order, the customer selects Windows, macOS, or Linux and calls `/api/license/claim`. A strongly consistent Netlify Blobs claim record binds the order to the first selected platform. The function then signs and returns the lifetime offline license file; the same platform can download it again, while a different platform receives HTTP 409. This protects the one-platform purchase without sending product credentials or backup metadata to PortaBase.

The application imports and verifies the license locally. Keep a separate protected copy of the license file with the customer's recovery documentation.

## Deployment gate

Netlify site-wide password protection intercepts anonymous webhook traffic. While the temporary site password is enabled, Square cannot deliver `/api/square/webhook` events. Remove or replace that blanket lock with route-aware access control before enabling public checkout, then repeat the signed webhook acceptance test.

## Fail-closed behavior

Checkout returns HTTP 503 when payment configuration is missing. Order verification never trusts a query string or redirect alone: it retrieves the order from Square and requires a completed $147 PortaBase Essentials line item. Invalid webhook signatures return HTTP 401. Errors are logged without tokens, keys, request bodies, or card data.

## Endpoints

- `POST /api/square/checkout` creates a new idempotent Square payment link.
- `GET /api/square/order?order_id=...` verifies the completed Square order.
- `POST /api/square/webhook` validates and accepts subscribed Square payment events.
- `POST /api/license/claim` re-verifies a completed order, binds its platform, and returns the signed lifetime license.
