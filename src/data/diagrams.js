export const diagrams = [
  {
    src: '/images/diagrams/01-customer-owned-recovery.png',
    title: 'The complete customer-owned recovery path',
    body: 'Supabase data moves through a runner on the customer system into storage the customer controls. PortaBase has no hosted cloud in the path.'
  },
  {
    src: '/images/diagrams/02-zero-knowledge-topology.png',
    title: 'Customer-held credentials and encryption',
    body: 'The runner uses credentials locally and sends the encrypted capsule directly to the selected destination.'
  },
  {
    src: '/images/diagrams/03-portabase-essentials.png',
    title: 'PortaBase Essentials',
    body: 'A scheduled local runner captures, encrypts, verifies, and retains capsules in Google Drive, Dropbox, or local/NAS storage.'
  },
  {
    src: '/images/diagrams/04-portabase-aws-recovery.png',
    title: 'PortaBase AWS Recovery',
    body: 'The advanced package provisions an S3/KMS vault, scheduled runner, logging, alerts, and restore workspace. The current package includes CloudFormation; Terraform is a documented future path.'
  },
  {
    src: '/images/diagrams/05-continuous-backup-cycle.png',
    title: 'The continuous backup cycle',
    body: 'Scheduled capture is followed by encryption, transfer, destination verification, status reporting, and guarded retention.'
  },
  {
    src: '/images/diagrams/06-recovery-capsule.png',
    title: 'Inside a recovery capsule',
    body: 'Database and Auth records, Storage bytes, Function source, manifests, checksums, and recovery instructions travel together.'
  },
  {
    src: '/images/diagrams/07-who-holds-the-keys.png',
    title: 'Who holds the keys',
    body: 'The customer controls the source credentials, destination account, and encryption passphrase. PortaBase receives none of them.'
  },
  {
    src: '/images/diagrams/08-what-portabase-captures.png',
    title: 'What PortaBase captures',
    body: 'The product covers the application layers that a database-only backup cannot recreate by itself.'
  },
  {
    src: '/images/diagrams/09-backup-is-not-recovery.png',
    title: 'Backup is not recovery',
    body: 'An upload message becomes meaningful only after integrity checks, authenticated decryption, and a guarded restore drill.'
  },
  {
    src: '/images/diagrams/10-restore-fresh-supabase-project.png',
    title: 'Restore into a fresh project',
    body: 'The source is never the target. PortaBase requires a distinct target project and exact confirmation before any restore executes.'
  }
];
