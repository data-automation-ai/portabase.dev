# PortaBase.dev

Customer-owned Supabase continuity and recovery. This repository contains the public landing page, evidence archive, technical diagrams, and the customer-run recovery utility.

Live site: [https://portabase.dev](https://portabase.dev)

## Run locally

```powershell
npm install
npm run dev
```

## Production build

```powershell
npm run build
```

The static output is written to `dist/` and deployed to the isolated Netlify site behind Cloudflare DNS.

## Deploy the landing page

The repository is bound locally to the isolated Netlify project `portabase-dev`; `.netlify/state.json` is ignored. After a successful build:

```powershell
netlify status
netlify deploy --prod --dir dist
```

Always confirm that `netlify status` reports `https://portabase.dev` before deploying. The explicit `netlify.toml` build/publish contract prevents the parent workspace's unrelated Netlify binding from determining this project's output.

## Square Checkout

PortaBase uses Square-hosted Checkout for the one-time $147 purchase. Payment links are created server-side, `/thanks` verifies the completed order directly with Square, and the signed webhook confirms payment events. Card data and Square private keys never enter the Vite browser bundle. See [the Square setup runbook](docs/SQUARE_SETUP.md).

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
npm run trial
npm run portabase -- verify --capsule .\portabase-capsules\CAPSULE_NAME
npm run portabase -- status
npm run portabase -- restore --capsule .\portabase-capsules\CAPSULE_NAME
```

Essentials supports Google Drive, Dropbox, any compatible `rclone` remote, and local/NAS destinations. Capsules are encrypted locally with AES-256-GCM, copied under timestamped immutable names, verified after transfer, and retained with a guarded dry-run-first prune command. AWS S3, Object Lock, Fargate scheduling, CloudWatch, and infrastructure as code belong to the separate AWS Recovery package.

The trial runs the real encryption, transfer, verification, and restore-plan path but intentionally captures database structure without rows, at most five Storage objects, and at most two Edge Functions. Every trial capsule includes a local HTML report with a button to open Square Checkout. It is explicitly not a complete recovery backup.

The restore command is a plan by default. Execution refuses the source project, requires a different target URL/ref, and requires `--execute --confirm-target <NEW_REF>`. Auth provider settings, API keys, external secrets, custom domains, and DNS still require explicit customer reconfiguration and verification.

See [the Essentials runbook](docs/ESSENTIALS_RUNBOOK.md), [hosting and scheduling guide](docs/HOSTING_AND_SCHEDULING.md), [the AWS Recovery runbook](aws/README.md), and [the package architecture](docs/PACKAGE_ARCHITECTURE.md).

The isolated Supabase scale-test dataset and its verified backup measurements are documented in [the mock warehouse report](docs/MOCK_WAREHOUSE.md).

PortaBase is independent and is not affiliated with Supabase, Inc.
