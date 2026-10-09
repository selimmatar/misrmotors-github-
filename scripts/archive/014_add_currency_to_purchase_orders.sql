-- Add currency column to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN currency TEXT NOT NULL DEFAULT 'EGP' CHECK (currency IN ('EGP', 'USD'));

-- Update existing records to have EGP as currency
UPDATE purchase_orders 
SET currency = 'EGP' 
WHERE currency IS NULL;

COMMENT ON COLUMN purchase_orders.currency IS 'Currency for the purchase order (EGP or USD)';
