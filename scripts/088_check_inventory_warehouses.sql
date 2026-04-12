-- Check current inventory warehouse distribution
SELECT 
  p.product_name,
  i.quantity,
  i.warehouse_id,
  w.warehouse_name,
  i.location
FROM inventory i
LEFT JOIN products p ON i.product_id = p.product_id
LEFT JOIN warehouses w ON i.warehouse_id = w.warehouse_id
ORDER BY p.product_name, w.warehouse_name;

-- Check total items per warehouse
SELECT 
  w.warehouse_id,
  w.warehouse_name,
  COUNT(i.inventory_id) as item_count,
  SUM(i.quantity) as total_quantity
FROM warehouses w
LEFT JOIN inventory i ON w.warehouse_id = i.warehouse_id
GROUP BY w.warehouse_id, w.warehouse_name
ORDER BY w.warehouse_id;
