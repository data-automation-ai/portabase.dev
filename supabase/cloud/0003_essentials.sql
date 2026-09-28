-- Essential Cloud control-plane rows for the hosted Portabase Cloud project.
-- Primary for the two-layer store (see docs/CLOUD_CONTROL_PLANE_STORE.md).
-- Apply to the portabase.dev control-plane project when it exists.
-- Do NOT apply to ekklokrukxmqlahtonnc (live business source, not a write dest).
-- Metadata only: never keys, never capsule bytes, never secret-shaped bodies.

create schema if not exists portabase_cloud;

create table if not exists portabase_cloud.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid,
  status text not null default 'none',
  plan_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscribers_email_idx
  on portabase_cloud.subscribers (email);
create index if not exists subscribers_user_id_idx
  on portabase_cloud.subscribers (user_id);

create table if not exists portabase_cloud.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plan_id text,
  percent_off int,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists portabase_cloud.billing_metadata (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid,
  square_customer_id text,
  square_subscription_id text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  price_monthly_cents int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_metadata_subscriber_idx
  on portabase_cloud.billing_metadata (subscriber_id);

create table if not exists portabase_cloud.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text not null default 'queued',
  project_ref text,
  capsule_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_status_idx
  on portabase_cloud.jobs (status, created_at desc);

create table if not exists portabase_cloud.capsule_hashes (
  id uuid primary key default gen_random_uuid(),
  hash text not null,
  algorithm text not null default 'sha256',
  created_at timestamptz not null default now(),
  unique (algorithm, hash)
);

alter table portabase_cloud.subscribers enable row level security;
alter table portabase_cloud.promo_codes enable row level security;
alter table portabase_cloud.billing_metadata enable row level security;
alter table portabase_cloud.jobs enable row level security;
alter table portabase_cloud.capsule_hashes enable row level security;

comment on table portabase_cloud.subscribers is
  'Cloud subscriber metadata. Never store keys or capsule bytes.';
comment on table portabase_cloud.promo_codes is
  'Discount codes only. Not API keys or encryption material.';
comment on table portabase_cloud.billing_metadata is
  'Square customer/subscription ids and period timestamps. Never PANs or card secrets.';
comment on table portabase_cloud.jobs is
  'Job metadata. capsule_hash is a hex digest only.';
comment on table portabase_cloud.capsule_hashes is
  'Hex digests only. Never capsule ciphertext or .pbase bytes.';
