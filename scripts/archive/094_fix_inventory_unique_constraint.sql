-- Fix inventory unique constraint to allow same product in multiple warehouses
-- The current constraint only on product_id prevents transfers

-- Drop the incorrect unique constraint on product_id only
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS unique_product_id;

-- Also drop the warehouse unique constraint if it exists (from earlier migration)
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_warehouse_unique_product_id;

-- Create the CORRECT unique constraint on product_id + warehouse_id combination
ALTER TABLE inventory ADD CONSTRAINT inventory_product_warehouse_unique 
  UNIQUE (product_id, warehouse_id);

-- Verify the constraint
SELECT 
  conname as constraint_name,
  contype as constraint_type
FROM pg_constraint 
WHERE conrelid = 'inventory'::regclass;

-- Show current inventory distribution
SELECT 
  i.product_id,
  p.product_name,
  i.warehouse_id,
  w.warehouse_name,
  i.quantity
FROM inventory i
JOIN products p ON p.product_id = i.product_id
LEFT JOIN warehouses w ON w.warehouse_id = i.warehouse_id
ORDER BY i.product_id, i.warehouse_id;
