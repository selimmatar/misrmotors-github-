-- Delete all report data (cached reports, not core business data)
-- This script is SAFE and does not delete transactional data

-- Note: This ERP system doesn't have a dedicated "reports" table
-- Reports are generated on-demand from existing data
-- If you meant to clear cached/temporary data, uncomment below:

-- Clear any report cache or temporary report storage
-- (Add table names here if report caching is implemented)

-- Example if report_cache table exists:
-- DELETE FROM report_cache;

-- If you want to clear ALL transactional data (DANGEROUS - DO NOT RUN IN PRODUCTION):
-- TRUNCATE TABLE sales_orders CASCADE;
-- TRUNCATE TABLE purchase_orders CASCADE;
-- TRUNCATE TABLE accounts_receivable CASCADE;
-- TRUNCATE TABLE accounts_payable CASCADE;
-- etc.

-- Confirmation message
DO $$
BEGIN
  RAISE NOTICE 'No report tables found to delete. Reports are generated on-demand from existing data.';
  RAISE NOTICE 'If you want to clear transactional data, please specify which tables (sales_orders, purchase_orders, etc.)';
END $$;
