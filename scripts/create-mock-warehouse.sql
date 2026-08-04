\set ON_ERROR_STOP on
\timing on

SET statement_timeout = 0;
SET lock_timeout = '10s';
SET idle_in_transaction_session_timeout = 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'mock_warehouse') THEN
    RAISE EXCEPTION 'mock_warehouse already exists; refusing to overwrite it';
  END IF;
END
$$;

BEGIN;

CREATE SCHEMA mock_warehouse;
COMMENT ON SCHEMA mock_warehouse IS
  'Entirely synthetic analytics warehouse created for Portabase backup and recovery testing.';

SET search_path = mock_warehouse, public;

CREATE TABLE load_manifest (
  dataset_name text PRIMARY KEY,
  dataset_version text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  synthetic_only boolean NOT NULL DEFAULT true,
  intended_sales_rows bigint NOT NULL,
  intended_inventory_rows bigint NOT NULL,
  intended_shipment_rows bigint NOT NULL,
  notes text NOT NULL
);

INSERT INTO load_manifest (
  dataset_name,
  dataset_version,
  intended_sales_rows,
  intended_inventory_rows,
  intended_shipment_rows,
  notes
) VALUES (
  'Asteria Distribution Analytics',
  '2026.07-v1',
  1200000,
  300000,
  250000,
  'Deterministic fictional customers, products, sales, inventory, and shipments. No real personal data.'
);

CREATE TABLE dim_date (
  date_id integer PRIMARY KEY,
  full_date date NOT NULL UNIQUE,
  day_of_week smallint NOT NULL,
  day_name text NOT NULL,
  day_of_month smallint NOT NULL,
  day_of_year smallint NOT NULL,
  week_of_year smallint NOT NULL,
  month_number smallint NOT NULL,
  month_name text NOT NULL,
  quarter_number smallint NOT NULL,
  calendar_year smallint NOT NULL,
  is_weekend boolean NOT NULL
);

INSERT INTO dim_date
SELECT
  to_char(d, 'YYYYMMDD')::integer,
  d::date,
  extract(isodow FROM d)::smallint,
  trim(to_char(d, 'Day')),
  extract(day FROM d)::smallint,
  extract(doy FROM d)::smallint,
  extract(week FROM d)::smallint,
  extract(month FROM d)::smallint,
  trim(to_char(d, 'Month')),
  extract(quarter FROM d)::smallint,
  extract(year FROM d)::smallint,
  extract(isodow FROM d) IN (6, 7)
FROM generate_series('2022-01-01'::date, '2026-12-31'::date, interval '1 day') AS d;

CREATE TABLE dim_customer (
  customer_id integer PRIMARY KEY,
  customer_code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email_address text NOT NULL UNIQUE,
  customer_segment text NOT NULL,
  country_code char(2) NOT NULL,
  region_name text NOT NULL,
  signup_date date NOT NULL,
  loyalty_tier text NOT NULL,
  marketing_opt_in boolean NOT NULL,
  synthetic_fingerprint char(32) NOT NULL
);

INSERT INTO dim_customer
SELECT
  g,
  'CUS-' || lpad(g::text, 8, '0'),
  'Synthetic Customer ' || lpad(g::text, 8, '0'),
  'customer' || lpad(g::text, 8, '0') || '@example.invalid',
  (ARRAY['Consumer', 'Small Business', 'Mid-Market', 'Enterprise'])[(g % 4) + 1],
  (ARRAY['US', 'CA', 'GB', 'DE', 'FR', 'AU', 'JP', 'BR'])[(g % 8) + 1],
  (ARRAY['Northeast', 'Southeast', 'Midwest', 'West', 'Central', 'International'])[(g % 6) + 1],
  date '2018-01-01' + (g % 2922),
  (ARRAY['Bronze', 'Silver', 'Gold', 'Platinum'])[(g % 4) + 1],
  g % 5 <> 0,
  md5('mock-customer-' || g::text)
FROM generate_series(1, 75000) AS g;

CREATE TABLE dim_supplier (
  supplier_id integer PRIMARY KEY,
  supplier_code text NOT NULL UNIQUE,
  supplier_name text NOT NULL,
  country_code char(2) NOT NULL,
  lead_time_days smallint NOT NULL,
  quality_score numeric(5,2) NOT NULL,
  active boolean NOT NULL
);

INSERT INTO dim_supplier
SELECT
  g,
  'SUP-' || lpad(g::text, 5, '0'),
  'Synthetic Supplier ' || lpad(g::text, 5, '0'),
  (ARRAY['US', 'CA', 'MX', 'GB', 'DE', 'PL', 'IN', 'VN', 'CN', 'JP'])[(g % 10) + 1],
  (3 + g % 58)::smallint,
  round((70 + (g % 3000) / 100.0)::numeric, 2),
  g % 29 <> 0
FROM generate_series(1, 2000) AS g;

CREATE TABLE dim_product (
  product_id integer PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  product_name text NOT NULL,
  category_name text NOT NULL,
  subcategory_name text NOT NULL,
  brand_name text NOT NULL,
  supplier_id integer NOT NULL REFERENCES dim_supplier(supplier_id),
  standard_cost numeric(10,2) NOT NULL,
  list_price numeric(10,2) NOT NULL,
  weight_kg numeric(8,3) NOT NULL,
  active boolean NOT NULL
);

INSERT INTO dim_product
SELECT
  g,
  'SKU-' || lpad(g::text, 7, '0'),
  'Synthetic Product ' || lpad(g::text, 7, '0'),
  (ARRAY['Electronics', 'Office', 'Industrial', 'Home', 'Outdoor', 'Apparel', 'Health', 'Automotive'])[(g % 8) + 1],
  (ARRAY['Core', 'Premium', 'Value', 'Seasonal', 'Specialty', 'Replacement'])[(g % 6) + 1],
  'Brand ' || lpad((g % 400 + 1)::text, 3, '0'),
  (g % 2000) + 1,
  round((2.00 + (g % 25000) / 100.0)::numeric, 2),
  round((5.00 + (g % 50000) / 100.0)::numeric, 2),
  round((0.050 + (g % 25000) / 1000.0)::numeric, 3),
  g % 37 <> 0
FROM generate_series(1, 20000) AS g;

CREATE TABLE dim_store (
  store_id integer PRIMARY KEY,
  store_code text NOT NULL UNIQUE,
  store_name text NOT NULL,
  store_type text NOT NULL,
  country_code char(2) NOT NULL,
  region_name text NOT NULL,
  opened_date date NOT NULL,
  floor_area_sqft integer NOT NULL
);

INSERT INTO dim_store
SELECT
  g,
  'STORE-' || lpad(g::text, 4, '0'),
  'Synthetic Location ' || lpad(g::text, 4, '0'),
  (ARRAY['Retail', 'Outlet', 'Partner', 'Online Fulfillment'])[(g % 4) + 1],
  (ARRAY['US', 'CA', 'GB', 'DE', 'FR', 'AU'])[(g % 6) + 1],
  (ARRAY['Northeast', 'Southeast', 'Midwest', 'West', 'Central', 'International'])[(g % 6) + 1],
  date '2005-01-01' + (g * 23 % 6574),
  2500 + (g * 137 % 85000)
FROM generate_series(1, 250) AS g;

CREATE TABLE dim_warehouse (
  warehouse_id integer PRIMARY KEY,
  warehouse_code text NOT NULL UNIQUE,
  warehouse_name text NOT NULL,
  country_code char(2) NOT NULL,
  region_name text NOT NULL,
  capacity_units integer NOT NULL,
  automated boolean NOT NULL
);

INSERT INTO dim_warehouse
SELECT
  g,
  'WH-' || lpad(g::text, 3, '0'),
  'Synthetic Distribution Center ' || lpad(g::text, 3, '0'),
  (ARRAY['US', 'CA', 'GB', 'DE', 'AU'])[(g % 5) + 1],
  (ARRAY['Northeast', 'Southeast', 'Midwest', 'West', 'International'])[(g % 5) + 1],
  100000 + (g * 17003 % 1400000),
  g % 3 <> 0
FROM generate_series(1, 50) AS g;

CREATE TABLE fact_sales (
  sale_id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  line_number smallint NOT NULL,
  date_id integer NOT NULL REFERENCES dim_date(date_id),
  customer_id integer NOT NULL REFERENCES dim_customer(customer_id),
  product_id integer NOT NULL REFERENCES dim_product(product_id),
  store_id integer NOT NULL REFERENCES dim_store(store_id),
  sales_channel text NOT NULL,
  payment_method text NOT NULL,
  quantity smallint NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  discount_rate numeric(5,4) NOT NULL,
  gross_revenue numeric(14,2) NOT NULL,
  net_revenue numeric(14,2) NOT NULL,
  product_cost numeric(14,2) NOT NULL,
  tax_amount numeric(12,2) NOT NULL,
  returned boolean NOT NULL,
  promotion_code text
);

WITH generated AS (
  SELECT
    g,
    (1 + g % 5)::smallint AS quantity,
    round((5.00 + (g % 50000) / 100.0)::numeric, 2) AS unit_price,
    round(((g % 31) / 100.0)::numeric, 4) AS discount_rate
  FROM generate_series(1, 1200000) AS g
), priced AS (
  SELECT *, round((quantity * unit_price)::numeric, 2) AS gross_revenue
  FROM generated
)
INSERT INTO fact_sales
SELECT
  g,
  ((g - 1) / 3) + 1,
  (((g - 1) % 3) + 1)::smallint,
  to_char(date '2022-01-01' + (g % 1826), 'YYYYMMDD')::integer,
  (g * 17 % 75000) + 1,
  (g * 31 % 20000) + 1,
  (g * 13 % 250) + 1,
  (ARRAY['Web', 'Mobile', 'Retail', 'Marketplace', 'Partner'])[(g % 5) + 1],
  (ARRAY['Card', 'ACH', 'Wallet', 'Invoice', 'Gift Card'])[(g % 5) + 1],
  quantity,
  unit_price,
  discount_rate,
  gross_revenue,
  round((gross_revenue * (1 - discount_rate))::numeric, 2),
  round((gross_revenue * (0.42 + (g % 21) / 100.0))::numeric, 2),
  round((gross_revenue * (0.02 + (g % 7) / 100.0))::numeric, 2),
  g % 41 = 0,
  CASE WHEN g % 7 = 0 THEN 'PROMO-' || lpad((g % 500)::text, 3, '0') END
FROM priced;

CREATE TABLE fact_inventory_snapshot (
  snapshot_id bigint PRIMARY KEY,
  date_id integer NOT NULL REFERENCES dim_date(date_id),
  warehouse_id integer NOT NULL REFERENCES dim_warehouse(warehouse_id),
  product_id integer NOT NULL REFERENCES dim_product(product_id),
  on_hand_units integer NOT NULL,
  allocated_units integer NOT NULL,
  backorder_units integer NOT NULL,
  reorder_point integer NOT NULL,
  inventory_value numeric(16,2) NOT NULL,
  days_since_receipt smallint NOT NULL
);

INSERT INTO fact_inventory_snapshot
SELECT
  g,
  to_char(date '2024-01-01' + (g % 731), 'YYYYMMDD')::integer,
  (g * 7 % 50) + 1,
  (g * 29 % 20000) + 1,
  10 + (g * 37 % 5000),
  g * 17 % 800,
  CASE WHEN g % 19 = 0 THEN g % 300 ELSE 0 END,
  25 + (g % 500),
  round(((10 + (g * 37 % 5000)) * (2.00 + (g % 25000) / 100.0))::numeric, 2),
  (g % 181)::smallint
FROM generate_series(1, 300000) AS g;

CREATE TABLE fact_shipment (
  shipment_id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  ship_date_id integer NOT NULL REFERENCES dim_date(date_id),
  delivery_date_id integer NOT NULL REFERENCES dim_date(date_id),
  warehouse_id integer NOT NULL REFERENCES dim_warehouse(warehouse_id),
  customer_id integer NOT NULL REFERENCES dim_customer(customer_id),
  carrier_name text NOT NULL,
  service_level text NOT NULL,
  package_count smallint NOT NULL,
  shipment_weight_kg numeric(12,3) NOT NULL,
  shipping_cost numeric(12,2) NOT NULL,
  promised_days smallint NOT NULL,
  actual_days smallint NOT NULL,
  delivered_on_time boolean NOT NULL,
  tracking_code text NOT NULL UNIQUE
);

WITH generated AS (
  SELECT
    g,
    date '2022-01-01' + (g % 1815) AS ship_date,
    (1 + g % 7)::smallint AS actual_days,
    (2 + g % 5)::smallint AS promised_days
  FROM generate_series(1, 250000) AS g
)
INSERT INTO fact_shipment
SELECT
  g,
  (g * 5 % 400000) + 1,
  to_char(ship_date, 'YYYYMMDD')::integer,
  to_char(ship_date + actual_days, 'YYYYMMDD')::integer,
  (g * 11 % 50) + 1,
  (g * 23 % 75000) + 1,
  (ARRAY['Atlas Parcel', 'Northstar Freight', 'Bluebird Express', 'Union Logistics', 'Meridian Post'])[(g % 5) + 1],
  (ARRAY['Economy', 'Ground', 'Two-Day', 'Overnight', 'Freight'])[(g % 5) + 1],
  (1 + g % 6)::smallint,
  round((0.150 + (g % 150000) / 1000.0)::numeric, 3),
  round((4.00 + (g % 30000) / 100.0)::numeric, 2),
  promised_days,
  actual_days,
  actual_days <= promised_days,
  'MOCK-' || upper(md5('shipment-' || g::text))
FROM generated;

CREATE INDEX fact_sales_date_idx ON fact_sales(date_id);
CREATE INDEX fact_sales_customer_idx ON fact_sales(customer_id);
CREATE INDEX fact_sales_product_idx ON fact_sales(product_id);
CREATE INDEX fact_sales_store_idx ON fact_sales(store_id);
CREATE INDEX fact_sales_channel_date_idx ON fact_sales(sales_channel, date_id);
CREATE INDEX fact_inventory_date_warehouse_idx ON fact_inventory_snapshot(date_id, warehouse_id);
CREATE INDEX fact_inventory_product_idx ON fact_inventory_snapshot(product_id);
CREATE INDEX fact_shipment_ship_date_idx ON fact_shipment(ship_date_id);
CREATE INDEX fact_shipment_customer_idx ON fact_shipment(customer_id);
CREATE INDEX fact_shipment_warehouse_idx ON fact_shipment(warehouse_id);
CREATE INDEX dim_product_category_idx ON dim_product(category_name, subcategory_name);
CREATE INDEX dim_customer_segment_idx ON dim_customer(customer_segment, loyalty_tier);

CREATE VIEW v_monthly_channel_sales AS
SELECT
  d.calendar_year,
  d.month_number,
  s.sales_channel,
  count(*) AS line_count,
  count(DISTINCT s.order_id) AS order_count,
  sum(s.quantity) AS units_sold,
  round(sum(s.net_revenue), 2) AS net_revenue,
  round(sum(s.net_revenue - s.product_cost), 2) AS gross_margin
FROM fact_sales s
JOIN dim_date d ON d.date_id = s.date_id
GROUP BY d.calendar_year, d.month_number, s.sales_channel;

CREATE MATERIALIZED VIEW mv_monthly_category_sales AS
SELECT
  d.calendar_year,
  d.month_number,
  p.category_name,
  count(*) AS line_count,
  sum(s.quantity) AS units_sold,
  round(sum(s.net_revenue), 2) AS net_revenue,
  round(avg(s.discount_rate), 4) AS average_discount_rate,
  round(sum(s.net_revenue - s.product_cost), 2) AS gross_margin
FROM fact_sales s
JOIN dim_date d ON d.date_id = s.date_id
JOIN dim_product p ON p.product_id = s.product_id
GROUP BY d.calendar_year, d.month_number, p.category_name;

CREATE UNIQUE INDEX mv_monthly_category_sales_pk
  ON mv_monthly_category_sales(calendar_year, month_number, category_name);

CREATE VIEW v_customer_lifetime_value AS
SELECT
  c.customer_id,
  c.customer_code,
  c.customer_segment,
  c.loyalty_tier,
  count(DISTINCT s.order_id) AS order_count,
  sum(s.quantity) AS units_purchased,
  round(sum(s.net_revenue), 2) AS lifetime_revenue,
  round(sum(s.net_revenue - s.product_cost), 2) AS lifetime_margin,
  max(d.full_date) AS most_recent_purchase_date
FROM dim_customer c
LEFT JOIN fact_sales s ON s.customer_id = c.customer_id
LEFT JOIN dim_date d ON d.date_id = s.date_id
GROUP BY c.customer_id, c.customer_code, c.customer_segment, c.loyalty_tier;

COMMIT;

ANALYZE mock_warehouse.dim_date;
ANALYZE mock_warehouse.dim_customer;
ANALYZE mock_warehouse.dim_supplier;
ANALYZE mock_warehouse.dim_product;
ANALYZE mock_warehouse.dim_store;
ANALYZE mock_warehouse.dim_warehouse;
ANALYZE mock_warehouse.fact_sales;
ANALYZE mock_warehouse.fact_inventory_snapshot;
ANALYZE mock_warehouse.fact_shipment;
ANALYZE mock_warehouse.mv_monthly_category_sales;

SELECT 'mock_warehouse created successfully' AS result;
