-- Portabase Cloud control plane.
-- Lives in schema portabase_cloud to avoid colliding with other apps on a shared project.
-- Does NOT store customer encryption passphrases, DB URLs, or capsule bytes.

create schema if not exists portabase_cloud;
create extension if not exists pgcrypto;

create table if not exists portabase_cloud.profiles (
  id uuid primary key default gen_random_uuid(),
  cognito_sub text unique,
  supabase_user_id uuid unique,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_identity_present check (cognito_sub is not null or supabase_user_id is not null)
);

create table if not exists portabase_cloud.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'cloud' check (plan in ('cloud', 'pro', 'business')),
  created_at timestamptz not null default now()
);

create table if not exists portabase_cloud.workspace_members (
  workspace_id uuid not null references portabase_cloud.workspaces (id) on delete cascade,
  profile_id uuid not null references portabase_cloud.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);

create table if not exists portabase_cloud.monitored_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references portabase_cloud.workspaces (id) on delete cascade,
  project_ref text not null,
  display_name text,
  created_at timestamptz not null default now(),
  unique (workspace_id, project_ref)
);

create table if not exists portabase_cloud.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references portabase_cloud.workspaces (id) on delete cascade,
  name text not null,
  token_hash text not null,
  token_prefix text not null,
  project_id uuid references portabase_cloud.monitored_projects (id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists portabase_cloud.telemetry_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references portabase_cloud.workspaces (id) on delete cascade,
  agent_id uuid references portabase_cloud.agents (id) on delete set null,
  project_ref text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  hostname text,
  portabase_version text,
  payload jsonb not null default '{}'::jsonb,
  constraint telemetry_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists telemetry_events_workspace_time
  on portabase_cloud.telemetry_events (workspace_id, occurred_at desc);
create index if not exists telemetry_events_type
  on portabase_cloud.telemetry_events (workspace_id, event_type, occurred_at desc);

create table if not exists portabase_cloud.alert_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references portabase_cloud.workspaces (id) on delete cascade,
  kind text not null check (kind in ('email', 'sms', 'slack', 'webhook', 'sns')),
  label text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists portabase_cloud.alert_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references portabase_cloud.workspaces (id) on delete cascade,
  name text not null,
  event_types text[] not null default array['backup.failed', 'schedule.missed'],
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists portabase_cloud.escalation_steps (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references portabase_cloud.alert_policies (id) on delete cascade,
  step_order int not null check (step_order >= 1),
  delay_seconds int not null default 0 check (delay_seconds >= 0),
  channel_id uuid not null references portabase_cloud.alert_channels (id) on delete cascade,
  unique (policy_id, step_order)
);

create table if not exists portabase_cloud.runners (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references portabase_cloud.workspaces (id) on delete cascade,
  project_id uuid references portabase_cloud.monitored_projects (id) on delete set null,
  isolation_level text not null default 'L1' check (isolation_level in ('L0', 'L1', 'L2', 'L3')),
  status text not null default 'pending' check (status in ('pending', 'provisioning', 'running', 'stopped', 'error')),
  ecs_cluster_arn text,
  ecs_service_arn text,
  ecs_task_definition_arn text,
  log_group_name text,
  secret_prefix text,
  tailscale_hostname text,
  tailscale_enabled boolean not null default false,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on schema portabase_cloud is 'Portabase Cloud control plane — health metadata and tenancy only.';
comment on table portabase_cloud.telemetry_events is 'Health metadata only. Never store secrets or capsule payloads.';
comment on table portabase_cloud.agents is 'token_hash only; plaintext token returned once at creation.';
comment on table portabase_cloud.runners is 'AWS ECS managed runner registry; secrets in Secrets Manager under secret_prefix.';
