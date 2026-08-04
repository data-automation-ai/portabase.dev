# Portabase open-core model

Status: active product definition (replaces one-time closed license as the commercial model)

## The Supabase-shaped split

Portabase follows the same commercial shape as Supabase itself:

| Layer | License / access | Who runs it |
| --- | --- | --- |
| Recovery engine, capsule format, encrypt/decrypt, verify, restore | **Apache-2.0 open source** | Customer (standalone) **or** Portabase managed runners (Cloud) |
| Basic management GUI / CLI | **Open source** | Customer |
| Hosted control plane + **managed staging runners** | **Portabase Cloud (paid)** | Portabase |
| Telemetry, advanced monitoring, multi-person alert chains | **Portabase Cloud (paid)** | Portabase |

- **Standalone script:** customer stages on **local disk or their cloud** working store; then writes the capsule to their destination.
- **Cloud (sold service):** **Portabase stages** on isolated managed runners. Customers are **not** expected to use a laptop drive. Final capsules still land in **customer BYO destination** (S3 etc.).

Cloud sells **managed staging + visibility + waking the right humans** — not permanent custody of recovery bytes.

## Non-negotiable trust boundary

| | Standalone | Cloud (managed runner) |
| --- | --- | --- |
| Staging disk | Customer machine / their cloud | **Portabase runner volume** (ephemeral) |
| Final capsule vault | Customer destination | **Customer destination (BYO)** |
| Control-plane DB | N/A | Metadata only — never capsule bytes |

Portabase Cloud may store **workspace config and opt-in health metadata** (job status, timing, RPO age, error class). It must never use the product database as a recovery vault:

- no long-term capsule bytes
- no decrypted dumps
- no “Portabase is your only copy”

Secrets used by managed runners are tenant-scoped for the job path, not a substitute for customer-held encryption policy. Offline/standalone recovery must still work without Cloud.

Default telemetry on self-hosted agents: **off**.

## Editions (engine)

| Edition | How enabled | Capture scope |
| --- | --- | --- |
| `community` | Default for all OSS installs | Full project capture (database, Auth, Storage, Functions per config) |
| `trial` / demo | Explicit `--trial` (or `PORTABASE_EDITION=trial`) | Deliberately limited sample for safe drills |

There is **no paid license gate** on full capture. Legacy offline license files may still verify for historical fulfillment, but they do not unlock software.

## Delivery surfaces (priority order)

1. **Portabase Cloud (sold service)** — console + **managed staging runners** + alerts; BYO capsule destination  
2. **Standalone CLI / self-hosted runner** — customer stages on local **or** their cloud; full recovery without Portabase  
3. **Basic web/local management GUI** — configure, schedule, run, restore (open source)  
4. **Desktop installer** — optional convenience for standalone users  

## Portabase Cloud (paid)

### Included directionally

- Hosted management console (setup wizards, multi-project fleet)
- **Managed staging** on isolated runners (customer does not stage on a laptop)
- Upload of encrypted capsules to the customer’s BYO destination
- Opt-in health events / job status in the console
- Advanced monitoring (missed windows, flaky destinations, RPO age)
- Alert channels: email, SMS, Slack, webhooks, PagerDuty-class routing
- **Multi-person alert chains / escalation**
- Team seats, roles, audit of console actions
- Up to 12 agents / runners per plan defaults (see billing)

### Explicitly not sold as

- Permanent Portabase-hosted recovery vault (customer owns the destination)
- “We hold your only passphrase forever” as the trust model
- Laptop-required staging for Cloud subscribers

## Hosted runner (managed isolation)

Cloud staging runs as **per-workspace isolated tasks** (e.g. ECS Fargate) in the Portabase Cloud AWS account with dedicated IAM roles, secret prefixes, and log groups. See [CLOUD_INFRASTRUCTURE.md](./CLOUD_INFRASTRUCTURE.md).

Standalone customers who refuse managed compute keep the open-source engine and stage wherever they choose (local disk or their cloud).

## Local Starter vault (no third-party storage yet)

For operators who **do not** have S3, Dropbox, or similar yet:

| | Policy |
| --- | --- |
| Destination | `provider.type = "local"` + folder path (this PC, USB, or NAS path) |
| Size gate | Encrypted capsule folder **≤ 100 MB** by default |
| Override | `provider.allowLargeLocal=true` or CLI `--allow-large-local` (you accept same-disk risk) |
| What it is | Real encrypted capsules you own — Escape from **Supabase** lockout still works if this disk survives |
| What it is not | Escape from laptop loss, fire, ransomware that hits the same machine |

Example config: `utility/portabase.config.local-starter.example.json`.

```bash
node utility/portabase.mjs init --provider local --path ./portabase-capsules/vault
node utility/portabase.mjs doctor
node utility/portabase.mjs backup
```

When the project grows, point `provider` at Dropbox or AWS S3 — same capsule format.

## Migration from $147 lifetime license

- Commercial model is subscription Cloud, not a software unlock.
- Existing engineering license code remains for historical orders and tests but is not a product gate.
- Public site no longer sells “pay once for full backup.”

## Related docs

- [Cloud infrastructure](./CLOUD_INFRASTRUCTURE.md)
- [Telemetry schema](./TELEMETRY_SCHEMA.md)
- [Package architecture](./PACKAGE_ARCHITECTURE.md)
- [Product specification](./PRODUCT_SPEC.md)
