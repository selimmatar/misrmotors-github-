-- Check if inventory records have warehouse_id populated
SELECT 
  inventory_id,
  product_id,
  warehouse_id,
  quantity,
  location
FROM inventory
LIMIT 10;

-- Count how many inventory records have warehouse_id
SELECT 
  COUNT(*) as total_records,
  COUNT(warehouse_id) as with_warehouse,
  COUNT(*) - COUNT(warehouse_id) as without_warehouse
FROM inventory;
