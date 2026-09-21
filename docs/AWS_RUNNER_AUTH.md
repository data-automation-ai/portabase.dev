# AWS credentials on the customer runner

**Status:** scaffold + fail-closed detection. Not a live AWS describe product.  
**Code:** [`utility/aws/runner-auth.mjs`](../utility/aws/runner-auth.mjs) · IAM sketches [`utility/aws/iam/`](../utility/aws/iam/)

Same never-hold-keys rule as Supabase Cloud: **AWS credentials are sealed to the customer runner only.** The Portabase control plane never stores access keys, secret keys, session tokens, or `secrets-bundle` values.

`--live` (mutate / CreateSnapshot / store-image execute) stays refused.

---

## Why the runner must have AWS access

`portabase aws inventory | doctor | plan` script the customer account: list objects, resolve **most recent completed** backups, emit the run sequence. That requires **the machine that runs the CLI** to be allowed to call AWS — not Portabase.dev.

```text
Customer browser / CLI
        │  seals AWS keys (ciphertext)
        ▼
Customer runner  (laptop · Combo · Cloud worker)
        │  standard AWS credential chain
        │  inventory / latest-backup resolve / dry-run plan
        │
        ├─ capsule metadata + hashes  →  customer vault
        └─ telemetry (status, counts, sizes, hashes, destination kind, safe errors)
                    │
                    ▼
           Portabase control plane
           NEVER keys · NEVER capsule bytes · NEVER secret-bundle
```

---

## Auth modes

| Mode | Where | Who uses it |
| --- | --- | --- |
| **instance-role** (preferred) | EC2 instance profile, ECS task role, IRSA | Combo / customer worker |
| **env** | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` on the runner process | Free CLI / sealed-then-injected |
| **profile** | `AWS_PROFILE` / `~/.aws/credentials` on the runner | Free CLI on a laptop |
| **sealed-to-runner** | Browser/CLI AES envelope POSTed to the **runner seal URL** | Cloud — sibling of the Supabase seal |
| **fixture** | `--fixture <json>` | CI / unit tests — no live account |

Detection is fail-closed. If the runner has no chain, the CLI exits with `RUNNER_AWS_CREDS_MISSING` and a plain-English message. Secret values are never printed.

```bash
# Offline / CI (no AWS required)
node utility/portabase.mjs aws plan --fixture utility/aws/fixtures/sample-account.json

# Combo / customer runner — ambient chain required
node utility/portabase.mjs aws inventory --require-aws --fixture ./account.json
# Without --fixture this scaffold still will not call AWS APIs (live describe not enabled).
```

Preferred on Combo: **do not** ship long-lived access keys. Attach an instance role with the MAP policy.

---

## Two IAM tiers (sketches, not admin)

No access keys in git. JSON is placeholder-only:

| Tier | File | Can | Cannot |
| --- | --- | --- | --- |
| **MAP** | [`utility/aws/iam/portabase-export-map.json`](../utility/aws/iam/portabase-export-map.json) | `sts:GetCallerIdentity`, `ec2:Describe*`, S3 list, IAM list, secret **names** | `GetSecretValue`, `s3:GetObject`, `CreateSnapshot`, `CreateStoreImageTask` |
| **SHIP** | [`utility/aws/iam/portabase-export-ship.json`](../utility/aws/iam/portabase-export-ship.json) | Read backup objects, AMI store-image, `GetSecretValue` **only** on `secrets-bundle-*` | Admin, `iam:CreateAccessKey`, write secrets |

Generate customer-specific JSON (not this repo) with [`scripts/generate-export-iam-grants.ps1`](../scripts/generate-export-iam-grants.ps1). See [BINARY_EXPORT_CREDENTIALS_AND_IAM.md](./BINARY_EXPORT_CREDENTIALS_AND_IAM.md).

---

## Cloud: seal AWS to the runner (sibling of Supabase seal)

The browser seals **ciphertext** to the runner seal URL — never to `/api/cloud/*`.

| Hop | AWS keys |
| --- | --- |
| Browser form | Typed, then sealed |
| Runner `acceptBrowserSeal` | Ciphertext envelope (`purpose: aws-runner-credentials`). Plaintext `AWS_ACCESS_KEY_ID` / secret / session token **refused** |
| `POST /api/cloud/runners` | Rejects secret-shaped bodies including AWS key fields (`keys_must_seal_to_runner`) |
| Telemetry | status, counts, sizes, hashes, destination kind, safe errors, `authMode` — never keys |

`buildAwsSealedEnvelope` in [`src/lib/runner-seal.js`](../src/lib/runner-seal.js) is the AWS sibling of the Supabase seal helper.

Honest limit: isolation is **designed**, not proven-green.

---

## Telemetry allowlist

Allowed back to Portabase: job status, resource counts, binary footprint GiB, capsule/layer hashes, destination kind, safe error codes, runner id/region, auth **mode**.

Forbidden: `AWS_SECRET_ACCESS_KEY`, session tokens, `secrets-bundle` contents, capsule bytes, passphrases.
