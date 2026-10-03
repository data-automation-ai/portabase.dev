/**
 * Signup acknowledgment checklist — the honest boundary of a capsule.
 * Levels: green = respawns automatically on the new project (informational, no checkbox),
 * amber = captureable by hand beforehand (checkbox), red = immediate attention, record the
 * key right now — on paper if necessary (checkbox).
 * Keep in lockstep with the NOT-COVERED table on /docs/disaster-recovery.
 */
export const RECOVERY_ACK_ITEMS = Object.freeze([
  Object.freeze({
    key: 'vault-root-key',
    level: 'red',
    item: 'Vault root key (pgsodium)',
    restore: 'Without it, every Vault secret in the capsule is ciphertext that can never be decrypted. This is the one permanent, total loss.',
    capture: 'Fetch it right now, while the project is healthy: Management API GET /v1/projects/{ref}/pgsodium. Make a note of it immediately — password manager, on paper if necessary — next to your capsule passphrase.',
    ack: 'My Vault root key is written down somewhere safe — or I use no Vault secrets.',
  }),
  Object.freeze({
    key: 'function-secrets',
    level: 'amber',
    item: 'Edge Function secret values',
    restore: 'Supabase returns names and digests only — plaintext values are unrecoverable by design.',
    capture: 'Keep your own copy of every value in your password manager. The capsule lists the names you must re-enter.',
    ack: 'I keep my own copies of my function secrets.',
  }),
  Object.freeze({
    key: 'auth-config',
    level: 'amber',
    item: 'Auth configuration (providers, SMTP, MFA, URLs)',
    restore: 'No automation can copy it — per-project secrets, re-created by hand on the new project.',
    capture: 'Screenshot the Auth settings pages today. OAuth client secrets live at the provider consoles (Google Cloud Console, GitHub, Apple) — reachable even if Supabase is locked.',
    docsHref: '/docs/auth-cutover',
    ack: 'I have my OAuth and SMTP credentials in my own records.',
  }),
  Object.freeze({
    key: 'project-settings',
    level: 'amber',
    item: 'Project settings (domains, network, SSL, PITR, log drains, replicas)',
    restore: 'Control-plane config, not data — re-created by hand.',
    capture: 'Screenshot these dashboard pages now, so cutover is transcription, not archaeology.',
    ack: 'I have records of my project settings.',
  }),
  Object.freeze({
    key: 'etl-destinations',
    level: 'amber',
    item: 'Replication / ETL destinations',
    restore: 'Publications ride along in the dump; pipeline and destination credentials do not.',
    capture: 'Destination credentials come from your own records; pipelines are re-created by hand.',
    ack: 'I have my pipeline destination credentials, or I run no pipelines.',
  }),
  Object.freeze({
    key: 'vector-buckets',
    level: 'amber',
    item: 'Vector Buckets',
    restore: 'Vectors live in a separate store — outside both the database dump and ordinary Storage capture.',
    capture: 'Keep your own export, or be able to re-embed from your source data.',
    ack: 'My vectors are exported or re-embeddable — or I use no Vector Buckets.',
  }),
  Object.freeze({
    key: 'analytics-buckets',
    level: 'amber',
    item: 'Analytics Buckets (Iceberg, alpha)',
    restore: 'A separate Parquet store; only a catalog row sits in Postgres.',
    capture: 'Usually re-derivable from the database the capsule does capture — confirm that for your data.',
    ack: 'My analytics data is re-derivable — or I use no Analytics Buckets.',
  }),
  Object.freeze({
    key: 'api-keys-jwt',
    level: 'green',
    item: 'JWT secret & API keys',
    restore: 'The new project mints its own — the keys simply respawn. Old sessions end; you paste the new keys into env, CI, and your secrets manager.',
    capture: 'Nothing to save. Plan the rotation, not the capture.',
  }),
  Object.freeze({
    key: 'user-signin',
    level: 'green',
    item: 'User passwords & sessions',
    restore: 'Password hashes never leave the old project — users reset once. OAuth users simply sign in again.',
    capture: 'Nothing to save. The reset flow is the designed path, not a failure.',
  }),
]);

/** Keys that require an explicit checkbox before signup (red + amber). */
export const REQUIRED_ACK_KEYS = Object.freeze(
  RECOVERY_ACK_ITEMS.filter((row) => row.ack).map((row) => row.key),
);

/** Pure gate: true when every red/amber item is acknowledged. Green rows are informational. */
export function isRecoveryAckComplete(checked) {
  if (!checked) return false;
  const set = checked instanceof Set ? checked : new Set(checked);
  return REQUIRED_ACK_KEYS.every((key) => set.has(key));
}
