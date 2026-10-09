-- Make user_id nullable for localStorage authentication
-- This allows inserts without requiring Supabase authenticated users

ALTER TABLE products ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE customers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE suppliers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE inventory ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE purchase_orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE sales_orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE supplier_invoices ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE customer_invoices ALTER COLUMN user_id DROP NOT NULL;
