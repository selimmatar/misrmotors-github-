-- Add delivery address fields to sales_orders table
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_contact_name VARCHAR(255);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_contact_phone VARCHAR(50);

-- Verify the changes
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sales_orders' 
AND column_name IN ('delivery_address', 'delivery_contact_name', 'delivery_contact_phone');
