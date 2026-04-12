-- Clear all data from tables (in correct order to respect foreign key constraints)

-- Disable foreign key checks temporarily (if needed)
-- Note: Supabase/PostgreSQL uses CASCADE for deletions

-- Clear transaction tables first (dependent on other tables)
DELETE FROM customer_payments;
DELETE FROM supplier_payments;

-- Clear invoice tables
DELETE FROM customer_invoices;
DELETE FROM supplier_invoices;

-- Added contact tables deletion before deleting customers/suppliers
-- Clear contact tables (dependent on customers/suppliers)
DELETE FROM customer_contacts;
DELETE FROM supplier_contacts;

-- Clear order-related tables
DELETE FROM sales_order_items;
DELETE FROM sales_orders;

DELETE FROM purchase_order_items;
DELETE FROM purchase_orders;

-- Clear inventory
DELETE FROM inventory;

-- Clear master data tables
DELETE FROM products;
DELETE FROM customers;
DELETE FROM suppliers;

-- Clear user profiles (but keep auth users)
DELETE FROM user_profiles;

-- Reset sequences (optional - this resets auto-increment counters)
-- ALTER SEQUENCE products_product_id_seq RESTART WITH 1;
-- ALTER SEQUENCE customers_customer_id_seq RESTART WITH 1;
-- ALTER SEQUENCE suppliers_supplier_id_seq RESTART WITH 1;
-- ALTER SEQUENCE sales_orders_order_id_seq RESTART WITH 1;
-- ALTER SEQUENCE purchase_orders_po_id_seq RESTART WITH 1;
-- ALTER SEQUENCE inventory_inventory_id_seq RESTART WITH 1;
-- ALTER SEQUENCE customer_invoices_invoice_id_seq RESTART WITH 1;
-- ALTER SEQUENCE supplier_invoices_invoice_id_seq RESTART WITH 1;

-- Confirm deletion
SELECT 'All data cleared successfully!' as message;
