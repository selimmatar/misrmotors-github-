-- Add PO invoice URL to purchase orders
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS po_invoice_url TEXT;

-- Add shipping invoice URL and new statuses to sales orders
ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS shipping_invoice_url TEXT;

-- Update sales orders status constraint to include new shipping statuses
ALTER TABLE sales_orders
DROP CONSTRAINT IF EXISTS sales_orders_status_check;

ALTER TABLE sales_orders
ADD CONSTRAINT sales_orders_status_check
CHECK (status IN ('pending_accountant', 'accountant_approved', 'ready_for_delivery', 'shipped', 'delivered', 'rejected', 'cancelled'));

-- Migrate existing statuses to new workflow
UPDATE sales_orders
SET status = CASE
  WHEN status = 'out_for_delivery' THEN 'ready_for_delivery'
  WHEN status NOT IN ('pending_accountant', 'accountant_approved', 'ready_for_delivery', 'shipped', 'delivered', 'rejected', 'cancelled') 
  THEN 'pending_accountant'
  ELSE status
END;
