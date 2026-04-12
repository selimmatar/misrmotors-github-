-- Populate warehouse_id for existing inventory records
-- Assigns all inventory to the first available warehouse (typically Main Warehouse)

-- First, get the first warehouse ID
DO $$
DECLARE
  first_warehouse_id INTEGER;
BEGIN
  -- Get the first warehouse
  SELECT warehouse_id INTO first_warehouse_id
  FROM warehouses
  ORDER BY warehouse_id
  LIMIT 1;
  
  -- Update all inventory records with NULL warehouse_id
  UPDATE inventory
  SET warehouse_id = first_warehouse_id
  WHERE warehouse_id IS NULL;
  
  RAISE NOTICE 'Updated inventory records to warehouse %', first_warehouse_id;
END $$;
