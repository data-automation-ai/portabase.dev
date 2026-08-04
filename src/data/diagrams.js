/**
 * Homepage technical diagrams — open-core first.
 * Captions explain Community (OSS) vs optional Cloud convenience.
 * Image files are legacy product art; copy is the source of truth for the model.
 */
export const diagrams = [
  {
    src: '/images/diagrams/01-customer-owned-recovery.png',
    title: 'Open-source recovery path',
    body: 'Your runner captures Supabase layers, encrypts locally, and writes capsules to storage you own. No Portabase account is required for backup or restore.',
    layer: 'community',
  },
  {
    src: '/images/diagrams/02-zero-knowledge-topology.png',
    title: 'Keys stay on your runner',
    body: 'Source credentials and the encryption passphrase never leave the customer environment. Cloud, when enabled, only receives opt-in health metadata.',
    layer: 'community',
  },
  {
    src: '/images/diagrams/03-portabase-essentials.png',
    title: 'Self-hosted Community engine',
    body: 'Schedule the open-source CLI or agent on a VM, NAS, container, or workstation. Full capture is free under Apache-2.0 — no license file.',
    layer: 'community',
  },
  {
    src: '/images/diagrams/04-portabase-aws-recovery.png',
    title: 'Customer-owned vault options',
    body: 'Use Drive, Dropbox, local/NAS, or your own AWS S3 path. Templates help advanced teams; ownership of vault and keys stays with you.',
    layer: 'community',
  },
  {
    src: '/images/diagrams/05-continuous-backup-cycle.png',
    title: 'Continuous backup cycle',
    body: 'Capture → encrypt → transfer → verify → retain. Optional Cloud telemetry watches the same cycle and alerts when it stalls.',
    layer: 'both',
  },
  {
    src: '/images/diagrams/06-recovery-capsule.png',
    title: 'Inside a recovery capsule',
    body: 'Database/Auth, Storage bytes, Function source, manifests, and checksums travel together as one encrypted artifact you can restore offline.',
    layer: 'community',
  },
  {
    src: '/images/diagrams/07-who-holds-the-keys.png',
    title: 'Who holds the keys',
    body: 'You hold source credentials, destination access, and passphrase. Portabase Cloud holds only agent tokens for health events — never capsule keys.',
    layer: 'both',
  },
  {
    src: '/images/diagrams/08-what-portabase-captures.png',
    title: 'What the OSS engine captures',
    body: 'Not just Postgres: Auth records, Storage objects, Functions, and configuration inventory required to rebuild application recovery.',
    layer: 'community',
  },
  {
    src: '/images/diagrams/09-backup-is-not-recovery.png',
    title: 'Backup is not recovery',
    body: 'Upload success is not enough. Community verifies integrity; Cloud can page people when verification fails or RPO age breaches policy.',
    layer: 'both',
  },
  {
    src: '/images/diagrams/10-restore-fresh-supabase-project.png',
    title: 'Restore into a fresh project',
    body: 'Guarded restore refuses the source project. You confirm a new target. Offline restore works even if Portabase Cloud is unreachable.',
    layer: 'community',
  },
];

/** Structured model cards used as primary homepage architecture assets */
export const modelLayers = [
  {
    id: 'community',
    kicker: 'LAYER 01 · OPEN SOURCE',
    title: 'Community engine',
    price: 'Free · Apache-2.0',
    promise: 'Everything that touches your data',
    points: [
      'CLI + self-hosted runner (VM, NAS, container, cloud box)',
      'Full encrypted capture by default — no license gate',
      'Verify, retain, and guarded restore into a new Supabase project',
      'Destinations: Drive, Dropbox, rclone, local/NAS, customer S3',
      'Works fully offline from Portabase infrastructure',
    ],
  },
  {
    id: 'cloud',
    kicker: 'LAYER 02 · HOSTED CONVENIENCE',
    title: 'Portabase Cloud',
    price: 'Paid · optional',
    promise: 'Ops, visibility, and waking humans',
    points: [
      'Hosted management console and setup niceties',
      'Opt-in agent telemetry (job status, timing, error class)',
      'Missed-backup / verify-failure / RPO-age monitoring',
      'Multi-person alert chains: SMS, email, Slack, webhooks',
      'Fleet view and team seats — never capsule bytes or passphrases',
    ],
  },
];

export const trustBoundary = [
  {
    side: 'never',
    title: 'Never sent to Cloud',
    items: ['Encryption passphrase', 'DB URLs & passwords', 'Service-role / secret keys', 'Capsule bytes & decrypted dumps', 'Storage object contents'],
  },
  {
    side: 'optional',
    title: 'Opt-in health only',
    items: ['backup.completed / failed', 'Missed schedule heartbeats', 'Verify failure class', 'RPO age / duration metrics', 'Agent id + project ref label'],
  },
];
