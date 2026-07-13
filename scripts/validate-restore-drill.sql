-- Read-only acceptance queries for the disposable PortaBase restore target.
-- Run only after confirming this is the new destination project.

select 'customers' as fixture, count(*)::bigint as actual_rows from portabase_drill.customers
union all
select 'orders', count(*)::bigint from portabase_drill.orders
union all
select 'order_items', count(*)::bigint from portabase_drill.order_items
order by fixture;

select count(*)::bigint as orphaned_orders
from portabase_drill.orders o
left join portabase_drill.customers c on c.id = o.customer_id
where c.id is null;

select count(*)::bigint as orphaned_order_items
from portabase_drill.order_items i
left join portabase_drill.orders o on o.id = i.order_id
where o.id is null;

select coalesce(sum(quantity * unit_price), 0)::numeric(14,2) as restored_order_total
from portabase_drill.order_items;

select count(*)::bigint as tagged_auth_users
from auth.users
where raw_user_meta_data ->> 'fixture' = 'portabase_restore_drill';

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('portabase-drill-private', 'portabase-drill-media')
order by id;

select bucket_id, name, metadata ->> 'size' as size, metadata ->> 'mimetype' as mime_type
from storage.objects
where bucket_id in ('portabase-drill-private', 'portabase-drill-media')
order by bucket_id, name;
