# Portabase AWS Capsule V2

**Status:** design + read-only scaffold. Not a proven AWS restore product.  
**Code:** [`utility/aws/`](../utility/aws/) · **Inventory catalog:** [AWS_INVENTORY.md](./AWS_INVENTORY.md)

This is an **AWS account escape package** in the same shape as Supabase Portabase: a **customer-owned encrypted capsule**. Portabase never holds sealing keys and never hosts capsule bytes.

It is **not** Cloud login (Cognito stays off). It is **not** the existing [`aws/`](../aws/) recovery stack, which provisions a customer vault so a *Supabase* capsule can land on S3. Those remain separate.

Launch capture flags for the free Supabase CLI are unchanged.

---

## 1. Product intent

Capture **every account aspect that is IaC-exportable or API-describable** — except binaries — into an encrypted capsule. **Binaries = most recent completed backups** (EBS snapshot / AMI / S3 series object). The capsule stores those **IDs** and **scripts the runs** the operator / Combo must execute. Portabase **never holds the bytes**.

Do **not** dump raw disk into `.pbase`. Prefer an **existing most-recent completed snapshot** over `CreateSnapshot`. Only recommend `CreateSnapshot` (AMI when the instance image is the unit) when latest-resolve finds none — and this CLI still will not create it.

Policy (product law, ported to [`utility/aws/latest-backup.mjs`](../utility/aws/latest-backup.mjs) and CI-tested):

- ALWAYS the most recent **completed** EBS snapshot / AMI (`scripts/aws-latest-ebs-snapshot.ps1`)
- Refuse a pinned older snap without loud `ForceOverride`
- Most recent EBS/AMI per critical workload; S3 backup series latest only; `CreateStoreImageTask` for latest AMIs (`scripts/export-aws-binary-backups-to-dropbox.ps1`)
- Only the most recent object per series by default (`scripts/export-binary-backups-interactive.ps1`)
- Tag filter **`PortabaseBackup=true`** where applicable
- Never stage hundreds of GB on C:

Resource **measurement is required**: sizes (GiB), counts, snapshot/storage cost *signals*, restore blockers. `portabase aws doctor` reports **will-copy / will-warn / will-fail** using both the resource-class tree and a **size overlay** (`SIZE_POLICY` in `utility/aws/binary-decision.mjs`):

| Gate | Finding |
| --- | --- |
| Scripted JSON ≤ 16 MiB | will-copy |
| Scripted JSON 16–100 MiB | will-warn |
| Scripted JSON > 100 MiB | will-fail (too large to pack) |
| EBS with no measured Size | will-fail (`unmeasured-volume`) |
| Any `dumpBytes` / would-copy-bytes request | will-fail (`binary-dump-refused`) |
| EBS with measured Size, **most recent completed snapshot exists** | will-copy · **reference that snap id only** (never dump bytes) |
| EBS with measured Size, no completed recent snapshot | will-warn · recommend `CreateSnapshot` after latest-resolve (this CLI will not create it) |
| Pinned older `SnapshotId` without `ForceOverride` | refused · use most recent completed instead |

Never claim MATCH or proven until an AWS restore drill exists.

---

## 2. Same escape-package shape as Supabase

| Rule | Supabase capsule | AWS capsule V2 |
| --- | --- | --- |
| Who owns ciphertext | Customer vault (S3 / Dropbox / named local path) | Same |
| Who holds the sealing key | Customer (`PORTABASE_ENCRYPTION_PASSPHRASE` or later KMS wrap) | Same |
| What Portabase Cloud may store | Id / status / encrypted size — not contents | Same (when Cloud eventually schedules AWS jobs) |
| Proof | `replay` into a **new blank** Supabase project | A future drill into a **new blank AWS account** — **not implemented** |
| Honesty | COMPLETE ≠ application recovery proven | Inventory ≠ account rebuild proven |

Standalone / open source remains the only posture with **no** Portabase process in the crypto path. Managed Cloud still has residual key visibility *during a job* — see [SECURITY-TRUST.md](./SECURITY-TRUST.md).

---

On disk the sealed package uses the **same files** as a Supabase capsule:

| File | Role |
| --- | --- |
| `capsule.json` | Manifest (`kind: portabase-aws-capsule`, `formatVersion: 2`) |
| `capsule.pbase` | Encrypted archive — **not produced by this scaffold** |
| `checksums.sha256` | Integrity |
| `RECOVER.txt` | Customer recover hint; passphrase stays outside the vault |

---

## 3. Versioning

Two independent versions, both required on every manifest:

| Field | Current | Bump when |
| --- | --- | --- |
| `kind` | `portabase-aws-capsule` | New envelope family (never reuse Supabase `capsule.json` `formatVersion`) |
| `capsuleFormatVersion` | `2.0.0` | Envelope, default profile, or proven-claim rules change |
| `inventorySchemaVersion` | `1.0.0` | Resource fields or collector contracts change |
| `profile` | `exclude-binaries` | A future opt-in that packs selected blobs (not this PR) |

Supabase capsules keep `formatVersion: 1` in `capsule.json`. An AWS document that omits either AWS version is invalid.

`coverage.proven` and `coverage.match` are **schema-locked to `false`** in this format version. A later format bump may allow `true` only after a documented restore drill passes.

Constants: [`utility/aws/versions.mjs`](../utility/aws/versions.mjs). JSON Schema: [`utility/aws/schema/aws-capsule-manifest.schema.json`](../utility/aws/schema/aws-capsule-manifest.schema.json).

---

## 4. Threat model (never-hold-keys)

| Asset | In capsule? | Notes |
| --- | --- | --- |
| Account id + aliases | Yes | Not secret |
| IAM users / roles / policies / instance profiles | Yes (JSON) | Access **key IDs** only |
| Secret access keys, session tokens, login passwords | **Never** | Redaction fails closed |
| EC2 key-pair **names** | Yes | Private keys **never** |
| Secrets Manager **names / ARNs** | Yes | `GetSecretValue` is a forbidden collector |
| SSM parameter **names** | Yes | SecureString **values** excluded; `GetParameter` forbidden |
| Lambda environment **names** | Yes | Values omitted |
| CloudFormation NoEcho parameters | No | Templates may be packed; secret parameters are not |
| Route53 TXT RDATA | Maybe | Packed only when not secret-shaped; otherwise omitted |
| Sealing passphrase | **Never** | Same as Supabase |
| Capsule ciphertext bytes | Customer vault only | Portabase does not host them |

Collectors are **read-only** and boto3-shaped. `CreateSnapshot`, `CreateImage`, `PutObject`, `PutSecretValue`, and the rest of [`FORBIDDEN_MUTATIONS`](../utility/aws/interfaces.mjs) throw if invoked. The **client runner** must have AWS access (instance role preferred) so inventory / latest-backup / plan can script correctly. Credentials stay on that runner — see [AWS_RUNNER_AUTH.md](./AWS_RUNNER_AUTH.md). This scaffold still does not construct a live AWS SDK client (`--live` mutate refused).

---

## 5. What is in the capsule (scripted / non-binary)

Packed as JSON (later sealed with the same customer-owned crypto path as Supabase capsules):

- Account identity (id, aliases, partition)
- IAM exportable JSON (users, roles, policies, instance profiles)
- VPC / networking: VPCs, subnets, route tables, security groups, NACLs, IGW/NAT, endpoints
- EC2 *descriptions*: instances, types, tags, block-device maps (**volume IDs only**), launch templates, ASGs, key-pair names
- EBS volume *metadata* + **most recent completed** snapshot IDs (referenced, never created by this scaffold)
- RDS/Aurora instance + parameter/option group *descriptions*. Allocated storage is measured. **Row data is a follow-on** (see below)
- Lambda *configuration* + function names; `CodeSha256` / `CodeSize` from the API
- S3 *bucket configs* (policy, CORS, lifecycle, versioning, encryption) + object **key** inventory / counts
- ELB/ALB/NLB, ECS/EKS cluster descriptions
- CloudWatch alarm definitions, EventBridge rules, SQS/SNS configs
- Route53 hosted zones / records (TXT treated carefully)
- CloudFormation stack templates that exist, plus CDK metadata when present

---

## 6. What is not in the capsule (binaries + secrets)

Default profile **`exclude-binaries`**. Loud `NOT COVERED` labels on the doctor report.

| Class | Capsule stores | Recommended path |
| --- | --- | --- |
| EBS volume bytes | Volume id + region + encryption + **most recent completed** snapshot id | Reference latest snap; `CreateSnapshot` only if none exists (gated) |
| Instance image as a unit | **Most recent** AMI id + snapshot map | `CreateStoreImageTask` for that AMI only (gated); never every historical AMI |
| Instance store | Size + instance id | **None** — ephemeral, restore blocker (`will-fail`) |
| S3 object bodies | Key inventory, counts, total bytes | Optional later customer-owned copy job |
| ECR images | Digests, tags, sizes | ECR replication or skopeo to a customer registry |
| RDS/Aurora rows | Allocated GiB + engine description | AWS RDS snapshot referenced from the manifest |
| Lambda deployment package | SHA + size | Optional later source zip |
| Secrets / SecureString values / private keys | Nothing | Recreate from the customer’s secret process |

RDS row capture is **explicitly out of AWS capsule V1-of-data**. Measurement still lists allocated storage so the doctor can shout about footprint.

---

## 7. EC2 snapshot strategy

```text
instance  →  EBS volume (id, size, encryption, AZ)
                 │
                 ├─ capsule: scripted metadata  (will-copy)
                 │
                 ├─ latest-resolve: most recent completed snapshot
                 │     (PortabaseBackup=true where applicable)
                 │     pending / older snaps ignored
                 │     pinned older snap refused without ForceOverride
                 │
                 ├─ completed recent snap exists
                 │     capsule: that snapshot id + region + volume map + encryption
                 │     doctor: will-copy (reference only)
                 │     bytes remain in AWS snapshot storage, not .pbase
                 │
                 └─ no completed recent snap
                       doctor: will-warn
                       plan: print CreateSnapshot (blocked; this CLI will not run it)
```

AMI is recommended when the continuity unit is the **image** (launch template / golden AMI / instance store-backed historic images), not a single data volume.

Encryption status is recorded. Unencrypted volumes are a restore warning: a later snapshot can be encrypted, but the doctor must not pretend they already are.

**This PR never creates snapshots.** A future capture command must be explicit, customer-approved, and still must not run as a side effect of `inventory`, `doctor`, or `plan`. `portabase aws plan` only **scripts** the operator/Combo sequence (see [AWS_RUN_PLAN.md](./AWS_RUN_PLAN.md)).

---

## 8. Proven vs not

| Claim | This PR |
| --- | --- |
| Schema versions exist and reject mixed/secret documents | Yes (unit tests) |
| Decision tree: EBS → snapshot, S3 body → exclude, … | Yes (unit tests) |
| Doctor classifies will-copy / will-warn / will-fail | Yes (fixture) |
| CLI `portabase aws inventory` / `aws doctor` / `aws plan` | Yes (fixture + runner-auth fail-closed; plan is dry-run) |
| Most-recent backup selection (JS port of the PowerShell law) | Yes (unit tests, no AWS mutate) |
| Runner AWS credential chain (instance role / profile / env / seal) | Yes (detect + fail-closed; no live describe) |
| Live inventory of any AWS account | **No** |
| CreateSnapshot / AMI / RDS snapshot | **No** |
| Sealed production AWS `.pbase` | **No** |
| Restore / replay into a blank AWS account | **No** |
| MATCH / completeness of an AWS escape | **No** |
| Cost *quotes* | **No** — list-price style **signals** only |
| Supabase free CLI capture behavior | Unchanged |

Until a restore drill exists, every report prints **`NOT PROVEN`** and `coverage.match === false`.

---

## 9. CLI

```bash
portabase aws inventory --fixture utility/aws/fixtures/sample-account.json
portabase aws doctor    --fixture utility/aws/fixtures/sample-account.json
portabase aws plan      --fixture utility/aws/fixtures/sample-account.json
portabase aws doctor    --fixture ./my-export.json --json --out ./doctor.json
portabase aws plan      --fixture ./my-export.json --json --out ./plan.json --md ./AWS_RUN_PLAN.md
```

`portabase doctor` (no `aws`) is still the **Supabase** readiness check and still requires `portabase.config.json`. AWS commands do **not** load that config.

Refused: `--live`, `--snapshot`, `--create-snapshot`, `--mutate`, `--execute`, and subcommands `backup` / `restore` / `replay` / `snapshot`. `plan` is dry-run only.

Without `--fixture`, missing runner AWS credentials **fail closed**. `--require-aws` does the same even with a fixture. Preferred chain: instance role (Combo) → `AWS_PROFILE` / env keys on the runner → sealed-to-runner. Portabase Cloud never stores those keys.

---

## 10. Follow-on (not this PR)

1. Live read-only collectors (AWS SDK v3 or boto3 adapter) with customer credentials on **their** runner.
2. Explicit, approved snapshot creation — never implied by doctor.
3. Seal scripted JSON with [`utility/capsule-crypto.mjs`](../utility/capsule-crypto.mjs) into an AWS `.pbase`.
4. Optional customer-owned S3 copy job / ECR replication job.
5. RDS logical dump **only** if separately scoped.
6. Restore drill into a new blank AWS account — the only path to `proven`.
7. Cloud scheduling of AWS jobs. Do **not** flip `AWS_CLOUD_VERSION_ENABLED` for this scaffold.

---

## Related

- [AWS_INVENTORY.md](./AWS_INVENTORY.md)
- [AWS_RUN_PLAN.md](./AWS_RUN_PLAN.md)
- [AWS_RUNNER_AUTH.md](./AWS_RUNNER_AUTH.md)
- [SECURITY-TRUST.md](./SECURITY-TRUST.md)
- [ZERO-KNOWLEDGE.md](./ZERO-KNOWLEDGE.md)
- [REPLAY.md](./REPLAY.md) (Supabase proof model this design copies)
- [LAUNCH-SCOPE.md](./LAUNCH-SCOPE.md) (Supabase product launch stays as-is)
