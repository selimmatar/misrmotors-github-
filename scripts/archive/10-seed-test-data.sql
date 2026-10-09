-- ===========================
-- SEED TEST DATA FOR WATER PUMP ERP SYSTEM
-- ===========================

-- Clear existing test data (keep default users and categories)
DELETE FROM customer_payments WHERE payment_id > 0;
DELETE FROM customer_invoices WHERE invoice_id > 0;
DELETE FROM sales_order_items WHERE so_item_id > 0;
DELETE FROM sales_orders WHERE so_id > 0;
DELETE FROM supplier_payments WHERE payment_id > 0;
DELETE FROM supplier_invoices WHERE invoice_id > 0;
DELETE FROM purchase_order_items WHERE po_item_id > 0;
DELETE FROM purchase_orders WHERE po_id > 0;
DELETE FROM inventory_transactions WHERE transaction_id > 0;
DELETE FROM inventory WHERE inventory_id > 0;
DELETE FROM products WHERE product_id > 0;
DELETE FROM customer_contacts WHERE contact_id > 0;
DELETE FROM customers WHERE customer_id > 0;
DELETE FROM supplier_contacts WHERE contact_id > 0;
DELETE FROM suppliers WHERE supplier_id > 0;

-- Reset sequences to start from 1
ALTER SEQUENCE suppliers_supplier_id_seq RESTART WITH 1;
ALTER SEQUENCE customers_customer_id_seq RESTART WITH 1;
ALTER SEQUENCE products_product_id_seq RESTART WITH 1;
ALTER SEQUENCE purchase_orders_po_id_seq RESTART WITH 1;
ALTER SEQUENCE sales_orders_so_id_seq RESTART WITH 1;
ALTER SEQUENCE supplier_invoices_invoice_id_seq RESTART WITH 1;
ALTER SEQUENCE customer_invoices_invoice_id_seq RESTART WITH 1;

-- ===========================
-- 1. INSERT TEST SUPPLIERS
-- ===========================
INSERT INTO suppliers (supplier_name, payment_terms, is_active) VALUES
('Global Pump Manufacturing Co.', 'installment', true),
('Aqua Tech Supplies Ltd.', 'prepaid', true),
('Premium Motor Systems', 'installment', true);

-- Now supplier_id will be 1, 2, 3 because we reset the sequence
INSERT INTO supplier_contacts (supplier_id, email, phone, address, city, country) VALUES
(1, 'sales@globalpump.com', '01234567890', '123 Industrial Zone', 'Cairo', 'Egypt'),
(2, 'info@aquatech.com', '01123456789', '456 Technology Park', 'Alexandria', 'Egypt'),
(3, 'contact@premiummotors.com', '01098765432', '789 Motor Street', 'Giza', 'Egypt');

-- ===========================
-- 2. INSERT TEST CUSTOMERS
-- ===========================
INSERT INTO customers (customer_name, credit_limit, payment_terms_days, status) VALUES
('Ahmed Construction LLC', 50000.00, 30, 'active'),
('Nile Agriculture Corp', 75000.00, 45, 'active'),
('Red Sea Irrigation Co.', 100000.00, 60, 'active'),
('Cairo Industrial Complex', 150000.00, 30, 'active');

-- Now customer_id will be 1, 2, 3, 4 because we reset the sequence
INSERT INTO customer_contacts (customer_id, email, phone, address, city, country) VALUES
(1, 'ahmed@construction.com', '01234567890', '15 Builder Street', 'Cairo', 'Egypt'),
(2, 'procurement@nileagri.com', '01123456789', '22 Farm Road', 'Alexandria', 'Egypt'),
(3, 'orders@redsea.com', '01098765432', '33 Coastal Avenue', 'Hurghada', 'Egypt'),
(4, 'purchasing@cairoindustrial.com', '01187654321', '44 Industrial Zone', 'Cairo', 'Egypt');

-- ===========================
-- 3. INSERT TEST PRODUCTS
-- ===========================
INSERT INTO products (product_name, sku, category_id, unit, unit_price, desired_excess, moq, is_active) VALUES
('Centrifugal Pump 5HP', 'CP-5HP-001', 1, 'unit', 3500.00, 10, 2, true),
('Submersible Pump 3HP', 'SP-3HP-002', 1, 'unit', 2800.00, 15, 2, true),
('Booster Pump 2HP', 'BP-2HP-003', 1, 'unit', 1800.00, 20, 3, true),
('Electric Motor 5HP', 'EM-5HP-004', 2, 'unit', 1500.00, 8, 2, true),
('Pump Controller Unit', 'PCU-001', 3, 'unit', 450.00, 25, 5, true),
('Water Filter 10 inch', 'WF-10-005', 3, 'unit', 120.00, 50, 10, true),
('Pressure Tank 50L', 'PT-50L-006', 3, 'unit', 800.00, 12, 3, true),
('Valve Set Standard', 'VS-STD-007', 4, 'set', 250.00, 30, 5, true);

-- ===========================
-- 4. INSERT INVENTORY
-- ===========================
INSERT INTO inventory (product_id, quantity, reorder_point, location) VALUES
(1, 8, 10, 'Main Warehouse - Aisle A1'),
(2, 12, 15, 'Main Warehouse - Aisle A2'),
(3, 18, 20, 'Main Warehouse - Aisle A3'),
(4, 6, 8, 'Main Warehouse - Aisle B1'),
(5, 22, 25, 'Main Warehouse - Aisle C1'),
(6, 45, 50, 'Main Warehouse - Aisle C2'),
(7, 10, 12, 'Main Warehouse - Aisle D1'),
(8, 28, 30, 'Main Warehouse - Aisle D2');

-- ===========================
-- 5. INSERT TEST PURCHASE ORDERS
-- ===========================
INSERT INTO purchase_orders (po_number, supplier_id, order_date, delivery_date, status, payment_terms, installments, currency, total, created_by) VALUES
('PO-2025-001', 1, '2025-01-10', '2025-02-10', 'approved', 'installment', 3, 'EGP', 42000.00, 1),
('PO-2025-002', 2, '2025-01-15', '2025-02-01', 'pending', 'prepaid', NULL, 'EGP', 15600.00, 1),
('PO-2025-003', 3, '2025-01-20', '2025-02-20', 'approved', 'installment', 6, 'EGP', 18000.00, 1);

-- Purchase Order Items
INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_price, total) VALUES
(1, 1, 10, 3200.00, 32000.00),
(1, 4, 5, 2000.00, 10000.00),
(2, 5, 20, 400.00, 8000.00),
(2, 6, 50, 152.00, 7600.00),
(3, 3, 10, 1800.00, 18000.00);

-- ===========================
-- 6. INSERT TEST SALES ORDERS
-- ===========================
INSERT INTO sales_orders (so_number, customer_id, order_date, delivery_date, status, payment_terms, installments, total, created_by) VALUES
('SO-2025-001', 1, '2025-01-12', '2025-02-12', 'pending_accountant', 'installment', 3, 14000.00, 4),
('SO-2025-002', 2, '2025-01-18', '2025-02-18', 'accountant_approved', 'prepaid', NULL, 8400.00, 4),
('SO-2025-003', 3, '2025-01-22', '2025-03-01', 'ready_for_delivery', 'installment', 6, 25200.00, 4),
('SO-2025-004', 4, '2025-01-25', '2025-02-25', 'shipped', 'installment', 12, 52500.00, 4);

-- Sales Order Items
INSERT INTO sales_order_items (so_id, product_id, quantity, unit_price, total) VALUES
(1, 1, 4, 3500.00, 14000.00),
(2, 3, 3, 1800.00, 5400.00),
(2, 5, 5, 600.00, 3000.00),
(3, 2, 9, 2800.00, 25200.00),
(4, 1, 15, 3500.00, 52500.00);

-- ===========================
-- 7. INSERT SUPPLIER INVOICES (AP)
-- ===========================
INSERT INTO supplier_invoices (invoice_number, po_id, supplier_id, invoice_date, due_date, amount, paid_amount, payment_terms, installment_months, months_paid, status) VALUES
('INV-SUP-001', 1, 1, '2025-01-10', '2025-02-10', 42000.00, 14000.00, 'installment', 3, 1, 'partially_paid'),
('INV-SUP-003', 3, 3, '2025-01-20', '2025-02-20', 18000.00, 0.00, 'installment', 6, 0, 'pending');

-- ===========================
-- 8. INSERT CUSTOMER INVOICES (AR)
-- ===========================
INSERT INTO customer_invoices (invoice_number, so_id, customer_id, invoice_date, due_date, amount, collected_amount, payment_terms, installment_months, months_paid, status) VALUES
('INV-CUST-002', 2, 2, '2025-01-18', '2025-02-18', 8400.00, 8400.00, 'prepaid', 1, 1, 'paid'),
('INV-CUST-003', 3, 3, '2025-01-22', '2025-03-01', 25200.00, 4200.00, 'installment', 6, 1, 'partially_paid'),
('INV-CUST-004', 4, 4, '2025-01-25', '2025-02-25', 52500.00, 8750.00, 'installment', 12, 2, 'partially_paid');

-- ===========================
-- 9. INSERT PAYMENTS
-- ===========================
-- Supplier Payments
INSERT INTO supplier_payments (invoice_id, supplier_id, amount, payment_date, payment_method, reference_number, recorded_by) VALUES
(1, 1, 14000.00, '2025-02-10', 'Bank Transfer', 'PAY-SUP-001', 2);

-- Customer Payments
INSERT INTO customer_payments (invoice_id, customer_id, amount, payment_date, payment_method, reference_number, recorded_by) VALUES
(1, 2, 8400.00, '2025-01-18', 'Cash', 'PAY-CUST-001', 2),
(2, 3, 4200.00, '2025-02-01', 'Bank Transfer', 'PAY-CUST-002', 2),
(3, 4, 4375.00, '2025-02-01', 'Bank Transfer', 'PAY-CUST-003', 2),
(3, 4, 4375.00, '2025-03-01', 'Bank Transfer', 'PAY-CUST-004', 2);

-- ===========================
-- 10. INSERT INVENTORY TRANSACTIONS
-- ===========================
INSERT INTO inventory_transactions (product_id, transaction_type, reference_type, reference_id, reference_number, quantity_change, quantity_before, quantity_after, notes, created_by) VALUES
(1, 'sale', 'sales_order', 1, 'SO-2025-001', -4, 12, 8, 'Sales order SO-2025-001', 5),
(3, 'sale', 'sales_order', 2, 'SO-2025-002', -3, 21, 18, 'Sales order SO-2025-002', 5),
(5, 'sale', 'sales_order', 2, 'SO-2025-002', -5, 27, 22, 'Sales order SO-2025-002', 5),
(2, 'sale', 'sales_order', 3, 'SO-2025-003', -9, 21, 12, 'Sales order SO-2025-003', 5),
(1, 'sale', 'sales_order', 4, 'SO-2025-004', -15, 23, 8, 'Sales order SO-2025-004', 5);

-- ===========================
-- VERIFICATION QUERIES
-- ===========================
SELECT 'Suppliers' as entity, COUNT(*) as count FROM suppliers
UNION ALL
SELECT 'Customers', COUNT(*) FROM customers
UNION ALL
SELECT 'Products', COUNT(*) FROM products
UNION ALL
SELECT 'Inventory Items', COUNT(*) FROM inventory
UNION ALL
SELECT 'Purchase Orders', COUNT(*) FROM purchase_orders
UNION ALL
SELECT 'Sales Orders', COUNT(*) FROM sales_orders
UNION ALL
SELECT 'Supplier Invoices', COUNT(*) FROM supplier_invoices
UNION ALL
SELECT 'Customer Invoices', COUNT(*) FROM customer_invoices;
