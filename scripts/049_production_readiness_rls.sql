-- Production Readiness: Row Level Security Policies
-- This script enables RLS on key tables and creates policies
-- IMPORTANT: Review these policies before enabling in production

-- Enable RLS on key tables (currently disabled for development)
-- Uncomment these lines when ready to enable RLS in production

-- ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Note: The current system uses service role key for all operations
-- which bypasses RLS. For production with user-specific access:
-- 1. Create auth.users entries linked to public.users
-- 2. Create RLS policies based on user roles
-- 3. Use anon key for client-side operations

-- Example policy templates (uncomment and customize as needed):

-- Sales Orders: Allow based on user role
-- CREATE POLICY "sales_orders_select_policy" ON sales_orders
--   FOR SELECT
--   USING (
--     auth.jwt() ->> 'role' IN ('ceo', 'accountant', 'sales-rep')
--     OR created_by = (auth.jwt() ->> 'user_id')::int
--   );

-- Purchase Orders: Allow based on user role
-- CREATE POLICY "purchase_orders_select_policy" ON purchase_orders
--   FOR SELECT
--   USING (
--     auth.jwt() ->> 'role' IN ('ceo', 'accountant', 'po-rep')
--     OR created_by = (auth.jwt() ->> 'user_id')::int
--   );

-- Inventory: Allow warehouse and authorized roles
-- CREATE POLICY "inventory_select_policy" ON inventory
--   FOR SELECT
--   USING (
--     auth.jwt() ->> 'role' IN ('ceo', 'accountant', 'warehouse-rep', 'po-rep', 'sales-rep')
--   );

-- For now, we ensure service role is used for all operations
-- This is secure as long as API routes properly validate requests
