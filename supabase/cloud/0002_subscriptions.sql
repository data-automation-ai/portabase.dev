-- Optional control-plane tables for Cloud billing (mirror of Netlify Blobs during SPA launch).
-- Apply when the hosted Portabase Cloud Supabase project is the system of record for tenancy.

create table if not exists portabase_cloud.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references portabase_cloud.profiles (id) on delete set null,
  cognito_sub text not null,
  email text not null,
  status text not null default 'none'
    check (status in ('none', 'checkout_pending', 'trialing', 'active', 'past_due', 'canceled')),
  plan text not null default 'cloud-intro-17',
  trial_days int not null default 7,
  price_monthly_cents int not null default 1700,
  list_price_monthly_cents int not null default 3400,
  square_customer_id text,
  square_subscription_id text unique,
  square_order_id text,
  square_plan_variation_id text,
  checkout_attempt text,
  started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cognito_sub)
);

create index if not exists subscriptions_status_idx
  on portabase_cloud.subscriptions (status, trial_ends_at);

comment on table portabase_cloud.subscriptions is
  'Cloud ops subscription only. Never store card PANs or capsule secrets.';
