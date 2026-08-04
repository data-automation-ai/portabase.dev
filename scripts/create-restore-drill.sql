\set ON_ERROR_STOP on

begin;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'portabase_drill') then
    raise exception 'portabase_drill already exists; refusing to overwrite it';
  end if;
end $$;

create schema portabase_drill;
comment on schema portabase_drill is
  'Deterministic synthetic fixture for Portabase fresh-project restore acceptance.';

create table portabase_drill.customers (
  id uuid primary key,
  email text not null unique check (email like '%@example.invalid'),
  display_name text not null,
  created_at timestamptz not null
);

create table portabase_drill.orders (
  id uuid primary key,
  customer_id uuid not null references portabase_drill.customers(id),
  status text not null check (status in ('draft', 'paid', 'fulfilled')),
  ordered_at timestamptz not null
);

create table portabase_drill.order_items (
  id uuid primary key,
  order_id uuid not null references portabase_drill.orders(id) on delete cascade,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0)
);

insert into portabase_drill.customers values
  ('10000000-0000-4000-8000-000000000001', 'ada@example.invalid', 'Ada Example', '2026-01-02T10:00:00Z'),
  ('10000000-0000-4000-8000-000000000002', 'grace@example.invalid', 'Grace Example', '2026-01-03T11:00:00Z'),
  ('10000000-0000-4000-8000-000000000003', 'katherine@example.invalid', 'Katherine Example', '2026-01-04T12:00:00Z');

insert into portabase_drill.orders values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'paid', '2026-02-01T09:00:00Z'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'fulfilled', '2026-02-02T10:00:00Z'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'paid', '2026-02-03T11:00:00Z'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'draft', '2026-02-04T12:00:00Z');

insert into portabase_drill.order_items values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'PB-ALPHA', 2, 19.95),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'PB-BETA', 1, 49.50),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'PB-GAMMA', 3, 7.25),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'PB-DELTA', 1, 125.00),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000003', 'PB-ALPHA', 5, 19.95),
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000003', 'PB-EPSILON', 2, 88.00),
  ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000004', 'PB-ZETA', 1, 5.00);

create or replace function public.portabase_drill_order_total()
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, portabase_drill
as $$
  select coalesce(sum(quantity * unit_price), 0)::numeric(14,2)
  from portabase_drill.order_items;
$$;

revoke all on function public.portabase_drill_order_total() from public;
grant execute on function public.portabase_drill_order_total() to service_role;

commit;

select 'portabase_drill created successfully' as result;
