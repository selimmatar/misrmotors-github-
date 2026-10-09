-- Add warehouse_id to sales_orders table
-- This allows assigning a specific warehouse to fulfill an order

-- Add warehouse_id column to sales_orders
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(warehouse_id);

-- Set default warehouse for existing orders
UPDATE sales_orders 
SET warehouse_id = (SELECT warehouse_id FROM warehouses WHERE is_default = true LIMIT 1)
WHERE warehouse_id IS NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_sales_orders_warehouse ON sales_orders(warehouse_id);

-- Comment
COMMENT ON COLUMN sales_orders.warehouse_id IS 'The warehouse that will fulfill this sales order';

-- Verify
SELECT 'Warehouse column added to sales_orders' AS status;
SELECT COUNT(*) AS orders_with_warehouse FROM sales_orders WHERE warehouse_id IS NOT NULL;
