# Private runner process

The Docker image starts `node cloud/runner/supervisor.mjs`. The previous
`boot.mjs` entry is a metadata prototype and does not execute jobs.

The supervisor polls sequentially using a job-enabled runner credential. It
does not need a customer login token. Registration and credential upgrades are
available in the account console. An older telemetry-only credential needs an
explicit upgrade before jobs can be queued or claimed.

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
