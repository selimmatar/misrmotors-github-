-- Fix the sales_orders status constraint to include all workflow statuses
-- This ensures the complete workflow: pending_accountant -> accountant_approved -> out_for_delivery -> shipped -> delivered

-- Drop the existing constraint
ALTER TABLE sales_orders
DROP CONSTRAINT IF EXISTS sales_orders_status_check;

-- Add the correct constraint with all required statuses
ALTER TABLE sales_orders
ADD CONSTRAINT sales_orders_status_check 
CHECK (status IN ('pending_accountant', 'accountant_approved', 'out_for_delivery', 'shipped', 'delivered', 'rejected'));

-- Update comment for clarity
COMMENT ON COLUMN sales_orders.status IS 'Workflow: Sales Rep creates (pending_accountant) -> Accountant approves with invoice (accountant_approved) -> Warehouse marks ready (out_for_delivery) -> Shipping team ships (shipped) -> Delivered';
