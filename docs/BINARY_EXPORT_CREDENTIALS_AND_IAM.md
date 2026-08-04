# Binary / inventory export — where keys live & minimum IAM

This covers the **export / mapping scripts** under `scripts/export-*.ps1` and `scripts/test-binary-backup-mode.ps1`. Goal: **least privilege** for discovery (mappings) vs full binary ship.

---

## 1. Where credentials live (nothing magic in the scripts)

### A. AWS identity (Amazon authorization)

| Item | Where it is | What scripts do with it |
| --- | --- | --- |
| **IAM user access keys** | Local AWS CLI config / env: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (or instance role). Bootstrap keys for `claude-code-blastard` also live **inside** Secrets Manager `secrets-bundle` as `aws-limited-access-key-id` / `aws-limited-secret-access-key`. | Scripts call `aws …` with ambient credentials. **They never create or write new AWS access keys.** |
| **EC2 key pairs** (`.pem` for SSH) | AWS account **EC2 → Key pairs** (private half only on the machine that generated it). **Not used** by export scripts. | Not read, not uploaded. |
| **IAM role temporary creds** | Instance/profile metadata or SSO cache | Same as ambient AWS identity if present. |

**Scripts do not generate Amazon key pairs.** Inventory may *list* key pair **names** if you run the full account inventory (`describe-key-pairs`), never private key material.

### B. Dropbox authorization

| Item | Where it is | What scripts do with it |
| --- | --- | --- |
| **App key / secret** | `secrets-bundle` → `dropbox-app-key`, `dropbox-app-secret` | Read only. |
| **Refresh token** | `secrets-bundle` → `dropbox-refresh-token` | Read only; exchange for short-lived access token. |
| **Access token** | **Ephemeral**: memory + temp file `%TEMP%\…\rclone.conf` (or similar) for the run | Built at runtime; **not** stored in secrets-bundle by the scripts. |
| **rclone conf** | Temp path only (e.g. `%TEMP%\rclone-dr.conf`, work dir under `%TEMP%\aws-binary-*`) | Should be treated as sensitive; delete when done. |

### C. “User keys” / company secrets (passwords, API keys, etc.)

| Item | Where it is | What scripts do with it |
| --- | --- | --- |
| **Canonical store** | AWS Secrets Manager secret **`secrets-bundle`** (account `899867382621`) | Inventory: **names only**. Binary export (optional path): can AES-encrypt the whole JSON → Dropbox as `secrets-bundle.aes`. |
| **AES passphrase for that archive** | **Local only**: e.g. `%TEMP%\aws-binary-secrets-finish\SECRETS_ARCHIVE_PASSPHRASE.txt` | **Must not** upload to Dropbox. Print offline / password manager. |
| **DataAutomation GitHub org URL** | secrets-bundle keys `dataautomation-ai-github-org` (+ name/LLC) | Metadata only; not an API token. |

### D. What lands in Dropbox

| Content | Keys included? |
| --- | --- |
| Inventory JSON (`export-aws-account-to-dropbox.ps1`) | **No** secret values, **no** private keys, **no** IAM secret access keys |
| S3 dump/bak binaries | Application backups only (may contain app data—not AWS IAM keys) |
| AMI `.bin` images | Full disk images (may contain anything that was on the volume) |
| `secrets-bundle.aes` | Encrypted company secrets; **passphrase separate** |

---

## 2. Two privilege tiers (minimum grants)

### Tier A — Mappings only (inventory / picker list)

Enough to **generate all mappings** (what exists, sizes, “most recent per series”) **without** exporting secret values or writing new resources.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Identity",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    },
    {
      "Sid": "ListAccountMap",
      "Effect": "Allow",
      "Action": [
        "iam:ListUsers",
        "iam:ListRoles",
        "iam:ListGroups",
        "iam:ListPolicies",
        "iam:ListInstanceProfiles",
        "iam:ListOpenIDConnectProviders",
        "iam:ListSAMLProviders",
        "iam:ListAccountAliases"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ListComputeNetwork",
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "ecs:List*",
        "ecs:Describe*",
        "lambda:List*",
        "elasticloadbalancing:Describe*",
        "autoscaling:Describe*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ListDataStores",
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketTagging",
        "s3:GetBucketVersioning",
        "rds:Describe*",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ListSecretsNamesOnly",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ListObservabilityMisc",
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "sns:ListTopics",
        "sqs:ListQueues",
        "kms:ListKeys",
        "kms:DescribeKey",
        "cloudformation:ListStacks",
        "cloudformation:DescribeStacks",
        "apigateway:GET",
        "cognito-idp:ListUserPools",
        "dlm:GetLifecyclePolicies",
        "ssm:DescribeParameters",
        "route53:ListHostedZones",
        "cloudfront:ListDistributions",
        "ecr:DescribeRepositories"
      ],
      "Resource": "*"
    }
  ]
}
```

**Explicitly denied / not needed for mappings:**

- `secretsmanager:GetSecretValue` (unless Dropbox auth also lives there — see note)
- `s3:GetObject` / binary download  
- `ec2:CreateStoreImageTask`, `ec2:CreateSnapshot`, `ec2:CreateVolume`  
- `iam:CreateAccessKey`, `iam:CreateUser`, any write  
- EC2 key pair private material (not available via API anyway)

**Note on Dropbox:** scripts currently load Dropbox OAuth **from** `secrets-bundle` via `GetSecretValue`. For **true** mapping-only IAM, either:

1. Split Dropbox OAuth into a separate secret the mapper cannot read, **or**  
2. Pass Dropbox env vars / local rclone remote and **omit** `GetSecretValue` from the mapper role.

Recommended minimum if mapper must refresh Dropbox only when uploading:

- Mappings job: **no** `GetSecretValue`  
- Upload job: `GetSecretValue` **only** on  
  `arn:aws:secretsmanager:us-east-1:899867382621:secret:secrets-bundle-*`

---

### Tier B — Binary ship (copy dumps + optional AMI store + Dropbox)

On top of Tier A (or a tighter subset: only the buckets you export):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSecretsBundleForDropboxAndOptionalAesExport",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:us-east-1:899867382621:secret:secrets-bundle-*"
    },
    {
      "Sid": "ReadBackupBucketObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": [
        "arn:aws:s3:::capece-supabase-backups",
        "arn:aws:s3:::capece-supabase-backups/*",
        "arn:aws:s3:::dbasebackups",
        "arn:aws:s3:::dbasebackups/*",
        "arn:aws:s3:::dataautomation-emergency-backups",
        "arn:aws:s3:::dataautomation-emergency-backups/*",
        "arn:aws:s3:::dataautomation-ai-backups",
        "arn:aws:s3:::dataautomation-ai-backups/*",
        "arn:aws:s3:::capece-backup-deploy-899867382621",
        "arn:aws:s3:::capece-backup-deploy-899867382621/*"
      ]
    },
    {
      "Sid": "AmiExportBucket",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketAcl",
        "s3:AbortMultipartUpload",
        "s3:ListBucketMultipartUploads",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::aws-binary-dr-exports-899867382621",
        "arn:aws:s3:::aws-binary-dr-exports-899867382621/*"
      ]
    },
    {
      "Sid": "AmiStoreImage",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateStoreImageTask",
        "ec2:DescribeStoreImageTasks",
        "ec2:DescribeImages",
        "ec2:DescribeSnapshots"
      ],
      "Resource": "*"
    }
  ]
}
```

**Still never required for these scripts:**

| Action | Why not |
| --- | --- |
| Create/download EC2 key pairs | Scripts don’t SSH |
| `iam:CreateAccessKey` / rotate keys | Use existing principal |
| `secretsmanager:PutSecretValue` | Export is read path (updates to bundle are separate ops) |
| Full `AdministratorAccess` | Overkill |

Optional **EbsSmoke** test only: add  
`ec2:CreateVolume`, `ec2:DeleteVolume`, `ec2:CreateSnapshot`, `ec2:CreateTags`, `ec2:DescribeVolumes`, `ec2:DescribeSnapshots`  
scoped carefully — not needed for production export.

---

## 3. Dropbox app grants (minimum)

App registered for this flow needs roughly:

- **files.content.write** / **files.content.read** (upload + verify download in test mode)  
- **files.metadata.read** (list/size)

Not required: account admin, team management, sharing links unless you add that feature.

Tokens stay in **secrets-bundle**; access tokens only in **temp rclone conf**.

---

## 4. Mental model

```text
┌─────────────────────┐     ambient AWS CLI keys
│ Operator machine    │◄──── (or aws-limited-* from bundle)
│ export scripts      │
└─────────┬───────────┘
          │ GetSecretValue (upload tier only)
          ▼
┌─────────────────────┐
│ secrets-bundle      │  Dropbox OAuth + company secrets
│ (Secrets Manager)   │  NO EC2 .pem files
└─────────┬───────────┘
          │ refresh → access token
          ▼
┌─────────────────────┐     temp only
│ %TEMP%\rclone.conf  │  deleted after session / work dir
└─────────┬───────────┘
          │ upload binaries
          ▼
┌─────────────────────┐
│ Dropbox             │  dumps / optional .aes / AMI .bin
└─────────────────────┘

EC2 key pairs: AWS + operator laptop only — out of scope for export scripts
```

---

## 5. Easy generator (for non-console users)

**Double-click or run:**

```text
scripts\Create-Export-Permissions.cmd
```

or:

```powershell
.\scripts\generate-export-iam-grants.ps1
```

The wizard:

1. Asks yes/no: create **MAP** (list only) and/or **SHIP** (copy binaries)  
2. Asks which S3 backup buckets SHIP may read (Enter = recommended list)  
3. Writes policy JSON to a folder on the Desktop  
4. If you say YES, creates IAM users + policies via CLI (**no console**)  
5. Saves access keys under `ACCESS-KEYS-KEEP-PRIVATE\` with a plain-English README  

Requires the machine to already have **admin/IAM** AWS credentials (`aws configure`).  
If create fails, the same folder still has JSON + console fallback steps in `README-START-HERE.txt`.

## 6. Practical recommendation

| Job | Principal | Policy |
| --- | --- | --- |
| Interactive picker / inventory map | Dedicated IAM user `portabase-export-map` | **Tier A** only |
| Confirmed binary upload after YES | `portabase-export-ship` | Tier A subset + **Tier B** |
| Day-to-day agent (`claude-code-blastard`) | Existing broad `blastard` policy | **Do not** treat as minimum; use dedicated roles when hardening |

Split **map** vs **ship** so generating mappings never requires `GetObject` on every backup bucket or full secrets read—unless you keep Dropbox OAuth in a second, upload-only secret.

---

## 7. Related scripts

| Script | Needs map (A) | Needs ship (B) |
| --- | --- | --- |
| `export-binary-backups-interactive.ps1 -ListOnly` | Yes | No (if no Dropbox) |
| `export-binary-backups-interactive.ps1` (full) | Yes | Yes |
| `export-aws-account-to-dropbox.ps1` | Yes | Dropbox + GetSecretValue for OAuth |
| `export-aws-binary-backups-to-dropbox.ps1` | Partial | Yes |
| `test-binary-backup-mode.ps1` | Minimal STS | Dropbox OAuth + write to test path |
