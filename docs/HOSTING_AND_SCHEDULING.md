# Hosting and scheduling Portabase

Portabase is delivered as customer-run software rather than a hosted backup SaaS. The customer keeps custody of every database credential, API token, encryption passphrase, cloud key, and recovery capsule. Portabase payment systems never receive those infrastructure secrets.

## Recommended paths

| Customer | Recommended runner | Scheduling |
| --- | --- | --- |
| Nontechnical Windows user | An always-on office PC or mini PC | Portabase `install-schedule` creates Windows Task Scheduler configuration |
| Nontechnical AWS user | Amazon Lightsail Linux Nano or Micro | `systemd` service and timer installed by `scripts/install-portabase-systemd.sh` |
| Existing AWS engineering team | Existing EC2, ECS/Fargate, or the included CloudFormation recovery stack | EventBridge Scheduler, systemd, or the existing task scheduler |
| Existing GCP engineering team | Compute Engine `e2-micro` or an existing VM | `systemd` timer or Cloud Scheduler-triggered job |
| NAS/server owner | Existing Linux host with enough temporary disk for the database dump | `systemd` timer |

As of July 13, 2026, AWS publishes a Lightsail Linux Nano bundle at **$5/month** with 0.5 GB RAM and 20 GB SSD, and a Micro bundle at **$7/month** with 1 GB RAM and 40 GB SSD. Those bundle prices are easier to explain than combining EC2, EBS, and public-IPv4 charges. Large databases may exceed Nano memory or disk; check capsule working-space requirements before promising a size.

Google publishes an `e2-micro` on-demand rate that is roughly $6.12 for a 730-hour month in some US regions before disk and networking, with a free VM program available only under its current eligibility rules. Always verify the customer’s region and full estimate in the provider calculator.

## Linux installation

Copy the purchased Portabase package to the VM, then run:

```bash
sudo bash scripts/install-portabase-systemd.sh
```

The helper:

- installs Node.js, PostgreSQL client tools, `rclone`, and `tar`;
- creates an unprivileged `portabase` service account;
- installs the package under `/opt/portabase`;
- stores runtime secrets in `/etc/portabase/portabase.env` with root-only permissions;
- installs a oneshot service and six-hour systemd timer;
- does not enable the timer until configuration and a manual backup pass.

After filling `/etc/portabase/portabase.env` and `/opt/portabase/portabase.config.json`, prove one manual run:

```bash
sudo systemctl start portabase-backup.service
sudo systemctl status portabase-backup.service
sudo systemctl enable --now portabase-backup.timer
systemctl list-timers portabase-backup.timer
```

## Customer handoff checklist

1. Choose a runner with temporary disk at least twice the expected uncompressed capture size.
2. Keep the encryption passphrase outside the backup destination.
3. Run `doctor` and require all mandatory checks to pass.
4. Run a manual backup and `verify --decrypt` before scheduling.
5. Confirm the remote destination contains the verified capsule.
6. Enable the timer and observe the first unattended run.
7. Configure failure alerts.
8. Schedule a fresh-project restore drill and record RPO/RTO.

Portabase support can script and walk the customer through this entire process, but the resulting VM, scheduler, credentials, keys, and data remain in the customer’s account.
