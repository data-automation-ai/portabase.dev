# Private runner process

The Docker image starts `node cloud/runner/supervisor.mjs`. The previous
`boot.mjs` entry is a metadata prototype and does not execute jobs.

The supervisor polls sequentially using a job-enabled runner credential. It
does not need a customer login token. Registration and credential upgrades are
available in the account console. An older telemetry-only credential needs an
explicit upgrade before jobs can be queued or claimed.

## Google Cloud Run Execution (Scale-to-Zero Jobs & Services)

The runner container is built for execution on **Google Cloud Run Jobs and Services**:
- Default listen port: `PORT=8080`
- Platform identifier: `PORTABASE_RUNNER_PLATFORM=google-cloud-run`
- Primary GCP region: `PORTABASE_GCP_REGION=us-central1` (also supports `us-east1`, `us-west1`, `europe-west1`, `asia-east1`)
- Scale-to-zero: Each subscriber runner can run as an ephemeral Cloud Run Job that spins up on demand, pulls and executes the sealed transfer task, writes the encrypted capsule to destination storage, and terminates cleanly.
- Keyless IAM & OIDC Federation: Cloud Run workloads can fetch Google Cloud OIDC identity tokens (`fetchGcpIdentityToken`) from the GCP metadata server (`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity`), which directly federate into AWS STS (`AssumeRoleWithWebIdentity`) or authenticate to Google Cloud Storage (GCS) without static keys.


## Deployment requirements

- Set `PORTABASE_CLOUD_URL`, `PORTABASE_AGENT_TOKEN`,
  `PORTABASE_RUNNER_ID`, `PORTABASE_PROJECT_REF` and
  `PORTABASE_RUNNER_CONFIG_DIR` inside the private runner environment.
- Mount the configured private directory on durable customer-controlled storage,
  writable by the image's `node` user. Preserve configurations, plans, journals
  and recovery evidence across restarts. F: paths are prohibited.
- Supply source/target credentials, encryption keys and engine configuration
  inside this boundary. They are not provided by the job queue. Do not place
  them in image layers, build arguments or repository files.
- Use one supervisor per private directory. Do not route engine stdout/stderr
  into ordinary-backend log collection; detailed diagnostics remain private.
- Ensure the database client and other tools match the source and recovery
  targets. A successful image build does not establish capture/restore support.

SIGTERM/SIGINT stops new polling and drains an active operation and its completion
report. Allow enough shutdown time for that operation. Forced termination during
execution leaves an uncertain outcome requiring private review; it is not an
instruction to rerun the job.

The private setup/review GUI is a separate loopback process. This image does not
publish a remotely authenticated GUI, create cloud compute, schedule backups,
encrypt persistent volumes, implement operator blindness, or manage cancellation.
Those capabilities require deployment integration and verification.

## Validation status

Supervisor and agent-only job flows are tested locally with synthetic stores and
operations. Docker was unavailable on the implementation workstation, so this
updated image has not been built or run. No cloud deployment or live recovery
has been verified for it. Do not treat this container definition as release proof.
