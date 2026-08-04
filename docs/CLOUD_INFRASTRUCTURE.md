# Portabase Cloud — hosted infrastructure

Status: engineering scaffold (v0.4 open-core)

This document defines how **Portabase Cloud** runs: authentication, control-plane data, per-user isolated runners, telemetry, and optional Tailscale access.

It does **not** replace the open-source recovery engine. Cloud is the hosted control plane + optional managed runner isolation. Capsule encryption keys remain customer-controlled.

## Launch scope

**v1 is Supabase-only** for product identity and customer sources (see [LAUNCH-SCOPE.md](./LAUNCH-SCOPE.md)). Cognito / AWS Cloud version code and Terraform remain for a later release.

## Design principles

1. **Control plane ≠ data plane.** Supabase (hosted account DB) stores workspaces, agents, alert policies, and health events. Capsule bytes and passphrases never land in that database.
2. **Identity at launch.** Users sign in with **hosted Supabase Auth** (email + Google). Profiles and tenancy use `auth.users.id` / RLS. Cognito remains reserved for a future AWS-native edge path.
3. **Strong tenant isolation for managed runners.** Each paid “hosted runner” is an isolated ECS Fargate task identity: own IAM role, secrets path, log group, security group rules, and optional Tailscale node.
4. **Telemetry is health metadata.** Agents POST allowlisted events (see `TELEMETRY_SCHEMA.md`). CloudWatch receives metrics/alarms; Supabase stores queryable event history for the console.
5. **Self-host always works.** Customer-run agents need only an agent token. Managed containers are optional convenience.

## High-level topology

```text
 Browser ──HTTPS──► Netlify (SPA + functions) / optional ALB later
                         │
                         ├─ Supabase Auth (login)
                         ├─ Supabase control plane DB
                         │    workspaces · agents · events
                         │    alert chains · subscriptions
                         │
                         └─ (later) ECS / CloudWatch for managed runners
                                      │
              customer destination    ▼  (S3 / Drive / Dropbox / NAS)
                         customer runner ◄── encrypted capsules
```

## Authentication

### Launch: Supabase only

| | |
| --- | --- |
| **Identity** | Hosted Supabase Auth (email + Google) |
| **Stable id** | `auth.users.id` |
| **API header** | `X-Portabase-Cloud-Version: supabase` |

Cognito (`version=aws`) is **not** offered in the UI. Flip `AWS_CLOUD_VERSION_ENABLED` in `src/lib/cloud-versions.js` when that product path ships. See `docs/AUTH_AND_TRIAL.md` and `docs/LAUNCH-SCOPE.md`.

### Control-plane DB: hosted Supabase

Use a **hosted** Portabase Cloud Supabase project (not customer projects; default ops project `ekklokrukxmqlahtonnc` unless docs say otherwise):

- `profiles` (`supabase_user_id` primary for website auth; optional `cognito_sub` reserved)
- `workspaces`, `workspace_members`
- `agents` (telemetry tokens, hashed)
- `projects` (customer Supabase project refs — labels only)
- `telemetry_events`
- `alert_policies`, `alert_channels`, `escalation_steps`
- `runners` (ECS task ARNs, status, Tailscale hostname)
- `subscriptions` (see `0002_subscriptions.sql`; SPA may use Netlify Blobs first)

RLS: members only see rows for workspaces they belong to. Service role is limited to trusted server functions.

### Why Supabase Auth first (and Cognito later)?

| Concern | Supabase Auth (launch) | Cognito (later / AWS edge) |
| --- | --- | --- |
| Website Google + email | Excellent | Possible, more setup |
| Multi-tenant app data + RLS | Excellent | Indirect |
| Realtime console updates | Yes | No |
| AWS API Gateway native JWT | Indirect | Excellent |
| Customer recovery data | Never | Never |

## Per-user / per-workspace isolation

### Isolation levels

| Level | Who | Mechanism |
| --- | --- | --- |
| **L0 · Agent only** | Default Cloud | Customer runs OSS agent; Cloud stores telemetry only |
| **L1 · Managed runner** | Paid | Dedicated ECS Fargate task in private subnet |
| **L2 · Hard isolation** | Higher tier | Separate task role, secret prefix, SG, log group; optional dedicated ENI / capacity provider |
| **L3 · Dedicated account** (future) | Enterprise | StackSets into customer or cell AWS accounts |

### Managed runner container

- Image: Portabase OSS engine + health sidecar (same Dockerfile family as `aws/Dockerfile`)
- Network: `awsvpc`, private subnets, egress only to Supabase, destinations, ECR, Secrets Manager, CloudWatch, Tailscale coordination
- Secrets: `arn:...:secret:portabase/tenants/{workspace_id}/runner` — customer-supplied source keys; encryption passphrase **customer-owned** (injected at runtime from customer KMS or prompted; never logged)
- CPU/memory: right-sized Fargate sizes; not Lambda (dump size)

### EBS volume images — always most recent backup

**Policy:** any restore, launch, or AMI rebuild that uses EBS snapshots **must take the most recent completed backup**. Do not pin a stale `snap-` / `ami-` id in runbooks or Terraform unless an explicit forensic override is required.

| Mechanism | Behavior |
| --- | --- |
| DLM lifecycle (`ebs_backups.tf`) | Snapshots volumes tagged `PortabaseBackup=true` on a schedule; retains the newest N |
| Terraform `data.aws_ebs_snapshot.latest` | `most_recent = true`, `status = completed` only |
| Terraform `data.aws_ami.latest_portabase` | `most_recent = true`, EBS root device only |
| `scripts/aws-latest-ebs-snapshot.ps1` | CLI helper; refuses pinned IDs without `-ForceOverride` |
| Override | `ebs_snapshot_override_id` / `-ForceOverride` only for intentional rollback |

Tag volumes that should enter the rolling snapshot set:

```text
PortabaseBackup = true
```

### Scheduling

- EventBridge Scheduler → `ecs:RunTask` with tenant-specific overrides
- Missed runs detected by CloudWatch metric math + agent heartbeats in Supabase

## Telemetry & observability

### Ingest path

1. Agent → `POST /api/cloud/telemetry` (Bearer agent token)
2. API validates token hash against Supabase `agents`
3. Event written to Supabase `telemetry_events`
4. Metrics emitted to CloudWatch EMF / `PutMetricData` (`Portabase/Cloud` namespace)
5. Alarms on: failed backup, missed heartbeat, high error rate

### CloudWatch

| Resource | Use |
| --- | --- |
| Log groups | `/portabase/cloud/api`, `/portabase/tenants/{id}/runner` |
| Metrics | `BackupSuccess`, `BackupFailure`, `HeartbeatAgeHours`, `RunnerCpu` |
| Alarms | SNS topics per workspace escalation policy |
| Dashboards | Ops overview (internal) + exportable for enterprise |

### Alert chains

Supabase `escalation_steps` ordered by `step_order` with `delay_seconds` and channel type (`sms`, `email`, `slack`, `webhook`). A small worker (EventBridge + Lambda) walks the chain until ack.

## Tailscale (optional secure client access)

Purpose: let a customer admin **securely reach their managed runner** for debugging, `portabase doctor`, or break-glass without public SSH.

### Pattern A — Tailscale sidecar / userspace (recommended start)

- Runner task starts: engine + `tailscaled` userspace or privileged sidecar with auth key from Secrets Manager
- Auth key is **ephemeral, tagged** (`tag:portabase-runner`, `tag:tenant-{id}`)
- ACL: only customer’s Tailscale user/group can SSH or HTTPS to that node
- No public port 22; ECS security group denies inbound from internet

### Pattern B — Subnet router cell

- One Tailscale subnet router per AZ advertises private runner CIDR
- Higher ops cost; better for many runners

### Operator notes

- Store Tailscale OAuth client / reusable auth keys in Secrets Manager
- Rotate keys on runner recreate
- Never put Tailscale keys in Supabase tables in plaintext
- Document that Tailscale access is **to the runner OS/process**, not a bypass of capsule encryption

Terraform flag: `enable_tailscale = true` adds IAM + secret placeholders + task definition mount for Tailscale.

## Repository layout

```text
aws/cloud/
  README.md
  terraform/
    main.tf              # root module
    variables.tf
    outputs.tf
    cognito.tf
    network.tf
    ecs.tf
    api.tf
    telemetry.tf
    secrets.tf
    modules/
      tenant_runner/     # per-workspace Fargate isolation
supabase/
  cloud/
    0001_control_plane.sql
```

## Trust checklist (do not ship without)

- [ ] Agent tokens hashed at rest; shown once
- [ ] No passphrase fields in Supabase schema
- [ ] Runner task role cannot read other tenants’ secret prefixes
- [ ] CloudWatch log retention + no secret echo in app logs
- [ ] Cognito MFA available for workspace owners
- [ ] Tailscale ACLs deny cross-tenant node access
- [ ] Public marketing still states Cloud ≠ capsule custody

## Deployment order

1. Create hosted Supabase project; apply `supabase/cloud/0001_control_plane.sql`
2. `terraform apply` network + Cognito + ECS cluster + API + CloudWatch
3. Configure Cognito app client callback URLs for console domain
4. Set Supabase URL + service role in API Lambda secrets
5. Provision first tenant runner module / workspace via API
6. (Optional) enable Tailscale secrets and redeploy runner task def
