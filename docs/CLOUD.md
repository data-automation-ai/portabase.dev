# Portabase Cloud — how the commercial layer sits on the free CLI

Portabase Cloud is **not** a second engine. The free open-source CLI already does capture, restore, doctor, verify, exclude flags, and capsule destinations. Cloud **layers** managed runners, Square checkout, a dashboard, scheduled jobs, telemetry reports, and optional SMS on $17.

Say **open source**, not OSS.

## What you already get for free

| Free CLI | Cloud adds |
| --- | --- |
| `portabase doctor` / `backup` / `verify` / `restore` / `replay` | Same commands, invoked on a managed runner |
| `--exclude-binaries`, `--exclude-table-list` (existing flags only) | Same flags — **no new free-CLI capture features** |
| Encrypted capsule to S3 / Dropbox / local | Guided destinations; vault still customer-owned |
| You run it on a machine you control | Per-subscriber **sleeping container** until a transfer starts |

Most Supabase users can stay on the free path. Cloud is convenience: GUI, schedule, telemetry, SMS.

## Never-hold-keys threat model

```text
Browser  --seals keys-->  customer Cloud Runner (container)
                              │
                              ├─ runs free engine (pg_dump + Edge Functions + Storage → encrypted capsule → restore)
                              └─ one-way telemetry (status / hashes / sizes)
                                      │
                                      ▼
                         Portabase control plane
                         (lifecycle + job metadata only)
```

| Party | May hold | Must not hold |
| --- | --- | --- |
| **Customer browser** | Source keys, passphrase, destination credentials (briefly, in-tab) | — |
| **Cloud Runner** | Sealed keys for the job window; ephemeral spool | Long-term capsule vault |
| **Portabase control plane** | Runner id, job id, status, phase, timestamps, counts, sizes, capsule/layer **hashes**, destination **kind**, safe error, daily meter bytes | Keys, passphrase, capsule bytes, row bodies, function source |
| **SMS (optional on $17)** | Status string + job id | Keys, capsule bytes, customer data |

The browser seals keys **to the runner**. `POST /api/cloud/runners` and the rest of `/api/cloud/*` reject secret-shaped bodies. There is **no** SSH or get-key path into a runner from the control plane.

Honest limit: Cloud isolation is **designed**, not claimed proven-green. Checks in this repo cover allowlists and unit behavior. They are not a completed isolation audit. If you need zero Portabase key path, run the free CLI on infrastructure only you operate.

## Proven vs not

| Proven in repo (unit / wiring) | Not proven |
| --- | --- |
| Product constants $7 / 1 GB · $17 / 10 GB · $37 / 100 GB | Live Square catalog IDs until Louis pins them |
| Checkout fails closed with **exact env var names** when Square is missing | Live charge in production |
| Webhook / confirm-checkout activate a paid plan on `/api/cloud/me` | End-to-end paid subscriber on portabase.dev |
| Runner sketch: sleeping container + free-engine argv + seal-to-runner | Production ECS/Fargate isolation audit |
| Control plane store: hosted Supabase primary + one persistent SQLite replica | Live outage drill |
| Dashboard view-model + `/api/cloud/dashboard` + empty/demo labels | Live job ingest on portabase.dev |
| Dashboard lamp stays **red** unless a real dry-run/compare is MATCH | A green lamp on demo or empty data (forbidden) |
| Telemetry allowlist + SMS status-only builder | Twilio delivery in production |
| GitHub / Google / email / magic-link sign-in wiring | Provider enablement in Supabase Auth (Louis) |
| SMS toggle UI (status-only) | Twilio send path + Square customer portal |

## Square LIVE vs TEST

| Mode | How |
| --- | --- |
| **LIVE** (preferred) | Omit `SQUARE_ENVIRONMENT` or set `production`. Functions default to `https://connect.squareup.com`. |
| **TEST** | `SQUARE_ENVIRONMENT=sandbox` or `SQUARE_ENV=sandbox`. |

Secrets live in Louis’s AWS `secrets-bundle` and/or Netlify env — never in git, never printed.

Required: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`.  
Webhook: `SQUARE_WEBHOOK_SIGNATURE_KEY`.  
Catalog pins: `SQUARE_CLOUD_PLAN_VARIATION_ID_7`, `SQUARE_CLOUD_PLAN_VARIATION_ID` ($17), `SQUARE_CLOUD_PLAN_VARIATION_ID_37`, plus Extra transfers `SQUARE_EXTRA_TRANSFERS_ADDON_VARIATION_ID_7` / `_17` / `_37`.

## Auth

Supabase Auth: **email**, **magic link**, **Google**, **GitHub**. Enable each provider on the hosted Auth project (not `ekklokrukxmqlahtonnc` as a write dest). Redirect: `https://portabase.dev/auth/callback`. After sign-in the SPA goes to **`/dashboard`**.

Site chrome shows **Sign in** vs **Dashboard** from the local session (Supabase access token). `/login` redirects an already-signed-in user to the dashboard.

## Customer dashboard

Route: **`/dashboard`** (also `/app` lands here). Demo: **`/dashboard?demo=1`** — labeled **sample UI**, never live customer data.

| Section | What it shows |
| --- | --- |
| **Telemetry** | Job status, phase, started/finished, object counts, sizes, destination kind, runner region, safe error codes |
| **Charts** | Capsule size over time, success/fail, bytes / day vs plan cap, object counts. Empty charts when no jobs |
| **Capsule sizes** | Per job: total + DB / Storage / Functions when hashes/counts exist |
| **Backup log** | Chronological capture/restore with status, times, size, MATCH / red lamp, detail links |
| **Utilities** | Doctor preflight, verify result, `--exclude-binaries` / `--exclude-table-list` (and `--force-orphan-fks` only if the runner reported it), customer-owned destination hints, schedule toggles, SMS opt-in on $17 / $37 |

View-model: `src/lib/dashboard-view.js`. API: `GET /api/cloud/dashboard` (Bearer). Empty signed-in workspaces do **not** seed fake jobs.

**Proof lamp:** stays **RED** until a real dry-run/compare from the CLI or Cloud Runner is MATCH. Demo / empty / mocked reports cannot turn it green.

Account strip: plan ($7 / $17 / $37), Extra transfers, Square checkout. Customer portal URL is **not** wired until Louis pins it.

## Control-plane store

Hosted Supabase is primary. One persistent on-disk SQLite file is the replica / live fallback (essentials only). See `docs/CLOUD_CONTROL_PLANE_STORE.md`. Never write to source project `ekklokrukxmqlahtonnc`. Capsule bytes never land on Portabase servers.

## Code map

| Piece | Path |
| --- | --- |
| Free engine | `utility/portabase.mjs` |
| Runner container | `cloud/runner/` |
| Control plane store | `cloud/control-plane/` |
| Square | `netlify/shared/square-cloud.mjs`, `square-ready.mjs` |
| Runners API | `netlify/functions/cloud-runners.mjs` |
| Proof lamp | `src/lib/proof-status.js` |
| Dashboard view-model | `src/lib/dashboard-view.js` |
| Customer dashboard UI | `src/console/customer-dashboard.jsx` · `/dashboard` |
| Dashboard API | `netlify/functions/cloud-dashboard.mjs` |
| SMS allowlist | `src/lib/sms-safe.js` |
