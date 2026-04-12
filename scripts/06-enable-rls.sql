-- Enable Row Level Security on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_entries ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users (we'll allow all operations for authenticated users)
-- In production, you'd want more granular policies based on roles

-- Users table policies
CREATE POLICY "Allow authenticated users to read users" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to update own profile" ON users FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Suppliers policies
CREATE POLICY "Allow authenticated users full access to suppliers" ON suppliers FOR ALL TO authenticated USING (true);

-- Customers policies
CREATE POLICY "Allow authenticated users full access to customers" ON customers FOR ALL TO authenticated USING (true);

-- Products policies
CREATE POLICY "Allow authenticated users full access to products" ON products FOR ALL TO authenticated USING (true);

-- Inventory policies
CREATE POLICY "Allow authenticated users full access to inventory" ON inventory FOR ALL TO authenticated USING (true);

-- Purchase Orders policies
CREATE POLICY "Allow authenticated users full access to purchase_orders" ON purchase_orders FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users full access to purchase_order_items" ON purchase_order_items FOR ALL TO authenticated USING (true);

-- Supplier Invoices and Payments policies
CREATE POLICY "Allow authenticated users full access to supplier_invoices" ON supplier_invoices FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users full access to supplier_payments" ON supplier_payments FOR ALL TO authenticated USING (true);

-- Sales Orders policies
CREATE POLICY "Allow authenticated users full access to sales_orders" ON sales_orders FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users full access to sales_order_items" ON sales_order_items FOR ALL TO authenticated USING (true);

-- Customer Invoices and Payments policies
CREATE POLICY "Allow authenticated users full access to customer_invoices" ON customer_invoices FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users full access to customer_payments" ON customer_payments FOR ALL TO authenticated USING (true);

-- Tracking tables policies
CREATE POLICY "Allow authenticated users full access to inventory_transactions" ON inventory_transactions FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users full access to balance_entries" ON balance_entries FOR ALL TO authenticated USING (true);
