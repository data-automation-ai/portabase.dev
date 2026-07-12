# PortaBase.dev product specification

Status: working v1 definition

## Product promise

PortaBase is a one-time-purchase, customer-run continuity utility for Supabase. It continuously creates recovery capsules outside the customer's Supabase account so recovery does not depend on access to the original organization, dashboard, or managed backups.

PortaBase has no hosted control plane, customer account, credential vault, telemetry pipeline, backup relay, or access to customer data. Payment fulfillment data held by Square is outside this infrastructure zero-knowledge claim.

## Shared recovery capsule

Both packages capture and verify:

- PostgreSQL roles, schema, data, policies, triggers, functions, extensions inventory, cron inventory, and queues inventory
- Supabase Auth schema records required for an authorized migration
- Actual Storage object bytes, bucket metadata, object metadata, and checksums
- Edge Function source from the customer's local project and authorized remote inventory
- Auth, Realtime, Storage, API, domain, webhook, SMTP, redirect, and extension configuration inventory
- Encrypted manifest, per-file hashes, timestamps, source project reference, tool versions, and capture status
- A truthful `COMPLETE`, `PARTIAL`, or `FAILED` result; a missing subsystem can never produce a successful capsule
- Retention, verification, restore rehearsal, logs, and failure notification

Credentials are read only from the customer's local environment or provider CLI. Encryption keys remain customer-held.

## Package 1: PortaBase Essentials

Audience: small businesses, agencies, and independent developers who want a low-friction external recovery copy.

Destinations:

- Dropbox through a customer-authenticated `rclone` remote
- Google Drive through a customer-authenticated `rclone` remote
- Local folder or NAS as an optional additional destination

Delivery:

- Windows-first interactive installer and PowerShell-friendly CLI
- Scheduled hourly/daily capture using Windows Task Scheduler
- Cross-platform cron/systemd instructions where supported
- Encrypted, dated recovery capsules with configurable retention
- `init`, `doctor`, `backup`, `verify`, `status`, `prune`, `install-schedule`, `remove-schedule`, `plan-restore`, and guarded `restore` commands

No Google, Dropbox, Supabase, or database credentials pass through PortaBase infrastructure.

## Package 2: PortaBase AWS Recovery

Audience: production businesses requiring stronger immutability, monitoring, and a rehearsable recovery environment.

Includes everything in Essentials plus:

- Customer-owned Amazon S3 recovery vault
- S3 versioning and configurable lifecycle retention
- Optional S3 Object Lock; the installer must explain that Object Lock configuration has long-lived consequences
- AWS KMS customer-managed encryption key
- Least-privilege IAM roles and policies
- EventBridge scheduling and an optional customer-owned backup runner
- CloudWatch logs/alarms and SNS failure notifications
- Restore-runner infrastructure and isolated recovery networking where required
- CloudFormation and Terraform templates for the AWS resources
- Dry-run and drift reporting before any infrastructure change

CloudFormation provisions AWS resources only. It cannot create or recover a Supabase account.

Terraform may configure resources supported by the current Supabase provider only after the customer has created a fresh, authorized Supabase organization/project and supplied target credentials locally. Unsupported dashboard settings remain a generated, evidence-backed runbook.

## Recovery model

1. The customer creates a fresh, authorized Supabase account and empty target project.
2. PortaBase refuses to restore when the target reference matches the source project.
3. The customer must type the exact target reference and approve a generated restore plan.
4. PortaBase restores database/Auth material, then Storage objects, then Edge Functions and supported configuration.
5. PortaBase validates row counts, hashes, bucket/object counts, policies, users, Functions, and selected application probes.
6. PortaBase produces a residual-work report for keys, OAuth providers, SMTP, custom domains, webhooks, DNS, mobile endpoints, and any setting that cannot be safely automated.
7. Cutover remains customer-controlled and is never performed silently.

## Definition of done

- A clean-machine installation succeeds without machine-wide developer tooling beyond documented prerequisites.
- Repeated scheduled captures produce independently stored, encrypted capsules.
- Source access is then removed for the recovery drill.
- A new Supabase project is restored using only the capsule and target credentials.
- Database rows, Auth records, Storage bytes, Functions, hashes, and recovery reports are verified.
- Both package installers, upgrade/uninstall paths, documentation, and example configurations are tested.
- Marketing claims match demonstrated behavior and never describe a partial backup as full application recovery.
