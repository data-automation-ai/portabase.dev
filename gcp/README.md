# Portabase on customer-owned GCP

This Terraform module creates a dedicated Debian Compute Engine runner, a least-privilege service account that can read one existing Secret Manager secret, checksum-verified Portabase package installation, and a systemd backup timer. The only inbound rule permits SSH from Google Identity-Aware Proxy's documented range, and OS Login is enabled. The customer owns the GCP project, VM, secret, destination, logs, and capsules.

The existing secret must be a JSON object containing `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `PORTABASE_ENCRYPTION_PASSPHRASE`, and any `RCLONE_CONFIG_GCS_*` environment values required for the customer-owned destination. Never put those values in `.tfvars`.

```bash
terraform init
terraform plan \
  -var project_id=YOUR_GCP_PROJECT \
  -var secret_id=portabase-source \
  -var package_url=https://YOUR_AUTHORIZED_DOWNLOAD/portabase-linux.tar.gz \
  -var package_sha256=64_HEX_CHARACTERS \
  -var supabase_project_ref=abcdefghijklmnopqrst
terraform apply
```

The default `e2-micro` is appropriate only for modest backups. Measure memory, disk, transfer time, database load, and restore time before relying on it. The first manual run and a fresh-project restore drill are mandatory acceptance gates.
