# Portabase Cloud — AWS infrastructure

Terraform for the **hosted control plane** and **optional per-tenant isolated runners**.

Full design: [docs/CLOUD_INFRASTRUCTURE.md](../../docs/CLOUD_INFRASTRUCTURE.md).

## What this stack creates

| Component | Resource |
| --- | --- |
| Auth | Cognito user pool + SPA app client (PKCE) |
| Network | VPC, public/private subnets, NAT, SGs |
| Compute | ECS Fargate cluster + optional tenant runner services |
| Secrets | KMS + path convention `portabase/tenants/{workspace_id}/*` |
| Observability | CloudWatch log groups, metric namespace, SNS alarm topic |
| API surface | HTTP API Gateway + Lambda authorizer stub wiring |
| Tailscale | Optional: secret placeholders + task env for auth key |

**Not in this stack:** customer capsule storage (customer-owned), Supabase project creation (apply SQL separately).

## Prerequisites

- Terraform ≥ 1.6
- AWS credentials for the Portabase Cloud account
- A hosted Supabase project with `supabase/cloud/0001_control_plane.sql` applied
- ECR image for the runner (build from `aws/Dockerfile` or OSS image)

## Quick start

```bash
cd aws/cloud/terraform
cp terraform.tfvars.example terraform.tfvars
# edit tfvars
terraform init
terraform plan
terraform apply
```

## Provision a tenant runner

After the root stack exists:

```bash
terraform apply -target=module.example_tenant_runner
# or call the tenant_runner module from your control-plane API
```

Pass:

- `workspace_id` — UUID from Supabase `workspaces`
- `project_ref` — customer Supabase ref (label)
- `enable_tailscale` — true to inject Tailscale auth key secret

## Environment variables (API Lambda)

| Name | Purpose |
| --- | --- |
| `COGNITO_USER_POOL_ID` | JWT issuer validation |
| `COGNITO_CLIENT_ID` | App client |
| `SUPABASE_URL` | Control-plane project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side RLS bypass for ingest/provision |
| `TELEMETRY_NAMESPACE` | `Portabase/Cloud` |
| `SNS_ALARM_TOPIC_ARN` | Default escalation bus |

## Easy IAM grants (minimum permissions)

Someone with **AWS admin** on a PC (does not need to know the console):

```text
scripts\Create-Export-Permissions.cmd
```

Creates users `portabase-export-map` (list only) and/or `portabase-export-ship` (copy binaries),
writes policy JSON + access keys to a Desktop folder. See `docs/BINARY_EXPORT_CREDENTIALS_AND_IAM.md`.

## Binary exports (easy path for operators)

### 1) Interactive pick — real dumps/images (recommended)

```powershell
.\scripts\export-binary-backups-interactive.ps1
```

- Scans backup buckets, groups into series  
- **Defaults to most recent backup only** per series  
- **Visual multi-select** (Out-GridView) + type `YES` to confirm  
- Uploads only what you confirmed to Dropbox `…/picked/<timestamp>/`  
- Optional: `-AlsoAmiImages` for latest CAPECE/Combo disk images  

### 2) Binary test mode (tiny fixtures)

Smoke-test the pipeline without multi-GB copies:

```powershell
.\scripts\export-aws-binary-backups-to-dropbox.ps1 -TestMode
.\scripts\test-binary-backup-mode.ps1 -Profile Tiny
.\scripts\test-binary-backup-mode.ps1 -Profile DiskSim   # +1 GiB disk-sim file
```

See [docs/BINARY_TEST_MODE.md](../../docs/BINARY_TEST_MODE.md).

## EBS volume images — most recent backup only

When selecting an EBS snapshot or EBS-backed AMI for restore/launch:

1. **Always** use the latest **completed** snapshot (or newest AMI) — `ebs_backups.tf`.
2. Tag volumes for DLM: `PortabaseBackup=true`.
3. Do not hardcode `snap-` / `ami-` ids in docs or modules.
4. Forensic rollback only: `ebs_snapshot_override_id` or  
   `scripts/aws-latest-ebs-snapshot.ps1 -SnapshotId snap-xxx -ForceOverride`.

```powershell
..\..\..\scripts\aws-latest-ebs-snapshot.ps1 -Json
..\..\..\scripts\aws-latest-ebs-snapshot.ps1 -AsAmi -Json
```

## Security notes

- Task roles are scoped with `secret_prefix` — never use a single shared secret ARN for all tenants.
- Agent tokens: hash with SHA-256 before insert into `agents.token_hash`.
- Tailscale auth keys: Secrets Manager only; rotate on runner replace.
- Do not put encryption passphrases in Terraform state; customers set runner secrets out of band or via a sealed console flow.
