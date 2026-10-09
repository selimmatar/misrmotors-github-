-- Fix inventory table to support multi-warehouse
-- Change unique constraint from (product_id) to (product_id, warehouse_id)

-- First, drop the existing unique constraint on product_id if it exists
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_product_id_key;
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS unique_product_inventory;

-- Add new composite unique constraint
-- This allows the same product to exist in multiple warehouses
ALTER TABLE inventory 
ADD CONSTRAINT unique_product_warehouse UNIQUE (product_id, warehouse_id);

-- Add warehouse-specific reorder points
ALTER TABLE inventory 
ADD COLUMN IF NOT EXISTS warehouse_reorder_point INTEGER;

-- Comment
COMMENT ON CONSTRAINT unique_product_warehouse ON inventory IS 'Ensures each product can only appear once per warehouse';
COMMENT ON COLUMN inventory.warehouse_reorder_point IS 'Optional warehouse-specific reorder point (overrides global)';

-- Verify
SELECT 'Multi-warehouse inventory constraint updated' AS status;
SELECT COUNT(*) AS total_inventory_records FROM inventory;
