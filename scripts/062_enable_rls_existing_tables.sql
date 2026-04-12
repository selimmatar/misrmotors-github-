-- Enable RLS on all existing tables that are missing it
-- This fixes all ERROR-level security vulnerabilities

-- Enable RLS on each table
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE reschedule_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_transfers ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users to access all data
-- company_settings
CREATE POLICY "Allow authenticated users full access to company_settings"
ON company_settings FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- customer_payments
CREATE POLICY "Allow authenticated users full access to customer_payments"
ON customer_payments FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- document_sequences
CREATE POLICY "Allow authenticated users full access to document_sequences"
ON document_sequences FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- goods_receipt_lines
CREATE POLICY "Allow authenticated users full access to goods_receipt_lines"
ON goods_receipt_lines FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- goods_receipts
CREATE POLICY "Allow authenticated users full access to goods_receipts"
ON goods_receipts FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- inventory_allocations
CREATE POLICY "Allow authenticated users full access to inventory_allocations"
ON inventory_allocations FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- po_request_items
CREATE POLICY "Allow authenticated users full access to po_request_items"
ON po_request_items FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- po_requests
CREATE POLICY "Allow authenticated users full access to po_requests"
ON po_requests FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- product_categories
CREATE POLICY "Allow authenticated users full access to product_categories"
ON product_categories FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- product_images
CREATE POLICY "Allow authenticated users full access to product_images"
ON product_images FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- product_returns
CREATE POLICY "Allow authenticated users full access to product_returns"
ON product_returns FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- reschedule_requests
CREATE POLICY "Allow authenticated users full access to reschedule_requests"
ON reschedule_requests FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- return_items
CREATE POLICY "Allow authenticated users full access to return_items"
ON return_items FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- sales_order_attachments
CREATE POLICY "Allow authenticated users full access to sales_order_attachments"
ON sales_order_attachments FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- supplier_payments
CREATE POLICY "Allow authenticated users full access to supplier_payments"
ON supplier_payments FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- supplier_products
CREATE POLICY "Allow authenticated users full access to supplier_products"
ON supplier_products FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- warehouse_transfer_items
CREATE POLICY "Allow authenticated users full access to warehouse_transfer_items"
ON warehouse_transfer_items FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- warehouse_transfers
CREATE POLICY "Allow authenticated users full access to warehouse_transfers"
ON warehouse_transfers FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
