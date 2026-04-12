-- Clear all existing data from the database
-- WARNING: This will permanently delete all records from all tables

-- Disable foreign key checks temporarily (if needed)
-- Note: PostgreSQL doesn't have a global FK disable, so we delete in dependency order

-- Delete transaction/payment records first (they reference other tables)
DELETE FROM supplier_payments;
DELETE FROM customer_payments;
DELETE FROM balance_entries;
DELETE FROM inventory_transactions;

-- Delete invoice records
DELETE FROM supplier_invoices;
DELETE FROM customer_invoices;

-- Delete order items (they reference orders and products)
DELETE FROM sales_order_items;
DELETE FROM purchase_order_items;

-- Delete orders
DELETE FROM sales_orders;
DELETE FROM purchase_orders;

-- Delete inventory records
DELETE FROM inventory;

-- Delete contact information
DELETE FROM customer_contacts;
DELETE FROM supplier_contacts;

-- Delete master data
DELETE FROM customers;
DELETE FROM suppliers;
DELETE FROM products;
DELETE FROM product_categories;

-- Delete users (optional - comment out if you want to keep users)
DELETE FROM users;

-- Reset sequences to start from 1 again
ALTER SEQUENCE IF EXISTS balance_entries_entry_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS customer_contacts_contact_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS customer_invoices_invoice_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS customer_payments_payment_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS customers_customer_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS inventory_inventory_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS inventory_transactions_transaction_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS product_categories_category_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS products_product_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS purchase_order_items_po_item_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS purchase_orders_po_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS sales_order_items_so_item_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS sales_orders_so_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS supplier_contacts_contact_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS supplier_invoices_invoice_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS supplier_payments_payment_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS suppliers_supplier_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS users_user_id_seq RESTART WITH 1;

-- Verify deletion (shows row counts for all tables)
SELECT 
    'balance_entries' as table_name, COUNT(*) as row_count FROM balance_entries
UNION ALL SELECT 'customer_contacts', COUNT(*) FROM customer_contacts
UNION ALL SELECT 'customer_invoices', COUNT(*) FROM customer_invoices
UNION ALL SELECT 'customer_payments', COUNT(*) FROM customer_payments
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL SELECT 'inventory_transactions', COUNT(*) FROM inventory_transactions
UNION ALL SELECT 'product_categories', COUNT(*) FROM product_categories
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'purchase_order_items', COUNT(*) FROM purchase_order_items
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'sales_order_items', COUNT(*) FROM sales_order_items
UNION ALL SELECT 'sales_orders', COUNT(*) FROM sales_orders
UNION ALL SELECT 'supplier_contacts', COUNT(*) FROM supplier_contacts
UNION ALL SELECT 'supplier_invoices', COUNT(*) FROM supplier_invoices
UNION ALL SELECT 'supplier_payments', COUNT(*) FROM supplier_payments
UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
UNION ALL SELECT 'users', COUNT(*) FROM users
ORDER BY table_name;
