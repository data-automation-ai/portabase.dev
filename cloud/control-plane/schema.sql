-- Portabase Cloud control-plane replica.
-- ONE persistent on-disk SQLite file. Not an in-memory database. Not a second throwaway store.
-- Mirrors hosted Supabase essentials only. Never keys, never capsule bytes.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS replica_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Local-only. Pending writes while the Supabase primary is down.
CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  row_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  plan_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS subscribers_email_idx ON subscribers (email);
CREATE INDEX IF NOT EXISTS subscribers_user_id_idx ON subscribers (user_id);

CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  plan_id TEXT,
  percent_off INTEGER,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_metadata (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT,
  square_customer_id TEXT,
  square_subscription_id TEXT,
  trial_ends_at TEXT,
  current_period_end TEXT,
  price_monthly_cents INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_subscriber_idx ON billing_metadata (subscriber_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  project_ref TEXT,
  capsule_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, created_at);

CREATE TABLE IF NOT EXISTS capsule_hashes (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'sha256',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS capsule_hashes_hash_idx ON capsule_hashes (algorithm, hash);
