# Portabase package architecture

## The shared premise

Both packages solve the same dependency problem: recovery material must already exist outside the original Supabase account before account access, billing state, credentials, or the project itself becomes unavailable.

Both packages use the same recovery-capsule format and the same local capture, encryption, integrity, retention, and guarded-restore engine. The package changes where execution runs, where capsules live, and how much of the recovery workspace is pre-provisioned.

## Portabase Essentials: independent recovery copy

### Best fit

- Small Supabase projects
- Independent developers and agencies
- Customers already paying for Google Drive or Dropbox
- Customers who value low setup friction over the shortest possible recovery time

### Topology

1. Portabase runs on a customer computer, NAS, or always-on server.
2. A local scheduler launches the capture at the chosen interval.
3. Portabase captures database/Auth material, actual Storage objects, Edge Function source, and configuration inventory.
4. The capsule is hashed and encrypted locally.
5. The encrypted capsule is copied through the customer's existing `rclone` authorization to Google Drive or Dropbox.
6. Portabase verifies the remote copy and applies local and remote retention without using destructive sync semantics.

### What it promises

- A complete, independently controlled recovery artifact
- No Portabase account, hosted service, credential relay, or telemetry
- Guided recovery into a fresh authorized Supabase project
- Configurable recovery-point objective based on the schedule

### What it does not promise

- A running standby application
- Instant failover
- Guaranteed upload speed through consumer file-sync APIs
- Recovery without downloading/decrypting the selected capsule and authorizing a target project

### Engineering implications

- Use append-only, timestamped capsule directories; never mirror-delete the destination.
- Prefer a scope limited to files created by the customer's rclone remote where the provider supports it.
- Split very large capsule payloads into deterministic chunks and record every chunk hash in the manifest.
- Verify the destination using remote listings and hashes where supported; label a destination partial when provider hash semantics are insufficient.
- Treat Google Drive or Dropbox trash/version history as convenience, not the retention authority. Portabase retention remains explicit and independently reported.
- Report realistic restore readiness: `CAPSULE VERIFIED` is not `APPLICATION RECOVERY PROVEN`.

### Expected recovery profile

- RPO: typically one hour or one day, customer configured
- RTO: typically hours and dependent on capsule size, download speed, target creation, and Supabase import time
- Operating cost: the customer's existing Drive/Dropbox storage plan and local execution resources

## Portabase AWS Recovery: immutable vault and restore workspace

### Best fit

- Production businesses
- Larger databases or Storage footprints
- Customers requiring immutability, auditability, alerts, or formal recovery drills
- Customers willing to provision a dedicated AWS recovery account

### Recommended account boundary

Use a dedicated customer-owned AWS account for recovery, separate from the application account when practical. Protect its root user with MFA, retain break-glass access, and restrict the Portabase runner to a purpose-built least-privilege role.

### Topology

1. The included CloudFormation template creates the recovery account resources. Customers with a Terraform standard can translate the same documented resource boundary.
2. EventBridge Scheduler launches an ECS Fargate backup task at the configured interval.
3. The task pulls authorized data directly from Supabase and writes encrypted capsules to S3.
4. S3 Versioning preserves overwritten keys; lifecycle rules manage cost and retention.
5. Optional S3 Object Lock protects selected capsule versions from deletion or overwrite.
6. KMS protects S3 objects, with deletion protection and documented break-glass ownership for the key.
7. CloudWatch captures execution logs and metrics; SNS delivers failure notices directly to the customer.
8. The same Fargate image can be launched on demand as a restore runner after the customer authorizes a fresh Supabase target.

### Why Fargate rather than Lambda

Database dumps and large Storage transfers can exceed short-function execution and ephemeral-storage assumptions. A scheduled Fargate task supports a containerized PostgreSQL/Supabase toolchain, adjustable CPU/memory/ephemeral storage, long-running transfers, and the same image for backup and restore.

### What “ready-to-go recovery point” means

It means the vault, encryption, runner image, permissions, logging, alarms, and restore task definition already exist and have been tested. It does not mean a replacement hosted Supabase account is running continuously.

At recovery time the customer still:

1. Creates or selects a fresh authorized Supabase organization/project.
2. Stores target credentials in the customer-controlled recovery environment.
3. Reviews the generated plan and confirms the exact target project reference.
4. Launches the guarded restore task.
5. Completes settings that cannot be safely exported or automated, then performs customer-controlled cutover.

### Object Lock safety

- S3 Object Lock requires Versioning.
- Start with Governance mode and a short tested retention period.
- Never default a small customer into Compliance mode.
- Enabling Object Lock has long-lived bucket consequences and must require explicit confirmation.
- KMS key loss can make a perfectly preserved capsule unreadable, so key recovery is part of the drill.

### Expected recovery profile

- RPO: commonly hourly; shorter intervals are possible after load and egress testing
- RTO: potentially under a few hours for modest workloads, but never promised until a timed drill proves it
- Operating cost: S3, KMS, Fargate execution, logs, notifications, egress, and optional Object Lock/replication costs paid directly by the customer

## Product positioning

| Capability | Essentials | AWS Recovery |
| --- | --- | --- |
| Customer-owned destination | Drive, Dropbox, local/NAS | Dedicated AWS account and S3 |
| Execution | Customer machine/server | Scheduled ECS Fargate task |
| Immutability | Encrypted append-only capsules | S3 Versioning plus optional Object Lock |
| Monitoring | Local status and direct notification | CloudWatch metrics/logs plus SNS |
| Infrastructure as code | Scheduler/install scripts | Included CloudFormation stack |
| Restore workspace | Customer machine | Predefined Fargate restore task |
| Best description | Independent recovery copy | Recovery vault and restore workspace |

Neither package should be called a hot standby. The higher-value promise is customer-owned, verified recoverability without Portabase ever receiving the credentials or the data.
