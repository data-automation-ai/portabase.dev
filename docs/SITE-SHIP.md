# Site ship checklist — portabase.dev

Use this when deploying the marketing + Cloud SPA to Netlify.

## What this revision implements

1. **Backend** `/backend` in nav (capsules, workers, trust-boundary diagram).
2. **Capsule communication** — CLI runner ↔ encrypted capsules; no passphrase/plaintext in Cloud.
3. **Cloud-worker communication** — jobs/status/alerts; no credential proxy; no hosted capsule bytes.
4. **Trust-boundary diagram** — your vault/keys vs optional Cloud telemetry.
5. **CLI install CTA** — `npm i -g portabase` · [npm](https://www.npmjs.com/package/portabase) · [DataAutomation-ai/portabase-CLI](https://github.com/DataAutomation-ai/portabase-CLI).
6. **Fill-missing docs** — absent-only Storage/DB fill; `--writers` default 1; not incremental sync.
7. **Restore-order docs** — tables → views → procs/RPCs → Edge Functions → data (+ Storage/permissions).
8. **export-manifest / capsule-unload** — names only, no secrets.
9. **`--report-drift`** — opt-in MD5 / row-count / RBAC.
10. **Security refresh** — Cloud never stores capsules or passphrases; least-privilege if a job key is held briefly.
11. **Pricing** — **Cloud Free 100 MB (manual)**. Square **$7** one DB ≤10 GB 1/24h · **$17** unlimited DBs ≤25 GB 3/day. Hidden legacy `$37`. Table/bucket sizer include/exclude.
12. **Download/run paths** — Local Starter vs S3/Dropbox/Drive/rclone; staging/disk warning.
13. **Console IA** — capsule management (not content browser), key injection (customer-side), gauges, **Telemetry graphs**, **Open capsule** wizard, worker health.
14. **Auth/trial funnel** — email + Google + magic link → trial → connect project → first capsule proof; no hosted-vault promise.
15. **Legal** — `/legal` not affiliated with Supabase, Inc.; customer owns destinations and keys.
16. **Docs cross-links** — Backend ↔ Security ↔ Cloud ↔ Escape ↔ Docs; footer + next links.
17. **Ship-ready** — this checklist + Netlify env names below.

## Capsule UI (Louis correction)

The signed-in Capsules view **manages** capsules (register / schedule / verify / retention / destination / status) and **injects the seal key** on the customer side.

It is **not** a content explorer. **Provably zero-knowledge:** no object names, no table peek, no plaintext listing from Portabase Cloud. See `docs/ZERO-KNOWLEDGE.md`.

Key injection uses Web Crypto in the browser and/or `PORTABASE_ENCRYPTION_PASSPHRASE` on the CLI. Cloud never receives the secret.

## Transfer rate limits (Louis)

**$7** includes **one (1) capsule / rolling 24 hours**. **$17** includes **three (3) / day**. Cloud Free is **manual only**. Dashboard shows used / allowance. Jobs API enforces the window on `type=backup`.

## Live Supabase viewer (Louis)

`/app/supabase-viewer` · `/tools/supabase-viewer`. **100% client-side** live project explorer (tables, optional rows, storage). Keys never sent to Portabase. Distinct from capsule ZK: this is the customer pointing their browser at **live** Supabase.

## Provably zero-knowledge (Louis · product law)

Website / Cloud APIs / dashboard / telemetry **cannot** show Storage object names, row contents, plaintext, or keys. No server-side decrypt path. Destination **type** only. See `docs/ZERO-KNOWLEDGE.md`.

## Telemetry graphs (Louis)

`/app` → **Telemetry**. Success/fail bars, duration and encrypted-byte lines, plan/worker/rescue gauges, drift counts, status timeline. Health signals only. Demo series labeled until live ingest is connected.

Forbidden from the site / Cloud control plane: Storage object names/paths, table rows, capsule plaintext inventory, anything that implies we can open the archive.

## Open capsule (Louis)

`/app` → **Open capsule** (also Capsules → Open locally). Wizard: local file **or** CLI. Copy: **Portabase cannot open this for you.** Browser decrypt is an honest stub (`BROWSER_DECRYPT.supported = false`). Full open is `portabase verify --decrypt` on the customer runner.

## Deploy (Netlify → portabase.dev)

1. Connect this repo; build command `npm run build`; publish `dist`; Node 24 (`netlify.toml`).
2. SPA fallback already set: `/*` → `/index.html`.
3. Set env vars from `.env.example` (no live secrets in git):

| Name | Who sets it |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Louis — hosted Auth project |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Optional build-time public |
| Google client ID/secret | **Supabase Auth → Providers → Google** (not Netlify) |
| `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID` / `SQUARE_WEBHOOK_SIGNATURE_KEY` | Louis — Square |
| `SQUARE_ENVIRONMENT` (`sandbox` \| `production`) | Louis |
| `SQUARE_CLOUD_PLAN_VARIATION_ID_7` / `_17` or default / `_37` | Louis — after catalog create |
| `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7` / `_17` / `_37` | Louis — Extra transfers catalog IDs (+$3 / +$5 / +$5) |
| `PORTABASE_SITE_URL=https://portabase.dev` | Production |

4. Supabase Auth redirect URLs: `https://portabase.dev/auth/callback` and local `http://localhost:5173/auth/callback`.
5. Remove any site-wide Netlify password before Square webhooks.
6. Verify: `/` `/backend` `/docs` `/security` `/cloud` `/legal` `/login` `/app?demo=1` `/app/telemetry?demo=1` `/app/inspect?demo=1` `/app/supabase-viewer?demo=1`.

## Louis still needs to provide

- Google OAuth client ID + secret in the Supabase Auth provider (placeholders only in repo).
- Square catalog variation IDs for $7 / $17 (and hidden legacy $37 if still pinned).
- Confirm npm `portabase` publish matches [DataAutomation-ai/portabase-CLI](https://github.com/DataAutomation-ai/portabase-CLI).
