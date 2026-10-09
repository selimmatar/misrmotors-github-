-- Add sales_order_id to maintenance_work_orders table
ALTER TABLE maintenance_work_orders
ADD COLUMN IF NOT EXISTS sales_order_id INTEGER REFERENCES sales_orders(so_id);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_maintenance_work_orders_sales_order_id 
ON maintenance_work_orders(sales_order_id);

-- Add comment
COMMENT ON COLUMN maintenance_work_orders.sales_order_id IS 'Reference to the sales order that requires this maintenance';
