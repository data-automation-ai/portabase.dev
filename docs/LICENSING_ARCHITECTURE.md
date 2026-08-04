# Licensing and open-core commercial model

**Supersedes** the closed $147 lifetime software-unlock model.

## Current model

Portabase is **Apache-2.0 open source**. Full backup and restore require no commercial license.

| Product | Access | Monetization |
| --- | --- | --- |
| Recovery engine, CLI, basic GUI, capsule format | Open source | Free |
| Portabase Cloud console niceties, telemetry, multi-person alert chains | Hosted SaaS | Paid subscription (in development) |

See [OPEN_CORE.md](./OPEN_CORE.md).

## Legacy offline license files

The Ed25519 license verifier remains for:

- Historical Square orders that already issued platform-bound license files
- Regression tests of the signature format
- Optional legacy import in desktop (no feature unlock)

`resolveEdition()` always returns `community` unless the operator explicitly requests demo mode (`--trial` / `PORTABASE_EDITION=trial`).

## What we never do

- Gate encryption, full capture, or restore behind a paywall
- Put license checks on the backup critical path through a Portabase server
- Claim JavaScript packaging is strong copy protection

## Cloud entitlements (future)

Cloud subscriptions will authorize:

- Agent tokens for telemetry ingest
- Console workspace seats
- SMS / escalation routing capacity

They will **not** authorize the right to run the recovery engine offline.
