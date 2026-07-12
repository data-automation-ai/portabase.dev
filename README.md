# PortaBase.dev

Customer-owned Supabase continuity and recovery. This repository contains the public landing page, evidence archive, technical diagrams, and the customer-run recovery utility.

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

PortaBase uses a Square-hosted Payment Link for a one-time purchase. Card data never touches this application.

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

## PortaBase Essentials utility

PortaBase creates encrypted, checksummed recovery capsules without a PortaBase account, hosted API, credential relay, or telemetry endpoint:

```powershell
npm run portabase -- init
npm run portabase -- doctor
npm run portabase -- plan
npm run portabase -- backup
npm run portabase -- verify --capsule .\portabase-capsules\CAPSULE_NAME
npm run portabase -- status
npm run portabase -- restore --capsule .\portabase-capsules\CAPSULE_NAME
```

Essentials supports Google Drive, Dropbox, any compatible `rclone` remote, and local/NAS destinations. Capsules are encrypted locally with AES-256-GCM, copied under timestamped immutable names, verified after transfer, and retained with a guarded dry-run-first prune command. AWS S3, Object Lock, Fargate scheduling, CloudWatch, and infrastructure as code belong to the separate AWS Recovery package.

The restore command is a plan by default. Execution refuses the source project, requires a different target URL/ref, and requires `--execute --confirm-target <NEW_REF>`. Auth provider settings, API keys, external secrets, custom domains, and DNS still require explicit customer reconfiguration and verification.

See [the Essentials runbook](docs/ESSENTIALS_RUNBOOK.md) and [the package architecture](docs/PACKAGE_ARCHITECTURE.md).

PortaBase is independent and is not affiliated with Supabase, Inc.
