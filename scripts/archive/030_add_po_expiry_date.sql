-- Add expiry date column to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- Add comment for documentation
COMMENT ON COLUMN purchase_orders.expiry_date IS 'The expiration date of the purchase order';
