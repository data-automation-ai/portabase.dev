# AWS capsule run plan

**Status:** dry-run emitter only. Not a proven AWS restore product.  
**CLI:** `portabase aws plan --fixture <json>`  
**Code:** [`utility/aws/run-plan.mjs`](../utility/aws/run-plan.mjs) · policy [`utility/aws/latest-backup.mjs`](../utility/aws/latest-backup.mjs)

The capsule **scripts the necessary runs**. It does not invent snapshots and does not hold binary bytes.

`--live`, `--snapshot`, `--create-snapshot`, `--mutate`, and `--execute` stay refused.

The plan **assumes runner-local AWS access** (instance role preferred). Offline `--fixture` is for CI. Missing credentials fail closed. Portabase never stores AWS keys. See [AWS_RUNNER_AUTH.md](./AWS_RUNNER_AUTH.md).

---

## Product law

Port of Louis’s existing scripts (same policy, now CI-tested in JS):

| Script | Law |
| --- | --- |
| [`scripts/aws-latest-ebs-snapshot.ps1`](../scripts/aws-latest-ebs-snapshot.ps1) | ALWAYS the most recent **completed** EBS snapshot / AMI. Pinned older `SnapshotId` is refused without loud `-ForceOverride`. |
| [`scripts/export-aws-binary-backups-to-dropbox.ps1`](../scripts/export-aws-binary-backups-to-dropbox.ps1) | Most recent EBS/AMI per critical workload; S3 backup buckets; `CreateStoreImageTask` for latest AMIs only; **never stage hundreds of GB on C:** |
| [`scripts/export-binary-backups-interactive.ps1`](../scripts/export-binary-backups-interactive.ps1) | Only the most recent object per series by default |

Tag filter **`PortabaseBackup=true`** where applicable.

Portabase never holds sealing keys or capsule bytes. Binaries stay in the customer’s AWS snapshot storage / S3 / Dropbox vault.

---

## Sequence the plan prints

1. **inventory** — `node utility/portabase.mjs aws inventory --fixture …` (read-only)
2. **doctor** — `node utility/portabase.mjs aws doctor --fixture …` (will-copy / will-warn / will-fail; never MATCH)
3. **latest-snapshot resolve** — bind most recent completed snapshot / AMI IDs; wrap `aws-latest-ebs-snapshot.ps1 -Json`
4. **binary export (S3)** — `export-binary-backups-interactive.ps1 -ListOnly` (most recent per series)
5. **binary export (AMI)** — print `CreateStoreImageTask` for latest critical AMIs — **blocked / would-mutate**
6. **CreateSnapshot if missing** — only when latest-resolve found **no** completed snap — **blocked / would-mutate**
7. **capsule seal** — same files as Supabase (`capsule.json`, `capsule.pbase`, `checksums.sha256`, `RECOVER.txt`) — **not implemented** this scaffold

Prefer referencing an existing latest completed snapshot over `CreateSnapshot`.

---

## CLI

```bash
node utility/portabase.mjs aws plan --fixture utility/aws/fixtures/sample-account.json
node utility/portabase.mjs aws plan --fixture utility/aws/fixtures/sample-account.json --json
node utility/portabase.mjs aws plan --fixture utility/aws/fixtures/sample-account.json --out plan.json --md AWS_RUN_PLAN.md
```

`--md` writes a markdown run list. The checked-in copy of this file is the **format spec**, not a live dump of a customer account.

---

## Honesty

| Claim | This PR |
| --- | --- |
| Plan is dry-run | Yes |
| Most-recent selection is unit-tested without AWS | Yes |
| Creates snapshots / store-image tasks | **No** |
| Stages multi-hundred-GB on C: | **No** |
| MATCH / proven | **No** |
