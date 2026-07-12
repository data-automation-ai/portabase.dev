# Portabase.dev

Customer-owned Supabase continuity and recovery. This repository contains the public landing page and a browser-local recovery readiness check.

## Run locally

```powershell
npm install
npm run dev
```

## Production build

```powershell
npm run build
```

The static output is written to `dist/` and is ready for Cloudflare Pages.

## Square checkout

Portabase uses a Square-hosted Payment Link for the one-time $47 purchase. Card data never touches this application.

```powershell
$env:SQUARE_ACCESS_TOKEN = 'your-production-token'
$env:SQUARE_LOCATION_ID = 'your-location-id'
$env:SQUARE_ENV = 'production'
npm run square:create-link
```

Copy the returned `square.link` URL into the Cloudflare Pages build variable `VITE_SQUARE_CHECKOUT_URL`, then rebuild/deploy. Do not prefix the access token with `VITE_`; Vite variables are public.

## Privacy model

- The readiness check is computed only in browser memory.
- No analytics or telemetry is installed.
- No Supabase or AWS credentials are requested by the site.
- The utility reads credentials only from the customer's local environment and uploads directly to their selected provider.

## Customer-side utility

Portabase creates checksummed recovery capsules without a Portabase account or API:

```powershell
npm run portabase -- init
npm run portabase -- doctor
npm run portabase -- plan
npm run portabase -- backup
npm run portabase -- verify --capsule .\portabase-capsules\CAPSULE_NAME
```

Supported destinations are AWS S3, Google Cloud Storage, Azure Blob Storage, Dropbox through `rclone`, and local storage. Provider credentials remain in the provider CLI or local environment; they are never written into `portabase.config.json`.

Portabase is independent and is not affiliated with Supabase, Inc.
