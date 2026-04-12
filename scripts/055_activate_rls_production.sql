-- =====================================================================
-- PRODUCTION RLS ACTIVATION SCRIPT
-- =====================================================================
-- This script enables Row Level Security on ALL tables and creates
-- secure policies based on authenticated user access.
-- 
-- SECURITY MODEL:
-- - All API routes use SERVICE ROLE (bypasses RLS)
-- - RLS acts as a safety net if anon key is accidentally used
-- - Policies ensure only authenticated users can access data
-- =====================================================================

-- Drop existing policies if they exist (for re-running script)
DO $$ 
BEGIN
    -- Drop all existing policies
    EXECUTE (
        SELECT string_agg('DROP POLICY IF EXISTS "' || policyname || '" ON ' || schemaname || '.' || tablename || ';', E'\n')
        FROM pg_policies 
        WHERE schemaname = 'public'
    );
END $$;

-- =====================================================================
-- ENABLE RLS ON ALL TABLES
-- =====================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_permit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_permit_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE couriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE lost_sales ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- CREATE POLICIES - ALL TABLES
-- =====================================================================
-- Policy: Allow authenticated users full access (service role bypasses)
-- This ensures data is protected if anon key is used by mistake

-- Users table
CREATE POLICY "authenticated_users_all" ON users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_users_all" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Suppliers table
CREATE POLICY "authenticated_suppliers_all" ON suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_suppliers_all" ON suppliers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Customers table
CREATE POLICY "authenticated_customers_all" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_customers_all" ON customers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Products table
CREATE POLICY "authenticated_products_all" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_products_all" ON products FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Inventory table
CREATE POLICY "authenticated_inventory_all" ON inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_inventory_all" ON inventory FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Warehouses table
CREATE POLICY "authenticated_warehouses_all" ON warehouses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_warehouses_all" ON warehouses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Purchase Orders table
CREATE POLICY "authenticated_purchase_orders_all" ON purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_purchase_orders_all" ON purchase_orders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Purchase Order Items table
CREATE POLICY "authenticated_purchase_order_items_all" ON purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_purchase_order_items_all" ON purchase_order_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Sales Orders table
CREATE POLICY "authenticated_sales_orders_all" ON sales_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_sales_orders_all" ON sales_orders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Sales Order Items table
CREATE POLICY "authenticated_sales_order_items_all" ON sales_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_sales_order_items_all" ON sales_order_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Accounts Payable table
CREATE POLICY "authenticated_accounts_payable_all" ON accounts_payable FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_accounts_payable_all" ON accounts_payable FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Accounts Receivable table
CREATE POLICY "authenticated_accounts_receivable_all" ON accounts_receivable FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_accounts_receivable_all" ON accounts_receivable FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Payment Schedules table
CREATE POLICY "authenticated_payment_schedules_all" ON payment_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_payment_schedules_all" ON payment_schedules FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Inventory Transactions table
CREATE POLICY "authenticated_inventory_transactions_all" ON inventory_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_inventory_transactions_all" ON inventory_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Inventory Audits table
CREATE POLICY "authenticated_inventory_audits_all" ON inventory_audits FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_inventory_audits_all" ON inventory_audits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Delivery Permits table
CREATE POLICY "authenticated_delivery_permits_all" ON delivery_permits FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_delivery_permits_all" ON delivery_permits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Delivery Permit Items table
CREATE POLICY "authenticated_delivery_permit_items_all" ON delivery_permit_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_delivery_permit_items_all" ON delivery_permit_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Delivery Permit Files table
CREATE POLICY "authenticated_delivery_permit_files_all" ON delivery_permit_files FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_delivery_permit_files_all" ON delivery_permit_files FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Couriers table
CREATE POLICY "authenticated_couriers_all" ON couriers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_couriers_all" ON couriers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Balance Entries table
CREATE POLICY "authenticated_balance_entries_all" ON balance_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_balance_entries_all" ON balance_entries FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Idempotency Log table
CREATE POLICY "authenticated_idempotency_log_all" ON idempotency_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_idempotency_log_all" ON idempotency_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Inventory Batches table
CREATE POLICY "authenticated_inventory_batches_all" ON inventory_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_inventory_batches_all" ON inventory_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Lost Sales table
CREATE POLICY "authenticated_lost_sales_all" ON lost_sales FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_lost_sales_all" ON lost_sales FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- VERIFICATION QUERY
-- =====================================================================
-- Run this to verify RLS is enabled on all tables:
-- SELECT tablename, rowsecurity 
-- FROM pg_tables 
-- WHERE schemaname = 'public' 
-- ORDER BY tablename;

-- Run this to see all policies:
-- SELECT schemaname, tablename, policyname, roles 
-- FROM pg_policies 
-- WHERE schemaname = 'public' 
-- ORDER BY tablename, policyname;
