# AWS Capsule V2 scaffold

Open-source, read-only design for a **customer-owned encrypted AWS escape package**.

Portabase never holds sealing keys, AWS keys, or capsule bytes. The **client runner** uses the standard AWS credential chain (instance role preferred). This directory does **not** create snapshots and `--live` mutate stays refused.

## Commands

```bash
node utility/portabase.mjs aws inventory --fixture utility/aws/fixtures/sample-account.json
node utility/portabase.mjs aws doctor --fixture utility/aws/fixtures/sample-account.json
node utility/portabase.mjs aws plan --fixture utility/aws/fixtures/sample-account.json
```

`--live`, `--snapshot`, `--create-snapshot`, `--mutate`, and `--execute` are refused. `plan` is dry-run only. Without `--fixture`, missing runner AWS credentials fail closed. `--require-aws` enforces the chain even with a fixture.

Binaries = most recent completed backups. The capsule scripts the runs. Portabase never holds the bytes.

Supabase `portabase doctor` / `backup` / `replay` are unchanged.

## Versions

| Field | Value |
| --- | --- |
| Capsule format | `2.0.0` (`portabase-aws-capsule`) |
| Inventory schema | `1.0.0` |
| Default profile | `exclude-binaries` |

## Layout

| File | Role |
| --- | --- |
| `versions.mjs` | Format + schema versions; proven stays false |
| `package-shape.mjs` | Same on-disk files as a Supabase capsule |
| `readonly-aws-cli.mjs` | AWS CLI allowlist — CreateSnapshot refused |
| `schema.mjs` | Manifest validator + JSON Schema export |
| `interfaces.mjs` | boto3-shaped **read-only** collector contracts |
| `inventory.mjs` | Fixture → normalized resources + dependency edges |
| `latest-backup.mjs` | Most-recent completed snapshot / AMI / S3 series (PS policy, no AWS mutate) |
| `run-plan.mjs` | Dry-run command sequence for operator / Combo |
| `binary-decision.mjs` | Script vs binary tree (prefer latest snap, S3 exclude, …) |
| `doctor.mjs` | will-copy / will-warn / will-fail report |
| `cli.mjs` | `aws inventory` / `aws doctor` / `aws plan` |
| `runner-auth.mjs` | Credential-chain detection; fail closed; never logs secrets |
| `iam/` | MAP (list/describe) vs SHIP (export) least-privilege sketches |
| `fixtures/sample-account.json` | Deterministic unit-test account |

## Docs

- [docs/AWS_CAPSULE.md](../../docs/AWS_CAPSULE.md)
- [docs/AWS_INVENTORY.md](../../docs/AWS_INVENTORY.md)
- [docs/AWS_RUN_PLAN.md](../../docs/AWS_RUN_PLAN.md)
- [docs/AWS_RUNNER_AUTH.md](../../docs/AWS_RUNNER_AUTH.md)
