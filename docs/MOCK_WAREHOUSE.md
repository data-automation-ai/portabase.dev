# Redshift White Papers mock warehouse

## Purpose

The `mock_warehouse` schema is a deterministic, entirely synthetic analytics workload created in the isolated Redshift White Papers Supabase project. It exists to exercise Portabase capture, encryption, transfer, verification, and future restore drills at a meaningful database size without touching existing application schemas.

No names, email addresses, tracking codes, or business records in this schema represent real people or transactions. Synthetic email addresses use the reserved `.invalid` domain.

## Generated model

| Relation | Rows |
| --- | ---: |
| `dim_date` | 1,826 |
| `dim_customer` | 75,000 |
| `dim_supplier` | 2,000 |
| `dim_product` | 20,000 |
| `dim_store` | 250 |
| `dim_warehouse` | 50 |
| `fact_sales` | 1,200,000 |
| `fact_inventory_snapshot` | 300,000 |
| `fact_shipment` | 250,000 |

The schema also includes a load manifest, indexed foreign keys, a monthly channel-sales view, a customer lifetime-value view, and a materialized monthly category-sales aggregate.

## Measured result

On July 12, 2026:

- The complete database grew from 11 MB to 360 MB.
- The tested sales relationships contained zero orphan customer, product, or date references.
- The largest relation was `fact_sales` at 223 MB including indexes.
- A full Portabase capture completed for database, Storage, and two Edge Functions.
- The independently copied encrypted capsule was 58.3 MB.
- Outer checksums, AES-GCM authentication, ciphertext hash, and decrypted payload hash all verified.

This proves the backup path at the generated scale. It does not replace a guarded restore into a separate disposable target.

## Reproduce

The loader refuses to overwrite an existing `mock_warehouse` schema.

```powershell
psql -X -f scripts/create-mock-warehouse.sql
psql -X -f scripts/validate-mock-warehouse.sql
```

Supply the database connection through standard PostgreSQL environment variables so credentials do not enter shell history.

## Removal

Removal is intentionally not automated. If the synthetic workload is no longer needed, explicitly verify the target project and schema before running:

```sql
DROP SCHEMA mock_warehouse CASCADE;
```

Never run that command against a schema containing customer or production data.
