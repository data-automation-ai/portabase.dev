# PortaBase delivery matrix

The same recovery-capsule format and guarded restore rules apply to every edition. The interface and scheduler change; the customer always owns the credentials, runner, destination, passphrase, and capsules.

| Customer | Delivery | Scheduling | Secret storage | Current readiness |
| --- | --- | --- | --- | --- |
| Windows non-technical | Electron NSIS installer with PostgreSQL and Supabase tools | Guided Windows Task Scheduler setup | Windows DPAPI through Electron `safeStorage` | Installer builds and smoke-runs; signing and end-to-end UI acceptance remain |
| macOS non-technical | Electron DMG and ZIP with the same guided UI | LaunchAgent | macOS Keychain through Electron `safeStorage` | Build definition exists; must build, sign, notarize, and test on macOS |
| Linux desktop | Electron AppImage and Debian package | systemd user/system timer | Secret Service keyring; app refuses plaintext persistence | AppImage and Debian package build and tool-smoke-test on Ubuntu; graphical clean-install acceptance remains |
| Linux server / NAS | CLI package or Docker Compose | systemd timer, cron, or NAS scheduler | root-readable env file or platform secret injection | CLI and systemd installer exist; target host acceptance remains |
| AWS novice | Small Lightsail/EC2 Linux runner | systemd timer | Customer AWS Secrets Manager or root-readable env file | Installation runbook/script path exists; no customer instance is provisioned automatically |
| AWS production | CloudFormation + ECS Fargate + S3/KMS vault | EventBridge Scheduler | Customer AWS Secrets Manager | Infrastructure template and guarded task model exist; deploy only into customer's authorized account |
| GCP | Docker/CLI on Compute Engine or Cloud Run Job | Cloud Scheduler/systemd | Customer Secret Manager | Portable container path; GCP-specific Terraform is still required before calling this one-click |
| Advanced / CI | Node CLI or container | Existing scheduler | Existing secret manager | Functional reference implementation |

## Desktop security boundary

The Electron renderer loads only packaged local files. It has no Node integration, uses process sandboxing and context isolation, blocks navigation and new windows, and receives only narrow IPC methods. The main process validates the renderer for every privileged call. Static external links are allowlisted. Secrets are encrypted with operating-system protected storage and are never included in the capsule or sent to PortaBase.

## Release gates

Do not publish a desktop artifact merely because it compiled. Each platform release must pass:

1. Clean-machine install and uninstall.
2. Tool self-tests for `pg_dump`, `pg_dumpall`, `psql`, `tar`, and the Supabase CLI.
3. Trial backup against the disposable source fixture.
4. Capsule verification and authenticated decryption.
5. No-write preflight against a new blank target.
6. Guarded restore and post-restore acceptance suite.
7. OS code-signature verification; macOS additionally requires notarization and Gatekeeper verification.
8. Secret-at-rest inspection and an outbound-network audit proving no PortaBase credential/data relay.

## Trial and paid distribution

The indefinite trial runs the complete workflow but enforces schema-only database capture, five Storage objects across two buckets, and two Functions. The paid package removes those payload limits after importing an offline Ed25519-signed lifetime license. The current JavaScript verifier fails closed and deters casual copying, but Electron ASAR packaging is not a strong protection boundary. A compiled native recovery core remains the hardening path for meaningful resistance to patching or redistribution.
