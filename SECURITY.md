# Security

## Key protection code (open source)

| | |
| --- | --- |
| **Source of truth** | [`utility/capsule-crypto.mjs`](./utility/capsule-crypto.mjs) |
| **Algorithm** | scrypt → AES-256-GCM (`portabase-aes256gcm-v1`) |
| **Docs** | [`docs/KEY-PROTECTION.md`](./docs/KEY-PROTECTION.md) |
| **Customer page** | https://portabase.dev/security#keys-protected |

There is no closed-source encryptor for Escape capsules. Cloud jobs use the same module.

## Trust model

Portabase is designed so that **encryption keys and recovery data never need to leave the customer environment** on the standalone path. The open-source engine performs capture, AES-256-GCM encryption, transfer, verification, and guarded restore on a runner you control.

Optional Portabase Cloud accepts only **opt-in health metadata** (see `docs/TELEMETRY_SCHEMA.md`). Do not send passphrases, database URLs, service-role keys, or capsule contents to Cloud telemetry APIs.

## Reporting a vulnerability

Email **escape@portabase.dev** with a description, impact, and reproduction steps. Do not open a public issue for active exploits against customer systems.

## Scope notes

- Capsule passphrase strength and key storage are customer responsibilities.
- Hosted Cloud ingest tokens protect telemetry endpoints, not customer data planes.
- Legacy offline license signatures are not a security boundary for open-core feature access.
