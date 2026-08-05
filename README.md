# Portabase.dev

Open-source, customer-owned Supabase continuity and recovery. Encrypted recovery capsules stay under your control. Optional **Portabase Cloud** adds a hosted console, telemetry, and multi-person alert chains — never custody of your keys.

Live site: [https://portabase.dev](https://portabase.dev)

**New AI / new engineer:** start with **[PROJECT.md](./PROJECT.md)** (what this is + what to do), then **[docs/HANDOFF.md](./docs/HANDOFF.md)** and **[AGENTS.md](./AGENTS.md)**.

License: **Apache-2.0** — see [LICENSE](./LICENSE) and [docs/OPEN_CORE.md](./docs/OPEN_CORE.md).

**Capsule key protection (open source):** [`utility/capsule-crypto.mjs`](./utility/capsule-crypto.mjs) — scrypt + AES-256-GCM. See [docs/KEY-PROTECTION.md](./docs/KEY-PROTECTION.md).

## Open core vs Cloud

| | Community (OSS) | Portabase Cloud |
| --- | --- | --- |
| Full backup / encrypt / verify / restore | Yes | Uses the same engine |
| Basic CLI / self-hosted runner | Yes | Yes |
| License required | **No** | N/A |
| Hosted console, fleet, escalation alerts | Self-wire webhooks | Paid product (early access) |
| Passphrase & capsule bytes | Always on your runner | Never received |

## Run the marketing site locally

```powershell
npm install
npm run dev
```

## Recovery utility (full capture by default)

```powershell
npm run portabase -- init
npm run portabase -- doctor
npm run portabase -- plan
npm run portabase -- backup
npm run portabase -- backup --trial   # optional limited demo sample
npm run portabase -- verify --capsule .\portabase-capsules\CAPSULE_NAME
npm run portabase -- status
npm run portabase -- restore --capsule .\portabase-capsules\CAPSULE_NAME
```

Optional Cloud telemetry (off by default): set `cloud.enabled` in config and `PORTABASE_CLOUD_URL` / `PORTABASE_CLOUD_TOKEN`. Schema: [docs/TELEMETRY_SCHEMA.md](./docs/TELEMETRY_SCHEMA.md).

## Production build

```powershell
npm run build
npm test
```

Deploy the static site from `dist/` to the isolated Netlify project for portabase.dev.

## Privacy model

- Readiness checks and encryption run on the customer runner.
- No analytics on the public site.
- Telemetry to Portabase Cloud is opt-in and health-metadata only.
- Credentials and passphrases never go to Portabase infrastructure.

## Portabase Cloud infrastructure

**Launch scope: Supabase only** — Cloud login is hosted Supabase Auth (email + Google). Cognito/AWS product identity is reserved for a later release (see [docs/LAUNCH-SCOPE.md](./docs/LAUNCH-SCOPE.md)).

Control plane: trial/billing (Square), Supabase account DB, optional ECS runners, CloudWatch:

- Launch scope: [docs/LAUNCH-SCOPE.md](./docs/LAUNCH-SCOPE.md)
- Design: [docs/CLOUD_INFRASTRUCTURE.md](./docs/CLOUD_INFRASTRUCTURE.md)
- Billing: [docs/BILLING.md](./docs/BILLING.md)
- Terraform (future AWS path / customer vault): [aws/cloud/](./aws/cloud/)
- Control-plane SQL: [supabase/cloud/0001_control_plane.sql](./supabase/cloud/0001_control_plane.sql)

## Docs

- **[Project handoff (for agents / new providers)](./docs/HANDOFF.md)** — start here for Claude or any successor
- [Agent rules](./AGENTS.md) — never F:; cloud spool for backups
- [Launch scope (Supabase only)](./docs/LAUNCH-SCOPE.md)
- [Open-core model](./docs/OPEN_CORE.md)
- [Security & trust](./docs/SECURITY-TRUST.md)
- [Billing](./docs/BILLING.md)
- [Replay proof](./docs/REPLAY.md)
- [Cloud infrastructure](./docs/CLOUD_INFRASTRUCTURE.md)
- [Product specification](./docs/PRODUCT_SPEC.md)
- [Essentials runbook](./docs/ESSENTIALS_RUNBOOK.md)
- [Telemetry schema](./docs/TELEMETRY_SCHEMA.md)
- [Restore drill](./docs/RESTORE_DRILL.md)

Portabase is independent and is not affiliated with Supabase, Inc.
