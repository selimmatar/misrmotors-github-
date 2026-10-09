-- Add SO type classification fields
-- Safe migration that defaults existing records to 'EQUIPMENT'

-- Add so_type column to sales_orders
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS so_type VARCHAR(50) DEFAULT 'EQUIPMENT';

-- Add item_category column to sales_order_items  
ALTER TABLE sales_order_items
ADD COLUMN IF NOT EXISTS item_category VARCHAR(50) DEFAULT 'EQUIPMENT';

-- Update any null values to EQUIPMENT for backward compatibility
UPDATE sales_orders SET so_type = 'EQUIPMENT' WHERE so_type IS NULL;
UPDATE sales_order_items SET item_category = 'EQUIPMENT' WHERE item_category IS NULL;

-- Add check constraint for valid so_type values
ALTER TABLE sales_orders 
DROP CONSTRAINT IF EXISTS check_so_type;

ALTER TABLE sales_orders 
ADD CONSTRAINT check_so_type 
CHECK (so_type IN ('EQUIPMENT', 'MAINTENANCE_PARTS', 'MIXED'));

-- Add check constraint for valid item_category values
ALTER TABLE sales_order_items 
DROP CONSTRAINT IF EXISTS check_item_category;

ALTER TABLE sales_order_items 
ADD CONSTRAINT check_item_category 
CHECK (item_category IN ('EQUIPMENT', 'MAINTENANCE_PARTS'));

-- Create index for filtering by so_type
CREATE INDEX IF NOT EXISTS idx_sales_orders_so_type ON sales_orders(so_type);
