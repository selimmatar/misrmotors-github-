# Archived SQL migrations

These scripts were already applied. Never run any of them against the production database.

They are kept only as a history of how the schema reached its current state. Several were one-off fixes, test seeds or full data wipes written for development databases. Running them again would duplicate, corrupt or delete live records.

The live schema is the source of truth. Make new database changes as reviewed migrations, never by re-running files from this folder.

## Destructive scripts

These files contain `DELETE FROM`, `TRUNCATE` or `DROP TABLE`. Never run them anywhere that holds real data:

- `004-simplify-lost-sales-table.sql`
- `006_clear_all_data.sql`
- `01-drop-existing-tables.sql`
- `020_fix_balance_table_schema.sql`
- `021_refactor_schema.sql`
- `034_create_delivery_permits_v2.sql`
- `056_delete_all_reports.sql`
- `09-new-schema-with-integer-ids.sql`
- `10-seed-test-data.sql`
- `104_cleanup_duplicate_invoices.sql`
- `11-add-inventory-records-v2.sql`
- `13-fix-duplicate-inventory.sql`
- `14-fix-inventory-duplicates-final.sql`
- `15-clear-all-data.sql`
