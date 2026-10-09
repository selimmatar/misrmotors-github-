-- Add pending_accountant and accountant_approved statuses to sales_orders if not already present
-- This allows the accountant approval workflow

-- Check if the status column allows these values, if using CHECK constraint update it
-- For most implementations, this should already work if status is VARCHAR/TEXT without constraints

-- Add any missing statuses to the documentation/enum if needed
COMMENT ON COLUMN sales_orders.status IS 'Status of the sales order: draft, pending, pending_accountant, accountant_approved, approved, shipped, delivered';
