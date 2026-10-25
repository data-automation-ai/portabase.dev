/**
 * Backend page copy — control plane vs capsule vault vs workers.
 * Source of truth for claims: docs/OPEN_CORE.md, TELEMETRY_SCHEMA.md,
 * ESSENTIALS_RUNBOOK.md, SECURITY-TRUST.md, HOSTING_AND_SCHEDULING.md.
 */
export const capsuleNever = [
  'Encryption passphrase',
  'Database URLs or passwords',
  'Service-role / secret keys',
  'Capsule plaintext or decrypted dumps',
  'Storage object bytes',
];

export const capsuleAbout = [
  'capsuleId / status (COMPLETE · PARTIAL · FAILED)',
  'destinationKind (S3 · Dropbox · local · …)',
  'verified flag, duration, error class',
  'RPO age / last-capsule hours',
  'Agent label + project ref (not credentials)',
];

export const capsuleSteps = [
  {
    title: 'The engine runs on your runner or an attested managed VM',
    body: 'The MIT engine captures database, Auth records, Storage bytes, and Function source. Standalone uses a machine you control. The managed design runs on a temporary Google Confidential Space VM with Intel TDX; that flow is still in isolated validation.',
  },
  {
    title: 'Encryption happens before the artifact is durable',
    body: 'The runner seals a recovery archive with AES-256-GCM. The durable object is a .pbase file plus a capsule directory (manifest, checksums). Without the passphrase, it is ciphertext — not a dump sitting in the clear.',
  },
  {
    title: 'The vault of record is yours, not Portabase',
    body: 'The runner writes the sealed capsule to a destination you choose: local/NAS, S3, Dropbox, Drive, or another rclone remote. Portabase Cloud never hosts capsule ciphertext as the storage of record. We do not sell “keep your only copy in our object store.”',
  },
  {
    title: 'Verify and restore stay on the runner path',
    body: 'verify checks hashes and the AES-GCM tag. restore / replay open the capsule on infrastructure that already has the passphrase and write into a new blank Supabase project — never a silent overwrite of the source. If Cloud is offline, this path still works.',
  },
  {
    title: 'Standalone telemetry is optional',
    body: 'A customer-run agent can send allowlisted health fields if you opt in. The managed design also has a Cloud Run controller that starts the enclave VM and relays encrypted commands. It does not decrypt the payload.',
  },
];

export const workerSteps = [
  {
    title: 'Cloud stores job intent — not a credential proxy',
    body: 'The console or a schedule can enqueue an intent: backup, verify, replay, or heartbeat, plus labels such as capsuleId, projectRef, or targetRef. That record is ops metadata. It is not a pipe that ships your DB URL or service-role key to Portabase so we can “dump for you” over the control plane.',
  },
  {
    title: 'The worker pulls the job and runs where secrets already live',
    body: 'Customer-controlled workers (your AWS, VPS, systemd timer, Windows Task Scheduler, or self-hosted box) pull queued work and execute the same open-source CLI. Passphrase, Supabase credentials, and vault keys stay in that runner’s env / OS secret store. Cloud does not need them to know that a job was requested.',
  },
  {
    title: 'Recovery bytes never upload to Portabase',
    body: 'The worker writes the sealed capsule to your destination and verifies it there. Status comes back as telemetry or job state — not as a .pbase attachment. Portabase is not a hop on the recovery-byte path.',
  },
  {
    title: 'Cloud fans out alerts; it does not become the vault',
    body: 'Opt-in health events can wake people: SMS on success and failure, email, Slack, webhooks, escalation chains. That is the paid product — visibility and waking humans — not custody of keys or capsule contents.',
  },
];

export const workerNever = [
  'DB URLs, service-role keys, or passphrases in job payloads',
  'Uploading .pbase / capsule directories to Portabase',
  'Using the control-plane database as a recovery vault',
  'Requiring Cloud to be online in order to restore',
];

export const workerSignals = [
  'Job type + queued / running / finished / failed',
  'Opt-in telemetry: backup.completed, backup.failed, verify.failed, schedule.missed, agent.heartbeat',
  'Alert routes and escalation (SMS, email, Slack, webhook)',
  'Agent token (hashed) that identifies a workspace runner — not a Supabase project key',
];
