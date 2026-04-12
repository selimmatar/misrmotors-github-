-- ===============================================
-- MISR MOTORS ERP SYSTEM — RELATIONAL DATABASE SCHEMA
-- Using incremental integer IDs (no UUID)
-- ===============================================

-- Drop all existing tables (in reverse dependency order)
DROP TABLE IF EXISTS balance_entries CASCADE;
DROP TABLE IF EXISTS supplier_payments CASCADE;
DROP TABLE IF EXISTS supplier_invoices CASCADE;
DROP TABLE IF EXISTS purchase_order_items CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS customer_payments CASCADE;
DROP TABLE IF EXISTS customer_invoices CASCADE;
DROP TABLE IF EXISTS sales_order_items CASCADE;
DROP TABLE IF EXISTS sales_orders CASCADE;
DROP TABLE IF EXISTS inventory_transactions CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS product_categories CASCADE;
DROP TABLE IF EXISTS supplier_contacts CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS customer_contacts CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ===========================
-- 1. USERS (MASTER ENTITY)
-- ===========================
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(120) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) CHECK (role IN 
    ('ceo', 'accountant', 'sales_rep', 'warehouse_rep', 'po_rep', 'admin', 'shipment')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- 2. CUSTOMERS (MASTER ENTITY)
-- ===========================
CREATE TABLE customers (
  customer_id SERIAL PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  credit_limit NUMERIC(12,2),
  payment_terms_days INTEGER DEFAULT 30,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- BABY ENTITY: CUSTOMER_CONTACTS
CREATE TABLE customer_contacts (
  contact_id SERIAL PRIMARY KEY,
  customer_id INT REFERENCES customers(customer_id),
  email VARCHAR(120),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(50),
  country VARCHAR(50)
);

-- ===========================
-- 3. SUPPLIERS (MASTER ENTITY)
-- ===========================
CREATE TABLE suppliers (
  supplier_id SERIAL PRIMARY KEY,
  supplier_name VARCHAR(100) NOT NULL,
  payment_terms VARCHAR(20) CHECK (payment_terms IN ('prepaid', 'installment')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- BABY ENTITY: SUPPLIER_CONTACTS
CREATE TABLE supplier_contacts (
  contact_id SERIAL PRIMARY KEY,
  supplier_id INT REFERENCES suppliers(supplier_id),
  email VARCHAR(120),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(50),
  country VARCHAR(50)
);

-- ===========================
-- 4. PRODUCTS (MASTER ENTITY)
-- ===========================
CREATE TABLE product_categories (
  category_id SERIAL PRIMARY KEY,
  category_name VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE products (
  product_id SERIAL PRIMARY KEY,
  product_name VARCHAR(120) NOT NULL,
  sku VARCHAR(50) UNIQUE NOT NULL,
  category_id INT REFERENCES product_categories(category_id),
  unit VARCHAR(20) DEFAULT 'pcs',
  unit_price NUMERIC(10,2) NOT NULL,
  desired_excess INT DEFAULT 0,
  moq INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- 5. INVENTORY MODULE
-- ===========================
CREATE TABLE inventory (
  inventory_id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(product_id),
  quantity INT DEFAULT 0,
  reorder_point INT DEFAULT 10,
  location VARCHAR(100) DEFAULT 'Main Warehouse',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_transactions (
  transaction_id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(product_id),
  transaction_type VARCHAR(20) CHECK (transaction_type IN ('purchase', 'sale', 'adjustment', 'return')),
  reference_type VARCHAR(20),
  reference_id INT,
  reference_number VARCHAR(50),
  quantity_change INT,
  quantity_before INT,
  quantity_after INT,
  notes TEXT,
  created_by INT REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- 6. SALES MODULE
-- ===========================
CREATE TABLE sales_orders (
  so_id SERIAL PRIMARY KEY,
  so_number VARCHAR(50) UNIQUE NOT NULL,
  customer_id INT REFERENCES customers(customer_id),
  order_date DATE NOT NULL,
  delivery_date DATE,
  status VARCHAR(30) DEFAULT 'draft' CHECK (status IN 
    ('draft', 'pending', 'pending_accountant', 'accountant_approved', 
     'ready_for_delivery', 'shipped', 'delivered', 'cancelled')),
  payment_terms VARCHAR(20) CHECK (payment_terms IN ('prepaid', 'installment')),
  installments INT,
  total NUMERIC(12,2) NOT NULL,
  notes TEXT,
  invoice_file_url TEXT,
  created_by INT REFERENCES users(user_id),
  approved_by INT REFERENCES users(user_id),
  approved_at TIMESTAMP,
  shipped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_order_items (
  so_item_id SERIAL PRIMARY KEY,
  so_id INT REFERENCES sales_orders(so_id) ON DELETE CASCADE,
  product_id INT REFERENCES products(product_id),
  quantity INT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL
);

CREATE TABLE customer_invoices (
  invoice_id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  so_id INT REFERENCES sales_orders(so_id),
  customer_id INT REFERENCES customers(customer_id),
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  collected_amount NUMERIC(12,2) DEFAULT 0,
  balance NUMERIC(12,2) GENERATED ALWAYS AS (amount - collected_amount) STORED,
  payment_terms VARCHAR(20),
  installment_months INT DEFAULT 1,
  months_paid INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_payments (
  payment_id SERIAL PRIMARY KEY,
  invoice_id INT REFERENCES customer_invoices(invoice_id),
  customer_id INT REFERENCES customers(customer_id),
  amount NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50),
  reference_number VARCHAR(50),
  recorded_by INT REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- 7. PURCHASE MODULE
-- ===========================
CREATE TABLE purchase_orders (
  po_id SERIAL PRIMARY KEY,
  po_number VARCHAR(50) UNIQUE NOT NULL,
  supplier_id INT REFERENCES suppliers(supplier_id),
  order_date DATE NOT NULL,
  delivery_date DATE,
  status VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'received')),
  payment_terms VARCHAR(20) CHECK (payment_terms IN ('prepaid', 'installment')),
  installments INT,
  currency VARCHAR(10) DEFAULT 'EGP',
  total NUMERIC(12,2) NOT NULL,
  invoice_file_url TEXT,
  created_by INT REFERENCES users(user_id),
  approved_by INT REFERENCES users(user_id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_order_items (
  po_item_id SERIAL PRIMARY KEY,
  po_id INT REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
  product_id INT REFERENCES products(product_id),
  quantity INT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL
);

CREATE TABLE supplier_invoices (
  invoice_id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  po_id INT REFERENCES purchase_orders(po_id),
  supplier_id INT REFERENCES suppliers(supplier_id),
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  paid_amount NUMERIC(12,2) DEFAULT 0,
  balance NUMERIC(12,2) GENERATED ALWAYS AS (amount - paid_amount) STORED,
  payment_terms VARCHAR(20),
  installment_months INT DEFAULT 1,
  months_paid INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE supplier_payments (
  payment_id SERIAL PRIMARY KEY,
  invoice_id INT REFERENCES supplier_invoices(invoice_id),
  supplier_id INT REFERENCES suppliers(supplier_id),
  amount NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50),
  reference_number VARCHAR(50),
  recorded_by INT REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- 8. BALANCE ENTRIES (ACCOUNTING)
-- ===========================
CREATE TABLE balance_entries (
  entry_id SERIAL PRIMARY KEY,
  entry_type VARCHAR(20) CHECK (entry_type IN 
    ('sales_order', 'purchase_order', 'ar_payment', 'ap_payment', 'adjustment')),
  reference_type VARCHAR(30),
  reference_id INT,
  reference_number VARCHAR(50),
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  created_by INT REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- INDEXES FOR PERFORMANCE
-- ===========================
CREATE INDEX idx_customer_contacts_customer ON customer_contacts(customer_id);
CREATE INDEX idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_inventory_product ON inventory(product_id);
CREATE INDEX idx_inventory_transactions_product ON inventory_transactions(product_id);
CREATE INDEX idx_so_customer ON sales_orders(customer_id);
CREATE INDEX idx_so_items_so ON sales_order_items(so_id);
CREATE INDEX idx_so_items_product ON sales_order_items(product_id);
CREATE INDEX idx_customer_invoices_so ON customer_invoices(so_id);
CREATE INDEX idx_customer_invoices_customer ON customer_invoices(customer_id);
CREATE INDEX idx_customer_payments_invoice ON customer_payments(invoice_id);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_items_po ON purchase_order_items(po_id);
CREATE INDEX idx_po_items_product ON purchase_order_items(product_id);
CREATE INDEX idx_supplier_invoices_po ON supplier_invoices(po_id);
CREATE INDEX idx_supplier_invoices_supplier ON supplier_invoices(supplier_id);
CREATE INDEX idx_supplier_payments_invoice ON supplier_payments(invoice_id);

-- ===========================
-- SEED DEFAULT DATA
-- ===========================

-- Insert default admin user
INSERT INTO users (full_name, email, password_hash, role) VALUES
('Admin User', 'admin@misrmotors.com', 'admin123', 'admin'),
('CEO', 'ceo@misrmotors.com', 'ceo123', 'ceo'),
('Accountant', 'accountant@misrmotors.com', 'acc123', 'accountant'),
('Sales Rep', 'sales@misrmotors.com', 'sales123', 'sales_rep'),
('Warehouse Rep', 'warehouse@misrmotors.com', 'warehouse123', 'warehouse_rep'),
('PO Rep', 'po@misrmotors.com', 'po123', 'po_rep'),
('Shipment', 'shipment@misrmotors.com', 'ship123', 'shipment');

-- Insert default categories
INSERT INTO product_categories (category_name) VALUES
('Water Pumps'),
('Motors'),
('Accessories'),
('Parts');
