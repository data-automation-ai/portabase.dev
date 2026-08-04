# Portabase.dev product specification

Status: open-core v0.4 working definition

## Product promise

Portabase creates encrypted recovery capsules for Supabase **outside** the customer's Supabase account so recovery does not depend on the original organization, dashboard, or managed backups.

Two ways to run it:

| Path | Who stages the job | Final capsule vault |
| --- | --- | --- |
| **Portabase Cloud (sold)** | **Portabase managed runners** — customer does not use a laptop disk | **Customer BYO destination** (S3, etc.) |
| **Standalone open-source engine** | Customer — **local disk or their cloud** working store (script is flexible) | Customer-chosen destination |

The recovery engine is **Apache-2.0 open source**. Cloud sells managed staging + console + alerts. Neither path makes Portabase the long-term landlord of recovery bytes.

## Shared recovery capsule

Open-source capture and verify include:

- PostgreSQL roles, schema, data, policies, triggers, functions, extensions inventory, cron inventory, and queues inventory
- Supabase Auth schema records required for an authorized migration
- Actual Storage object bytes, bucket metadata, object metadata, and checksums
- Edge Function source from the customer's local project and authorized remote inventory
- Auth, Realtime, Storage, API, domain, webhook, SMTP, redirect, and extension configuration inventory
- Encrypted manifest, per-file hashes, timestamps, source project reference, tool versions, and capture status
- A truthful `COMPLETE`, `PARTIAL`, `TRIAL` (demo), or `FAILED` result

Credentials are read only from the customer's local environment or provider CLI. Encryption keys remain customer-held.

## Open-source Community (standalone script)

Audience: teams that want independent recovery without buying Cloud.

Includes:

- CLI and self-hosted runner
- **Flexible staging:** local drive **or** another customer-controlled cloud/VM disk (script may be extended either way)
- Basic management GUI (local / self-hosted)
- Destinations: Google Drive, Dropbox, rclone remotes, local/NAS, customer AWS path
- Full capture by default; optional `--trial` limited demo for safe drills
- Guarded restore into a fresh Supabase project
- Optional local webhook alerts

No customer credentials or capsules are required by the public website repo.

## Portabase Cloud (paid service)

Audience: teams who expect **Portabase to perform staging** and operate the control plane.

**Launch platform: Supabase only** (see [LAUNCH-SCOPE.md](./LAUNCH-SCOPE.md)).

Commercial defaults: **$17/mo** (Square), **7-day trial with card**, **up to 12 agents/runners**, **customer-provided capsule destination (BYO storage)**.

Includes:

- Hosted management console and setup wizards
- **Managed staging on Portabase runners** (not the customer’s laptop)
- Encrypted capsule written to the customer’s BYO destination
- Job status in console: running / finished / failed (progress % optional)
- Advanced monitoring (missed backups, RPO age, destination failures)
- Multi-person alert chains / escalation (SMS, email, Slack, webhooks)
- Team seats, fleet view, console audit log

Does **not** include: Portabase as permanent recovery vault; requiring local laptop staging for Cloud subscribers.

### Trust posture (customer choice)

Cloud subscribers pick how hard the locks are (see [SECURITY-TRUST.md](./SECURITY-TRUST.md) and `/security`):

Honest default: managed Cloud still has a **possibility that Portabase sees or uses key material during a run**. Customer KMS and audits reduce that; they do not claim zero. Standalone OSS if zero vendor key path is required.

| Option | Intent |
| --- | --- |
| **Trust Portabase** | We hold job encryption material for unattended simplicity; capsules still go to their BYO vault; **key visibility possible by design** |
| **Job CloudWatch / console** | **Always recorded** for managed jobs; customer has **retroactive** access in-product within retention — no “request logs” gate |
| **Customer CloudTrail** | Audit KMS/S3 use in *their* AWS account (always theirs when Trail is on; enable early for history) |
| **Customer KMS** | Crypto authority in *their* CMK; revocable grant |
| **Any combination** | Start simple; tighten later |
| **Standalone OSS** | Zero Portabase compute |

## Recovery model

1. The customer creates a fresh, authorized Supabase account and empty target project.
2. Portabase refuses to restore when the target reference matches the source project.
3. The customer must type the exact target reference and approve a generated restore plan.
4. Portabase restores database/Auth material, then Storage objects, then Edge Functions and supported configuration.
5. Portabase validates row counts, hashes, bucket/object counts, policies, users, Functions, and selected application probes.
6. Portabase produces a residual-work report for keys, OAuth providers, SMTP, custom domains, webhooks, DNS, mobile endpoints, and any setting that cannot be safely automated.
7. Cutover remains customer-controlled and is never performed silently.

## Definition of done

- A clean-machine or clean-VM installation succeeds with documented prerequisites.
- Repeated scheduled captures produce independently stored, encrypted capsules without a Portabase account.
- Source access can be removed for a recovery drill.
- A new Supabase project is restored using only the capsule and target credentials.
- Marketing claims match demonstrated behavior; demo/trial capsules are never described as complete recovery.
- Cloud marketing never implies Portabase can decrypt customer capsules.
