\set ON_ERROR_STOP on
\timing on

SET statement_timeout = '2min';
SET search_path = mock_warehouse, public;

SELECT table_name, row_count
FROM (
  SELECT 'dim_date' AS table_name, count(*)::bigint AS row_count FROM dim_date
  UNION ALL SELECT 'dim_customer', count(*) FROM dim_customer
  UNION ALL SELECT 'dim_supplier', count(*) FROM dim_supplier
  UNION ALL SELECT 'dim_product', count(*) FROM dim_product
  UNION ALL SELECT 'dim_store', count(*) FROM dim_store
  UNION ALL SELECT 'dim_warehouse', count(*) FROM dim_warehouse
  UNION ALL SELECT 'fact_sales', count(*) FROM fact_sales
  UNION ALL SELECT 'fact_inventory_snapshot', count(*) FROM fact_inventory_snapshot
  UNION ALL SELECT 'fact_shipment', count(*) FROM fact_shipment
) counts
ORDER BY table_name;

SELECT
  count(*) FILTER (WHERE c.customer_id IS NULL) AS orphan_sales_customers,
  count(*) FILTER (WHERE p.product_id IS NULL) AS orphan_sales_products,
  count(*) FILTER (WHERE d.date_id IS NULL) AS orphan_sales_dates
FROM fact_sales s
LEFT JOIN dim_customer c ON c.customer_id = s.customer_id
LEFT JOIN dim_product p ON p.product_id = s.product_id
LEFT JOIN dim_date d ON d.date_id = s.date_id;

SELECT
  calendar_year,
  month_number,
  category_name,
  units_sold,
  net_revenue,
  gross_margin
FROM mv_monthly_category_sales
ORDER BY net_revenue DESC
LIMIT 10;

SELECT
  schemaname,
  relname,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'mock_warehouse'
ORDER BY pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) DESC;

SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
