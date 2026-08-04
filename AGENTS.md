# Portabase — agent rules

**Project brief (what this is + what to do):** [PROJECT.md](./PROJECT.md)  
**Full handoff:** [docs/HANDOFF.md](./docs/HANDOFF.md)

## NEVER write to F:

**HARD RULE:** Never write, create, move, copy, stage, cache, or spool any file to the **F:** drive (`F:\`, `F:/`).

- Do not set `backupDirectory`, `statusDirectory`, or work paths to F:.
- If config points at F:, fix it before any `backup` / `restore` / `replay` run.
- Do not probe or remount F: as a workaround.

## Backup / proof runs — spool in the cloud

End-to-end backup and restore proof must **not** thrash the user’s workstation disks.

| Concern | Required approach |
| --- | --- |
| **Staging / spool** | **EC2** or **container** (ECS/Fargate/Docker) with cloud ephemeral disk |
| **Vault** | Customer BYO: **S3** or **Dropbox** (OAuth and/or access token) |
| **Local PC disk** | Only if the user **explicitly** names an allowed path for this machine |

### Why

Capture (especially Storage) needs temporary disk. That disk must be **cloud runner storage**, not the operator’s F: or a surprise folder on C:.

### Default proof path

1. Run Portabase engine on **EC2 or container** in AWS account `899867382621` (or project-designated runner).
2. Source: hosted Supabase project under test (e.g. DataAutomation `ekklokrukxmqlahtonnc`).
3. Destination: `s3://…` (or Dropbox when configured).
4. Replay into a **new blank** Supabase project — never the source.

## Product reminders

- Cloud: Portabase stages on managed runners; customer owns capsule vault.
- Standalone: customer may stage local or cloud; still not agent-default on F:.
- Be honest: managed Cloud may still use key material on the runner during a job.

## Related docs

- **`docs/HANDOFF.md`** — full project handoff for successor agents (read first)
- `docs/LAUNCH-SCOPE.md`
- `docs/SECURITY-TRUST.md`
- `docs/REPLAY.md`
- `docs/BILLING.md`
