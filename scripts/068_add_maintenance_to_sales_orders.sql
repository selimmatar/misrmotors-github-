-- Add maintenance-related fields to sales_orders table

-- Add requires_maintenance field to track if SO needs maintenance service
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS requires_maintenance BOOLEAN DEFAULT false;

-- Add maintenance_work_order_id to link SO with maintenance work order
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS maintenance_work_order_id INTEGER REFERENCES maintenance_work_orders(work_order_id);

-- Add maintenance notes
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS maintenance_notes TEXT;

-- Add maintenance priority
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS maintenance_priority VARCHAR(20) CHECK (maintenance_priority IN ('low', 'medium', 'high', 'urgent'));

-- Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_sales_orders_maintenance_work_order 
ON sales_orders(maintenance_work_order_id);

CREATE INDEX IF NOT EXISTS idx_sales_orders_requires_maintenance 
ON sales_orders(requires_maintenance);
