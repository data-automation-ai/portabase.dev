/**
 * Signup acknowledgment checklist — the honest boundary of a capsule.
 * Levels: green = respawns automatically on the new project (informational, no checkbox),
 * amber = captureable by hand beforehand (checkbox), red = immediate attention, record the
 * key right now — on paper if necessary (checkbox).
 * Keep in lockstep with the NOT-COVERED table on /docs/disaster-recovery.
 */
export const RECOVERY_ACK_ITEMS = Object.freeze([
  // --- COMMON SECRETS (Used by almost every project) ---
  Object.freeze({
    key: 'function-secrets',
    level: 'amber',
    group: 'common',
    item: 'Edge Function & App Secrets (Stripe, OpenAI, Resend, etc.)',
    restore: 'Supabase stores secret values in a one-way hash — the system only compares True or False when your code runs, so no automated backup or programmatic API can extract the original values back out.',
    capture: 'The easiest and safest move is to rotate them right now so you can paste a fresh copy into your password manager, notes app, or Notepad. The only chance you have to make a copy of a secret value is when you rotate a new one or know the value already.',
    steps: Object.freeze([
      '1. In Supabase Dashboard, click "Edge Functions" in the left sidebar.',
      '2. Click on the "Secrets" tab.',
      '3. Click "Add new secret" or rotate the value from your provider (Stripe, OpenAI, etc.), and copy it into your Notepad.',
    ]),
    ack: 'I have my Edge Function and API secret values saved in my records.',
  }),
  Object.freeze({
    key: 'auth-config',
    level: 'amber',
    group: 'common',
    item: 'Auth Provider Secrets & SMTP Email (Google, GitHub, SendGrid)',
    restore: 'Stored as write-only credentials inside the Supabase control plane. No backup program can pull these plaintext passwords back out for you.',
    capture: 'Provider client secrets and SMTP passwords cannot be copied out of Supabase once entered. The safest move is to check your provider console (Google Cloud Console, GitHub, SendGrid) now, rotate if unknown, and save a copy in your password manager or Notepad.',
    steps: Object.freeze([
      '1. In Supabase Dashboard, click "Authentication" in the left sidebar.',
      '2. Click "Providers" (or "Email Templates / SMTP").',
      '3. Open your provider (e.g. Google), copy or generate a fresh Client Secret from the provider dashboard, and save it in your Notepad.',
    ]),
    docsHref: '/docs/auth-cutover',
    ack: 'I have my OAuth and SMTP credentials in my own records.',
  }),
  Object.freeze({
    key: 'project-settings',
    level: 'amber',
    group: 'common',
    item: 'Project Settings & Connection Details (Domains, Database, SSL)',
    restore: 'General project configuration and connection settings. Re-applied easily when pointing your domain to the new project.',
    capture: 'Keep a quick note of your custom domains, project ref, and database connection settings so cutover takes under 2 minutes.',
    steps: Object.freeze([
      '1. In Supabase Dashboard, click "Project Settings" (gear icon at bottom left).',
      '2. Click "Database" or "API".',
      '3. Note down your Reference ID, Project URL, and database connection details into your Notepad.',
    ]),
    ack: 'I have records of my project settings.',
  }),

  // --- LESS COMMON / ADVANCED (Only needed if your project specifically uses these) ---
  Object.freeze({
    key: 'vault-root-key',
    level: 'red',
    group: 'less-common',
    item: 'Vault Root Encryption Key (pgsodium — advanced column encryption)',
    restore: 'Without it, every Vault secret in the capsule is ciphertext that can never be decrypted. This is the one permanent, total loss.',
    capture: 'Most projects do not use Vault column encryption. If you do, values cannot be copied out once saved. The easiest and safest move is to rotate or set a known pgsodium key right now and copy it into your password manager, notes, or on paper if necessary — next to your capsule passphrase. The only chance you have to make a copy of a secret value is when you rotate a new one or already know the value.',
    steps: Object.freeze([
      '1. In Supabase Dashboard, click "Project Settings" (gear icon).',
      '2. Click "Database".',
      '3. Under Vault / pgsodium encryption, verify or rotate your root key (skip if you do not use Vault column encryption).',
    ]),
    ack: 'My Vault root key is written down somewhere safe — or I use no Vault secrets.',
  }),
  Object.freeze({
    key: 'vector-buckets',
    level: 'amber',
    group: 'less-common',
    item: 'Vector Buckets (AI vector search indexes)',
    restore: 'Less common. Vector embeddings live in a separate vector store outside standard database dumps.',
    capture: 'Most standard projects do not use dedicated Vector Buckets. If you do, ensure you can re-embed your vectors from your source text data or keep an export in your records.',
    steps: Object.freeze([
      '1. In Supabase Dashboard, click "Storage" in the left sidebar.',
      '2. Check if any storage buckets are dedicated vector index stores.',
      '3. If you do not use AI vector stores, simply check the confirmation below.',
    ]),
    ack: 'My vectors are exported or re-embeddable — or I use no Vector Buckets.',
  }),
  Object.freeze({
    key: 'analytics-buckets',
    level: 'amber',
    group: 'less-common',
    item: 'Analytics Buckets (Apache Iceberg / Parquet)',
    restore: 'Less common. Analytical data lakes storing raw Parquet files outside Postgres.',
    capture: 'Most projects do not use Iceberg analytics buckets. If you do, confirm your analytics data is re-derivable from the primary database rows.',
    steps: Object.freeze([
      '1. In Supabase Dashboard, check if experimental Iceberg analytics are active.',
      '2. If you only use standard Postgres tables, this does not apply to you.',
    ]),
    ack: 'My analytics data is re-derivable — or I use no Analytics Buckets.',
  }),
  Object.freeze({
    key: 'etl-destinations',
    level: 'amber',
    group: 'less-common',
    item: 'Replication / ETL Destinations (Fivetran, Airbyte, Kafka)',
    restore: 'Less common. Publications ride along in the database dump; third-party external destination logins do not.',
    capture: 'Only needed if you stream data to external data warehouses like Snowflake or BigQuery. Keep destination passwords in your records.',
    steps: Object.freeze([
      '1. In Supabase Dashboard, click "Database" -> "Publications" / "Webhooks".',
      '2. Review if external data sync services are connected.',
    ]),
    ack: 'I have my pipeline destination credentials, or I run no pipelines.',
  }),

  // --- AUTOMATIC (Handled automatically on the new project) ---
  Object.freeze({
    key: 'api-keys-jwt',
    level: 'green',
    group: 'automatic',
    item: 'JWT secret & API keys (anon & service_role)',
    restore: 'The new project mints its own fresh keys automatically — they simply respawn upon creation.',
    capture: 'Nothing to save beforehand. When your new lifeboat project is ready, it provides fresh keys to paste into your app.',
    steps: Object.freeze([
      'Automatic: No action needed now. New keys are generated when you restore.',
    ]),
  }),
  Object.freeze({
    key: 'user-signin',
    level: 'green',
    group: 'automatic',
    item: 'User passwords & active browser sessions',
    restore: 'Password hashes never leave the old project — users reset once. OAuth users simply sign in again.',
    capture: 'Nothing to save. The reset flow is the designed path, not a failure.',
    steps: Object.freeze([
      'Automatic: Handled naturally by standard authentication.',
    ]),
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
