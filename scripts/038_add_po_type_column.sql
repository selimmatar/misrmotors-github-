-- Add po_type column to purchase_orders table
-- Values: 'local' or 'international'

ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS po_type VARCHAR(20) DEFAULT 'local';

-- Add check constraint
ALTER TABLE purchase_orders
DROP CONSTRAINT IF EXISTS purchase_orders_po_type_check;

ALTER TABLE purchase_orders
ADD CONSTRAINT purchase_orders_po_type_check 
CHECK (po_type IN ('local', 'international'));

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'purchase_orders' AND column_name = 'po_type';
