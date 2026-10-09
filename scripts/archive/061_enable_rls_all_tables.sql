-- Enable RLS on all tables that are missing it
-- This fixes all ERROR-level security issues

-- Tables missing RLS
ALTER TABLE IF EXISTS public.inventory_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sales_order_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.warehouse_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.warehouse_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reschedule_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.po_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.po_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.vendor_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.vendor_quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.delivery_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.delivery_permit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.price_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Create permissive policies to allow authenticated users to access these tables
-- These are basic policies - you may want to customize them based on your security requirements

-- Inventory allocations
DROP POLICY IF EXISTS "Allow authenticated users to manage inventory allocations" ON public.inventory_allocations;
CREATE POLICY "Allow authenticated users to manage inventory allocations"
  ON public.inventory_allocations FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Product images
DROP POLICY IF EXISTS "Allow authenticated users to manage product images" ON public.product_images;
CREATE POLICY "Allow authenticated users to manage product images"
  ON public.product_images FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Company settings
DROP POLICY IF EXISTS "Allow authenticated users to manage company settings" ON public.company_settings;
CREATE POLICY "Allow authenticated users to manage company settings"
  ON public.company_settings FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Product categories
DROP POLICY IF EXISTS "Allow authenticated users to manage product categories" ON public.product_categories;
CREATE POLICY "Allow authenticated users to manage product categories"
  ON public.product_categories FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Supplier payments
DROP POLICY IF EXISTS "Allow authenticated users to manage supplier payments" ON public.supplier_payments;
CREATE POLICY "Allow authenticated users to manage supplier payments"
  ON public.supplier_payments FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Customer payments
DROP POLICY IF EXISTS "Allow authenticated users to manage customer payments" ON public.customer_payments;
CREATE POLICY "Allow authenticated users to manage customer payments"
  ON public.customer_payments FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Document sequences
DROP POLICY IF EXISTS "Allow authenticated users to manage document sequences" ON public.document_sequences;
CREATE POLICY "Allow authenticated users to manage document sequences"
  ON public.document_sequences FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Sales order attachments
DROP POLICY IF EXISTS "Allow authenticated users to manage sales order attachments" ON public.sales_order_attachments;
CREATE POLICY "Allow authenticated users to manage sales order attachments"
  ON public.sales_order_attachments FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Supplier products
DROP POLICY IF EXISTS "Allow authenticated users to manage supplier products" ON public.supplier_products;
CREATE POLICY "Allow authenticated users to manage supplier products"
  ON public.supplier_products FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Goods receipts
DROP POLICY IF EXISTS "Allow authenticated users to manage goods receipts" ON public.goods_receipts;
CREATE POLICY "Allow authenticated users to manage goods receipts"
  ON public.goods_receipts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Goods receipt lines
DROP POLICY IF EXISTS "Allow authenticated users to manage goods receipt lines" ON public.goods_receipt_lines;
CREATE POLICY "Allow authenticated users to manage goods receipt lines"
  ON public.goods_receipt_lines FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Warehouse transfers
DROP POLICY IF EXISTS "Allow authenticated users to manage warehouse transfers" ON public.warehouse_transfers;
CREATE POLICY "Allow authenticated users to manage warehouse transfers"
  ON public.warehouse_transfers FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Warehouse transfer items
DROP POLICY IF EXISTS "Allow authenticated users to manage warehouse transfer items" ON public.warehouse_transfer_items;
CREATE POLICY "Allow authenticated users to manage warehouse transfer items"
  ON public.warehouse_transfer_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Product returns
DROP POLICY IF EXISTS "Allow authenticated users to manage product returns" ON public.product_returns;
CREATE POLICY "Allow authenticated users to manage product returns"
  ON public.product_returns FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Return items
DROP POLICY IF EXISTS "Allow authenticated users to manage return items" ON public.return_items;
CREATE POLICY "Allow authenticated users to manage return items"
  ON public.return_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Reschedule requests
DROP POLICY IF EXISTS "Allow authenticated users to manage reschedule requests" ON public.reschedule_requests;
CREATE POLICY "Allow authenticated users to manage reschedule requests"
  ON public.reschedule_requests FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- PO requests
DROP POLICY IF EXISTS "Allow authenticated users to manage PO requests" ON public.po_requests;
CREATE POLICY "Allow authenticated users to manage PO requests"
  ON public.po_requests FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- PO request items
DROP POLICY IF EXISTS "Allow authenticated users to manage PO request items" ON public.po_request_items;
CREATE POLICY "Allow authenticated users to manage PO request items"
  ON public.po_request_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Vendor quotations
DROP POLICY IF EXISTS "Allow authenticated users to manage vendor quotations" ON public.vendor_quotations;
CREATE POLICY "Allow authenticated users to manage vendor quotations"
  ON public.vendor_quotations FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Vendor quotation items
DROP POLICY IF EXISTS "Allow authenticated users to manage vendor quotation items" ON public.vendor_quotation_items;
CREATE POLICY "Allow authenticated users to manage vendor quotation items"
  ON public.vendor_quotation_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Delivery permits
DROP POLICY IF EXISTS "Allow authenticated users to manage delivery permits" ON public.delivery_permits;
CREATE POLICY "Allow authenticated users to manage delivery permits"
  ON public.delivery_permits FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Delivery permit items
DROP POLICY IF EXISTS "Allow authenticated users to manage delivery permit items" ON public.delivery_permit_items;
CREATE POLICY "Allow authenticated users to manage delivery permit items"
  ON public.delivery_permit_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Payment schedules
DROP POLICY IF EXISTS "Allow authenticated users to manage payment schedules" ON public.payment_schedules;
CREATE POLICY "Allow authenticated users to manage payment schedules"
  ON public.payment_schedules FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Price requests
DROP POLICY IF EXISTS "Allow authenticated users to manage price requests" ON public.price_requests;
CREATE POLICY "Allow authenticated users to manage price requests"
  ON public.price_requests FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Notifications
DROP POLICY IF EXISTS "Allow authenticated users to manage notifications" ON public.notifications;
CREATE POLICY "Allow authenticated users to manage notifications"
  ON public.notifications FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Activity logs
DROP POLICY IF EXISTS "Allow authenticated users to manage activity logs" ON public.activity_logs;
CREATE POLICY "Allow authenticated users to manage activity logs"
  ON public.activity_logs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
