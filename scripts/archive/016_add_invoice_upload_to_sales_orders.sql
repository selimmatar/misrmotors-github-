-- Add invoice_file_url column to sales_orders table for accountant uploaded invoices
ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS invoice_file_url TEXT;

-- First, drop the old constraint if it exists
ALTER TABLE sales_orders
DROP CONSTRAINT IF EXISTS sales_orders_status_check;

-- Update all existing sales orders to use the new workflow statuses
UPDATE sales_orders 
SET status = CASE 
  WHEN status IN ('draft', 'pending', 'pending_warehouse') THEN 'pending_accountant'
  WHEN status IN ('approved', 'out_for_delivery') THEN 'accountant_approved'
  WHEN status = 'delivered' THEN 'delivered'
  WHEN status IN ('cancelled', 'rejected', 'shipped') THEN 'rejected'
  ELSE 'pending_accountant'
END;

-- Add the new constraint with the accountant workflow statuses
ALTER TABLE sales_orders
ADD CONSTRAINT sales_orders_status_check 
CHECK (status IN ('pending_accountant', 'accountant_approved', 'out_for_delivery', 'delivered', 'rejected'));

-- Add comment for clarity
COMMENT ON COLUMN sales_orders.invoice_file_url IS 'URL to the invoice file uploaded by accountant during approval';
COMMENT ON COLUMN sales_orders.status IS 'New workflow: Sales Rep creates (pending_accountant) -> Accountant approves with invoice (accountant_approved) -> Warehouse ships (out_for_delivery) -> Delivered';
