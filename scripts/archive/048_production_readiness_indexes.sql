-- Production Readiness: Database Indexes for Performance
-- This script adds essential indexes for production performance
-- Safe to run multiple times (IF NOT EXISTS)

-- Sales Orders indexes
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_id ON sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at ON sales_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_order_date ON sales_orders(order_date DESC);

-- Purchase Orders indexes
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_delivery_date ON purchase_orders(delivery_date);

-- Inventory indexes
CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse_id ON inventory(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_quantity ON inventory(quantity);

-- Accounts Receivable indexes
CREATE INDEX IF NOT EXISTS idx_ar_status ON accounts_receivable(status);
CREATE INDEX IF NOT EXISTS idx_ar_customer_id ON accounts_receivable(customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_due_date ON accounts_receivable(due_date);
CREATE INDEX IF NOT EXISTS idx_ar_so_id ON accounts_receivable(so_id);

-- Accounts Payable indexes
CREATE INDEX IF NOT EXISTS idx_ap_status ON accounts_payable(status);
CREATE INDEX IF NOT EXISTS idx_ap_supplier_id ON accounts_payable(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ap_due_date ON accounts_payable(due_date);
CREATE INDEX IF NOT EXISTS idx_ap_po_id ON accounts_payable(po_id);

-- Delivery Permits indexes
CREATE INDEX IF NOT EXISTS idx_delivery_permits_status ON delivery_permits(status);
CREATE INDEX IF NOT EXISTS idx_delivery_permits_so_id ON delivery_permits(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_permits_customer_id ON delivery_permits(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_permits_created_at ON delivery_permits(created_at DESC);

-- Payment Schedules indexes
CREATE INDEX IF NOT EXISTS idx_payment_schedules_invoice_id ON payment_schedules(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_po_id ON payment_schedules(po_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_so_id ON payment_schedules(so_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_due_date ON payment_schedules(due_date);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_status ON payment_schedules(status);

-- Inventory Batches indexes
CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_id ON inventory_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_po_id ON inventory_batches(po_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_received_date ON inventory_batches(received_date DESC);

-- Balance Entries indexes
CREATE INDEX IF NOT EXISTS idx_balance_entries_entry_type ON balance_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_balance_entries_reference_type ON balance_entries(reference_type);
CREATE INDEX IF NOT EXISTS idx_balance_entries_created_at ON balance_entries(created_at DESC);

-- Products indexes
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

-- Customers indexes
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- Suppliers indexes
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_email ON suppliers(email);

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- Couriers indexes
CREATE INDEX IF NOT EXISTS idx_couriers_is_active ON couriers(is_active);

-- Warehouses indexes  
CREATE INDEX IF NOT EXISTS idx_warehouses_is_active ON warehouses(is_active);
CREATE INDEX IF NOT EXISTS idx_warehouses_is_default ON warehouses(is_default);

-- Sales Order Items indexes
CREATE INDEX IF NOT EXISTS idx_so_items_so_id ON sales_order_items(so_id);
CREATE INDEX IF NOT EXISTS idx_so_items_product_id ON sales_order_items(product_id);

-- Purchase Order Items indexes
CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product_id ON purchase_order_items(product_id);

-- Delivery Permit Items indexes
CREATE INDEX IF NOT EXISTS idx_dp_items_permit_id ON delivery_permit_items(permit_id);
CREATE INDEX IF NOT EXISTS idx_dp_items_product_id ON delivery_permit_items(product_id);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_so_customer_status ON sales_orders(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_po_supplier_status ON purchase_orders(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_customer_status ON accounts_receivable(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_ap_supplier_status ON accounts_payable(supplier_id, status);
